import {
  CommandId,
  ExternalResumeSessionId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const EXTERNAL_SESSION_ID = ExternalResumeSessionId.make("f66f4325-82ae-4e1c-999a-9c0f4efe4320");

function makeReadModel(latestTurn: OrchestrationLatestTurn | null): OrchestrationReadModel {
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
        messages: [],
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
