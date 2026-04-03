import type {
  AddCommentInput,
  CheckoutIssueInput,
  IssueCheckoutError,
  IssueComment,
  IssueDocumentError,
  IssueDocumentRecord,
  IssueRecord,
  IssueReleaseError,
  IssueStatus,
  IssueTransitionError,
  ReleaseIssueInput,
  TransitionIssueInput,
  UpsertIssueDocumentInput,
} from "./issue-service.js";
import type {
  AddApprovalCommentInput,
  ApprovalComment,
  ApprovalRecord,
  TransitionApprovalInput,
  ApprovalTransitionError,
} from "./approval-service.js";
import type { RuntimeFixtureService } from "./runtime-fixture-service.js";

export interface ControlPlaneWriteApiIssueService {
  getIssue(issueId: string): IssueRecord;
  checkoutIssue(input: CheckoutIssueInput): IssueRecord;
  releaseIssue(input: ReleaseIssueInput): IssueRecord;
  transitionIssue(input: TransitionIssueInput): IssueRecord;
  addComment(input: AddCommentInput): IssueComment;
  upsertDocument(input: UpsertIssueDocumentInput): IssueDocumentRecord;
}

export interface ControlPlaneWriteApiApprovalService {
  getApproval(approvalId: string): ApprovalRecord;
  transitionApproval(input: TransitionApprovalInput): ApprovalRecord;
  addComment(input: AddApprovalCommentInput): ApprovalComment;
}

export interface ControlPlaneWriteApiDependencies {
  callerId: string;
  issueService: ControlPlaneWriteApiIssueService;
  approvalService: ControlPlaneWriteApiApprovalService;
  runtimeFixtureService?: Pick<RuntimeFixtureService, "runFixture">;
  clock?: () => string;
}

