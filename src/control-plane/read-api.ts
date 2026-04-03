import {
  ApprovalTransitionError,
  type ApprovalComment,
  type ApprovalRecord,
  type InMemoryApprovalService,
} from "./approval-service.js";
import {
  buildDashboardViewModel,
  type DashboardIssue,
  type DashboardViewModel,
} from "./dashboard.js";
import type {
  ExecutionWorkspaceRecord,
  InMemoryExecutionWorkspaceService,
} from "./execution-workspace-service.js";
import {
  buildIssueWorkbenchViewModel,
  type IssueWorkbenchComment,
  type IssueWorkbenchEvent,
  type IssueWorkbenchIssue,
  type IssueWorkbenchVerificationEvidence,
  type IssueWorkbenchViewModel,
} from "./issue-workbench.js";
import type {
  IssueCheckout,
  IssueComment,
  IssueDocumentRecord,
  IssueEvent,
  IssueRecord,
} from "./issue-service.js";
import type { RuntimeFixtureService } from "./runtime-fixture-service.js";
import type { RuntimeFixtureOperatorSummary } from "../runtime/cli.js";
import { TaskLevel } from "../contracts/enums.js";
import type { AssignmentDecision, ProviderRegistryEntry } from "../contracts/types.js";
import { evaluateAssignment } from "../policies/assignment-gate.js";

export interface ControlPlaneAgentSummary {
  id: string;
  name: string;
  title?: string | null;
}

export interface ControlPlaneProjectSummary {
  id: string;
  name: string;
  status?: string | null;
  targetDate?: string | null;
}

export interface ControlPlaneGoalSummary {
  id: string;
  name: string;
  status?: string | null;
}

export interface ControlPlaneIssueMetadata {
  id: string;
  companyId: string;
  identifier?: string | null;
  priority?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  blockedReason?: string | null;
  nextOwner?: string | null;
  activeRun?: {
    id: string;
    status: string;
    startedAt?: string | null;
    agentId?: string | null;
  } | null;
  signals?: {
    hasNewComments?: boolean;
    hasCheckoutConflict?: boolean;
    awaitingApproval?: boolean;
  } | null;
  operatorSummary?: RuntimeFixtureOperatorSummary | null;
  verificationEvidence?: IssueWorkbenchVerificationEvidence | null;
}

export interface ControlPlaneReadApiDependencies {
  viewerAgentId: string;
  now?: () => string;
  issueService: {
    getIssue(issueId: string): IssueRecord;
    listComments(issueId: string, afterCommentId?: string): IssueComment[];
    listDocuments(issueId: string): IssueDocumentRecord[];
    getDocument(issueId: string, key: string): IssueDocumentRecord;
    listEvents(issueId: string): IssueEvent[];
  };
  approvalService?: Pick<
    InMemoryApprovalService,
    "listApprovals" | "getApproval" | "listComments" | "addComment" | "transitionApproval"
  >;
  runtimeFixtureService?: Pick<RuntimeFixtureService, "getLatestRun">;
  executionWorkspaceService?: Pick<
    InMemoryExecutionWorkspaceService,
    "listWorkspaces" | "listProjectWorkspaces" | "getWorkspace" | "updateWorkspace"
  >;
  issues: ControlPlaneIssueMetadata[];
  agents?: ControlPlaneAgentSummary[];
  projects?: ControlPlaneProjectSummary[];
  goals?: ControlPlaneGoalSummary[];
  providerRegistry?: ProviderRegistryEntry[];
}

interface ResolvedIssue {
  record: IssueRecord;
  metadata: ControlPlaneIssueMetadata;
}

interface HeartbeatContextResponse {
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    description: string;
    status: string;
    priority: string | null;
    projectId: string | null;
    goalId: string | null;
    parentId: string | null;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    updatedAt: string;
    checkout: IssueCheckout | null;
    blockedReason: string | null;
    nextOwner: string | null;
  };
  ancestors: Array<{
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    priority: string | null;
  }>;
  project: ControlPlaneProjectSummary | null;
  goal: ControlPlaneGoalSummary | null;
  commentCursor: {
    totalComments: number;
    latestCommentId: string | null;
    latestCommentAt: string | null;
  };
  wakeComment: null;
}

