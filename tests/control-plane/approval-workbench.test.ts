import { describe, expect, it } from "vitest";

import {
  buildApprovalWorkbenchViewModel,
  renderApprovalWorkbenchHtml,
} from "../../src/control-plane/approval-workbench.js";
import type { IssueWorkbenchVerificationEvidence } from "../../src/control-plane/issue-workbench.js";
import type {
  ApprovalWorkflowHandoff,
  ApprovalGateStatus,
} from "../../src/runtime/executable-runtime.js";
import type { RuntimeFixtureOperatorSummary } from "../../src/runtime/cli.js";

describe("approval workbench", () => {
  it("separates request, decision, and release details for pending approval", () => {
    const model = buildApprovalWorkbenchViewModel({
      issue: {
        identifier: "NIT-81",
        title: "승인 요청·결정·해제 운영 화면 구현",
        status: "in_review",
        updatedAt: "2026-04-03T11:00:00.000Z",
      },
      approvalWorkflow: createApprovalWorkflow({
        status: "pending_human_approval",
      }),
      verificationEvidence: createEvidence({
        promotion_gate: "waiting_for_human_approval_and_independent_verifier",
        approval_status: "pending_human_approval",
        input_boundary_summary: [
          {
            input_ref: "workspace://artifacts/runtime.log",
            input_kind: "file",
            trust_zone: "trusted_workspace",
          },
          {
            input_ref: "browser://operator-approval-request",
            input_kind: "browser",
            trust_zone: "untrusted_external_input",
          },
        ],
      }),
      operatorSummary: createOperatorSummary(),
    });

    expect(model.summaryFacts).toEqual([
      "Issue status: in review",
      "Updated: 2026-04-03T11:00:00.000Z",
      "Workflow status: pending human approval",
      "Promotion gate: waiting for human approval and independent verifier",
      "Approval status: pending human approval",
    ]);
    expect(model.requestFacts).toEqual([
      "Requested role: human operator",
      "Request channel: handoff artifact",
      "Issued at: 2026-04-03T11:05:00.000Z",
    ]);
    expect(model.requestSummary).toBe(
      "Review the execution evidence, confirm the trust boundaries, and record a promotion decision.",
    );
    expect(model.requestEvidence).toEqual([
      "state://verification_handoff/replay",
      "workspace://artifacts/runtime.log",
      "state://verification_handoff/governance/input_defense",
    ]);
    expect(model.requestPaths).toEqual([
      {
        label: "Request artifact",
        path: "state://verification_handoff/approval_workflow/request",
      },
      { label: "Summary", path: "/tmp/run-result.json" },
      { label: "Runtime log", path: "/tmp/workspace/artifacts/runtime.log" },
      {
        label: "Decision artifact",
        path: "/tmp/run-result.json#verification_handoff.approval_workflow.decision",
      },
    ]);
    expect(model.decisionFacts).toEqual([
      "Decision status: pending human approval",
      "Recorded by: pending",
      "Recorded at: pending",
    ]);
    expect(model.decisionBlockedReason).toBe("human approval has not been recorded yet");
    expect(model.releaseFacts).toEqual([
      "Promotion action: promote done candidate to complete",
      "Release blocked: yes",
      "Next owner: human operator",
    ]);
    expect(model.releaseBlockers).toEqual([
      "human approval artifact missing",
      "approval:grant permission missing",
    ]);
    expect(model.releaseChecklist).toEqual([
      "record the approval decision artifact",
      "confirm independent verification evidence still passes",
      "rerun promotion with approval:grant",
    ]);
    expect(model.trustBoundarySummary).toEqual([
      "workspace://artifacts/runtime.log (file / trusted workspace)",
      "browser://operator-approval-request (browser / untrusted external input)",
    ]);
    expect(model.validationCommands).toEqual([
      "npm run runtime:fixture",
      "npm run typecheck",
      "npm test",
    ]);
    expect(model.nextActions).toEqual([
      "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
      "Unblock checklist: record the approval decision artifact | confirm independent verification evidence still passes | rerun promotion with approval:grant",
      "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
    ]);
  });

  it("handles blocked recovery without collapsing it into pending approval", () => {
    const model = buildApprovalWorkbenchViewModel({
      approvalWorkflow: createApprovalWorkflow({
        status: "blocked_by_recovery",
        request: {
          issued_at: null,
        },
        decision: {
          blocked_reason: "execution failed, so approval stays blocked until rollback evidence is reviewed",
        },
        release: {
          blockers: ["rollback review incomplete", "issue must be rerun successfully"],
          unblock_checklist: [
            "review rollback and missing artifact evidence",
            "rerun the issue successfully",
            "reissue the approval request after recovery",
          ],
        },
      }),
      verificationEvidence: createEvidence({
        promotion_gate: "rollback_and_requeue_recorded",
        approval_status: "blocked_by_recovery",
        authorization_exception: null,
      }),
    });

    expect(model.title).toBe("Approval workbench");
    expect(model.requestFacts).toContain("Issued at: pending");
    expect(model.decisionFacts).toEqual([
      "Decision status: blocked by recovery",
      "Recorded by: pending",
      "Recorded at: pending",
    ]);
    expect(model.decisionBlockedReason).toBe(
      "execution failed, so approval stays blocked until rollback evidence is reviewed",
    );
    expect(model.releaseFacts).toEqual([
      "Promotion action: promote done candidate to complete",
      "Release blocked: yes",
      "Next owner: human operator",
    ]);
    expect(model.releaseBlockers).toEqual([
      "rollback review incomplete",
      "issue must be rerun successfully",
    ]);
    expect(model.nextActions).toEqual([
      "Unblock checklist: review rollback and missing artifact evidence | rerun the issue successfully | reissue the approval request after recovery",
    ]);
  });

  it("keeps the release path open when approval is not required", () => {
    const model = buildApprovalWorkbenchViewModel({
      approvalWorkflow: createApprovalWorkflow({
        status: "not_required",
        request: {
          summary: "No separate approval request is required for this envelope.",
          required_evidence: [],
          validation_commands: [],
          request_artifact_path: null,
        },
        decision: {
          blocked_reason: null,
          resolution_criteria: [],
        },
        release: {
          release_blocked: false,
          blockers: [],
          unblock_checklist: [],
          next_owner: "system_orchestrator",
        },
      }),
      verificationEvidence: createEvidence({
        promotion_gate: "not_required",
        approval_status: "not_required",
        approval_artifact_path: null,
        authorization_exception: null,
        input_boundary_summary: [],
      }),
    });

    expect(model.requestPaths).toEqual([
      { label: "Summary", path: "/tmp/run-result.json" },
      { label: "Runtime log", path: "/tmp/workspace/artifacts/runtime.log" },
    ]);
    expect(model.decisionBlockedReason).toBeNull();
    expect(model.decisionCriteria).toEqual([]);
    expect(model.releaseBlockers).toEqual([]);
    expect(model.releaseChecklist).toEqual([]);
    expect(model.validationCommands).toEqual([]);
    expect(model.trustBoundarySummary).toEqual([]);
    expect(model.nextActions).toEqual(["Release path is open for promotion."]);
  });

  it("shows recorded decision metadata when an operator already responded", () => {
    const model = buildApprovalWorkbenchViewModel({
      approvalWorkflow: createApprovalWorkflow({
        decision: {
          recorded_by: "operator-1",
          recorded_at: "2026-04-03T12:00:00.000Z",
        },
      }),
      verificationEvidence: createEvidence(),
    });

    expect(model.decisionFacts).toEqual([
      "Decision status: pending human approval",
      "Recorded by: operator-1",
      "Recorded at: 2026-04-03T12:00:00.000Z",
    ]);
  });

  it("uses the issue title when an approval issue has no identifier yet", () => {
    const model = buildApprovalWorkbenchViewModel({
      issue: {
        identifier: null,
        title: "Identifier pending approval",
        status: "todo",
        updatedAt: "2026-04-03T12:30:00.000Z",
      },
      approvalWorkflow: createApprovalWorkflow(),
      verificationEvidence: createEvidence(),
    });

    expect(model.title).toBe("Identifier pending approval");
  });

  it("renders escaped HTML and empty-state copy", () => {
    const html = renderApprovalWorkbenchHtml({
      issue: {
        identifier: "NIT-81",
        title: "<unsafe approval>",
        status: "in_review",
        updatedAt: "2026-04-03T11:00:00.000Z",
      },
      approvalWorkflow: createApprovalWorkflow({
        request: {
          request_artifact_path: null,
          required_evidence: [],
          validation_commands: [],
        },
        decision: {
          blocked_reason: null,
          resolution_criteria: [],
        },
        release: {
          blockers: [],
          unblock_checklist: [],
        },
      }),
      verificationEvidence: createEvidence({
        approval_artifact_path: null,
        input_boundary_summary: [],
        validation_commands: [],
      }),
    });

    expect(html).toContain("&lt;unsafe approval&gt;");
    expect(html).toContain("No required evidence is listed.");
    expect(html).toContain("No blocked reason is attached.");
    expect(html).toContain("No trust boundaries are attached.");
    expect(html).toContain("No validation commands are listed.");
    expect(html).toContain("Decision");
    expect(html).toContain("Release");
    expect(html).toContain("Next actions");
  });

  it("renders populated support sections for approval review", () => {
    const html = renderApprovalWorkbenchHtml({
      approvalWorkflow: createApprovalWorkflow(),
      verificationEvidence: createEvidence(),
      operatorSummary: createOperatorSummary(),
    });

    expect(html).toContain("Trust boundaries");
    expect(html).toContain("Validation commands");
    expect(html).toContain("Unblock checklist");
    expect(html).toContain(
      "<strong>Decision artifact:</strong> <code>/tmp/run-result.json#verification_handoff.approval_workflow.decision</code>",
    );
  });
});

