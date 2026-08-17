import {
  CommandId,
  ExternalResumeSessionId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const EXTERNAL_SESSION_ID = ExternalResumeSessionId.make("f66f4325-82ae-4e1c-999a-9c0f4efe4320");

function makeReadModel(
  latestTurn: OrchestrationLatestTurn | null,
  messages: ReadonlyArray<OrchestrationMessage> = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-5",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        deletedAt: null,
        messages: [...messages],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

function makeTurnStartCommand() {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make("cmd-turn-start"),
    threadId: ThreadId.make("thread-1"),
    message: {
      messageId: MessageId.make("message-1"),
      role: "user",
      text: "Continue",
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    externalResumeSessionId: EXTERNAL_SESSION_ID,
    createdAt: NOW,
  } as const;
}

it.layer(NodeServices.layer)("external resume decider", (it) => {
  it.effect("carries the external resume session id onto the turn-start-requested event", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: makeTurnStartCommand(),
        readModel: makeReadModel(null),
      });
      const events = Array.isArray(result) ? result : [result];
      const turnStartRequested = events.find(
        (event) => event.type === "thread.turn-start-requested",
      );
      expect(turnStartRequested).toBeDefined();
      if (turnStartRequested?.type === "thread.turn-start-requested") {
        expect(turnStartRequested.payload.externalResumeSessionId).toBe(EXTERNAL_SESSION_ID);
      }
    }),
  );

  it.effect("re-emits imported transcript messages with their original timestamps", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.external-transcript.import",
          commandId: CommandId.make("cmd-import"),
          threadId: ThreadId.make("thread-1"),
          sessionId: EXTERNAL_SESSION_ID,
          messages: [
            {
              messageId: MessageId.make("imported:aaa"),
              role: "user",
              text: "hello from the terminal",
              createdAt: "2026-08-14T09:10:34.179Z",
            },
            {
              messageId: MessageId.make("imported:bbb"),
              role: "assistant",
              text: "hello back",
              createdAt: "2026-08-14T09:10:40.000Z",
            },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(null),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.message-sent",
      ]);
      const first = events[0];
      if (first?.type === "thread.message-sent") {
        expect(first.payload).toMatchObject({
          messageId: MessageId.make("imported:aaa"),
          role: "user",
          text: "hello from the terminal",
          turnId: null,
          streaming: false,
          createdAt: "2026-08-14T09:10:34.179Z",
          updatedAt: "2026-08-14T09:10:34.179Z",
        });
        expect(first.occurredAt).toBe("2026-08-14T09:10:34.179Z");
      }
    }),
  );

  it.effect("rejects a transcript import once the thread has messages", () =>
    Effect.gen(function* () {
      const failure = yield* decideOrchestrationCommand({
        command: {
          type: "thread.external-transcript.import",
          commandId: CommandId.make("cmd-import-late"),
          threadId: ThreadId.make("thread-1"),
          sessionId: EXTERNAL_SESSION_ID,
          messages: [
            {
              messageId: MessageId.make("imported:aaa"),
              role: "user",
              text: "hello",
              createdAt: NOW,
            },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel(null, [
          {
            id: MessageId.make("message-existing"),
            role: "user",
            text: "already here",
            turnId: null,
            streaming: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]),
      }).pipe(Effect.flip);
      expect(String(failure)).toContain("empty thread");
    }),
  );

  it.effect("rejects a transcript import with no messages", () =>
    Effect.gen(function* () {
      const failure = yield* decideOrchestrationCommand({
        command: {
          type: "thread.external-transcript.import",
          commandId: CommandId.make("cmd-import-empty"),
          threadId: ThreadId.make("thread-1"),
          sessionId: EXTERNAL_SESSION_ID,
          messages: [],
          createdAt: NOW,
        },
        readModel: makeReadModel(null),
      }).pipe(Effect.flip);
      expect(String(failure)).toContain("no messages");
    }),
  );

  it.effect("rejects an external resume session once the thread has turns", () =>
    Effect.gen(function* () {
      const failure = yield* decideOrchestrationCommand({
        command: makeTurnStartCommand(),
        readModel: makeReadModel({
          turnId: TurnId.make("turn-1"),
          state: "completed",
          requestedAt: NOW,
          startedAt: NOW,
          completedAt: NOW,
          assistantMessageId: null,
        }),
      }).pipe(Effect.flip);
      expect(String(failure)).toContain("first turn");
    }),
  );
});
