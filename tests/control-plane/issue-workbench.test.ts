import { describe, expect, it } from "vitest";

import {
  buildIssueWorkbenchViewModel,
  renderIssueWorkbenchHtml,
  type IssueWorkbenchComment,
  type IssueWorkbenchEvent,
  type IssueWorkbenchInput,
  type IssueWorkbenchVerificationEvidence,
} from "../../src/control-plane/issue-workbench.js";
import type { RuntimeFixtureOperatorSummary } from "../../src/runtime/cli.js";

describe("issue workbench", () => {
  it("builds a blocked recovery workbench with checkout conflict history", () => {
    const model = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-82",
        identifier: "NIT-82",
        title: "이슈 스레드·작업 잠금·실행 증거 운영 화면 구현",
        description: "Blocked until the runtime evidence is reviewed.",
        status: "blocked",
        priority: "medium",
        assigneeLabel: "Frontend Product Engineer",
        projectName: "agent-tactics-system",
        parent: {
          identifier: "NIT-78",
          title: "프론트 엔드 개발자 채용 의뢰",
        },
        updatedAt: "2026-04-03T10:00:00.000Z",
        checkout: {
          agentId: "frontend-product-engineer",
          runId: "run-123",
          lockedAt: "2026-04-03T09:30:00.000Z",
        },
        blockedReason: "Await rollback review from operations.",
        nextOwner: "cto",
      },
      ancestors: [
        {
          identifier: "NIT-78",
          title: "프론트 엔드 개발자 채용 의뢰",
          status: "done",
        },
      ],
      comments: [
        createComment({
          id: "comment-1",
          authorId: "cto",
          authorLabel: "CTO",
          body: "Pin the MVP slice before you unblock it.",
          createdAt: "2026-04-03T09:00:00.000Z",
        }),
        createComment({
          id: "comment-2",
          authorId: "system",
          body: "Checkout released by `agent-1`; issue moved to `blocked`.",
          kind: "system",
          createdAt: "2026-04-03T09:15:00.000Z",
        }),
      ],
      events: [
        createEvent({
          id: "event-1",
          actorId: "frontend-product-engineer",
          action: "checkout.rejected",
          outcome: "rejected",
          detail: "issue NIT-82 is already checked out",
          createdAt: "2026-04-03T08:55:00.000Z",
          metadata: {
            current_checkout_agent_id: "cto",
            current_checkout_run_id: "run-previous",
            attempt_count: 2,
            attempted_statuses: ["todo", "blocked"],
          },
        }),
      ],
      operatorSummary: createOperatorSummary({
        final_status: "failed_and_requeued",
      }),
      verificationEvidence: createEvidence({
        promotion_gate: "rollback_and_requeue_recorded",
        approval_status: "blocked_by_recovery",
        authorization_exception:
          "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
        recovery_outcome: "rollback_completed",
        recovery_scope: {
          attempted_write_paths: ["artifacts/runtime.log"],
          changed_paths: ["artifacts/runtime.log"],
          modified_preexisting_paths: ["src/runtime/cli.ts"],
          created_paths: ["artifacts/runtime.log"],
          restored_paths: ["src/runtime/cli.ts"],
          unrestored_paths: ["artifacts/runtime.log"],
          artifact_paths_missing_after_recovery: ["/tmp/workspace/artifacts/runtime.log"],
          residual_risk_paths: ["/tmp/workspace/artifacts/runtime.log"],
        },
      }),
    });

    expect(model.summaryFacts).toContain("Status: blocked");
    expect(model.ancestorSummary).toEqual(["NIT-78 · 프론트 엔드 개발자 채용 의뢰 (done)"]);
    expect(model.checkoutSummary).toEqual([
      "Checked out by frontend-product-engineer.",
      "Run: run-123",
      "Locked at: 2026-04-03T09:30:00.000Z",
    ]);
    expect(model.checkoutConflicts).toEqual([
      "issue NIT-82 is already checked out (owner cto, run run-previous)",
    ]);
    expect(model.blockers).toEqual([
      "Await rollback review from operations.",
      "Recovery evidence must be reviewed before approval can resume.",
      "The most recent execution failed and the issue has been requeued.",
      "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
    ]);
    expect(model.nextOwner).toBe("cto");
    expect(model.nextActions).toContain("Next owner: cto");
    expect(model.timeline.map((item) => item.id)).toEqual([
      "event-1",
      "comment-1",
      "comment-2",
    ]);
    expect(model.timeline[0]).toMatchObject({
      tone: "warning",
      title: "checkout rejected",
      metadata: [
        "attempt count: 2",
        "attempted statuses: todo, blocked",
        "current checkout agent id: cto",
        "current checkout run id: run-previous",
      ],
    });
    expect(model.timeline[2]).toMatchObject({
      title: "System note",
      tone: "muted",
    });
    expect(model.recoverySummary).toEqual([
      "Attempted writes: artifacts/runtime.log",
      "Modified existing: src/runtime/cli.ts",
      "Created: artifacts/runtime.log",
      "Restored: src/runtime/cli.ts",
      "Unrestored: artifacts/runtime.log",
      "Missing artifacts: /tmp/workspace/artifacts/runtime.log",
      "Residual risk: /tmp/workspace/artifacts/runtime.log",
    ]);
  });

  it("derives human approval and verifier follow-up actions", () => {
    const model = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-81",
        identifier: "NIT-81",
        title: "승인 요청·결정·해제 운영 화면 구현",
        description: "Need the approval surface.",
        status: "in_review",
        updatedAt: "2026-04-03T11:00:00.000Z",
      },
      operatorSummary: createOperatorSummary({
        scenario: "success",
        final_status: "pending_approval_and_verification",
        next_action:
          "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
      }),
      verificationEvidence: createEvidence({
        promotion_gate: "waiting_for_human_approval_and_independent_verifier",
        approval_status: "pending_human_approval",
      }),
    });

    expect(model.blockers).toEqual([
      "Human approval and independent verification are still required.",
    ]);
    expect(model.nextOwner).toBe("human_operator");
    expect(model.nextActions).toEqual([
      "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
      "Next owner: human operator",
      "Validation commands: npm run runtime:fixture | npm run typecheck | npm test",
    ]);
    expect(model.evidenceSummary).toEqual([
      "Runtime execution finished, but promotion remains closed until a human approval artifact and independent verification are both present.",
      "Promotion gate: waiting for human approval and independent verifier",
      "Approval status: pending human approval",
      "Recovery outcome: not needed",
    ]);
    expect(model.evidencePaths.filter((entry) => entry.label === "Artifact dir")).toHaveLength(1);
  });

  it("tracks approval-only blockers separately from independent verification blockers", () => {
    const approvalOnly = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-approval",
        title: "Approval only",
        description: "Approval must happen first.",
        status: "in_progress",
        updatedAt: "2026-04-03T12:00:00.000Z",
      },
      verificationEvidence: createEvidence({
        promotion_gate: "waiting_for_human_approval",
        approval_status: "pending_human_approval",
      }),
    });
    const verifierOnly = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-verifier",
        title: "Verifier only",
        description: "Verification must happen first.",
        status: "in_progress",
        updatedAt: "2026-04-03T12:30:00.000Z",
      },
      verificationEvidence: createEvidence({
        promotion_gate: "waiting_for_independent_verifier",
        approval_status: "not_required",
      }),
    });

    expect(approvalOnly.blockers).toEqual([
      "Human approval is still required before promotion.",
    ]);
    expect(approvalOnly.nextOwner).toBe("human_operator");
    expect(verifierOnly.blockers).toEqual([
      "Independent verification is still required before promotion.",
    ]);
    expect(verifierOnly.nextOwner).toBeNull();
  });

  it("renders empty states and escapes issue content safely", () => {
    const html = renderIssueWorkbenchHtml({
      issue: {
        id: "issue-empty",
        title: "<unsafe issue>",
        description: "<script>alert('xss')</script>",
        status: "blocked",
        updatedAt: "2026-04-03T13:00:00.000Z",
      },
      comments: [],
      events: [],
    });

    expect(html).toContain("&lt;unsafe issue&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(html).toContain("No active checkout.");
    expect(html).toContain("No runtime evidence is linked yet.");
    expect(html).toContain("No comments or events have been recorded.");
    expect(html).toContain("Issue is blocked and needs a clear unblock action before more execution.");
  });

  it("renders evidence paths, validation commands, and skips empty metadata values", () => {
    const html = renderIssueWorkbenchHtml({
      issue: {
        id: "issue-evidence",
        title: "Evidence rich issue",
        description: "Capture every operator artifact.",
        status: "in_review",
        updatedAt: "2026-04-03T14:00:00.000Z",
      },
      events: [
        createEvent({
          id: "event-evidence",
          actorId: "operator-1",
          action: "status.changed",
          outcome: "succeeded",
          detail: "Issue promoted for review.",
          metadata: {
            actor_note: "",
            ignored: null,
            retries: [],
            approved: true,
          },
        }),
      ],
      verificationEvidence: createEvidence({
        promotion_gate: "waiting_for_human_approval",
        approval_status: "pending_human_approval",
      }),
      operatorSummary: createOperatorSummary({
        scenario: "success",
        final_status: "pending_approval_and_verification",
      }),
    });

    expect(html).toContain("<strong>Artifact dir:</strong> <code>/tmp/artifacts</code>");
    expect(html).toContain("<code>npm run runtime:fixture</code>");
    expect(html).toContain("approved: true");
    expect(html).not.toContain("ignored");
    expect(html).not.toContain("actor note");
    expect(html).not.toContain("retries");
  });

  it("renders no-blocker empty states and preserves checkout conflict details without owner metadata", () => {
    const model = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-empty-actions",
        title: "Quiet issue",
        description: "No blockers or next actions should be derived.",
        status: "in_progress",
        updatedAt: "2026-04-03T15:00:00.000Z",
      },
      events: [
        createEvent({
          id: "event-conflict",
          actorId: "agent-2",
          action: "checkout.rejected",
          outcome: "rejected",
          detail: "checkout rejected without ownership metadata",
          metadata: {},
        }),
      ],
    });
    const html = renderIssueWorkbenchHtml({
      issue: {
        id: "issue-recovery",
        title: "Recovery issue",
        description: "Show recovery details without blockers.",
        status: "in_progress",
        updatedAt: "2026-04-03T15:30:00.000Z",
      },
      verificationEvidence: createEvidence({
        promotion_gate: "not_required",
        approval_status: "not_required",
        authorization_exception: null,
        validation_commands: [],
        recovery_scope: {
          attempted_write_paths: ["artifacts/runtime.log"],
          changed_paths: ["artifacts/runtime.log"],
          modified_preexisting_paths: [],
          created_paths: ["artifacts/runtime.log"],
          restored_paths: [],
          unrestored_paths: [],
          artifact_paths_missing_after_recovery: [],
          residual_risk_paths: ["artifacts/runtime.log"],
        },
      }),
    });

    expect(model.checkoutConflicts).toEqual(["checkout rejected without ownership metadata"]);
    expect(html).toContain("No explicit blockers are attached.");
    expect(html).toContain("No next action has been derived yet.");
    expect(html).toContain("Recovery");
    expect(html).toContain("Residual risk: artifacts/runtime.log");
  });

  it("renders ancestor and checkout conflict sections when both are present", () => {
    const html = renderIssueWorkbenchHtml({
      issue: {
        id: "issue-conflict-render",
        title: "Conflict render issue",
        description: "Render ancestor and conflict details.",
        status: "blocked",
        updatedAt: "2026-04-03T16:00:00.000Z",
      },
      ancestors: [
        {
          identifier: "NIT-78",
          title: "프론트 엔드 개발자 채용 의뢰",
          status: "done",
        },
      ],
      events: [
        createEvent({
          id: "event-render-conflict",
          actorId: "agent-3",
          action: "checkout.rejected",
          outcome: "rejected",
          detail: "render conflict detail",
          metadata: {
            current_checkout_agent_id: "cto",
          },
        }),
      ],
    });

    expect(html).toContain("Ancestors");
    expect(html).toContain("NIT-78 · 프론트 엔드 개발자 채용 의뢰");
    expect(html).toContain("Recent conflicts");
    expect(html).toContain("render conflict detail (owner cto)");
  });

  it("renders identifier titles, ancestor labels without ids, and stable timeline order for equal timestamps", () => {
    const model = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-timeline",
        identifier: "NIT-90",
        title: "Timeline issue",
        description: "Check stable ordering.",
        status: "in_progress",
        updatedAt: "2026-04-03T17:00:00.000Z",
      },
      ancestors: [
        {
          identifier: null,
          title: "Ancestor without id",
          status: "done",
        },
      ],
      comments: [
        createComment({
          id: "comment-b",
          authorId: "cto",
          body: "Second by id.",
          createdAt: "2026-04-03T17:00:00.000Z",
        }),
        createComment({
          id: "comment-a",
          authorId: "cto",
          body: "First by id.",
          createdAt: "2026-04-03T17:00:00.000Z",
        }),
      ],
    });
    const html = renderIssueWorkbenchHtml({
      issue: {
        id: "issue-timeline",
        identifier: "NIT-90",
        title: "Timeline issue",
        description: "Check stable ordering.",
        status: "in_progress",
        updatedAt: "2026-04-03T17:00:00.000Z",
      },
      ancestors: [
        {
          identifier: null,
          title: "Ancestor without id",
          status: "done",
        },
      ],
      comments: [
        createComment({
          id: "comment-a",
          authorId: "cto",
          body: "First by id.",
          createdAt: "2026-04-03T17:00:00.000Z",
        }),
      ],
    });

    expect(model.timeline.map((item) => item.id)).toEqual(["comment-a", "comment-b"]);
    expect(model.ancestorSummary).toEqual(["Ancestor without id (done)"]);
    expect(html).toContain("<title>NIT-90 · Timeline issue</title>");
    expect(html).toContain("Ancestor without id");
    expect(html).toContain("Comment");
  });

  it("summarizes parent titles even when the parent identifier is missing", () => {
    const model = buildIssueWorkbenchViewModel({
      issue: {
        id: "issue-parentless-id",
        title: "Parent label issue",
        description: "Parent exists without identifier.",
        status: "todo",
        parent: {
          identifier: null,
          title: "Parent without identifier",
        },
        updatedAt: "2026-04-03T18:00:00.000Z",
      },
    });

    expect(model.summaryFacts).toContain("Parent: Parent without identifier");
  });
});

