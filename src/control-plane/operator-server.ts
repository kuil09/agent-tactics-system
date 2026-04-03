import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { renderDashboardHtml, type DashboardInput } from "./dashboard.js";
import {
  renderIssueWorkbenchHtml,
  type IssueWorkbenchInput,
} from "./issue-workbench.js";
import {
  renderApprovalWorkbenchHtml,
  type ApprovalWorkbenchInput,
} from "./approval-workbench.js";
import {
  createControlPlaneReadApi,
  type ControlPlaneAgentSummary,
  type ControlPlaneGoalSummary,
  type ControlPlaneIssueMetadata,
  type ControlPlaneProjectSummary,
} from "./read-api.js";
import { createControlPlaneWriteApi } from "./write-api.js";
import type { InMemoryIssueService } from "./issue-service.js";
import type { InMemoryApprovalService } from "./approval-service.js";
import type { RuntimeFixtureService } from "./runtime-fixture-service.js";
import type { ProviderRegistryEntry } from "../contracts/types.js";

export interface ControlPlaneOperatorServerDependencies {
  viewerAgentId: string;
  issueService: InMemoryIssueService;
  approvalService: InMemoryApprovalService;
  issues: ControlPlaneIssueMetadata[];
  agents?: ControlPlaneAgentSummary[];
  projects?: ControlPlaneProjectSummary[];
  goals?: ControlPlaneGoalSummary[];
  runtimeFixtureService?: RuntimeFixtureService;
  providerRegistry?: ProviderRegistryEntry[];
  clock?: () => string;
}