export interface WriteApiError {
  error: string;
  message: string;
  code?: string;
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";

const WRITE_METHODS: HttpMethod[] = ["POST", "PUT", "PATCH"];

export function createControlPlaneWriteApi(dependencies: ControlPlaneWriteApiDependencies): {
  handle(request: Request): Promise<Response>;
  canHandle(method: string, pathname: string): boolean;
} {
  function now(): string {
    return dependencies.clock ? dependencies.clock() : new Date().toISOString();
  }

  function canHandle(method: string, pathname: string): boolean {
    const m = method.toUpperCase() as HttpMethod;
    if (!WRITE_METHODS.includes(m)) {
      return false;
    }

    const path = trimTrailingSlash(pathname);

    return (
      /^\/api\/runtime\/fixture-runs$/.test(path) ||
      /^\/api\/issues\/[^/]+\/checkout$/.test(path) ||
      /^\/api\/issues\/[^/]+\/release$/.test(path) ||
      /^\/api\/issues\/[^/]+\/comments$/.test(path) ||
      /^\/api\/issues\/[^/]+\/documents\/[^/]+$/.test(path) ||
      /^\/api\/issues\/[^/]+$/.test(path) ||
      /^\/api\/approvals\/[^/]+\/comments$/.test(path) ||
      /^\/api\/approvals\/[^/]+$/.test(path)
    );
  }

  async function handle(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    if (!WRITE_METHODS.includes(method as HttpMethod)) {
      return jsonError("method_not_allowed", `${method} is not supported on this route`, 405);
    }

    const url = new URL(request.url);
    const path = trimTrailingSlash(url.pathname);

    if (path === "/api/runtime/fixture-runs" && method === "POST") {
      return handleRunRuntimeFixture(request);
    }

    // POST /api/issues/{issueId}/checkout
    const checkoutMatch = path.match(/^\/api\/issues\/([^/]+)\/checkout$/);
    if (checkoutMatch && method === "POST") {
      return handleCheckout(request, decodeURIComponent(checkoutMatch[1]!));
    }

    // POST /api/issues/{issueId}/release
    const releaseMatch = path.match(/^\/api\/issues\/([^/]+)\/release$/);
    if (releaseMatch && method === "POST") {
      return handleRelease(request, decodeURIComponent(releaseMatch[1]!));
    }

    // POST /api/issues/{issueId}/comments
    const issueCommentsMatch = path.match(/^\/api\/issues\/([^/]+)\/comments$/);
    if (issueCommentsMatch && method === "POST") {
      return handleAddIssueComment(request, decodeURIComponent(issueCommentsMatch[1]!));
    }

    const issueDocumentMatch = path.match(/^\/api\/issues\/([^/]+)\/documents\/([^/]+)$/);
    if (issueDocumentMatch && method === "PUT") {
      return handlePutIssueDocument(
        request,
        decodeURIComponent(issueDocumentMatch[1]!),
        decodeURIComponent(issueDocumentMatch[2]!),
      );
    }

    // PATCH /api/issues/{issueId}
    const issueMatch = path.match(/^\/api\/issues\/([^/]+)$/);
    if (issueMatch && method === "PATCH") {
      return handlePatchIssue(request, decodeURIComponent(issueMatch[1]!));
    }

    // POST /api/approvals/{approvalId}/comments
    const approvalCommentsMatch = path.match(/^\/api\/approvals\/([^/]+)\/comments$/);
    if (approvalCommentsMatch && method === "POST") {
      return handleAddApprovalComment(request, decodeURIComponent(approvalCommentsMatch[1]!));
    }

    // PATCH /api/approvals/{approvalId}
    const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
    if (approvalMatch && method === "PATCH") {
      return handlePatchApproval(request, decodeURIComponent(approvalMatch[1]!));
    }

    return jsonError("route_not_found", `route ${path} was not found`, 404);
  }

  async function handleCheckout(request: Request, issueId: string): Promise<Response> {
    const body = await readBody<{
      agentId?: string;
      runId?: string;
      expectedStatuses?: string[];
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }

    const agentId = body.agentId ?? dependencies.callerId;
    const runId = body.runId;
    const expectedStatuses = (body.expectedStatuses ?? ["todo", "backlog", "blocked"]) as IssueStatus[];

    if (!runId) {
      return jsonError("bad_request", "runId is required for checkout", 400);
    }

    try {
      const issue = dependencies.issueService.checkoutIssue({
        issueId,
        agentId,
        runId,
        expectedStatuses,
        at: now(),
      });
      return json(issue);
    } catch (error) {
      return handleIssueCheckoutError(error, issueId);
    }
  }

  async function handleRunRuntimeFixture(request: Request): Promise<Response> {
    if (!dependencies.runtimeFixtureService) {
      return jsonError("route_not_found", "route /api/runtime/fixture-runs was not found", 404);
    }

    const body = await readBody<{
      scenario?: string;
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }

    const scenario = body.scenario ?? "success";
    if (scenario !== "success" && scenario !== "failure") {
      return jsonError("bad_request", "scenario must be success or failure", 400);
    }

    try {
      const run = await dependencies.runtimeFixtureService.runFixture({ scenario });
      return json(run, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError("runtime_fixture_failed", message, 500);
    }
  }

  async function handleRelease(request: Request, issueId: string): Promise<Response> {
    const body = await readBody<{
      agentId?: string;
      runId?: string;
      nextStatus?: string;
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }

    const agentId = body.agentId ?? dependencies.callerId;
    const runId = body.runId;
    if (!runId) {
      return jsonError("bad_request", "runId is required for release", 400);
    }

    try {
      const issue = dependencies.issueService.releaseIssue({
        issueId,
        agentId,
        runId,
        nextStatus: body.nextStatus as IssueStatus | undefined,
        at: now(),
      });
      return json(issue);
    } catch (error) {
      return handleIssueReleaseError(error, issueId);
    }
  }

  async function handlePatchIssue(request: Request, issueId: string): Promise<Response> {
    const body = await readBody<{
      status?: string;
      comment?: string;
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }

    // Verify the issue exists first
    let issue: IssueRecord;
    try {
      issue = dependencies.issueService.getIssue(issueId);
    } catch {
      return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
    }

    if (body.status) {
      try {
        issue = dependencies.issueService.transitionIssue({
          issueId,
          actorId: dependencies.callerId,
          nextStatus: body.status as IssueStatus,
          at: now(),
          reason: body.comment,
        });
      } catch (error) {
        return handleIssueTransitionError(error, issueId);
      }
    }

    if (body.comment && !body.status) {
      dependencies.issueService.addComment({
        issueId,
        authorId: dependencies.callerId,
        body: body.comment,
        at: now(),
        runId: readRunId(request),
      });
      issue = dependencies.issueService.getIssue(issueId);
    }

    return json(issue);
  }

  async function handleAddIssueComment(request: Request, issueId: string): Promise<Response> {
    const body = await readBody<{ body?: string; authorId?: string }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }
    if (!body.body) {
      return jsonError("bad_request", "body is required", 400);
    }

    try {
      dependencies.issueService.getIssue(issueId);
    } catch {
      return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
    }

    const comment = dependencies.issueService.addComment({
      issueId,
      authorId: body.authorId ?? dependencies.callerId,
      body: body.body,
      at: now(),
      runId: readRunId(request),
    });

    return json(comment, 201);
  }

  async function handlePutIssueDocument(
    request: Request,
    issueId: string,
    key: string,
  ): Promise<Response> {
    const body = await readBody<{
      title?: string;
      format?: string;
      body?: string;
      authorId?: string;
      baseRevisionId?: string | null;
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }
    if (!body.title || !body.format || body.body === undefined) {
      return jsonError("bad_request", "title, format, and body are required", 400);
    }

    try {
      dependencies.issueService.getIssue(issueId);
    } catch {
      return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
    }

    try {
      const document = dependencies.issueService.upsertDocument({
        issueId,
        key,
        title: body.title,
        format: body.format,
        body: body.body,
        authorId: body.authorId ?? dependencies.callerId,
        at: now(),
        baseRevisionId: body.baseRevisionId,
        runId: readRunId(request),
      });
      return json(document, 201);
    } catch (error) {
      return handleIssueDocumentError(error, issueId, key);
    }
  }

  async function handlePatchApproval(request: Request, approvalId: string): Promise<Response> {
    const body = await readBody<{
      action?: string;
      actorId?: string;
    }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }

    const action = body.action as TransitionApprovalInput["action"] | undefined;
    if (!action) {
      return jsonError("bad_request", "action is required (approve, reject, request_revision, resubmit)", 400);
    }

    const validActions = ["approve", "reject", "request_revision", "resubmit"];
    if (!validActions.includes(action)) {
      return jsonError(
        "bad_request",
        `action must be one of: ${validActions.join(", ")}`,
        400,
      );
    }

    try {
      dependencies.approvalService.getApproval(approvalId);
    } catch {
      return jsonError("approval_not_found", `approval ${approvalId} was not found`, 404);
    }

    try {
      const approval = dependencies.approvalService.transitionApproval({
        approvalId,
        actorId: body.actorId ?? dependencies.callerId,
        action,
        at: now(),
      });
      return json(approval);
    } catch (error) {
      return handleApprovalTransitionError(error, approvalId);
    }
  }

