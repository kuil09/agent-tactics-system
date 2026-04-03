import { describe, expect, it } from "vitest";

import {
  MicrobenchStatus,
  ProviderKind,
  TaskLevel,
  Transport,
} from "../../src/contracts/enums.js";
import {
  createControlPlaneReadApi,
  type ControlPlaneIssueMetadata,
} from "../../src/control-plane/read-api.js";
import { InMemoryIssueService } from "../../src/control-plane/issue-service.js";
import { createProviderRegistryEntry } from "../../src/providers/registry.js";
import type { RuntimeFixtureOperatorSummary } from "../../src/runtime/cli.js";
import type { RuntimeFixtureRunSummary } from "../../src/control-plane/runtime-fixture-service.js";

describe("control-plane read api", () => {
  it("serves inbox-lite and company issue filters from assigned work", async () => {
    const { api } = createFixture();

    const inboxResponse = await api.handle(
      new Request("http://control-plane.test/api/agents/me/inbox-lite"),
    );
    expect(inboxResponse.status).toBe(200);
    expect(await inboxResponse.json()).toEqual([
      expect.objectContaining({
        id: "issue-child",
        identifier: "NIT-97",
        status: "in_progress",
        activeRun: expect.objectContaining({
          id: "run-97",
        }),
      }),
      expect.objectContaining({
        id: "issue-blocked",
        identifier: "NIT-85",
        status: "blocked",
      }),
    ]);

    const listResponse = await api.handle(
      new Request(
        "http://control-plane.test/api/companies/company-1/issues?assigneeAgentId=agent-fe&status=blocked,in_progress",
      ),
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        id: "issue-child",
        identifier: "NIT-97",
        parentId: "issue-parent",
      }),
      expect.objectContaining({
        id: "issue-blocked",
        identifier: "NIT-85",
        blockedReason: "Waiting for CTO review on deployment scope.",
      }),
    ]);
  });

  it("builds dashboard responses directly from control-plane issue summaries", async () => {
    const { api } = createFixture();

    const response = await api.handle(
      new Request(
        "http://control-plane.test/api/companies/company-1/dashboard?assigneeAgentId=agent-fe",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      heading: "Assigned operator inbox",
      summaryFacts: [
        "Visible issues: 2",
        "Attention needed: 1",
        "Status filters: in progress, blocked, in review",
      ],
      selectedStatuses: ["in_progress", "blocked", "in_review"],
      availableStatuses: [
        { status: "blocked", count: 1 },
        { status: "in_progress", count: 1 },
      ],
      issues: [
        expect.objectContaining({
          id: "issue-child",
          identifier: "NIT-97",
          projectName: "agent-tactics-system",
        }),
        expect.objectContaining({
          id: "issue-blocked",
          warnings: [
            "Waiting for CTO review on deployment scope.",
            "New comments arrived on a blocked or active issue.",
            "Checkout conflict was recorded and needs operator review.",
            "Approval is still pending before promotion can continue.",
          ],
          nextOwner: "cto",
        }),
      ],
    });
  });

  it("returns issue workbench payloads with ancestors, comments, events, and derived view model", async () => {
    const { api } = createFixture();

    const response = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({
          id: "issue-child",
          identifier: "NIT-97",
          assigneeLabel: "Frontend Product Engineer",
          checkout: {
            agentId: "agent-fe",
            runId: "run-97",
            lockedAt: "2026-04-03T10:00:00.000Z",
          },
        }),
        ancestors: [
          expect.objectContaining({
            id: "issue-parent",
            identifier: "NIT-96",
            title: "제품에 필요한 API 엔드포인트를 정리할 것",
          }),
        ],
        comments: [
          expect.objectContaining({
            id: "comment-1",
            kind: "system",
          }),
          expect.objectContaining({
            id: "comment-2",
            authorId: "agent-fe",
            kind: "comment",
          }),
          expect.objectContaining({
            id: "comment-3",
            kind: "system",
          }),
        ],
        events: expect.arrayContaining([
          expect.objectContaining({
            action: "checkout.granted",
          }),
          expect.objectContaining({
            action: "comment.created",
          }),
          expect.objectContaining({
            action: "document.saved",
          }),
        ]),
        workbench: expect.objectContaining({
          identifier: "NIT-97",
          ancestorSummary: ["NIT-96 · 제품에 필요한 API 엔드포인트를 정리할 것 (in progress)"],
          nextOwner: "human_operator",
          nextActions: expect.arrayContaining([
            "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
            "Next owner: human operator",
          ]),
        }),
      }),
    );
  });

  it("exposes heartbeat context, incremental comments, and activity trails", async () => {
    const { api } = createFixture();

    const heartbeatResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/heartbeat-context"),
    );
    expect(heartbeatResponse.status).toBe(200);
    expect(await heartbeatResponse.json()).toEqual({
      issue: {
        id: "issue-child",
        identifier: "NIT-97",
        title: "작업함과 이슈 작업대 읽기 API를 구현할 것",
        description: "Implement the read-only control-plane routes.",
        status: "in_progress",
        priority: "high",
        projectId: "project-1",
        goalId: null,
        parentId: "issue-parent",
        assigneeAgentId: "agent-fe",
        assigneeUserId: null,
        updatedAt: "2026-04-03T10:02:30.000Z",
        checkout: {
          agentId: "agent-fe",
          runId: "run-97",
          lockedAt: "2026-04-03T10:00:00.000Z",
        },
        blockedReason: null,
        nextOwner: "human_operator",
      },
      ancestors: [
        {
          id: "issue-parent",
          identifier: "NIT-96",
          title: "제품에 필요한 API 엔드포인트를 정리할 것",
          status: "in_progress",
          priority: "medium",
        },
      ],
      project: {
        id: "project-1",
        name: "agent-tactics-system",
        status: "backlog",
        targetDate: null,
      },
      goal: null,
      commentCursor: {
        totalComments: 3,
        latestCommentId: "comment-3",
        latestCommentAt: "2026-04-03T10:02:30.000Z",
      },
      wakeComment: null,
    });

    const commentsResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/comments?after=comment-1"),
    );
    expect(commentsResponse.status).toBe(200);
    expect(await commentsResponse.json()).toEqual({
      items: [
        {
          id: "comment-2",
          issueId: "issue-child",
          authorId: "agent-fe",
          body: "Started the read-only control-plane API implementation.",
          kind: "comment",
          createdAt: "2026-04-03T10:01:00.000Z",
        },
        {
          id: "comment-3",
          issueId: "issue-child",
          authorId: "system",
          body: "Document `plan` saved at revision `revision-1`.",
          kind: "system",
          createdAt: "2026-04-03T10:02:30.000Z",
        },
      ],
      after: "comment-1",
      order: "asc",
      totalComments: 3,
    });

    const singleCommentResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/comments/comment-2"),
    );
    expect(singleCommentResponse.status).toBe(200);
    expect(await singleCommentResponse.json()).toEqual({
      id: "comment-2",
      issueId: "issue-child",
      authorId: "agent-fe",
      body: "Started the read-only control-plane API implementation.",
      kind: "comment",
      createdAt: "2026-04-03T10:01:00.000Z",
    });

    const activityResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/activity"),
    );
    expect(activityResponse.status).toBe(200);
    const activityBody = await activityResponse.json();
    expect(activityBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "checkout.granted",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          action: "comment.created",
          metadata: expect.objectContaining({
            comment_id: "comment-2",
          }),
        }),
        expect.objectContaining({
          action: "document.saved",
          metadata: expect.objectContaining({
            document_key: "plan",
            run_id: "run-97",
          }),
        }),
      ]),
    );
  });

  it("lists issue documents and returns document detail payloads", async () => {
    const { api } = createFixture();

    const documentsResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/documents"),
    );
    expect(documentsResponse.status).toBe(200);
    expect(await documentsResponse.json()).toEqual([
      {
        issueId: "issue-child",
        key: "plan",
        title: "Plan",
        format: "markdown",
        body: "# Plan\n\nShip the read API surface.",
        revisionId: "revision-1",
        authorId: "agent-fe",
        createdAt: "2026-04-03T10:02:30.000Z",
        updatedAt: "2026-04-03T10:02:30.000Z",
      },
    ]);

    const detailResponse = await api.handle(
      new Request("http://control-plane.test/api/issues/issue-child/documents/plan"),
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual({
      issueId: "issue-child",
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "# Plan\n\nShip the read API surface.",
      revisionId: "revision-1",
      authorId: "agent-fe",
      createdAt: "2026-04-03T10:02:30.000Z",
      updatedAt: "2026-04-03T10:02:30.000Z",
    });
  });

  it("exposes the latest runtime fixture summary and structured handoff slices", async () => {
    const { api } = createFixture();

    const latestResponse = await api.handle(
      new Request("http://control-plane.test/api/runtime/fixture-runs/latest?scenario=failure"),
    );
    expect(latestResponse.status).toBe(200);
    expect(await latestResponse.json()).toEqual(
      expect.objectContaining({
        scenario: "failure",
        outcome: "blocked",
        operator_summary: expect.objectContaining({
          final_status: "failed_and_requeued",
        }),
        approval_workflow: expect.objectContaining({
          status: "blocked_by_recovery",
        }),
        recovery: expect.objectContaining({
          attempted: true,
        }),
      }),
    );

    const operatorSummaryResponse = await api.handle(
      new Request("http://control-plane.test/api/runtime/fixture-runs/latest/operator-summary"),
    );
    expect(operatorSummaryResponse.status).toBe(200);
    expect(await operatorSummaryResponse.json()).toEqual(
      expect.objectContaining({
        scenario: "success",
        final_status: "pending_approval_and_verification",
      }),
    );

    const evidenceResponse = await api.handle(
      new Request("http://control-plane.test/api/runtime/fixture-runs/latest/verification-evidence"),
    );
    expect(evidenceResponse.status).toBe(200);
    expect(await evidenceResponse.json()).toEqual(
      expect.objectContaining({
        promotion_gate: "waiting_for_human_approval_and_independent_verifier",
      }),
    );

    const approvalResponse = await api.handle(
      new Request("http://control-plane.test/api/runtime/fixture-runs/latest/approval-workflow"),
    );
    expect(approvalResponse.status).toBe(200);
    expect(await approvalResponse.json()).toEqual(
      expect.objectContaining({
        status: "pending_human_approval",
      }),
    );

    const recoveryResponse = await api.handle(
      new Request("http://control-plane.test/api/runtime/fixture-runs/latest/recovery?scenario=failure"),
    );
    expect(recoveryResponse.status).toBe(200);
    expect(await recoveryResponse.json()).toEqual(
      expect.objectContaining({
        attempted: true,
        outcome_classification: "rolled_back_and_requeued",
      }),
    );
  });

  it("exposes provider registry entries and assignment decisions", async () => {
    const { api } = createFixture();

    const registryResponse = await api.handle(
      new Request("http://control-plane.test/api/providers/registry"),
    );
    expect(registryResponse.status).toBe(200);
    expect(await registryResponse.json()).toEqual([
      expect.objectContaining({
        provider_id: "cursor-runtime",
        assignment_modes: ["decompose_only"],
      }),
      expect.objectContaining({
        provider_id: "openai-runtime",
        trust_tier: "T3",
      }),
    ]);

    const entryResponse = await api.handle(
      new Request("http://control-plane.test/api/providers/registry/openai-runtime"),
    );
    expect(entryResponse.status).toBe(200);
    expect(await entryResponse.json()).toEqual(
      expect.objectContaining({
        provider_id: "openai-runtime",
        models: [
          {
            model_id: "gpt-5.4",
            task_levels_supported: ["L1", "L2", "L3", "L4", "L5"],
          },
        ],
      }),
    );

    const decisionResponse = await api.handle(
      new Request("http://control-plane.test/api/providers/assignment-decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "task-123",
          candidate_provider_id: "openai-runtime",
          candidate_model: "gpt-5.4",
          target_role: "implementer",
          requested_task_level: "L4",
          required_skills: ["typescript"],
        }),
      }),
    );
    expect(decisionResponse.status).toBe(200);
    expect(await decisionResponse.json()).toEqual({
      provider: expect.objectContaining({
        provider_id: "openai-runtime",
      }),
      decision: expect.objectContaining({
        decision: "assign",
        reasons: ["provider evidence satisfies direct assignment gate"],
        independent_verifier_required: true,
      }),
    });
  });

  it("rejects invalid provider assignment decision requests", async () => {
    const { api } = createFixture();

    const invalidTaskLevelResponse = await api.handle(
      new Request("http://control-plane.test/api/providers/assignment-decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "task-123",
          candidate_provider_id: "openai-runtime",
          candidate_model: "gpt-5.4",
          target_role: "implementer",
          requested_task_level: "L9",
        }),
      }),
    );
    expect(invalidTaskLevelResponse.status).toBe(400);
    expect(await invalidTaskLevelResponse.json()).toEqual({
      error: "invalid_task_level",
      message: "requested_task_level must be one of: L1, L2, L3, L4, L5",
    });

    const missingProviderResponse = await api.handle(
      new Request("http://control-plane.test/api/providers/assignment-decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_id: "task-123",
          candidate_provider_id: "missing-provider",
          candidate_model: "gpt-5.4",
          target_role: "implementer",
          requested_task_level: "L4",
        }),
      }),
    );
    expect(missingProviderResponse.status).toBe(404);
    expect(await missingProviderResponse.json()).toEqual({
      error: "provider_not_found",
      message: "provider missing-provider was not found",
    });
  });
});