interface JsonRequest {
  authorId?: string;
  body?: string;
  actorId?: string;
  name?: string;
  rootPath?: string;
  repoUrl?: string;
  status?: "ready" | "blocked";
  blockedReason?: string | null;
  recoveryPlan?: ExecutionWorkspaceRecord["recoveryPlan"];
  lastRouting?: ExecutionWorkspaceRecord["lastRouting"];
  task_id?: string;
  candidate_provider_id?: string;
  candidate_model?: string;
  target_role?: string;
  requested_task_level?: string;
  required_skills?: string[];
}

export function createControlPlaneReadApi(dependencies: ControlPlaneReadApiDependencies): {
  handle(request: Request): Promise<Response>;
} {
  const metadataById = new Map(dependencies.issues.map((issue) => [issue.id, issue]));
  const agentById = new Map((dependencies.agents ?? []).map((agent) => [agent.id, agent]));
  const projectById = new Map((dependencies.projects ?? []).map((project) => [project.id, project]));
  const goalById = new Map((dependencies.goals ?? []).map((goal) => [goal.id, goal]));
  const providerRegistry = [...(dependencies.providerRegistry ?? [])].sort((left, right) =>
    left.provider_id.localeCompare(right.provider_id),
  );
  const providerById = new Map(providerRegistry.map((provider) => [provider.provider_id, provider]));

  function resolveIssue(issueId: string): ResolvedIssue | null {
    const metadata = metadataById.get(issueId);
    if (!metadata) {
      return null;
    }

    try {
      return {
        record: dependencies.issueService.getIssue(issueId),
        metadata,
      };
    } catch {
      return null;
    }
  }

  function listResolvedIssues(companyId: string): ResolvedIssue[] {
    return dependencies.issues
      .filter((issue) => issue.companyId === companyId)
      .map((issue) => resolveIssue(issue.id))
      .filter((issue): issue is ResolvedIssue => issue !== null);
  }

  function listAncestors(issue: ResolvedIssue): ResolvedIssue[] {
    const ancestors: ResolvedIssue[] = [];
    const visited = new Set<string>();
    let cursor = issue.metadata.parentId ?? null;

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const ancestor = resolveIssue(cursor);
      if (!ancestor) {
        break;
      }

      ancestors.unshift(ancestor);
      cursor = ancestor.metadata.parentId ?? null;
    }

    return ancestors;
  }

  function getAgentLabel(agentId: string | null | undefined): string | null {
    if (!agentId) {
      return null;
    }

    return agentById.get(agentId)?.name ?? agentId;
  }

  function buildInboxLite(companyId: string): unknown {
    return listResolvedIssues(companyId)
      .filter(
        (issue) =>
          issue.metadata.assigneeAgentId === dependencies.viewerAgentId &&
          !TERMINAL_STATUSES.has(issue.record.status),
      )
      .sort(compareIssueListOrder)
      .map((issue) => ({
        id: issue.record.id,
        identifier: issue.metadata.identifier ?? null,
        title: issue.record.title,
        status: issue.record.status,
        priority: issue.metadata.priority ?? null,
        projectId: issue.metadata.projectId ?? null,
        goalId: issue.metadata.goalId ?? null,
        parentId: issue.metadata.parentId ?? null,
        updatedAt: issue.record.updatedAt,
        activeRun: issue.metadata.activeRun ?? null,
      }));
  }

  function buildIssueFilterResponse(url: URL, companyId: string): unknown {
    const assigneeAgentId = url.searchParams.get("assigneeAgentId");
    const statuses = splitCsv(url.searchParams.get("status"));

    return listResolvedIssues(companyId)
      .filter((issue) =>
        assigneeAgentId ? issue.metadata.assigneeAgentId === assigneeAgentId : true,
      )
      .filter((issue) => (statuses.length > 0 ? statuses.includes(issue.record.status) : true))
      .sort(compareIssueListOrder)
      .map((issue) => ({
        id: issue.record.id,
        identifier: issue.metadata.identifier ?? null,
        title: issue.record.title,
        description: issue.record.description,
        status: issue.record.status,
        priority: issue.metadata.priority ?? null,
        projectId: issue.metadata.projectId ?? null,
        goalId: issue.metadata.goalId ?? null,
        parentId: issue.metadata.parentId ?? null,
        assigneeAgentId: issue.metadata.assigneeAgentId ?? null,
        assigneeUserId: issue.metadata.assigneeUserId ?? null,
        updatedAt: issue.record.updatedAt,
        checkout: issue.record.checkout,
        blockedReason: issue.metadata.blockedReason ?? null,
        nextOwner: issue.metadata.nextOwner ?? null,
        activeRun: issue.metadata.activeRun ?? null,
        signals: issue.metadata.signals ?? null,
      }));
  }

  function buildDashboardResponse(url: URL, companyId: string): DashboardViewModel {
    const assigneeAgentId = url.searchParams.get("assigneeAgentId");
    const selectedStatuses = splitCsv(url.searchParams.get("status"));
    const issues: DashboardIssue[] = listResolvedIssues(companyId)
      .filter((issue) =>
        assigneeAgentId ? issue.metadata.assigneeAgentId === assigneeAgentId : true,
      )
      .map((issue) => ({
        id: issue.record.id,
        identifier: issue.metadata.identifier ?? null,
        title: issue.record.title,
        status: issue.record.status,
        priority: issue.metadata.priority ?? null,
        updatedAt: issue.record.updatedAt,
        projectName: issue.metadata.projectId
          ? projectById.get(issue.metadata.projectId)?.name ?? null
          : null,
        blockedReason: issue.metadata.blockedReason ?? null,
        parent: buildParentSummary(issue),
        activeRun: issue.metadata.activeRun ?? null,
        signals: issue.metadata.signals ?? null,
        nextOwner: issue.metadata.nextOwner ?? null,
      }));

    return buildDashboardViewModel({
      heading: "Assigned operator inbox",
      selectedStatuses,
      issues,
    });
  }

  function buildIssueResponse(issue: ResolvedIssue): unknown {
    const ancestors = listAncestors(issue);
    const comments = buildWorkbenchComments(issue.record.id);
    const events = buildWorkbenchEvents(issue.record.id);
    const workbenchIssue = buildWorkbenchIssue(issue);
    const workbench = buildIssueWorkbenchViewModel({
      issue: workbenchIssue,
      ancestors: ancestors.map((ancestor) => ({
        identifier: ancestor.metadata.identifier ?? null,
        title: ancestor.record.title,
        status: ancestor.record.status,
      })),
      comments,
      events,
      operatorSummary: issue.metadata.operatorSummary ?? null,
      verificationEvidence: issue.metadata.verificationEvidence ?? null,
    });

    return {
      issue: {
        ...workbenchIssue,
        projectId: issue.metadata.projectId ?? null,
        goalId: issue.metadata.goalId ?? null,
        assigneeAgentId: issue.metadata.assigneeAgentId ?? null,
        assigneeUserId: issue.metadata.assigneeUserId ?? null,
      },
      project: issue.metadata.projectId ? projectById.get(issue.metadata.projectId) ?? null : null,
      goal: issue.metadata.goalId ? goalById.get(issue.metadata.goalId) ?? null : null,
      ancestors: ancestors.map((ancestor) => ({
        id: ancestor.record.id,
        identifier: ancestor.metadata.identifier ?? null,
        title: ancestor.record.title,
        status: ancestor.record.status,
        priority: ancestor.metadata.priority ?? null,
      })),
      comments,
      events,
      operatorSummary: issue.metadata.operatorSummary ?? null,
      verificationEvidence: issue.metadata.verificationEvidence ?? null,
      workbench,
    };
  }

  function buildHeartbeatContext(issue: ResolvedIssue): HeartbeatContextResponse {
    const comments = dependencies.issueService.listComments(issue.record.id);
    const latestComment = comments.at(-1) ?? null;
    const ancestors = listAncestors(issue);

    return {
      issue: {
        id: issue.record.id,
        identifier: issue.metadata.identifier ?? null,
        title: issue.record.title,
        description: issue.record.description,
        status: issue.record.status,
        priority: issue.metadata.priority ?? null,
        projectId: issue.metadata.projectId ?? null,
        goalId: issue.metadata.goalId ?? null,
        parentId: issue.metadata.parentId ?? null,
        assigneeAgentId: issue.metadata.assigneeAgentId ?? null,
        assigneeUserId: issue.metadata.assigneeUserId ?? null,
        updatedAt: issue.record.updatedAt,
        checkout: issue.record.checkout,
        blockedReason: issue.metadata.blockedReason ?? null,
        nextOwner: issue.metadata.nextOwner ?? null,
      },
      ancestors: ancestors.map((ancestor) => ({
        id: ancestor.record.id,
        identifier: ancestor.metadata.identifier ?? null,
        title: ancestor.record.title,
        status: ancestor.record.status,
        priority: ancestor.metadata.priority ?? null,
      })),
      project: issue.metadata.projectId ? projectById.get(issue.metadata.projectId) ?? null : null,
      goal: issue.metadata.goalId ? goalById.get(issue.metadata.goalId) ?? null : null,
      commentCursor: {
        totalComments: comments.length,
        latestCommentId: latestComment?.id ?? null,
        latestCommentAt: latestComment?.createdAt ?? null,
      },
      wakeComment: null,
    };
  }

  function buildCommentsResponse(url: URL, issue: ResolvedIssue): unknown {
    const order = url.searchParams.get("order") ?? "asc";
    if (order !== "asc" && order !== "desc") {
      return json(
        {
          error: "invalid_order",
          message: "order must be asc or desc",
        },
        400,
      );
    }

    const after = url.searchParams.get("after") ?? undefined;
    const comments = dependencies.issueService.listComments(issue.record.id, after);
    const ordered = order === "desc" ? [...comments].reverse() : comments;

    return {
      items: ordered.map((comment) => toCommentResponse(comment)),
      after: after ?? null,
      order,
      totalComments: dependencies.issueService.listComments(issue.record.id).length,
    };
  }

  function buildCommentByIdResponse(issue: ResolvedIssue, commentId: string): unknown {
    const comment = dependencies
      .issueService
      .listComments(issue.record.id)
      .find((entry) => entry.id === commentId);
    if (!comment) {
      return json(
        {
          error: "comment_not_found",
          message: `comment ${commentId} was not found on issue ${issue.record.id}`,
        },
        404,
      );
    }

    return toCommentResponse(comment);
  }

  function buildDocumentsResponse(issue: ResolvedIssue): unknown {
    return dependencies.issueService.listDocuments(issue.record.id).map((document) => ({
      ...document,
    }));
  }

  function buildDocumentByKeyResponse(issue: ResolvedIssue, key: string): Response | unknown {
    try {
      return {
        ...dependencies.issueService.getDocument(issue.record.id, key),
      };
    } catch {
      return notFound(
        "document_not_found",
        `document ${key} was not found on issue ${issue.record.id}`,
      );
    }
  }

  function buildActivityResponse(issue: ResolvedIssue): unknown {
    return {
      items: dependencies.issueService.listEvents(issue.record.id).map((event) => ({
        ...event,
      })),
    };
  }

  function buildApprovalSummary(approval: ApprovalRecord): unknown {
    return {
      id: approval.id,
      companyId: approval.companyId,
      issueIds: approval.issueLinks.map((link) => link.issueId),
      issueIdentifiers: approval.issueLinks.map((link) => link.identifier ?? null),
      decisionOutcome: approval.decisionOutcome,
      request: approval.workflow.request,
      decision: approval.workflow.decision,
      release: approval.workflow.release,
      verificationEvidence: approval.verificationEvidence,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
    };
  }

  function buildWorkspaceResponse(workspace: ExecutionWorkspaceRecord): unknown {
    return {
      id: workspace.id,
      companyId: workspace.companyId,
      projectId: workspace.projectId,
      name: workspace.name,
      rootPath: workspace.rootPath,
      repoUrl: workspace.repoUrl,
      status: workspace.status,
      blockedReason: workspace.blockedReason,
      recoveryPlan: workspace.recoveryPlan,
      lastRouting: workspace.lastRouting,
      updatedAt: workspace.updatedAt,
    };
  }

  function buildProviderRegistryResponse(): unknown {
    return providerRegistry.map((provider) => ({
      ...provider,
    }));
  }

  function buildProviderRegistryEntryResponse(providerId: string): Response | unknown {
    const provider = providerById.get(providerId);
    if (!provider) {
      return notFound("provider_not_found", `provider ${providerId} was not found`);
    }

    return { ...provider };
  }

  function buildAssignmentDecisionResponse(body: JsonRequest | null): Response | unknown {
    if (!body) {
      return json(
        {
          error: "invalid_request",
          message: "a json object is required",
        },
        400,
      );
    }

    if (
      !body.task_id ||
      !body.candidate_provider_id ||
      !body.candidate_model ||
      !body.target_role ||
      !body.requested_task_level
    ) {
      return json(
        {
          error: "invalid_request",
          message:
            "task_id, candidate_provider_id, candidate_model, target_role, and requested_task_level are required",
        },
        400,
      );
    }

    if (!Object.values(TaskLevel).includes(body.requested_task_level as TaskLevel)) {
      return json(
        {
          error: "invalid_task_level",
          message: `requested_task_level must be one of: ${Object.values(TaskLevel).join(", ")}`,
        },
        400,
      );
    }

    if (
      body.required_skills !== undefined &&
      (!Array.isArray(body.required_skills) ||
        body.required_skills.some((skill) => typeof skill !== "string"))
    ) {
      return json(
        {
          error: "invalid_request",
          message: "required_skills must be an array of strings",
        },
        400,
      );
    }

    const provider = providerById.get(body.candidate_provider_id);
    if (!provider) {
      return notFound(
        "provider_not_found",
        `provider ${body.candidate_provider_id} was not found`,
      );
    }

    const decision: AssignmentDecision = evaluateAssignment({
      task_id: body.task_id,
      candidate_provider_id: body.candidate_provider_id,
      candidate_model: body.candidate_model,
      target_role: body.target_role,
      requested_task_level: body.requested_task_level as TaskLevel,
      required_skills: body.required_skills,
      provider,
    });

    return {
      provider,
      decision,
    };
  }

  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = trimTrailingSlash(url.pathname);

      if (request.method === "GET" && path === "/api/agents/me/inbox-lite") {
        const viewerIssue = dependencies.issues.find(
          (issue) => issue.assigneeAgentId === dependencies.viewerAgentId,
        );
        const companyId = viewerIssue?.companyId;
        if (!companyId) {
          return json([]);
        }

        return json(buildInboxLite(companyId));
      }

      const companyIssuesMatch = path.match(/^\/api\/companies\/([^/]+)\/issues$/);
      if (request.method === "GET" && companyIssuesMatch) {
        return json(buildIssueFilterResponse(url, decodeURIComponent(companyIssuesMatch[1]!)));
      }

      if (request.method === "GET" && path === "/api/providers/registry") {
        if (providerRegistry.length === 0) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        return json(buildProviderRegistryResponse());
      }

      const providerRegistryEntryMatch = path.match(/^\/api\/providers\/registry\/([^/]+)$/);
      if (request.method === "GET" && providerRegistryEntryMatch) {
        if (providerRegistry.length === 0) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const response = buildProviderRegistryEntryResponse(
          decodeURIComponent(providerRegistryEntryMatch[1]!),
        );
        return response instanceof Response ? response : json(response);
      }

      if (request.method === "POST" && path === "/api/providers/assignment-decisions") {
        if (providerRegistry.length === 0) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const response = buildAssignmentDecisionResponse(await parseJsonBody(request));
        return response instanceof Response ? response : json(response);
      }

      if (request.method === "GET" && path === "/api/runtime/fixture-runs/latest") {
        if (!dependencies.runtimeFixtureService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const scenario = parseRuntimeScenario(url.searchParams.get("scenario"));
        if (scenario instanceof Response) {
          return scenario;
        }

        const run = await dependencies.runtimeFixtureService.getLatestRun(scenario);
        if (!run) {
          return notFound(
            "runtime_run_not_found",
            `no runtime fixture summary exists for scenario ${scenario}`,
          );
        }

        return json(run);
      }

      const runtimeSummaryMatch = path.match(
        /^\/api\/runtime\/fixture-runs\/latest\/(operator-summary|verification-evidence|approval-workflow|recovery)$/,
      );
      if (request.method === "GET" && runtimeSummaryMatch) {
        if (!dependencies.runtimeFixtureService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const scenario = parseRuntimeScenario(url.searchParams.get("scenario"));
        if (scenario instanceof Response) {
          return scenario;
        }

        const run = await dependencies.runtimeFixtureService.getLatestRun(scenario);
        if (!run) {
          return notFound(
            "runtime_run_not_found",
            `no runtime fixture summary exists for scenario ${scenario}`,
          );
        }

        switch (runtimeSummaryMatch[1]) {
          case "operator-summary":
            return json(run.operator_summary);
          case "verification-evidence":
            return json(run.verification_evidence);
          case "approval-workflow":
            return json(run.approval_workflow);
          case "recovery":
            return json(run.recovery);
        }
      }

      const dashboardMatch = path.match(/^\/api\/companies\/([^/]+)\/dashboard$/);
      if (request.method === "GET" && dashboardMatch) {
        return json(buildDashboardResponse(url, decodeURIComponent(dashboardMatch[1]!)));
      }

      const companyApprovalsMatch = path.match(/^\/api\/companies\/([^/]+)\/approvals$/);
      if (request.method === "GET" && companyApprovalsMatch) {
        if (!dependencies.approvalService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        return json(
          dependencies
            .approvalService
            .listApprovals(decodeURIComponent(companyApprovalsMatch[1]!))
            .map((approval) => buildApprovalSummary(approval)),
        );
      }

      const companyExecutionWorkspacesMatch = path.match(
        /^\/api\/companies\/([^/]+)\/execution-workspaces$/,
      );
      if (request.method === "GET" && companyExecutionWorkspacesMatch) {
        if (!dependencies.executionWorkspaceService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        return json(
          dependencies
            .executionWorkspaceService
            .listWorkspaces(decodeURIComponent(companyExecutionWorkspacesMatch[1]!))
            .map((workspace) => buildWorkspaceResponse(workspace)),
        );
      }

      const projectWorkspacesMatch = path.match(/^\/api\/projects\/([^/]+)\/workspaces$/);
      if (request.method === "GET" && projectWorkspacesMatch) {
        if (!dependencies.executionWorkspaceService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        return json(
          dependencies
            .executionWorkspaceService
            .listProjectWorkspaces(decodeURIComponent(projectWorkspacesMatch[1]!))
            .map((workspace) => buildWorkspaceResponse(workspace)),
        );
      }

      const issueCommentMatch = path.match(/^\/api\/issues\/([^/]+)\/comments\/([^/]+)$/);
      if (request.method === "GET" && issueCommentMatch) {
        const issue = resolveIssue(decodeURIComponent(issueCommentMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueCommentMatch[1]} was not found`);
        }

        const response = buildCommentByIdResponse(issue, decodeURIComponent(issueCommentMatch[2]!));
        return response instanceof Response ? response : json(response);
      }

      const issueCommentsMatch = path.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (request.method === "GET" && issueCommentsMatch) {
        const issue = resolveIssue(decodeURIComponent(issueCommentsMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueCommentsMatch[1]} was not found`);
        }

        const response = buildCommentsResponse(url, issue);
        return response instanceof Response ? response : json(response);
      }

      const issueDocumentMatch = path.match(/^\/api\/issues\/([^/]+)\/documents\/([^/]+)$/);
      if (request.method === "GET" && issueDocumentMatch) {
        const issue = resolveIssue(decodeURIComponent(issueDocumentMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueDocumentMatch[1]} was not found`);
        }

        const response = buildDocumentByKeyResponse(
          issue,
          decodeURIComponent(issueDocumentMatch[2]!),
        );
        return response instanceof Response ? response : json(response);
      }

      const issueDocumentsMatch = path.match(/^\/api\/issues\/([^/]+)\/documents$/);
      if (request.method === "GET" && issueDocumentsMatch) {
        const issue = resolveIssue(decodeURIComponent(issueDocumentsMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueDocumentsMatch[1]} was not found`);
        }

        return json(buildDocumentsResponse(issue));
      }

      const issueActivityMatch = path.match(/^\/api\/issues\/([^/]+)\/activity$/);
      if (request.method === "GET" && issueActivityMatch) {
        const issue = resolveIssue(decodeURIComponent(issueActivityMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueActivityMatch[1]} was not found`);
        }

        return json(buildActivityResponse(issue));
      }

      const heartbeatContextMatch = path.match(/^\/api\/issues\/([^/]+)\/heartbeat-context$/);
      if (request.method === "GET" && heartbeatContextMatch) {
        const issue = resolveIssue(decodeURIComponent(heartbeatContextMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${heartbeatContextMatch[1]} was not found`);
        }

        return json(buildHeartbeatContext(issue));
      }

      const issueMatch = path.match(/^\/api\/issues\/([^/]+)$/);
      if (request.method === "GET" && issueMatch) {
        const issue = resolveIssue(decodeURIComponent(issueMatch[1]!));
        if (!issue) {
          return notFound("issue_not_found", `issue ${issueMatch[1]} was not found`);
        }

        return json(buildIssueResponse(issue));
      }

      const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
      if (request.method === "GET" && approvalMatch) {
        if (!dependencies.approvalService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        try {
          return json(
            buildApprovalSummary(
              dependencies.approvalService.getApproval(decodeURIComponent(approvalMatch[1]!)),
            ),
          );
        } catch {
          return notFound("approval_not_found", `approval ${approvalMatch[1]} was not found`);
        }
      }

      const approvalIssuesMatch = path.match(/^\/api\/approvals\/([^/]+)\/issues$/);
      if (request.method === "GET" && approvalIssuesMatch) {
        if (!dependencies.approvalService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        try {
          const approval = dependencies
            .approvalService
            .getApproval(decodeURIComponent(approvalIssuesMatch[1]!));
          return json(
            approval.issueLinks.map((link) => ({
              issueId: link.issueId,
              identifier: link.identifier ?? null,
              title: link.title,
              status: link.status,
            })),
          );
        } catch {
          return notFound("approval_not_found", `approval ${approvalIssuesMatch[1]} was not found`);
        }
      }

      const approvalCommentsMatch = path.match(/^\/api\/approvals\/([^/]+)\/comments$/);
      if (approvalCommentsMatch) {
        if (!dependencies.approvalService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const approvalId = decodeURIComponent(approvalCommentsMatch[1]!);
        if (request.method === "GET") {
          try {
            return json(dependencies.approvalService.listComments(approvalId));
          } catch {
            return notFound("approval_not_found", `approval ${approvalId} was not found`);
          }
        }

        if (request.method === "POST") {
          const body = await parseJsonBody(request);
          if (!body || !body.authorId || !body.body) {
            return json(
              {
                error: "invalid_request",
                message: "authorId and body are required",
              },
              400,
            );
          }

          try {
            return json(
              dependencies.approvalService.addComment({
                approvalId,
                authorId: body.authorId,
                body: body.body,
                at: dependencies.now?.() ?? new Date().toISOString(),
              }),
              201,
            );
          } catch {
            return notFound("approval_not_found", `approval ${approvalId} was not found`);
          }
        }
      }

      const approvalActionMatch = path.match(
        /^\/api\/approvals\/([^/]+)\/(approve|reject|request-revision|resubmit)$/,
      );
      if (request.method === "POST" && approvalActionMatch) {
        if (!dependencies.approvalService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const body = await parseJsonBody(request);
        if (!body || !body.actorId) {
          return json(
            {
              error: "invalid_request",
              message: "actorId is required",
            },
            400,
          );
        }

        const action = approvalActionMatch[2]!.replaceAll("-", "_") as
          | "approve"
          | "reject"
          | "request_revision"
          | "resubmit";

        try {
          return json(
            buildApprovalSummary(
              dependencies.approvalService.transitionApproval({
                approvalId: decodeURIComponent(approvalActionMatch[1]!),
                actorId: body.actorId,
                action,
                at: dependencies.now?.() ?? new Date().toISOString(),
              }),
            ),
          );
        } catch (error) {
          if (error instanceof ApprovalTransitionError) {
            return json(
              {
                error: error.code,
                message: error.message,
              },
              409,
            );
          }

          return notFound("approval_not_found", `approval ${approvalActionMatch[1]} was not found`);
        }
      }

      const executionWorkspaceMatch = path.match(/^\/api\/execution-workspaces\/([^/]+)$/);
      if (executionWorkspaceMatch) {
        if (!dependencies.executionWorkspaceService) {
          return notFound("route_not_found", `route ${path} was not found`);
        }

        const workspaceId = decodeURIComponent(executionWorkspaceMatch[1]!);
        if (request.method === "GET") {
          try {
            return json(
              buildWorkspaceResponse(
                dependencies.executionWorkspaceService.getWorkspace(workspaceId),
              ),
            );
          } catch {
            return notFound(
              "execution_workspace_not_found",
              `execution workspace ${workspaceId} was not found`,
            );
          }
        }

        if (request.method === "PATCH") {
          const body = await parseJsonBody(request);
          if (!body) {
            return json(
              {
                error: "invalid_request",
                message: "a json object is required",
              },
              400,
            );
          }

          try {
            return json(
              buildWorkspaceResponse(
                dependencies.executionWorkspaceService.updateWorkspace({
                  workspaceId,
                  name: body.name,
                  rootPath: body.rootPath,
                  repoUrl: body.repoUrl,
                  status: body.status,
                  blockedReason: body.blockedReason,
                  recoveryPlan: body.recoveryPlan,
                  lastRouting: body.lastRouting,
                  at: dependencies.now?.() ?? new Date().toISOString(),
                }),
              ),
            );
          } catch {
            return notFound(
              "execution_workspace_not_found",
              `execution workspace ${workspaceId} was not found`,
            );
          }
        }
      }

      if (!["GET", "POST", "PATCH"].includes(request.method)) {
        return json(
          {
            error: "method_not_allowed",
            message: `${request.method} is not supported`,
          },
          405,
        );
      }

      return notFound("route_not_found", `route ${path} was not found`);
    },
  };

  function buildParentSummary(issue: ResolvedIssue): { identifier?: string | null; title: string } | null {
    const parentId = issue.metadata.parentId;
    if (!parentId) {
      return null;
    }

    const parent = resolveIssue(parentId);
    if (!parent) {
      return null;
    }

    return {
      identifier: parent.metadata.identifier ?? null,
      title: parent.record.title,
    };
  }

  function buildWorkbenchIssue(issue: ResolvedIssue): IssueWorkbenchIssue {
    return {
      id: issue.record.id,
      identifier: issue.metadata.identifier ?? null,
      title: issue.record.title,
      description: issue.record.description,
      status: issue.record.status,
      priority: issue.metadata.priority ?? null,
      assigneeLabel: getAgentLabel(issue.metadata.assigneeAgentId) ?? null,
      projectName: issue.metadata.projectId
        ? projectById.get(issue.metadata.projectId)?.name ?? null
        : null,
      parent: buildParentSummary(issue),
      updatedAt: issue.record.updatedAt,
      checkout: issue.record.checkout,
      blockedReason: issue.metadata.blockedReason ?? null,
      nextOwner: issue.metadata.nextOwner ?? null,
    };
  }

  function buildWorkbenchComments(issueId: string): IssueWorkbenchComment[] {
    return dependencies.issueService.listComments(issueId).map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      authorLabel: getAgentLabel(comment.authorId) ?? undefined,
      body: comment.body,
      kind: comment.kind,
      createdAt: comment.createdAt,
    }));
  }

  function buildWorkbenchEvents(issueId: string): IssueWorkbenchEvent[] {
    return dependencies.issueService.listEvents(issueId).map((event) => ({
      id: event.id,
      actorId: event.actorId,
      action: event.action,
      outcome: event.outcome,
      detail: event.detail,
      createdAt: event.createdAt,
      metadata: { ...event.metadata },
    }));
  }
}

