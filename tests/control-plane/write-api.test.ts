import { describe, expect, it } from "vitest";

import {
  InMemoryApprovalService,
  type ApprovalRecord,
} from "../../src/control-plane/approval-service.js";
import {
  createControlPlaneReadApi,
  type ControlPlaneIssueMetadata,
} from "../../src/control-plane/read-api.js";
import { InMemoryExecutionWorkspaceService } from "../../src/control-plane/execution-workspace-service.js";
import { InMemoryIssueService } from "../../src/control-plane/issue-service.js";
import type { IssueWorkbenchVerificationEvidence } from "../../src/control-plane/issue-workbench.js";
import type {
  ApprovalWorkflowHandoff,
  ApprovalGateStatus,
} from "../../src/runtime/executable-runtime.js";

describe("control-plane write api", () => {
  it("lists approvals, returns linked issues, and appends approval comments", async () => {
    const { api } = createFixture();

    const listResponse = await api.handle(
      new Request("http://control-plane.test/api/companies/company-1/approvals"),
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: "approval-1",
        decisionOutcome: "pending",
      }),
    ]);

    const issuesResponse = await api.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/issues"),
    );
    expect(issuesResponse.status).toBe(200);
    expect(await issuesResponse.json()).toEqual([
      {
        issueId: "issue-child",
        identifier: "NIT-99",
        title: "승인과 작업공간 연결 API를 구현할 것",
        status: "in_progress",
      },
    ]);

    const commentResponse = await api.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/comments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authorId: "operator-1",
          body: "Evidence reviewed. Waiting on final sign-off.",
        }),
      }),
    );
    expect(commentResponse.status).toBe(201);
    expect(await commentResponse.json()).toEqual({
      id: "approval-comment-1",
      approvalId: "approval-1",
      authorId: "operator-1",
      body: "Evidence reviewed. Waiting on final sign-off.",
      createdAt: "2026-04-03T12:10:00.000Z",
    });

    const commentsResponse = await api.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/comments"),
    );
    expect(commentsResponse.status).toBe(200);
    expect(await commentsResponse.json()).toEqual([
      expect.objectContaining({
        id: "approval-comment-1",
      }),
    ]);
  });

  it("transitions approval decisions across approve, request revision, and resubmit", async () => {
    const { api } = createFixture();

    const approveResponse = await api.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorId: "operator-1",
        }),
      }),
    );
    expect(approveResponse.status).toBe(200);
    expect(await approveResponse.json()).toEqual(
      expect.objectContaining({
        decisionOutcome: "approved",
        decision: expect.objectContaining({
          recorded_by: "operator-1",
          recorded_at: "2026-04-03T12:10:00.000Z",
          blocked_reason: null,
        }),
        release: expect.objectContaining({
          release_blocked: false,
          blockers: [],
          next_owner: "system_orchestrator",
        }),
      }),
    );

    const invalidRevisionResponse = await api.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/request-revision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorId: "operator-2",
        }),
      }),
    );
    expect(invalidRevisionResponse.status).toBe(409);

    const { api: revisionApi } = createFixture();
    const revisionResponse = await revisionApi.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/request-revision", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorId: "operator-2",
        }),
      }),
    );
    expect(revisionResponse.status).toBe(200);
    expect(await revisionResponse.json()).toEqual(
      expect.objectContaining({
        decisionOutcome: "revision_requested",
        release: expect.objectContaining({
          release_blocked: true,
          blockers: ["revision requested by operator"],
        }),
      }),
    );

    const resubmitResponse = await revisionApi.handle(
      new Request("http://control-plane.test/api/approvals/approval-1/resubmit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorId: "agent-fe",
        }),
      }),
    );
    expect(resubmitResponse.status).toBe(200);
    expect(await resubmitResponse.json()).toEqual(
      expect.objectContaining({
        decisionOutcome: "pending",
        decision: expect.objectContaining({
          recorded_by: "agent-fe",
          blocked_reason: "human approval has not been recorded yet",
        }),
        release: expect.objectContaining({
          release_blocked: true,
          blockers: [
            "human approval artifact missing",
            "approval:grant permission missing",
          ],
        }),
      }),
    );
  });

  it("lists execution workspaces, exposes project workspace views, and patches blocked routing data", async () => {
    const { api } = createFixture();

    const companyResponse = await api.handle(
      new Request("http://control-plane.test/api/companies/company-1/execution-workspaces"),
    );
    expect(companyResponse.status).toBe(200);
    expect(await companyResponse.json()).toEqual([
      expect.objectContaining({
        id: "workspace-app",
        status: "ready",
      }),
      expect.objectContaining({
        id: "workspace-fallback",
        status: "blocked",
        blockedReason: "workspace preference did not match any available workspace",
      }),
    ]);

    const projectResponse = await api.handle(
      new Request("http://control-plane.test/api/projects/project-1/workspaces"),
    );
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toEqual([
      expect.objectContaining({
        id: "workspace-app",
      }),
      expect.objectContaining({
        id: "workspace-fallback",
      }),
    ]);

    const patchResponse = await api.handle(
      new Request("http://control-plane.test/api/execution-workspaces/workspace-fallback", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "ready",
          blockedReason: null,
          recoveryPlan: null,
        }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.json()).toEqual(
      expect.objectContaining({
        id: "workspace-fallback",
        status: "ready",
        blockedReason: null,
        recoveryPlan: null,
        updatedAt: "2026-04-03T12:10:00.000Z",
      }),
    );

    const detailResponse = await api.handle(
      new Request("http://control-plane.test/api/execution-workspaces/workspace-fallback"),
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual(
      expect.objectContaining({
        id: "workspace-fallback",
        status: "ready",
        blockedReason: null,
      }),
    );
  });
});

