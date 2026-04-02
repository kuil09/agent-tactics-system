import { describe, expect, it } from "vitest";

import {
  InMemoryIssueService,
  IssueCheckoutError,
  IssueReleaseError,
  IssueTransitionError,
} from "../../src/control-plane/issue-service.js";

describe("InMemoryIssueService", () => {
  it("defaults new issues to backlog when no initial status is provided", () => {
    const service = new InMemoryIssueService();

    const created = service.createIssue({
      id: "issue-0",
      title: "Default issue state",
      description: "Use backlog as the default state.",
      createdAt: "2026-04-02T09:59:00Z",
    });

    expect(created.status).toBe("backlog");
  });

  it("creates issues, grants checkout, and records a comment trail", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-1",
      title: "Productize checkout",
      description: "Implement the issue lifecycle surface.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    const checkedOut = service.checkoutIssue({
      issueId: "issue-1",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo", "blocked"],
      at: "2026-04-02T10:01:00Z",
    });
    const userComment = service.addComment({
      issueId: "issue-1",
      authorId: "agent-1",
      body: "Started the control-plane implementation.",
      at: "2026-04-02T10:02:00Z",
    });

    expect(checkedOut.status).toBe("in_progress");
    expect(checkedOut.checkout).toEqual({
      agentId: "agent-1",
      runId: "run-1",
      lockedAt: "2026-04-02T10:01:00Z",
    });
    expect(userComment.id).toBe("comment-2");
    expect(service.listComments("issue-1")).toEqual([
      {
        id: "comment-1",
        issueId: "issue-1",
        authorId: "system",
        body: "Checkout granted to `agent-1` for run `run-1`.",
        kind: "system",
        createdAt: "2026-04-02T10:01:00Z",
      },
      {
        id: "comment-2",
        issueId: "issue-1",
        authorId: "agent-1",
        body: "Started the control-plane implementation.",
        kind: "comment",
        createdAt: "2026-04-02T10:02:00Z",
      },
    ]);
  });

  it("returns cloned issue records so callers cannot mutate stored checkout state", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-1b",
      title: "Clone issue records",
      description: "Protect in-memory state from caller mutations.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    const checkedOut = service.checkoutIssue({
      issueId: "issue-1b",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });
    checkedOut.checkout!.agentId = "mutated-agent";

    expect(service.getIssue("issue-1b").checkout).toEqual({
      agentId: "agent-1",
      runId: "run-1",
      lockedAt: "2026-04-02T10:01:00Z",
    });
  });

  it("supports incremental comment reads after a known comment id", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-2",
      title: "Stream comments",
      description: "Load comments incrementally.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.addComment({
      issueId: "issue-2",
      authorId: "agent-1",
      body: "first",
      at: "2026-04-02T10:01:00Z",
    });
    service.addComment({
      issueId: "issue-2",
      authorId: "agent-2",
      body: "second",
      at: "2026-04-02T10:02:00Z",
    });

    expect(service.listComments("issue-2", "comment-1")).toEqual([
      {
        id: "comment-2",
        issueId: "issue-2",
        authorId: "agent-2",
        body: "second",
        kind: "comment",
        createdAt: "2026-04-02T10:02:00Z",
      },
    ]);
  });

  it("sorts same-timestamp comments by comment id", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-2b",
      title: "Order comments deterministically",
      description: "Preserve stable thread reads.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.addComment({
      issueId: "issue-2b",
      authorId: "agent-1",
      body: "first",
      at: "2026-04-02T10:01:00Z",
    });
    service.addComment({
      issueId: "issue-2b",
      authorId: "agent-2",
      body: "second",
      at: "2026-04-02T10:01:00Z",
    });

    expect(service.listComments("issue-2b")).toEqual([
      {
        id: "comment-1",
        issueId: "issue-2b",
        authorId: "agent-1",
        body: "first",
        kind: "comment",
        createdAt: "2026-04-02T10:01:00Z",
      },
      {
        id: "comment-2",
        issueId: "issue-2b",
        authorId: "agent-2",
        body: "second",
        kind: "comment",
        createdAt: "2026-04-02T10:01:00Z",
      },
    ]);
  });

  it("records rejected checkout attempts when the expected status does not match", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-3",
      title: "Reject mismatched checkout",
      description: "Protect issue status semantics.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "blocked",
    });

    expect(() =>
      service.checkoutIssue({
        issueId: "issue-3",
        agentId: "agent-2",
        runId: "run-2",
        expectedStatuses: ["todo"],
        at: "2026-04-02T10:05:00Z",
      }),
    ).toThrowError(IssueCheckoutError);
    expect(service.listEvents("issue-3")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "checkout.rejected",
          outcome: "rejected",
          metadata: {
            current_status: "blocked",
            expected_statuses: ["todo"],
          },
        }),
      ]),
    );
  });

  it("rejects conflicting checkout attempts and keeps the existing lock", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-4",
      title: "Detect lock conflicts",
      description: "Prevent concurrent ownership.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-4",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });

    expect(() =>
      service.checkoutIssue({
        issueId: "issue-4",
        agentId: "agent-2",
        runId: "run-2",
        expectedStatuses: ["in_progress"],
        at: "2026-04-02T10:02:00Z",
      }),
    ).toThrowError(IssueCheckoutError);
    expect(service.getIssue("issue-4").checkout).toEqual({
      agentId: "agent-1",
      runId: "run-1",
      lockedAt: "2026-04-02T10:01:00Z",
    });
    expect(service.listEvents("issue-4")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "checkout.rejected",
          metadata: expect.objectContaining({
            current_checkout_agent_id: "agent-1",
            current_checkout_run_id: "run-1",
          }),
        }),
      ]),
    );
  });

  it("releases a checkout back to todo by default", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-5",
      title: "Release ownership",
      description: "Support issue release.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-5",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });
    const released = service.releaseIssue({
      issueId: "issue-5",
      agentId: "agent-1",
      runId: "run-1",
      at: "2026-04-02T10:03:00Z",
    });

    expect(released.status).toBe("todo");
    expect(released.checkout).toBeNull();
    expect(service.listComments("issue-5")).toEqual([
      expect.objectContaining({
        body: "Checkout granted to `agent-1` for run `run-1`.",
      }),
      expect.objectContaining({
        body: "Checkout released by `agent-1`; issue moved to `todo`.",
      }),
    ]);
  });

  it("rejects release attempts from a non-owner and records the failure", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-6",
      title: "Reject release",
      description: "Require the checkout owner.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-6",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });

    expect(() =>
      service.releaseIssue({
        issueId: "issue-6",
        agentId: "agent-2",
        runId: "run-2",
        at: "2026-04-02T10:02:00Z",
      }),
    ).toThrowError(IssueReleaseError);
    expect(service.listEvents("issue-6")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "release.rejected",
          outcome: "rejected",
          metadata: expect.objectContaining({
            current_checkout_agent_id: "agent-1",
          }),
        }),
      ]),
    );
  });

  it("rejects release when no checkout exists", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-6b",
      title: "Reject unowned release",
      description: "Require an active checkout before release.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    expect(() =>
      service.releaseIssue({
        issueId: "issue-6b",
        agentId: "agent-1",
        runId: "run-1",
        at: "2026-04-02T10:01:00Z",
      }),
    ).toThrowError(IssueReleaseError);
    expect(service.listEvents("issue-6b")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "release.rejected",
          outcome: "rejected",
          metadata: {
            attempted_status: null,
          },
        }),
      ]),
    );
  });

  it("rejects invalid release transitions requested by the checkout owner", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-6c",
      title: "Reject invalid release transition",
      description: "Disallow unsupported release status changes.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-6c",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });

    expect(() =>
      service.releaseIssue({
        issueId: "issue-6c",
        agentId: "agent-1",
        runId: "run-1",
        nextStatus: "backlog",
        at: "2026-04-02T10:02:00Z",
      }),
    ).toThrowError(IssueReleaseError);
    expect(service.listEvents("issue-6c")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "release.rejected",
          outcome: "rejected",
          metadata: {
            current_status: "in_progress",
            attempted_status: "backlog",
          },
        }),
      ]),
    );
  });

  it("falls back to the default rejection message when a non-Error value is thrown", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-6d",
      title: "Fallback rejection detail",
      description: "Preserve a stable audit message for non-Error throws.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "done",
    });

    const originalIncludes = Array.prototype.includes;
    let thrown: unknown = null;

    Array.prototype.includes = function includesWithNonErrorThrow(
      this: unknown[],
      ...args: Parameters<typeof originalIncludes>
    ) {
      if (this === Array.prototype) {
        return originalIncludes.apply(this, args);
      }

      throw "non-error throw";
    } as typeof Array.prototype.includes;

    try {
      try {
        service.transitionIssue({
          issueId: "issue-6d",
          actorId: "agent-1",
          nextStatus: "todo",
          at: "2026-04-02T10:01:00Z",
        });
      } catch (error) {
        thrown = error;
      }
    } finally {
      Array.prototype.includes = originalIncludes;
    }

    expect(thrown).toBe("non-error throw");
    expect(service.listEvents("issue-6d")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "status.rejected",
          outcome: "rejected",
          detail: "status transition rejected",
        }),
      ]),
    );
  });

  it("enforces lifecycle transitions and rejects invalid terminal moves", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-7",
      title: "Protect terminal states",
      description: "Done should be terminal.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "done",
    });

    expect(() =>
      service.transitionIssue({
        issueId: "issue-7",
        actorId: "agent-1",
        nextStatus: "todo",
        at: "2026-04-02T10:01:00Z",
      }),
    ).toThrowError(IssueTransitionError);
  });

  it("rejects status changes from a non-owner while the issue is checked out", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-7b",
      title: "Protect checked-out transitions",
      description: "Only the checkout owner can change status.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-7b",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });

    expect(() =>
      service.transitionIssue({
        issueId: "issue-7b",
        actorId: "agent-2",
        nextStatus: "blocked",
        at: "2026-04-02T10:02:00Z",
      }),
    ).toThrowError(IssueTransitionError);
    expect(service.listEvents("issue-7b")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "status.rejected",
          outcome: "rejected",
          metadata: {
            attempted_status: "blocked",
            current_status: "in_progress",
            checkout_agent_id: "agent-1",
          },
        }),
      ]),
    );
  });

  it("records successful status changes without a reason", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-7c",
      title: "Record status change",
      description: "Capture a normal lifecycle transition.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    const transitioned = service.transitionIssue({
      issueId: "issue-7c",
      actorId: "agent-1",
      nextStatus: "in_progress",
      at: "2026-04-02T10:01:00Z",
    });

    expect(transitioned.status).toBe("in_progress");
    expect(service.listComments("issue-7c")).toEqual([
      expect.objectContaining({
        body: "Status changed to `in_progress`.",
      }),
    ]);
  });

  it("allows same-status transitions and same-status release for the checkout owner", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-8",
      title: "Allow no-op transitions",
      description: "Support audit-only state writes.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-8",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });

    const transitioned = service.transitionIssue({
      issueId: "issue-8",
      actorId: "agent-1",
      nextStatus: "in_progress",
      at: "2026-04-02T10:02:00Z",
      reason: "no-op audit entry",
    });
    const released = service.releaseIssue({
      issueId: "issue-8",
      agentId: "agent-1",
      runId: "run-1",
      nextStatus: "in_progress",
      at: "2026-04-02T10:03:00Z",
    });

    expect(transitioned.status).toBe("in_progress");
    expect(released.status).toBe("in_progress");
    expect(released.checkout).toBeNull();
    expect(service.listComments("issue-8")).toEqual([
      expect.objectContaining({
        body: "Checkout granted to `agent-1` for run `run-1`.",
      }),
      expect.objectContaining({
        body: "Status changed to `in_progress`: no-op audit entry",
      }),
      expect.objectContaining({
        body: "Checkout released by `agent-1`; issue moved to `in_progress`.",
      }),
    ]);
  });

  it("rejects unknown issue lookups", () => {
    const service = new InMemoryIssueService();

    expect(() => service.getIssue("missing")).toThrowError("issue missing not found");
    expect(() => service.listComments("missing")).toThrowError("issue missing not found");
  });

  it("releases blocked issues back to the same blocked status by default", () => {
    const service = new InMemoryIssueService();
    service.createIssue({
      id: "issue-9",
      title: "Release blocked work",
      description: "Keep blocked issues blocked on release.",
      createdAt: "2026-04-02T10:00:00Z",
      initialStatus: "todo",
    });

    service.checkoutIssue({
      issueId: "issue-9",
      agentId: "agent-1",
      runId: "run-1",
      expectedStatuses: ["todo"],
      at: "2026-04-02T10:01:00Z",
    });
    service.transitionIssue({
      issueId: "issue-9",
      actorId: "agent-1",
      nextStatus: "blocked",
      at: "2026-04-02T10:02:00Z",
    });

    const released = service.releaseIssue({
      issueId: "issue-9",
      agentId: "agent-1",
      runId: "run-1",
      at: "2026-04-02T10:03:00Z",
    });

    expect(released.status).toBe("blocked");
    expect(released.checkout).toBeNull();
  });

  it("returns an empty event list for unknown issues", () => {
    const service = new InMemoryIssueService();

    expect(service.listEvents("missing")).toEqual([]);
  });
});