function createFixture(): {
  api: ReturnType<typeof createControlPlaneReadApi>;
} {
  const issueService = new InMemoryIssueService();
  issueService.createIssue({
    id: "issue-parent",
    title: "제품에 필요한 API 엔드포인트를 정리할 것",
    description: "Break the API work into implementation slices.",
    createdAt: "2026-04-03T09:00:00.000Z",
    initialStatus: "in_progress",
  });
  issueService.createIssue({
    id: "issue-child",
    title: "작업함과 이슈 작업대 읽기 API를 구현할 것",
    description: "Implement the read-only control-plane routes.",
    createdAt: "2026-04-03T09:30:00.000Z",
    initialStatus: "todo",
  });
  issueService.createIssue({
    id: "issue-blocked",
    title: "대시보드 구현",
    description: "Wait on CTO review before unblocking the dashboard work.",
    createdAt: "2026-04-03T08:00:00.000Z",
    initialStatus: "blocked",
  });

  issueService.checkoutIssue({
    issueId: "issue-child",
    agentId: "agent-fe",
    runId: "run-97",
    expectedStatuses: ["todo"],
    at: "2026-04-03T10:00:00.000Z",
  });
  issueService.addComment({
    issueId: "issue-child",
    authorId: "agent-fe",
    body: "Started the read-only control-plane API implementation.",
    at: "2026-04-03T10:01:00.000Z",
  });
  issueService.upsertDocument({
    issueId: "issue-child",
    key: "plan",
    title: "Plan",
    format: "markdown",
    body: "# Plan\n\nShip the read API surface.",
    authorId: "agent-fe",
    at: "2026-04-03T10:02:30.000Z",
    baseRevisionId: null,
    runId: "run-97",
  });

  const issues: ControlPlaneIssueMetadata[] = [
    {
      id: "issue-parent",
      companyId: "company-1",
      identifier: "NIT-96",
      priority: "medium",
      projectId: "project-1",
      assigneeAgentId: "agent-cto",
    },
    {
      id: "issue-child",
      companyId: "company-1",
      identifier: "NIT-97",
      priority: "high",
      projectId: "project-1",
      parentId: "issue-parent",
      assigneeAgentId: "agent-fe",
      nextOwner: "human_operator",
      activeRun: {
        id: "run-97",
        status: "running",
        startedAt: "2026-04-03T10:00:00.000Z",
        agentId: "agent-fe",
      },
      operatorSummary: createOperatorSummary(),
      verificationEvidence: createEvidence(),
    },
    {
      id: "issue-blocked",
      companyId: "company-1",
      identifier: "NIT-85",
      priority: "medium",
      projectId: "project-1",
      assigneeAgentId: "agent-fe",
      blockedReason: "Waiting for CTO review on deployment scope.",
      nextOwner: "cto",
      signals: {
        hasNewComments: true,
        hasCheckoutConflict: true,
        awaitingApproval: true,
      },
    },
  ];

  return {
    api: createControlPlaneReadApi({
      viewerAgentId: "agent-fe",
      issueService,
      issues,
      agents: [
        {
          id: "agent-fe",
          name: "Frontend Product Engineer",
        },
        {
          id: "agent-cto",
          name: "CTO",
        },
      ],
      projects: [
        {
          id: "project-1",
          name: "agent-tactics-system",
          status: "backlog",
          targetDate: null,
        },
      ],
      runtimeFixtureService: {
        async getLatestRun(scenario = "success") {
          return scenario === "failure" ? createFailureRuntimeRunSummary() : createRuntimeRunSummary();
        },
      },
      providerRegistry: [
        createProviderRegistryEntry({
          provider_id: "openai-runtime",
          provider_kind: ProviderKind.OpenAI,
          transport: Transport.Api,
          models: [
            {
              model_id: "gpt-5.4",
              task_levels_supported: [
                TaskLevel.L1,
                TaskLevel.L2,
                TaskLevel.L3,
                TaskLevel.L4,
                TaskLevel.L5,
              ],
            },
          ],
          eligibility: {
            protocol_compliant: true,
            heartbeat_ok: true,
            microbench_status: MicrobenchStatus.Pass,
            last_calibrated_at: "2026-04-03T00:00:00Z",
          },
        }),
        createProviderRegistryEntry({
          provider_id: "cursor-runtime",
          provider_kind: ProviderKind.Cursor,
          transport: Transport.Cli,
          models: [
            {
              model_id: "cursor-agent",
              task_levels_supported: [TaskLevel.L1, TaskLevel.L2, TaskLevel.L3],
            },
          ],
          eligibility: {
            protocol_compliant: true,
            heartbeat_ok: true,
            microbench_status: MicrobenchStatus.Pass,
            last_calibrated_at: "2026-04-03T00:00:00Z",
          },
        }),
      ],
    }),
  };
}