function createFixture(): {
  api: ReturnType<typeof createControlPlaneReadApi>;
  approvalService: InMemoryApprovalService;
  workspaceService: InMemoryExecutionWorkspaceService;
} {
  const issueService = new InMemoryIssueService();
  issueService.createIssue({
    id: "issue-child",
    title: "승인과 작업공간 연결 API를 구현할 것",
    description: "Implement approval and execution workspace routes.",
    createdAt: "2026-04-03T10:00:00.000Z",
    initialStatus: "todo",
  });
  issueService.checkoutIssue({
    issueId: "issue-child",
    agentId: "agent-fe",
    runId: "run-99",
    expectedStatuses: ["todo"],
    at: "2026-04-03T10:01:00.000Z",
  });

  const issues: ControlPlaneIssueMetadata[] = [
    {
      id: "issue-child",
      companyId: "company-1",
      identifier: "NIT-99",
      priority: "high",
      projectId: "project-1",
      assigneeAgentId: "agent-fe",
      verificationEvidence: createEvidence(),
    },
  ];

  const approvalService = new InMemoryApprovalService();
  approvalService.createApproval(createApproval());

  const workspaceService = new InMemoryExecutionWorkspaceService();
  workspaceService.createWorkspace({
    id: "workspace-app",
    companyId: "company-1",
    projectId: "project-1",
    name: "App Workspace",
    rootPath: "/tmp/workspaces/app",
    repoUrl: "https://github.com/kuil09/agent-tactics-system",
    status: "ready",
    blockedReason: null,
    recoveryPlan: null,
    lastRouting: null,
    updatedAt: "2026-04-03T10:05:00.000Z",
  });
  workspaceService.createWorkspace({
    id: "workspace-fallback",
    companyId: "company-1",
    projectId: "project-1",
    name: "Fallback Workspace",
    rootPath: "/tmp/workspaces/fallback",
    repoUrl: "https://github.com/kuil09/operator-playbooks",
    status: "blocked",
    blockedReason: "workspace preference did not match any available workspace",
    recoveryPlan: {
      action: "fix_execution_workspace_preference",
      summary: "update executionWorkspacePreference.repoUrl or add the missing workspace before retrying",
      targetWorkspaceId: "workspace-app",
    },
    lastRouting: {
      status: "blocked",
      code: "workspace_repo_mismatch",
      issueId: "issue-child",
      runId: "run-99",
      reason: "workspace preference did not match any available workspace",
      candidateWorkspaceIds: ["workspace-app", "workspace-fallback"],
      requestedWorkspaceId: null,
      requestedRepoUrl: "https://github.com/kuil09/nonexistent-repo",
      recovery: {
        action: "fix_execution_workspace_preference",
        summary: "update executionWorkspacePreference.repoUrl or add the missing workspace before retrying",
        targetWorkspaceId: "workspace-app",
      },
    },
    updatedAt: "2026-04-03T10:06:00.000Z",
  });

  return {
    api: createControlPlaneReadApi({
      viewerAgentId: "agent-fe",
      now: () => "2026-04-03T12:10:00.000Z",
      issueService,
      approvalService,
      executionWorkspaceService: workspaceService,
      issues,
      projects: [
        {
          id: "project-1",
          name: "agent-tactics-system",
        },
      ],
    }),
    approvalService,
    workspaceService,
  };
}