export interface ControlPlaneOperatorServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startControlPlaneOperatorServer(
  dependencies: ControlPlaneOperatorServerDependencies,
  port = 0,
): Promise<ControlPlaneOperatorServer> {
  const readApi = createControlPlaneReadApi({
    viewerAgentId: dependencies.viewerAgentId,
    issueService: dependencies.issueService,
    approvalService: dependencies.approvalService,
    runtimeFixtureService: dependencies.runtimeFixtureService,
    issues: dependencies.issues,
    agents: dependencies.agents,
    projects: dependencies.projects,
    goals: dependencies.goals,
    providerRegistry: dependencies.providerRegistry,
  });

  const writeApi = createControlPlaneWriteApi({
    callerId: dependencies.viewerAgentId,
    issueService: dependencies.issueService,
    approvalService: dependencies.approvalService,
    runtimeFixtureService: dependencies.runtimeFixtureService,
    clock: dependencies.clock,
  });

  const server = createServer(async (req, res) => {
    try {
      await dispatch(req, res, readApi, writeApi, dependencies);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendHtml(
        res,
        500,
        renderErrorHtml("Internal Server Error", `An unexpected error occurred: ${message}`),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  /* c8 ignore next 3 */
  if (!address || typeof address === "string") {
    throw new Error("operator server did not expose a TCP address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  readApi: ReturnType<typeof createControlPlaneReadApi>,
  writeApi: ReturnType<typeof createControlPlaneWriteApi>,
  dependencies: ControlPlaneOperatorServerDependencies,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, "http://localhost");
  const path = trimTrailingSlash(url.pathname);

  // ── API routes ──────────────────────────────────────────────────────────────
  if (path.startsWith("/api/")) {
    if (writeApi.canHandle(method, path)) {
      const body = await readRequestBody(req);
      const request = new Request(`http://localhost${rawUrl}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body || undefined,
      });
      const response = await writeApi.handle(request);
      await pipeResponse(response, res);
      return;
    }

    if (["GET", "POST"].includes(method)) {
      const body = method === "POST" ? await readRequestBody(req) : "";
      const request = new Request(`http://localhost${rawUrl}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body || undefined,
      });
      const response = await readApi.handle(request);
      await pipeResponse(response, res);
      return;
    }

    sendJson(res, 405, { error: "method_not_allowed", message: `${method} is not supported` });
    return;
  }

  // ── HTML views ──────────────────────────────────────────────────────────────

  // GET / — operator dashboard
  if (method === "GET" && (path === "" || path === "/")) {
    const companyId = findCompanyId(dependencies.issues);
    if (!companyId) {
      sendHtml(
        res,
        200,
        renderEmptyStateHtml("No issues found", "No issues are available for this operator."),
      );
      return;
    }

    const dashboardRequest = new Request(
      `http://localhost/api/companies/${encodeURIComponent(companyId)}/dashboard?assigneeAgentId=${encodeURIComponent(dependencies.viewerAgentId)}`,
    );
    const dashboardResponse = await readApi.handle(dashboardRequest);
    if (!dashboardResponse.ok) {
      sendHtml(
        res,
        500,
        renderErrorHtml("Dashboard Unavailable", "Failed to load dashboard data from the API."),
      );
      return;
    }

    const dashboardInput: DashboardInput = await dashboardResponse.json();
    sendHtml(res, 200, renderDashboardHtml(dashboardInput));
    return;
  }

  // GET /issues/{issueId}
  const issueViewMatch = path.match(/^\/issues\/([^/]+)$/);
  if (method === "GET" && issueViewMatch) {
    const issueId = decodeURIComponent(issueViewMatch[1]!);
    const issueRequest = new Request(`http://localhost/api/issues/${encodeURIComponent(issueId)}`);
    const issueResponse = await readApi.handle(issueRequest);

    if (issueResponse.status === 404) {
      sendHtml(
        res,
        404,
        renderErrorHtml("Issue Not Found", `Issue ${issueId} could not be found.`),
      );
      return;
    }

    if (!issueResponse.ok) {
      sendHtml(
        res,
        500,
        renderErrorHtml("Issue Unavailable", "Failed to load issue data from the API."),
      );
      return;
    }

    const data = await issueResponse.json() as {
      issue: IssueWorkbenchInput["issue"];
      ancestors: IssueWorkbenchInput["ancestors"];
      comments: IssueWorkbenchInput["comments"];
      events: IssueWorkbenchInput["events"];
      operatorSummary: IssueWorkbenchInput["operatorSummary"];
      verificationEvidence: IssueWorkbenchInput["verificationEvidence"];
    };

    const input: IssueWorkbenchInput = {
      issue: data.issue,
      ancestors: data.ancestors,
      comments: data.comments,
      events: data.events,
      operatorSummary: data.operatorSummary ?? null,
      verificationEvidence: data.verificationEvidence ?? null,
    };

    sendHtml(res, 200, renderIssueWorkbenchHtml(input));
    return;
  }

  // GET /approvals — approval list
  if (method === "GET" && path === "/approvals") {
    const companyId = findCompanyId(dependencies.issues);
    const approvals = companyId
      ? dependencies.approvalService.listApprovals(companyId)
      : [];

    if (approvals.length === 0) {
      sendHtml(
        res,
        200,
        renderEmptyStateHtml("No Approvals", "No pending approvals are available."),
      );
      return;
    }

    sendHtml(res, 200, renderApprovalListHtml(approvals));
    return;
  }

  // GET /approvals/{approvalId}
  const approvalViewMatch = path.match(/^\/approvals\/([^/]+)$/);
  if (method === "GET" && approvalViewMatch) {
    const approvalId = decodeURIComponent(approvalViewMatch[1]!);

    let approval;
    try {
      approval = dependencies.approvalService.getApproval(approvalId);
    } catch {
      sendHtml(
        res,
        404,
        renderErrorHtml("Approval Not Found", `Approval ${approvalId} could not be found.`),
      );
      return;
    }

    const issueLink = approval.issueLinks[0] ?? null;
    let issueSummary: ApprovalWorkbenchInput["issue"] | null = null;

    if (issueLink) {
      const issueReq = new Request(
        `http://localhost/api/issues/${encodeURIComponent(issueLink.issueId)}`,
      );
      const issueRes = await readApi.handle(issueReq);
      if (issueRes.ok) {
        const data = await issueRes.json() as {
          issue: { identifier?: string | null; title: string; status: string; updatedAt: string };
        };
        issueSummary = {
          identifier: data.issue.identifier ?? null,
          title: data.issue.title,
          status: data.issue.status,
          updatedAt: data.issue.updatedAt,
        };
      }
    }

    const input: ApprovalWorkbenchInput = {
      issue: issueSummary,
      approvalWorkflow: approval.workflow,
      verificationEvidence: approval.verificationEvidence,
    };

    sendHtml(res, 200, renderApprovalWorkbenchHtml(input));
    return;
  }

  sendHtml(res, 404, renderErrorHtml("Not Found", `Path ${path} was not found.`));
}

// ── Approval list HTML ───────────────────────────────────────────────────────

function renderApprovalListHtml(
  approvals: Array<{
    id: string;
    issueLinks: Array<{ identifier?: string | null; title: string; status: string }>;
    decisionOutcome: string;
    updatedAt: string;
    workflow: { release: { release_blocked: boolean } };
  }>,
): string {
  const rows = approvals
    .map((approval) => {
      const issue = approval.issueLinks[0];
      const title = issue
        ? (issue.identifier ? `${issue.identifier} · ` : "") + issue.title
        : approval.id;
      const releaseBlocked = approval.workflow.release.release_blocked;
      const outcome = approval.decisionOutcome.replaceAll("_", " ");

      return [
        '<article class="panel approval-card">',
        `<h2><a href="/approvals/${escapeHtml(approval.id)}">${escapeHtml(title)}</a></h2>`,
        `<ul class="tags">`,
        `<li>Status: ${escapeHtml(outcome)}</li>`,
        `<li>Updated: ${escapeHtml(approval.updatedAt)}</li>`,
        releaseBlocked ? `<li class="warn">Release blocked</li>` : `<li>Release open</li>`,
        `</ul>`,
        `</article>`,
      ].join("");
    })
    .join("");

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Approval Workbench</title>",
    "<style>",
    OPERATOR_SHELL_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    '<section class="hero panel">',
    '<p class="eyebrow">Operator</p>',
    "<h1>Approval Workbench</h1>",
    `<p class="nav-links"><a href="/">← Dashboard</a></p>`,
    "</section>",
    `<section class="board">${rows}</section>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

// ── Error and empty state HTML ───────────────────────────────────────────────

function renderErrorHtml(title: string, detail: string): string {
  return renderStatusPage("error", title, detail);
}

function renderEmptyStateHtml(title: string, detail: string): string {
  return renderStatusPage("empty", title, detail);
}

function renderStatusPage(kind: "error" | "empty", title: string, detail: string): string {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    OPERATOR_SHELL_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    `<section class="hero panel ${kind}-state">`,
    '<p class="eyebrow">Operator</p>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(detail)}</p>`,
    `<p class="nav-links"><a href="/">← Dashboard</a> · <a href="/approvals">Approvals</a></p>`,
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findCompanyId(issues: ControlPlaneIssueMetadata[]): string | null {
  return issues[0]?.companyId ?? null;
}

async function pipeResponse(source: Response, dest: ServerResponse): Promise<void> {
  const body = await source.text();
  const contentType = source.headers.get("content-type") ?? "application/json; charset=utf-8";
  dest.statusCode = source.status;
  dest.setHeader("Content-Type", contentType);
  dest.end(body);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const OPERATOR_SHELL_CSS = `
:root {
  color-scheme: light;
  font-family: "Iowan Old Style", "Palatino Linotype", serif;
  background: linear-gradient(180deg, #f4efe5 0%, #e8e0d1 100%);
  color: #1f2328;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
.shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}
.hero, .panel {
  border: 1px solid rgba(72, 54, 35, 0.16);
  border-radius: 24px;
  background: rgba(255, 251, 244, 0.9);
  box-shadow: 0 20px 60px rgba(82, 54, 24, 0.08);
  padding: 28px;
  margin-bottom: 18px;
}
.board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.approval-card { padding: 20px; }
.approval-card h2 { margin: 0 0 12px; font-size: 1.1rem; }
.approval-card a { color: inherit; text-decoration: none; }
.approval-card a:hover { text-decoration: underline; }
.eyebrow {
  font-size: 0.73rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7a5b39;
  margin: 0;
}
h1 { font-size: clamp(2rem, 4vw, 3rem); margin: 8px 0; }
.tags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  margin: 12px 0 0;
}
.tags li {
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(115, 87, 49, 0.08);
  font-size: 0.88rem;
}
.tags li.warn {
  background: rgba(190, 80, 30, 0.12);
  color: #9f3310;
}
.nav-links { margin: 16px 0 0; font-size: 0.92rem; }
.nav-links a { color: #6b4f2e; }
.error-state h1 { color: #9f2020; }
.empty-state h1 { color: #5f7a4f; }
p { margin: 0 0 12px; }
@media (max-width: 720px) {
  .shell { padding: 20px 14px 32px; }
  .hero, .panel { border-radius: 18px; padding: 18px; }
}
`;
