import { describe, expect, it, afterEach, beforeEach } from "vitest";

import {
  MicrobenchStatus,
  ProviderKind,
  TaskLevel,
  Transport,
} from "../../src/contracts/enums.js";
import {
  startControlPlaneOperatorServer,
  type ControlPlaneOperatorServer,
} from "../../src/control-plane/operator-server.js";
import { InMemoryIssueService } from "../../src/control-plane/issue-service.js";
import { InMemoryApprovalService } from "../../src/control-plane/approval-service.js";
import type { ControlPlaneIssueMetadata } from "../../src/control-plane/read-api.js";
import type { IssueWorkbenchVerificationEvidence } from "../../src/control-plane/issue-workbench.js";
import { createProviderRegistryEntry } from "../../src/providers/registry.js";
import type { ApprovalWorkflowHandoff } from "../../src/runtime/executable-runtime.js";
import type { RuntimeFixtureRunSummary } from "../../src/control-plane/runtime-fixture-service.js";

const FIXED_AT = "2026-04-03T10:00:00.000Z";
const VIEWER_AGENT_ID = "agent-fe";
const COMPANY_ID = "company-1";

async function get(server: ControlPlaneOperatorServer, path: string): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`);
}

async function post(
  server: ControlPlaneOperatorServer,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(
  server: ControlPlaneOperatorServer,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function put(
  server: ControlPlaneOperatorServer,
  path: string,
  body: unknown,
  runId?: string,
): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(runId ? { "x-paperclip-run-id": runId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function createFixture() {
  const issueService = new InMemoryIssueService();
  const approvalService = new InMemoryApprovalService();

  issueService.createIssue({
    id: "issue-1",
    title: "Connect inbox to real API",
    description: "Operator screen connection task.",
    createdAt: FIXED_AT,
    initialStatus: "in_progress",
  });

  issueService.createIssue({
    id: "issue-blocked",
    title: "Blocked test issue",
    description: "A blocked issue.",
    createdAt: FIXED_AT,
    initialStatus: "blocked",
  });

  approvalService.createApproval({
    id: "approval-1",
    companyId: COMPANY_ID,
    issueLinks: [
      { issueId: "issue-1", identifier: "NIT-100", title: "Connect inbox to real API", status: "in_progress" },
    ],
    workflow: createWorkflow(),
    verificationEvidence: createEvidence(),
    createdAt: FIXED_AT,
  });

  const issues: ControlPlaneIssueMetadata[] = [
    {
      id: "issue-1",
      companyId: COMPANY_ID,
      identifier: "NIT-100",
      priority: "medium",
      projectId: "project-1",
      assigneeAgentId: VIEWER_AGENT_ID,
      verificationEvidence: createEvidence(),
    },
    {
      id: "issue-blocked",
      companyId: COMPANY_ID,
      identifier: "NIT-85",
      priority: "high",
      projectId: "project-1",
      assigneeAgentId: VIEWER_AGENT_ID,
      blockedReason: "Waiting for CTO review.",
    },
  ];

  return {
    issueService,
    approvalService,
    issues,
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
          last_calibrated_at: FIXED_AT,
        },
      }),
    ],
    servers: [] as ControlPlaneOperatorServer[],
    async start() {
      const server = await startControlPlaneOperatorServer({
        viewerAgentId: VIEWER_AGENT_ID,
        issueService,
        approvalService,
        issues,
        providerRegistry: this.providerRegistry,
        runtimeFixtureService: createRuntimeFixtureServiceStub(),
        clock: () => FIXED_AT,
      });
      this.servers.push(server);
      return server;
    },
    async close() {
      await Promise.all(this.servers.map((s) => s.close()));
    },
  };
}

describe("operator-server HTML views", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("serves operator dashboard HTML at GET /", async () => {
    const server = await fixture.start();

    const response = await get(server, "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);

    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Connect inbox to real API");
  });

  it("serves issue workbench HTML at GET /issues/{issueId}", async () => {
    const server = await fixture.start();

    const response = await get(server, "/issues/issue-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);

    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Connect inbox to real API");
    expect(body).toContain("NIT-100");
  });

  it("returns 404 HTML when issue is not found", async () => {
    const server = await fixture.start();

    const response = await get(server, "/issues/nonexistent-issue");
    expect(response.status).toBe(404);

    const body = await response.text();
    expect(body).toContain("Not Found");
  });

  it("serves approval list HTML at GET /approvals", async () => {
    const server = await fixture.start();

    const response = await get(server, "/approvals");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);

    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("NIT-100");
    expect(body).toContain("approval-1");
  });

  it("serves approval workbench HTML at GET /approvals/{approvalId}", async () => {
    const server = await fixture.start();

    const response = await get(server, "/approvals/approval-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);

    const body = await response.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("Approval workbench");
  });

  it("returns 404 HTML when approval is not found", async () => {
    const server = await fixture.start();

    const response = await get(server, "/approvals/nonexistent");
    expect(response.status).toBe(404);

    const body = await response.text();
    expect(body).toContain("Not Found");
  });

  it("returns empty state HTML when no issues are assigned", async () => {
    const emptyServer = await startControlPlaneOperatorServer({
      viewerAgentId: VIEWER_AGENT_ID,
      issueService: new InMemoryIssueService(),
      approvalService: new InMemoryApprovalService(),
      issues: [],
    });
    // Register with fixture so afterEach handles cleanup
    fixture.servers.push(emptyServer);

    const response = await get(emptyServer, "/");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain("No issues found");
  });

  it("returns 404 HTML for unknown paths", async () => {
    const server = await fixture.start();

    const response = await get(server, "/unknown/path");
    expect(response.status).toBe(404);
  });
});

describe("operator-server API pass-through (GET /api/*)", () => {
  let fixture: ReturnType<typeof createFixture>;

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it("proxies GET /api/agents/me/inbox-lite through read API", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await get(server, "/api/agents/me/inbox-lite");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toMatchObject({
      identifier: expect.any(String),
      status: expect.any(String),
    });
  });

  it("proxies GET /api/issues/{issueId} through read API", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await get(server, "/api/issues/issue-1");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.issue).toMatchObject({
      id: "issue-1",
      title: "Connect inbox to real API",
      status: "in_progress",
    });
  });

  it("proxies GET /api/runtime/fixture-runs/latest through read API", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await get(server, "/api/runtime/fixture-runs/latest?scenario=failure");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      scenario: "failure",
      outcome: "blocked",
      operator_summary: {
        final_status: "failed_and_requeued",
      },
    });
  });

  it("proxies provider policy routes through read API", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const registryResponse = await get(server, "/api/providers/registry");
    expect(registryResponse.status).toBe(200);
    expect(await registryResponse.json()).toEqual([
      expect.objectContaining({
        provider_id: "openai-runtime",
      }),
    ]);

    const decisionResponse = await post(server, "/api/providers/assignment-decisions", {
      task_id: "task-123",
      candidate_provider_id: "openai-runtime",
      candidate_model: "gpt-5.4",
      target_role: "implementer",
      requested_task_level: "L4",
    });
    expect(decisionResponse.status).toBe(200);

    const body = await decisionResponse.json();
    expect(body.decision).toMatchObject({
      decision: "assign",
      independent_verifier_required: true,
    });
  });

  it("returns 404 JSON for unknown API routes", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await get(server, "/api/unknown/endpoint");
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBeDefined();
  });
});

describe("operator-server write API (POST/PATCH /api/*)", () => {
  let fixture: ReturnType<typeof createFixture>;

  afterEach(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it("handles issue checkout via POST /api/issues/{issueId}/checkout", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await post(server, "/api/issues/issue-blocked/checkout", {
      agentId: VIEWER_AGENT_ID,
      runId: "run-test-1",
      expectedStatuses: ["blocked"],
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.checkout).toMatchObject({
      agentId: VIEWER_AGENT_ID,
      runId: "run-test-1",
    });
  });

  it("handles PATCH /api/issues/{issueId} for status transition", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    // First checkout
    await post(server, "/api/issues/issue-1/checkout", {
      agentId: VIEWER_AGENT_ID,
      runId: "run-patch-1",
      expectedStatuses: ["in_progress"],
    });

    const response = await patch(server, "/api/issues/issue-1", {
      status: "done",
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("done");
  });

  it("handles POST /api/issues/{issueId}/comments", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await post(server, "/api/issues/issue-1/comments", {
      body: "Operator comment from server test.",
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.body).toBe("Operator comment from server test.");
    expect(body.authorId).toBe(VIEWER_AGENT_ID);
  });

  it("handles PUT /api/issues/{issueId}/documents/{key} and exposes the saved document", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const putResponse = await put(
      server,
      "/api/issues/issue-1/documents/plan",
      {
        title: "Plan",
        format: "markdown",
        body: "# Plan\n\nPublish the write API surface.",
        baseRevisionId: null,
      },
      "run-doc-1",
    );
    expect(putResponse.status).toBe(201);
    expect(await putResponse.json()).toEqual(
      expect.objectContaining({
        key: "plan",
        revisionId: "revision-1",
      }),
    );

    const getResponse = await get(server, "/api/issues/issue-1/documents/plan");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual(
      expect.objectContaining({
        key: "plan",
        title: "Plan",
        revisionId: "revision-1",
      }),
    );
  });

  it("handles POST /api/runtime/fixture-runs", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await post(server, "/api/runtime/fixture-runs", {
      scenario: "failure",
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body).toMatchObject({
      scenario: "failure",
      outcome: "blocked",
      approval_workflow: {
        status: "blocked_by_recovery",
      },
    });
  });

  it("returns 405 for unsupported methods on API routes", async () => {
    fixture = createFixture();
    const server = await fixture.start();

    const response = await fetch(`${server.baseUrl}/api/issues/issue-1`, {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
  });
});

describe("operator-server shows checkout status and blocked reason in issue workbench", () => {
  it("renders checkout state visible in HTML", async () => {
    const issueService = new InMemoryIssueService();
    const approvalService = new InMemoryApprovalService();

    issueService.createIssue({
      id: "issue-locked",
      title: "Issue with checkout",
      description: "Testing checkout display.",
      createdAt: FIXED_AT,
      initialStatus: "todo",
    });

    issueService.checkoutIssue({
      issueId: "issue-locked",
      agentId: VIEWER_AGENT_ID,
      runId: "run-checkout-display",
      expectedStatuses: ["todo"],
      at: FIXED_AT,
    });

    const issues: ControlPlaneIssueMetadata[] = [
      {
        id: "issue-locked",
        companyId: COMPANY_ID,
        identifier: "NIT-101",
        priority: "high",
        assigneeAgentId: VIEWER_AGENT_ID,
      },
    ];

    const server = await startControlPlaneOperatorServer({
      viewerAgentId: VIEWER_AGENT_ID,
      issueService,
      approvalService,
      issues,
    });

    try {
      const response = await get(server, "/issues/issue-locked");
      expect(response.status).toBe(200);

      const body = await response.text();
      // Checkout info should appear in the workbench HTML
      expect(body).toContain("run-checkout-display");
    } finally {
      await server.close();
    }
  });

  it("renders blocked reason visible in issue workbench", async () => {
    const issueService = new InMemoryIssueService();
    const approvalService = new InMemoryApprovalService();

    issueService.createIssue({
      id: "issue-with-block",
      title: "Blocked issue with reason",
      description: "This issue is blocked.",
      createdAt: FIXED_AT,
      initialStatus: "blocked",
    });

    const issues: ControlPlaneIssueMetadata[] = [
      {
        id: "issue-with-block",
        companyId: COMPANY_ID,
        identifier: "NIT-85",
        priority: "medium",
        assigneeAgentId: VIEWER_AGENT_ID,
        blockedReason: "Waiting for external dependency.",
      },
    ];

    const server = await startControlPlaneOperatorServer({
      viewerAgentId: VIEWER_AGENT_ID,
      issueService,
      approvalService,
      issues,
    });

    try {
      const response = await get(server, "/issues/issue-with-block");
      expect(response.status).toBe(200);

      const body = await response.text();
      expect(body).toContain("Waiting for external dependency.");
    } finally {
      await server.close();
    }
  });
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function createWorkflow(): ApprovalWorkflowHandoff {
  return {
    workflow_id: "approval-issue-1",
    status: "pending_human_approval",
    request: {
      requested_role: "human_operator",
      request_channel: "handoff_artifact",
      request_artifact_path: null,
      issued_at: FIXED_AT,
      summary: "Promotion requires human approval.",
      required_evidence: ["run-result.json present"],
      validation_commands: ["npm test"],
    },
    decision: {
      status: "pending_human_approval",
      decision_artifact_path: null,
      recorded_by: null,
      recorded_at: null,
      resolution_criteria: ["operator must record decision artifact"],
      blocked_reason: "human approval has not been recorded yet",
    },
    release: {
      promotion_action: "promote_done_candidate_to_complete",
      release_blocked: true,
      blockers: ["human approval artifact missing"],
      unblock_checklist: ["record the approval decision artifact"],
      next_owner: "human_operator",
    },
  };
}

function createEvidence(): IssueWorkbenchVerificationEvidence {
  return {
    promotion_gate: "waiting_for_human_approval",
    approval_status: "pending_human_approval",
    approval_artifact_path: null,
    authorization_exception: null,
    input_boundary_summary: [
      {
        input_ref: "workspace://src/index.ts",
        input_kind: "workspace_file",
        trust_zone: "trusted_workspace",
      },
    ],
    validation_commands: ["npm test"],
    artifact_dir: "artifacts/run-1",
    workspace_dir: "/tmp/workspace",
    summary_path: "artifacts/run-1/run-result.json",
    runtime_log_path: "artifacts/run-1/runtime.log",
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

function createRuntimeFixtureServiceStub() {
  return {
    async getLatestRun(scenario = "success"): Promise<RuntimeFixtureRunSummary> {
      return scenario === "failure" ? createRuntimeRunSummary("failure") : createRuntimeRunSummary("success");
    },
    async runFixture(input?: { scenario?: "success" | "failure" }): Promise<RuntimeFixtureRunSummary> {
      return input?.scenario === "failure"
        ? createRuntimeRunSummary("failure")
        : createRuntimeRunSummary("success");
    },
  };
}

function createRuntimeRunSummary(
  scenario: "success" | "failure",
): RuntimeFixtureRunSummary {
  const failure = scenario === "failure";
  const verificationHandoff = {
    contract_version: "m5",
    subject_id: "runtime-fixture-1",
    executor_provider_id: "runtime-fixture",
    executor_provider_kind: "other",
    executor_model: "fixture-model",
    outcome: failure ? "blocked" : "patched",
    rollback_to_version: failure ? 1 : null,
    replay: {
      subject_id: "runtime-fixture-1",
      verification_ids: ["verify-1"],
      evidence: ["operator evidence"],
      latest_status: "pass",
      latest_created_at: FIXED_AT,
      status_counts: {
        pending: 0,
        pass: 1,
        fail: 0,
        requeue: 0,
      },
      recovery_paths: failure ? ["rollback", "requeue"] : [],
      timeline: [
        {
          verification_id: "verify-1",
          status: "pass",
          evidence: ["operator evidence"],
          created_at: FIXED_AT,
        },
      ],
    },
    evidence: {
      verification_required: true,
      approval_required: true,
      approval_status: failure ? "blocked_by_recovery" : "pending_human_approval",
      independent_verifier_required: true,
      handoff_ready: true,
      summary: "Runtime summary is ready.",
      commands: ["npm test"],
      artifacts: [],
      missing_artifacts: [],
    },
    approval_workflow: {
      ...createWorkflow(),
      status: failure ? "blocked_by_recovery" : "pending_human_approval",
      decision: {
        ...createWorkflow().decision,
        status: failure ? "blocked_by_recovery" : "pending_human_approval",
      },
    },
    governance: {
      approval_gate: {
        policy_id: "human_approval_required_for_promotion",
        approval_required: true,
        status: failure ? "blocked_by_recovery" : "pending_human_approval",
        approver_role: "human_operator",
        artifact_path: "artifacts/run-1/run-result.json#verification_handoff.approval_workflow.decision",
        promotion_blocked: true,
        rationale: "A human approval artifact is required.",
      },
      authorization_boundary: {
        promotion_action: "promote_done_candidate_to_complete",
        required_permission: "approval:grant",
        allowed: false,
        exception: "approval:grant permission missing",
      },
      input_defense: [],
      audit_trail: [],
    },
    recovery: {
      attempted: failure,
      outcome_classification: failure ? "rolled_back_and_requeued" : "not_needed",
      strategy: failure ? "rollback_and_requeue" : "none",
      rollback_to_version: failure ? 1 : null,
      repo_restored: failure,
      requeued: failure,
      reason: failure ? "provider execution failed" : null,
      steps: [],
      scope: {
        attempted_write_paths: failure ? ["artifacts/runtime.log"] : [],
        changed_paths: failure ? ["artifacts/runtime.log"] : [],
        modified_preexisting_paths: [],
        created_paths: failure ? ["artifacts/runtime.log"] : [],
        restored_paths: [],
        unrestored_paths: failure ? ["artifacts/runtime.log"] : [],
        artifact_paths_missing_after_recovery: [],
        residual_risk_paths: failure ? ["artifacts/runtime.log"] : [],
      },
    },
  } as RuntimeFixtureRunSummary["verification_handoff"];

  return {
    scenario,
    outcome: failure ? "blocked" : "patched",
    artifact_dir: `artifacts/runtime-fixtures/${scenario}`,
    workspace_dir: "/tmp/workspace",
    summary_path: `artifacts/runtime-fixtures/${scenario}/run-result.json`,
    runtime_log_path: `artifacts/runtime-fixtures/${scenario}/workspace/artifacts/runtime.log`,
    provider_handshake_path: `artifacts/runtime-fixtures/${scenario}/run-result.json#provider_handshake`,
    operator_summary: {
      operational_flow: "workspace_routed_runtime_fixture",
      scenario,
      final_status: failure ? "failed_and_requeued" : "pending_approval_and_verification",
      decision: failure
        ? "Runtime execution failed. Rollback and requeue were recorded for the next attempt."
        : "Runtime execution finished on a routed workspace, but promotion remains closed until a human approval artifact and independent verification are both present.",
      next_action: "Inspect the structured runtime summary.",
      key_paths: {
        artifact_dir: `artifacts/runtime-fixtures/${scenario}`,
        workspace_dir: "/tmp/workspace",
        summary_path: `artifacts/runtime-fixtures/${scenario}/run-result.json`,
        runtime_log_path: `artifacts/runtime-fixtures/${scenario}/workspace/artifacts/runtime.log`,
        governance_path: `artifacts/runtime-fixtures/${scenario}/run-result.json#verification_handoff.governance`,
        provider_handshake_path: `artifacts/runtime-fixtures/${scenario}/run-result.json#provider_handshake`,
        workspace_binding_path: `artifacts/runtime-fixtures/${scenario}/run-result.json#workspace_routing.binding`,
      },
      checks: ["runtime summary is present"],
    },
    verification_evidence: createEvidence(),
    verification_handoff: verificationHandoff,
    approval_workflow: {
      ...createWorkflow(),
      status: failure ? "blocked_by_recovery" : "pending_human_approval",
      decision: {
        ...createWorkflow().decision,
        status: failure ? "blocked_by_recovery" : "pending_human_approval",
      },
    },
    recovery: {
      attempted: failure,
      outcome_classification: failure ? "rolled_back_and_requeued" : "not_needed",
      strategy: failure ? "rollback_and_requeue" : "none",
      rollback_to_version: failure ? 1 : null,
      repo_restored: failure,
      requeued: failure,
      reason: failure ? "provider execution failed" : null,
      steps: [],
      scope: {
        attempted_write_paths: failure ? ["artifacts/runtime.log"] : [],
        changed_paths: failure ? ["artifacts/runtime.log"] : [],
        modified_preexisting_paths: [],
        created_paths: failure ? ["artifacts/runtime.log"] : [],
        restored_paths: [],
        unrestored_paths: failure ? ["artifacts/runtime.log"] : [],
        artifact_paths_missing_after_recovery: [],
        residual_risk_paths: failure ? ["artifacts/runtime.log"] : [],
      },
    },
    completed: {},
    recovered: failure ? {} : null,
  };
}
