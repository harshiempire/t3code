// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  findClaudeSessionTranscriptPath,
  readClaudeSessionTranscriptMessages,
  resolveClaudeTranscriptDir,
} from "./claudeExternalTranscript.ts";

const options = { maxMessages: 100, maxTextLength: 10_000 };

const withTempDir = async (run: (dir: string) => Promise<void> | void): Promise<void> => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-claude-transcript-"));
  try {
    await run(dir);
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
};

const writeTranscript = (dir: string, lines: readonly (object | string)[]): string => {
  const path = NodePath.join(dir, "session.jsonl");
  NodeFS.writeFileSync(
    path,
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"),
  );
  return path;
};

const transcriptLine = (
  type: "user" | "assistant",
  uuid: string,
  timestamp: string,
  content: unknown,
  extra: Record<string, unknown> = {},
) => ({
  type,
  uuid,
  timestamp,
  isSidechain: false,
  cwd: "/workspace/t3code",
  message: { role: type, content },
  ...extra,
});

describe("claudeExternalTranscript", () => {
  it("extracts human text and skips transcript-only content", async () => {
    await withTempDir(async (dir) => {
      const filePath = writeTranscript(dir, [
        transcriptLine("user", "user-1", "2026-08-17T00:00:00.000Z", [
          { type: "text", text: "Please inspect this" },
        ]),
        transcriptLine("assistant", "assistant-1", "2026-08-17T00:00:01.000Z", [
          { type: "thinking", thinking: "reasoning" },
          { type: "text", text: "I found it." },
          { type: "tool_use", name: "Read" },
        ]),
        transcriptLine("user", "tool-result", "2026-08-17T00:00:02.000Z", [
          { type: "tool_result", content: "hidden" },
        ]),
        transcriptLine("assistant", "thinking-only", "2026-08-17T00:00:03.000Z", [
          { type: "thinking", thinking: "hidden" },
          { type: "tool_use", name: "Read" },
        ]),
        transcriptLine("user", "sidechain", "2026-08-17T00:00:04.000Z", "Not main", {
          isSidechain: true,
        }),
        "not json",
      ]);

      const result = await readClaudeSessionTranscriptMessages(filePath, options);
      expect(result).toEqual({
        messages: [
          {
            uuid: "user-1",
            role: "user",
            text: "Please inspect this",
            createdAt: "2026-08-17T00:00:00.000Z",
          },
          {
            uuid: "assistant-1",
            role: "assistant",
            text: "I found it.",
            createdAt: "2026-08-17T00:00:01.000Z",
          },
        ],
        totalMessageCount: 2,
        cwd: "/workspace/t3code",
      });
    });
  });

  it("accepts plain-string content and drops CLI command wrappers", async () => {
    await withTempDir(async (dir) => {
      const filePath = writeTranscript(dir, [
        transcriptLine("user", "command", "2026-08-17T00:00:00.000Z", "<command-name>/help"),
        transcriptLine(
          "user",
          "stdout",
          "2026-08-17T00:00:01.000Z",
          "<local-command-stdout>output",
        ),
        transcriptLine(
          "user",
          "caveat",
          "2026-08-17T00:00:02.000Z",
          "Caveat: The messages below are injected",
        ),
        transcriptLine("assistant", "assistant-1", "2026-08-17T00:00:03.000Z", "Plain reply"),
      ]);

      const result = await readClaudeSessionTranscriptMessages(filePath, options);
      expect(result?.messages).toEqual([
        {
          uuid: "assistant-1",
          role: "assistant",
          text: "Plain reply",
          createdAt: "2026-08-17T00:00:03.000Z",
        },
      ]);
    });
  });

  it("merges assistant continuations across skipped tool results but not users", async () => {
    await withTempDir(async (dir) => {
      const filePath = writeTranscript(dir, [
        transcriptLine("assistant", "first", "2026-08-17T00:00:00.000Z", "First", {
          message: { role: "assistant", id: "msg-1", content: "First" },
        }),
        transcriptLine("user", "tool", "2026-08-17T00:00:01.000Z", [
          { type: "tool_result", content: "ignored" },
        ]),
        transcriptLine("assistant", "second", "2026-08-17T00:00:02.000Z", "Second", {
          message: { role: "assistant", id: "msg-1", content: "Second" },
        }),
        transcriptLine("user", "user-1", "2026-08-17T00:00:03.000Z", "New question"),
        transcriptLine("assistant", "third", "2026-08-17T00:00:04.000Z", "Third", {
          message: { role: "assistant", id: "msg-1", content: "Third" },
        }),
      ]);

      const result = await readClaudeSessionTranscriptMessages(filePath, options);
      expect(result?.messages).toEqual([
        {
          uuid: "first",
          role: "assistant",
          text: "First\n\nSecond",
          createdAt: "2026-08-17T00:00:00.000Z",
        },
        {
          uuid: "user-1",
          role: "user",
          text: "New question",
          createdAt: "2026-08-17T00:00:03.000Z",
        },
        {
          uuid: "third",
          role: "assistant",
          text: "Third",
          createdAt: "2026-08-17T00:00:04.000Z",
        },
      ]);
    });
  });

  it("caps the newest messages and marks truncated text", async () => {
    await withTempDir(async (dir) => {
      const filePath = writeTranscript(dir, [
        transcriptLine("user", "one", "2026-08-17T00:00:00.000Z", "one"),
        transcriptLine("assistant", "two", "2026-08-17T00:00:01.000Z", "two"),
        transcriptLine("user", "three", "2026-08-17T00:00:02.000Z", "three"),
      ]);

      const capped = await readClaudeSessionTranscriptMessages(filePath, {
        maxMessages: 2,
        maxTextLength: 10_000,
      });
      expect(capped?.totalMessageCount).toBe(3);
      expect(capped?.messages.map((message) => message.uuid)).toEqual(["two", "three"]);

      const truncated = await readClaudeSessionTranscriptMessages(filePath, {
        maxMessages: 100,
        maxTextLength: 2,
      });
      expect(truncated?.messages[2]?.text).toBe("th\n\n[truncated]");
    });
  });

  it("returns null for a missing file", async () => {
    await withTempDir(async (dir) => {
      await expect(
        readClaudeSessionTranscriptMessages(NodePath.join(dir, "missing.jsonl"), options),
      ).resolves.toBeNull();
    });
  });

  it("finds session files only in immediate project directories", async () => {
    await withTempDir(async (dir) => {
      const projectDir = NodePath.join(dir, "-Users-example-project");
      const subagentsDir = NodePath.join(projectDir, "subagents");
      const sessionId = "session-id";
      NodeFS.mkdirSync(subagentsDir, { recursive: true });
      const expected = NodePath.join(projectDir, `${sessionId}.jsonl`);
      NodeFS.writeFileSync(expected, "");
      NodeFS.writeFileSync(NodePath.join(subagentsDir, `${sessionId}.jsonl`), "");

      await expect(findClaudeSessionTranscriptPath(dir, sessionId)).resolves.toBe(expected);
      await expect(findClaudeSessionTranscriptPath(dir, "absent")).resolves.toBeNull();
    });
  });

  it("prefers Claude's nested projects directory when it exists", async () => {
    await withTempDir(async (dir) => {
      const fallback = NodePath.join(dir, "projects");
      expect(await resolveClaudeTranscriptDir(dir)).toBe(fallback);

      const nested = NodePath.join(dir, ".claude", "projects");
      NodeFS.mkdirSync(nested, { recursive: true });
      expect(await resolveClaudeTranscriptDir(dir)).toBe(nested);
    });
  });
});