const STATUS_ORDER = new Map<string, number>([
  ["in_progress", 0],
  ["todo", 1],
  ["blocked", 2],
  ["in_review", 3],
  ["backlog", 4],
  ["done", 5],
  ["cancelled", 6],
]);

const PRIORITY_ORDER = new Map<string, number>([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

function compareIssueListOrder(left: ResolvedIssue, right: ResolvedIssue): number {
  return (
    (STATUS_ORDER.get(left.record.status) ?? 99) - (STATUS_ORDER.get(right.record.status) ?? 99) ||
    (PRIORITY_ORDER.get(left.metadata.priority ?? "") ?? 99) -
      (PRIORITY_ORDER.get(right.metadata.priority ?? "") ?? 99) ||
    right.record.updatedAt.localeCompare(left.record.updatedAt) ||
    left.record.title.localeCompare(right.record.title)
  );
}

function splitCsv(value: string | null): string[] {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];
}

function parseRuntimeScenario(
  value: string | null,
): RuntimeFixtureOperatorSummary["scenario"] | Response {
  if (value === null || value === "") {
    return "success";
  }

  if (value === "success" || value === "failure") {
    return value;
  }

  return json(
    {
      error: "invalid_scenario",
      message: "scenario must be success or failure",
    },
    400,
  );
}

function toCommentResponse(comment: IssueComment): IssueComment {
  return { ...comment };
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

async function parseJsonBody(request: Request): Promise<JsonRequest | null> {
  try {
    return (await request.json()) as JsonRequest;
  } catch {
    return null;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function notFound(error: string, message: string): Response {
  return json({ error, message }, 404);
}