function createComment(
  overrides: Partial<IssueWorkbenchComment> & Pick<IssueWorkbenchComment, "id" | "authorId" | "body">,
): IssueWorkbenchComment {
  return {
    id: overrides.id,
    authorId: overrides.authorId,
    authorLabel: overrides.authorLabel ?? null,
    body: overrides.body,
    kind: overrides.kind ?? "comment",
    createdAt: overrides.createdAt ?? "2026-04-03T00:00:00.000Z",
  };
}

function createEvent(
  overrides: Partial<IssueWorkbenchEvent> &
    Pick<IssueWorkbenchEvent, "id" | "actorId" | "action" | "outcome" | "detail">,
): IssueWorkbenchEvent {
  return {
    id: overrides.id,
    actorId: overrides.actorId,
    action: overrides.action,
    outcome: overrides.outcome,
    detail: overrides.detail,
    createdAt: overrides.createdAt ?? "2026-04-03T00:00:00.000Z",
    metadata: overrides.metadata ?? {},
  };
}

function createOperatorSummary(
  overrides: Partial<RuntimeFixtureOperatorSummary> = {},
): RuntimeFixtureOperatorSummary {
  return {
    operational_flow: "single_workspace_runtime_fixture",
    scenario: overrides.scenario ?? "failure",
    final_status: overrides.final_status ?? "failed_and_requeued",
    decision:
      overrides.decision ??
      "Runtime execution finished, but promotion remains closed until a human approval artifact and independent verification are both present.",
    next_action:
      overrides.next_action ??
      "Open run-result.json, confirm recovery.steps, restored_paths, and residual_risk_paths, then inspect the requeued inputs before retrying.",
    key_paths: {
      artifact_dir: "/tmp/artifacts",
      workspace_dir: "/tmp/workspace",
      summary_path: "/tmp/run-result.json",
      runtime_log_path: "/tmp/workspace/artifacts/runtime.log",
      governance_path: "/tmp/run-result.json#verification_handoff.governance",
      provider_handshake_path: "/tmp/run-result.json#provider_handshake",
      ...overrides.key_paths,
    },
    checks: overrides.checks ?? ["runtime_log_path must exist"],
  };
}