function createApproval(): ApprovalRecord {
  return {
    id: "approval-1",
    companyId: "company-1",
    issueLinks: [
      {
        issueId: "issue-child",
        identifier: "NIT-99",
        title: "승인과 작업공간 연결 API를 구현할 것",
        status: "in_progress",
      },
    ],
    workflow: createApprovalWorkflow(),
    verificationEvidence: createEvidence(),
    decisionOutcome: "pending",
    comments: [],
    createdAt: "2026-04-03T10:02:00.000Z",
    updatedAt: "2026-04-03T10:02:00.000Z",
  };
}

function createApprovalWorkflow(
  status: ApprovalGateStatus = "pending_human_approval",
): ApprovalWorkflowHandoff {
  return {
    workflow_id: "approval-issue-child",
    status,
    request: {
      requested_role: "human_operator",
      request_channel: "handoff_artifact",
      request_artifact_path: "artifacts/run-99/run-result.json#verification_handoff.approval_workflow.request",
      issued_at: "2026-04-03T10:02:00.000Z",
      summary: "Review the execution evidence, confirm the trust boundaries, and record a promotion decision.",
      required_evidence: [
        "state://verification_handoff/replay",
        "workspace://artifacts/runtime.log",
      ],
      validation_commands: ["npm test -- --run tests/control-plane/write-api.test.ts"],
    },
    decision: {
      status,
      decision_artifact_path: "artifacts/run-99/run-result.json#verification_handoff.approval_workflow.decision",
      recorded_by: null,
      recorded_at: null,
      resolution_criteria: [
        "verification replay remains in pass status",
        "an authorized operator records the approval decision",
      ],
      blocked_reason: "human approval has not been recorded yet",
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
    },
  };
}

function createEvidence(): IssueWorkbenchVerificationEvidence {
  return {
    promotion_gate: "waiting_for_human_approval_and_independent_verifier",
    approval_status: "pending_human_approval",
    approval_artifact_path: "artifacts/run-99/run-result.json#verification_handoff.approval_workflow.decision",
    authorization_exception:
      "promotion to complete is denied without a recorded human approval artifact and approval:grant permission",
    input_boundary_summary: [
      {
        input_ref: "workspace://artifacts/runtime.log",
        input_kind: "file",
        trust_zone: "trusted_workspace",
      },
    ],
    validation_commands: ["npm test -- --run tests/control-plane/write-api.test.ts"],
    artifact_dir: "artifacts/run-99",
    workspace_dir: "/tmp/workspaces/app",
    summary_path: "artifacts/run-99/run-result.json",
    runtime_log_path: "artifacts/run-99/runtime.log",
    recovery_outcome: "not_needed",
    recovery_scope: {
      attempted_write_paths: [],
      changed_paths: [],
      modified_preexisting_paths: [],
      created_paths: [],
      restored_paths: [],
      unrestored_paths: [],
      artifact_paths_missing_after_recovery: [],
      residual_risk_paths: [],
    },
  };
}
