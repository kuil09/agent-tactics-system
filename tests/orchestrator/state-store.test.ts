import { describe, expect, it } from "vitest";

import { PatchOperation } from "../../src/contracts/enums.js";
import { StateStore } from "../../src/orchestrator/state-store.js";

describe("state store", () => {
  it("applies object and array patch operations across versions", () => {
    const store = new StateStore<Record<string, unknown>>({
      status: "queued",
      items: ["first"],
      nested: {
        keep: true,
      },
    });

    const added = store.applyPatch({
      patch_id: "patch-1",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: 0,
      operations: [
        {
          op: PatchOperation.Add,
          path: "/items/-",
          value: "second",
        },
        {
          op: PatchOperation.Add,
          path: "/escaped~1path",
          value: "slash",
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: null,
    });

    const replaced = store.applyPatch({
      patch_id: "patch-2",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: added.version,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/status",
          value: "in_progress",
        },
        {
          op: PatchOperation.Replace,
          path: "/nested/child",
          value: {
            value: 1,
          },
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: 0,
    });

    const removed = store.applyPatch({
      patch_id: "patch-3",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: replaced.version,
      operations: [
        {
          op: PatchOperation.Remove,
          path: "/items/0",
          value: null,
        },
        {
          op: PatchOperation.Remove,
          path: "/nested/keep",
          value: null,
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: 1,
    });

    const indexedWrite = store.applyPatch({
      patch_id: "patch-4",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: removed.version,
      operations: [
        {
          op: PatchOperation.Replace,
          path: "/items/0",
          value: "replaced",
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: 2,
    });

    expect(added.state).toMatchObject({
      items: ["first", "second"],
      "escaped/path": "slash",
    });
    expect(replaced.state).toMatchObject({
      status: "in_progress",
      nested: {
        keep: true,
        child: {
          value: 1,
        },
      },
    });
    expect(removed.state).toMatchObject({
      items: ["second"],
      nested: {
        child: {
          value: 1,
        },
      },
    });
    expect(indexedWrite.state).toMatchObject({
      items: ["replaced"],
    });
    expect(store.getStateAtVersion(0)?.state).toEqual({
      status: "queued",
      items: ["first"],
      nested: {
        keep: true,
      },
    });
    expect(store.getStateAtVersion(999)).toBeNull();
  });

  it("rejects invalid patch paths and non-container traversals", () => {
    const store = new StateStore<Record<string, unknown>>({
      leaf: "value",
      items: ["first"],
    });

    expect(() =>
      store.applyPatch({
        patch_id: "patch-root",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/",
            value: "blocked",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("root-level replacement is not supported in v1");

    expect(() =>
      store.applyPatch({
        patch_id: "patch-pointer",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "status",
            value: "blocked",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("JSON pointer must start with '/': status");

    expect(() =>
      store.applyPatch({
        patch_id: "patch-leaf",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/leaf/value/x",
            value: "blocked",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("patch path traverses a non-container");

    expect(() =>
      store.applyPatch({
        patch_id: "patch-parent",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/items/0/value",
            value: "blocked",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("patch target parent must be an object or array");

    expect(() =>
      store.applyPatch({
        patch_id: "patch-invalid-final-token",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 0,
        operations: [
          {
            op: PatchOperation.Replace,
            path: "/items/",
            value: "blocked",
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("invalid patch path: /items/");
  });

  it("creates missing containers and rejects unsupported operations", () => {
    const store = new StateStore<Record<string, unknown>>({});

    const created = store.applyPatch({
      patch_id: "patch-missing-container",
      issue_id: "issue-1",
      actor_id: "agent-1",
      base_state_version: 0,
      operations: [
        {
          op: PatchOperation.Add,
          path: "/created/nested/value",
          value: 1,
        },
      ],
      requires_lock: true,
      verifier_required: false,
      rollback_to_version: null,
    });

    expect(created.state).toEqual({
      created: {
        nested: {
          value: 1,
        },
      },
    });

    expect(() =>
      store.applyPatch({
        patch_id: "patch-unsupported-op",
        issue_id: "issue-1",
        actor_id: "agent-1",
        base_state_version: 1,
        operations: [
          {
            op: "move" as PatchOperation,
            path: "/created",
            value: null,
          },
        ],
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: null,
      }),
    ).toThrow("unsupported patch operation: move");
  });
});