  async function handleAddApprovalComment(
    request: Request,
    approvalId: string,
  ): Promise<Response> {
    const body = await readBody<{ body?: string; authorId?: string }>(request);
    if (!body) {
      return jsonError("bad_request", "request body must be valid JSON", 400);
    }
    if (!body.body) {
      return jsonError("bad_request", "body is required", 400);
    }

    try {
      dependencies.approvalService.getApproval(approvalId);
    } catch {
      return jsonError("approval_not_found", `approval ${approvalId} was not found`, 404);
    }

    const comment = dependencies.approvalService.addComment({
      approvalId,
      authorId: body.authorId ?? dependencies.callerId,
      body: body.body,
      at: now(),
    });

    return json(comment, 201);
  }

  return { handle, canHandle };
}

function handleIssueCheckoutError(error: unknown, issueId: string): Response {
  const err = error as IssueCheckoutError;
  if (err?.code === "status_mismatch") {
    return jsonError(
      "status_mismatch",
      err.message,
      422,
    );
  }
  if (err?.code === "checkout_conflict") {
    return jsonError(
      "checkout_conflict",
      err.message,
      409,
    );
  }
  return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
}

function handleIssueReleaseError(error: unknown, issueId: string): Response {
  const err = error as IssueReleaseError;
  if (err?.code === "not_checked_out") {
    return jsonError("not_checked_out", err.message, 422);
  }
  if (err?.code === "permission_denied") {
    return jsonError("permission_denied", err.message, 403);
  }
  if (err?.code === "invalid_transition") {
    return jsonError("invalid_transition", err.message, 422);
  }
  return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
}

function handleIssueTransitionError(error: unknown, issueId: string): Response {
  const err = error as IssueTransitionError;
  if (err?.code === "permission_denied") {
    return jsonError("permission_denied", err.message, 403);
  }
  if (err?.code === "invalid_transition") {
    return jsonError("invalid_transition", err.message, 422);
  }
  return jsonError("issue_not_found", `issue ${issueId} was not found`, 404);
}

function handleApprovalTransitionError(error: unknown, approvalId: string): Response {
  const err = error as ApprovalTransitionError;
  if (err?.code === "invalid_action") {
    return jsonError("invalid_action", err.message, 422);
  }
  return jsonError("approval_not_found", `approval ${approvalId} was not found`, 404);
}

function handleIssueDocumentError(error: unknown, issueId: string, key: string): Response {
  const err = error as IssueDocumentError;
  if (err?.code === "revision_conflict") {
    return jsonError("revision_conflict", err.message, 409);
  }

  return jsonError(
    "issue_document_not_found",
    `document ${key} on issue ${issueId} was not found`,
    404,
  );
}

async function readBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function readRunId(request: Request): string | undefined {
  return request.headers.get("x-paperclip-run-id") ?? undefined;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(error: string, message: string, status: number): Response {
  return json({ error, message } satisfies WriteApiError, status);
}