function createApprovalWorkflow(
  overrides: {
    workflow_id?: string;
    status?: ApprovalGateStatus;
    request?: Partial<ApprovalWorkflowHandoff["request"]>;
    decision?: Partial<ApprovalWorkflowHandoff["decision"]>;
    release?: Partial<ApprovalWorkflowHandoff["release"]>;
  } = {},
): ApprovalWorkflowHandoff {
  const status = overrides.status ?? "pending_human_approval";

  return {
    workflow_id: overrides.workflow_id ?? "approval-issue-81",
    status,
    request: {
      requested_role: "human_operator",
      request_channel: "handoff_artifact",
      request_artifact_path: "state://verification_handoff/approval_workflow/request",
      issued_at: "2026-04-03T11:05:00.000Z",
      summary:
        "Review the execution evidence, confirm the trust boundaries, and record a promotion decision.",
      required_evidence: [
        "state://verification_handoff/replay",
        "workspace://artifacts/runtime.log",
        "state://verification_handoff/governance/input_defense",
      ],
      validation_commands: ["npm run runtime:fixture", "npm run typecheck", "npm test"],
      ...overrides.request,
    },
    decision: {
      status,
      decision_artifact_path: "state://verification_handoff/approval_workflow/decision",
      recorded_by: null,
      recorded_at: null,
      resolution_criteria: [
        "verification replay remains in pass status",
        "an authorized operator records the approval decision",
        "promotion is retried with approval:grant permission",
      ],
      blocked_reason: "human approval has not been recorded yet",
      ...overrides.decision,
    },
    release: {
      promotion_action: "promote_done_candidate_to_complete",
      release_blocked: true,
      blockers: ["human approval artifact missing", "approval:grant permission missing"],
      unblock_checklist: [
        "record the approval decision artifact",
        "confirm independent verification evidence still passes",
        "rerun promotion with approval:grant",
      ],
      next_owner: "human_operator",
      ...overrides.release,
    },
  };
}

