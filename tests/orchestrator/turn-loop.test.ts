import { describe, expect, it } from "vitest";

import {
  PatchOperation,
  ProviderKind,
  VerificationStatus,
  VerificationSubjectKind,
} from "../../src/contracts/enums.js";
import { TurnLoop } from "../../src/orchestrator/turn-loop.js";
import { StateStore, StateVersionConflictError } from "../../src/orchestrator/state-store.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("turn loop", () => {
  it("serializes concurrent write turns against canonical state", async () => {
    const loop = new TurnLoop(new StateStore<{ status?: string }>());

    const first = loop.runWritePatch({
      patch_id: "patch-1",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: 0,
      operations: [
        {
          op: PatchOperation.Add,
          path: "/status",
          value: "first",
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: null,
    });

    const second = loop.runWritePatch({
      patch_id: "patch-2",
      issue_id: "issue-1",
      actor_id: "agent-2",
      base_state_version: 0,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: "second",
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: null,
    });

    await expect(first).resolves.toMatchObject({
      version: 1,
      state: { status: "first" },
    });
    await expect(second).rejects.toBeInstanceOf(StateVersionConflictError);

    expect(loop.getSnapshot()).toEqual({
      version: 1,
      state: { status: "first" },
    });
  });

  it("rejects stale base_state_version values", async () => {
    const store = new StateStore<{ status?: string }>({ status: "draft" });

    store.applyPatch({
      patch_id: "patch-1",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: 0,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: "in_review",
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: null,
    });

    expect(() =>
      store.applyPatch({
        patch_id: "patch-2",
        issue_id: "issue-1",
        actor_id: "agent-2",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/status",
            value: "done",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow(StateVersionConflictError);
  });

  it("allows read turns to proceed without waiting on the write lock", async () => {
    const loop = new TurnLoop(new StateStore<{ status?: string }>({ status: "draft" }));
    const gate = deferred();

    const writeTurn = loop.runWrite(async ({ getSnapshot }) => {
      expect(getSnapshot()).toEqual({
        version: 0,
        state: { status: "draft" },
      });

      await gate.promise;

      return {
        patch_id: "patch-1",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/status",
            value: "in_progress",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      };
    });

    const readTurn = loop.runRead(({ getSnapshot }) => getSnapshot());

    await expect(readTurn).resolves.toEqual({
      version: 0,
      state: { status: "draft" },
    });

    gate.resolve();

    await expect(writeTurn).resolves.toMatchObject({
      version: 1,
      state: { status: "in_progress" },
    });
  });

  it("promotes done_candidate through verified to complete only after independent verification", async () => {
    const loop = new TurnLoop(
      new StateStore<Record<string, unknown>>({ status: "done_candidate" }),
    );

    const result = await loop.promoteDoneCandidate({
      issue_id: "issue-1",
      actor_id: "system-orchestrator",
      verified_patch_id: "patch-verified",
      complete_patch_id: "patch-complete",
      subject_id: "issue-1",
      executor_provider_id: "openai-prod",
      executor_provider_kind: ProviderKind.OpenAI,
      executor_model: "gpt-5.4",
      verifier: {
        provider_id: "claude-prod",
        provider_kind: ProviderKind.Claude,
        model: "claude-sonnet-4",
      },
      verification_record: {
        verification_id: "verify-1",
        subject_id: "issue-1",
        subject_kind: VerificationSubjectKind.Task,
        verifier_provider_id: "claude-prod",
        verifier_model: "claude-sonnet-4",
        status: VerificationStatus.Pass,
        evidence: ["npm test"],
        created_at: "2026-03-30T00:00:00Z",
      },
    });

    expect(result.verified.state).toMatchObject({
      status: "verified",
      verification: {
        verification_id: "verify-1",
      },
    });
    expect(result.completed.state).toMatchObject({
      status: "complete",
    });
    expect(loop.getSnapshot()).toMatchObject({
      version: 2,
      state: {
        status: "complete",
      },
    });
  });

  it("blocks complete promotion when verification evidence is missing", async () => {
    const loop = new TurnLoop(
      new StateStore<Record<string, unknown>>({ status: "done_candidate" }),
    );

    await expect(
      loop.promoteDoneCandidate({
        issue_id: "issue-1",
        actor_id: "system-orchestrator",
        verified_patch_id: "patch-verified",
        complete_patch_id: "patch-complete",
        subject_id: "issue-1",
        executor_provider_id: "openai-prod",
        executor_provider_kind: ProviderKind.OpenAI,
        executor_model: "gpt-5.4",
        verifier: {
          provider_id: "claude-prod",
          provider_kind: ProviderKind.Claude,
          model: "claude-sonnet-4",
        },
        verification_record: null,
      }),
    ).rejects.toThrow("verification record is required before completion can be promoted");

    expect(loop.getSnapshot()).toEqual({
      version: 0,
      state: { status: "done_candidate" },
    });
  });
});