function createEvidence(
  overrides: Partial<IssueWorkbenchVerificationEvidence> = {},
): IssueWorkbenchVerificationEvidence {
  return {
    promotion_gate: overrides.promotion_gate ?? "not_required",
    approval_status: overrides.approval_status ?? "not_required",
    approval_artifact_path:
      overrides.approval_artifact_path ?? "/tmp/run-result.json#verification_handoff.approval_workflow.decision",
    authorization_exception: overrides.authorization_exception ?? null,
    input_boundary_summary: overrides.input_boundary_summary ?? [
      {
        input_ref: "src/task.txt",
        input_kind: "file",
        trust_zone: "trusted_workspace",
      },
    ],
    validation_commands:
      overrides.validation_commands ?? ["npm run runtime:fixture", "npm run typecheck", "npm test"],
    artifact_dir: overrides.artifact_dir ?? "/tmp/artifacts",
    workspace_dir: overrides.workspace_dir ?? "/tmp/workspace",
    summary_path: overrides.summary_path ?? "/tmp/run-result.json",
    runtime_log_path: overrides.runtime_log_path ?? "/tmp/workspace/artifacts/runtime.log",
    recovery_outcome: overrides.recovery_outcome ?? "not_needed",
    recovery_scope: {
      attempted_write_paths: [],
      changed_paths: [],
      modified_preexisting_paths: [],
      created_paths: [],
      restored_paths: [],
      unrestored_paths: [],
      artifact_paths_missing_after_recovery: [],
      residual_risk_paths: [],
      ...overrides.recovery_scope,
    },
  };
}