function createOperatorSummary(): RuntimeFixtureOperatorSummary {
  return {
    operational_flow: "workspace_routed_runtime_fixture",
    scenario: "success",
    final_status: "pending_approval_and_verification",
    decision:
      "Runtime execution finished, but promotion remains closed until a human approval artifact and independent verification are both present.",
    next_action:
      "Open run-result.json, confirm approval_workflow and input_defense, then collect the approval decision artifact and run the listed validation commands.",
    key_paths: {
      artifact_dir: "artifacts/run-97",
      workspace_dir: "/tmp/workspace",
      summary_path: "artifacts/run-97/run-result.json",
      runtime_log_path: "artifacts/run-97/runtime.log",
      governance_path: "artifacts/run-97/governance.json",
      provider_handshake_path: "artifacts/run-97/run-result.json#provider_handshake",
      workspace_binding_path: "artifacts/run-97/run-result.json#workspace_routing.binding",
    },
    checks: ["workspace routing bound", "approval workflow captured"],
  };
}

function createEvidence() {
  return {
    promotion_gate: "waiting_for_human_approval_and_independent_verifier" as const,
    approval_status: "pending_human_approval" as const,
    approval_artifact_path: "artifacts/approval.json",
    authorization_exception: null,
    input_boundary_summary: [
      {
        input_ref: "workspace://src/control-plane/read-api.ts",
        input_kind: "workspace_file",
        trust_zone: "trusted_workspace",
      },
    ],
    validation_commands: ["npm test -- --run tests/control-plane/read-api.test.ts"],
    artifact_dir: "artifacts/run-97",
    workspace_dir: "/tmp/workspace",
    summary_path: "artifacts/run-97/run-result.json",
    runtime_log_path: "artifacts/run-97/runtime.log",
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

function createRuntimeRunSummary(): RuntimeFixtureRunSummary {
  const verificationHandoff = createVerificationHandoff("pending_human_approval", false);
  return {
    scenario: "success",
    outcome: "patched",
    artifact_dir: "artifacts/runtime-fixtures/success",
    workspace_dir: "/tmp/workspace",
    summary_path: "artifacts/runtime-fixtures/success/run-result.json",
    runtime_log_path: "artifacts/runtime-fixtures/success/workspace/artifacts/runtime.log",
    provider_handshake_path: "artifacts/runtime-fixtures/success/run-result.json#provider_handshake",
    operator_summary: createOperatorSummary(),
    verification_evidence: createEvidence(),
    verification_handoff: verificationHandoff as RuntimeFixtureRunSummary["verification_handoff"],
    approval_workflow: verificationHandoff.approval_workflow as RuntimeFixtureRunSummary["approval_workflow"],
    recovery: verificationHandoff.recovery as RuntimeFixtureRunSummary["recovery"],
    completed: {},
    recovered: null,
  };
}

function createFailureRuntimeRunSummary(): RuntimeFixtureRunSummary {
  const verificationHandoff = createVerificationHandoff("blocked_by_recovery", true);
  return {
    scenario: "failure",
    outcome: "blocked",
    artifact_dir: "artifacts/runtime-fixtures/failure",
    workspace_dir: "/tmp/workspace",
    summary_path: "artifacts/runtime-fixtures/failure/run-result.json",
    runtime_log_path: "artifacts/runtime-fixtures/failure/workspace/artifacts/runtime.log",
    provider_handshake_path: "artifacts/runtime-fixtures/failure/run-result.json#provider_handshake",
    operator_summary: {
      ...createOperatorSummary(),
      scenario: "failure",
      final_status: "failed_and_requeued",
    },
    verification_evidence: {
      ...createEvidence(),
      promotion_gate: "rollback_and_requeue_recorded",
      approval_status: "blocked_by_recovery",
      recovery_outcome: "rollback_completed",
      recovery_scope: {
        ...createEvidence().recovery_scope,
        attempted_write_paths: ["artifacts/runtime.log"],
        residual_risk_paths: ["/tmp/workspace/artifacts/runtime.log"],
      },
    },
    verification_handoff: verificationHandoff as RuntimeFixtureRunSummary["verification_handoff"],
    approval_workflow: verificationHandoff.approval_workflow as RuntimeFixtureRunSummary["approval_workflow"],
    recovery: verificationHandoff.recovery as RuntimeFixtureRunSummary["recovery"],
    completed: {},
    recovered: {},
  };
}

function createVerificationHandoff(
  status: "pending_human_approval" | "blocked_by_recovery",
  attemptedRecovery: boolean,
): any {
  return {
    contract_version: "m5",
    subject_id: "runtime-fixture-97",
    executor_provider_id: "runtime-fixture",
    executor_provider_kind: "other",
    executor_model: "fixture-model",
    rollback_to_version: attemptedRecovery ? 1 : null,
    replay: {
      subject_id: "runtime-fixture-97",
      verification_ids: ["verify-1"],
      evidence: ["previous replay evidence"],
      latest_status: "pass",
      latest_created_at: "2026-04-03T10:00:00.000Z",
      status_counts: {
        pending: 0,
        pass: 1,
        fail: 0,
        requeue: 0,
      },
      recovery_paths: attemptedRecovery ? ["rollback", "requeue"] : [],
      timeline: [
        {
          verification_id: "verify-1",
          status: "pass",
          evidence: ["previous replay evidence"],
          created_at: "2026-04-03T10:00:00.000Z",
        },
      ],
    },
    evidence: {
      verification_required: true,
      approval_required: true,
      approval_status: status,
      independent_verifier_required: true,
      handoff_ready: true,
      summary: "Runtime summary is ready for operator review.",
      commands: ["npm test -- --run tests/control-plane/read-api.test.ts"],
      artifacts: [],
      missing_artifacts: [],
    },
    approval_workflow: {
      workflow_id: "approval-97",
      status,
      request: {
        requested_role: "human_operator",
        request_channel: "handoff_artifact",
        request_artifact_path: "artifacts/runtime-fixtures/success/run-result.json#verification_handoff.approval_workflow.request",
        issued_at: "2026-04-03T10:00:00.000Z",
        summary: "Review the runtime evidence before promotion.",
        required_evidence: ["run-result.json"],
        validation_commands: ["npm test -- --run tests/control-plane/read-api.test.ts"],
      },
      decision: {
        status,
        decision_artifact_path: "artifacts/runtime-fixtures/success/run-result.json#verification_handoff.approval_workflow.decision",
        recorded_by: null,
        recorded_at: null,
        resolution_criteria: ["record an approval artifact"],
        blocked_reason:
          status === "blocked_by_recovery"
            ? "recovery must be reviewed before approval resumes"
            : "human approval has not been recorded yet",
      },
      release: {
        promotion_action: "promote_done_candidate_to_complete",
        release_blocked: true,
        blockers: ["human approval artifact missing"],
        unblock_checklist: ["record the approval decision artifact"],
        next_owner: "human_operator",
      },
    },
    governance: {
      approval_gate: {
        policy_id: "human_approval_required_for_promotion",
        approval_required: true,
        status,
        approver_role: "human_operator",
        artifact_path: "artifacts/runtime-fixtures/success/run-result.json#verification_handoff.approval_workflow.decision",
        promotion_blocked: true,
        rationale: "A human approval artifact must be recorded before promotion.",
      },
      authorization_boundary: {
        promotion_action: "promote_done_candidate_to_complete",
        required_permission: "approval:grant",
        allowed: false,
        exception: "approval:grant permission missing",
      },
      input_defense: [
        {
          input_ref: "workspace://src/control-plane/read-api.ts",
          input_kind: "workspace_file",
          trust_zone: "trusted_workspace",
          handling_rule: "workspace inputs may inform the operator summary",
        },
      ],
      audit_trail: [],
    },
    recovery: {
      attempted: attemptedRecovery,
      outcome_classification: attemptedRecovery ? "rolled_back_and_requeued" : "not_needed",
      strategy: attemptedRecovery ? "rollback_and_requeue" : "none",
      rollback_to_version: attemptedRecovery ? 1 : null,
      repo_restored: attemptedRecovery,
      requeued: attemptedRecovery,
      reason: attemptedRecovery ? "provider execution failed" : null,
      steps: [],
      scope: {
        attempted_write_paths: attemptedRecovery ? ["artifacts/runtime.log"] : [],
        changed_paths: attemptedRecovery ? ["artifacts/runtime.log"] : [],
        modified_preexisting_paths: [],
        created_paths: attemptedRecovery ? ["artifacts/runtime.log"] : [],
        restored_paths: [],
        unrestored_paths: attemptedRecovery ? ["artifacts/runtime.log"] : [],
        artifact_paths_missing_after_recovery: [],
        residual_risk_paths: attemptedRecovery ? ["artifacts/runtime.log"] : [],
      },
    },
    outcome: attemptedRecovery ? "blocked" : "patched",
  };
}