function createOperatorSummary(
  overrides: Partial<RuntimeFixtureOperatorSummary> = {},
): RuntimeFixtureOperatorSummary {
  return {
    operational_flow: "single_workspace_runtime_fixture",
    scenario: "success",
    final_status: "pending_approval_and_verification",
    decision:
      "Runtime execution finished, but promotion remains closed until a human approval artifact and independent verification are both present.",
    next_action:
      "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
    key_paths: {
      artifact_dir: "/tmp/artifacts",
      workspace_dir: "/tmp/workspace",
      summary_path: "/tmp/run-result.json",
      runtime_log_path: "/tmp/workspace/artifacts/runtime.log",
      governance_path: "/tmp/run-result.json#verification_handoff.governance",
      provider_handshake_path: "/tmp/run-result.json#provider_handshake",
      ...overrides.key_paths,
    },
    checks: overrides.checks ?? [],
  };
}

function createEvidence(
  overrides: Partial<IssueWorkbenchVerificationEvidence> = {},
): IssueWorkbenchVerificationEvidence {
  const hasApprovalArtifactPath = Object.prototype.hasOwnProperty.call(
    overrides,
    "approval_artifact_path",
  );
  const hasAuthorizationException = Object.prototype.hasOwnProperty.call(
    overrides,
    "authorization_exception",
  );

  return {
    promotion_gate: overrides.promotion_gate ?? "waiting_for_human_approval",
    approval_status: overrides.approval_status ?? "pending_human_approval",
    approval_artifact_path: hasApprovalArtifactPath
      ? (overrides.approval_artifact_path ?? null)
      : "/tmp/run-result.json#verification_handoff.approval_workflow.decision",
    authorization_exception: hasAuthorizationException
      ? (overrides.authorization_exception ?? null)
      : "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
    input_boundary_summary: overrides.input_boundary_summary ?? [
      {
        input_ref: "workspace://artifacts/runtime.log",
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
