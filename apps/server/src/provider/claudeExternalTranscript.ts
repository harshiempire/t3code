// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for Claude Code transcript imports.
 *
 * Claude stores one JSON object per line, including tool traffic and metadata
 * alongside the conversation. Streaming keeps large sessions cheap to import.
 *
 * @module claudeExternalTranscript
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import { expandHomePath } from "../pathExpansion.ts";

export type ImportedTranscriptMessage = {
  readonly uuid: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
};

export type ExternalTranscriptReadResult = {
  readonly messages: readonly ImportedTranscriptMessage[];
  readonly totalMessageCount: number;
  readonly cwd: string | null;
};

type JsonObject = { readonly [key: string]: unknown };

type ParsedMessage = ImportedTranscriptMessage & {
  readonly assistantMessageId: string | null;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractText = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;

  const textBlocks: string[] = [];
  for (const block of value) {
    if (!isJsonObject(block) || block.type !== "text" || typeof block.text !== "string") {
      continue;
    }
    textBlocks.push(block.text);
  }
  return textBlocks.join("\n\n");
};

const truncationSuffix = "\n\n[truncated]";

const truncateText = (text: string, maxTextLength: number): string => {
  const maximum = Math.max(0, maxTextLength);
  return text.length > maximum ? `${text.slice(0, maximum)}${truncationSuffix}` : text;
};

/**
 * Mirrors ClaudeHome.resolveClaudeHomePath for callers that cannot carry the
 * Path service: blank setting falls back to the OS home directory.
 */
export function resolveClaudeHomePathFromSetting(homePathSetting: string): string {
  const trimmed = homePathSetting.trim();
  return NodePath.resolve(trimmed.length > 0 ? expandHomePath(trimmed) : NodeOS.homedir());
}

/** Resolves Claude's default nested projects directory, with legacy fallback. */
export async function resolveClaudeTranscriptDir(homePath: string): Promise<string> {
  const nested = NodePath.join(homePath, ".claude", "projects");
  try {
    const stats = await NodeFSP.stat(nested);
    if (stats.isDirectory()) return nested;
  } catch {
    // Claude's config directory has not been created yet.
  }
  return NodePath.join(homePath, "projects");
}

/**
 * Finds a main-session transcript below one project directory.
 *
 * Individual entries can disappear while Claude rotates transcript files, so
 * their errors are ignored and the rest of the directory remains useful.
 */
export async function findClaudeSessionTranscriptPath(
  transcriptDir: string,
  sessionId: string,
): Promise<string | null> {
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = await NodeFSP.readdir(transcriptDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = NodePath.join(transcriptDir, entry.name, `${sessionId}.jsonl`);
    try {
      if ((await NodeFSP.stat(candidate)).isFile()) return candidate;
    } catch {
      // Vanished between readdir and stat, or is not readable.
    }
  }
  return null;
}

/**
 * Streams a Claude session and returns only the human-visible conversation.
 * Returns `null` when the transcript cannot be opened or read.
 */
export async function readClaudeSessionTranscriptMessages(
  filePath: string,
  options: { readonly maxMessages: number; readonly maxTextLength: number },
): Promise<ExternalTranscriptReadResult | null> {
  const parsedMessages: ParsedMessage[] = [];
  let cwd: string | null = null;

  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isJsonObject(parsed)) continue;

      const role = parsed.type;
      if (
        (role !== "user" && role !== "assistant") ||
        parsed.isSidechain === true ||
        parsed.isMeta === true ||
        !isJsonObject(parsed.message)
      ) {
        continue;
      }

      const text = extractText(parsed.message.content);
      if (text === null || text.trim() === "") continue;
      if (
        role === "user" &&
        (text.startsWith("<command-name>") ||
          text.startsWith("<local-command-stdout>") ||
          text.startsWith("Caveat: The messages below"))
      ) {
        continue;
      }

      if (typeof parsed.uuid !== "string" || typeof parsed.timestamp !== "string") continue;
      if (cwd === null && typeof parsed.cwd === "string" && parsed.cwd.trim() !== "") {
        cwd = parsed.cwd;
      }

      const assistantMessageId =
        role === "assistant" && typeof parsed.message.id === "string" ? parsed.message.id : null;
      const previous = parsedMessages.at(-1);
      if (
        role === "assistant" &&
        assistantMessageId !== null &&
        previous?.role === "assistant" &&
        previous.assistantMessageId === assistantMessageId
      ) {
        parsedMessages[parsedMessages.length - 1] = {
          ...previous,
          text: `${previous.text}\n\n${text}`,
        };
        continue;
      }

      parsedMessages.push({
        uuid: parsed.uuid,
        role,
        text,
        createdAt: parsed.timestamp,
        assistantMessageId,
      });
    }
  } catch {
    return null;
  }

  const totalMessageCount = parsedMessages.length;
  const cappedMessages = options.maxMessages <= 0 ? [] : parsedMessages.slice(-options.maxMessages);
  return {
    messages: cappedMessages.map(({ assistantMessageId: _, ...message }) => ({
      ...message,
      text: truncateText(message.text, options.maxTextLength),
    })),
    totalMessageCount,
    cwd,
  };
}
