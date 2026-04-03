import type { ApprovalWorkflowHandoff } from "../runtime/executable-runtime.js";
import type { RuntimeFixtureOperatorSummary } from "../runtime/cli.js";

import type { IssueWorkbenchVerificationEvidence } from "./issue-workbench.js";

export interface ApprovalWorkbenchIssueSummary {
  identifier?: string | null;
  title: string;
  status: string;
  updatedAt: string;
}

export interface ApprovalWorkbenchViewModel {
  title: string;
  summaryFacts: string[];
  requestFacts: string[];
  requestSummary: string;
  requestEvidence: string[];
  requestPaths: Array<{ label: string; path: string }>;
  decisionFacts: string[];
  decisionCriteria: string[];
  decisionBlockedReason: string | null;
  releaseFacts: string[];
  releaseBlockers: string[];
  releaseChecklist: string[];
  trustBoundarySummary: string[];
  validationCommands: string[];
  nextActions: string[];
}

export interface ApprovalWorkbenchInput {
  issue?: ApprovalWorkbenchIssueSummary | null;
  approvalWorkflow: ApprovalWorkflowHandoff;
  verificationEvidence: IssueWorkbenchVerificationEvidence;
  operatorSummary?: RuntimeFixtureOperatorSummary | null;
}

export function buildApprovalWorkbenchViewModel(
  input: ApprovalWorkbenchInput,
): ApprovalWorkbenchViewModel {
  const title = input.issue
    ? `${input.issue.identifier ? `${input.issue.identifier} · ` : ""}${input.issue.title}`
    : "Approval workbench";
  const summaryFacts = compact([
    input.issue ? `Issue status: ${humanizeToken(input.issue.status)}` : null,
    input.issue ? `Updated: ${input.issue.updatedAt}` : null,
    `Workflow status: ${humanizeToken(input.approvalWorkflow.status)}`,
    `Promotion gate: ${humanizeToken(input.verificationEvidence.promotion_gate)}`,
    `Approval status: ${humanizeToken(input.verificationEvidence.approval_status)}`,
  ]);
  const requestFacts = compact([
    `Requested role: ${humanizeToken(input.approvalWorkflow.request.requested_role)}`,
    `Request channel: ${humanizeToken(input.approvalWorkflow.request.request_channel)}`,
    input.approvalWorkflow.request.issued_at
      ? `Issued at: ${input.approvalWorkflow.request.issued_at}`
      : "Issued at: pending",
  ]);
  const requestEvidence = input.approvalWorkflow.request.required_evidence;
  const requestPaths = compactPaths([
    input.approvalWorkflow.request.request_artifact_path
      ? {
          label: "Request artifact",
          path: input.approvalWorkflow.request.request_artifact_path,
        }
      : null,
    {
      label: "Summary",
      path: input.verificationEvidence.summary_path,
    },
    {
      label: "Runtime log",
      path: input.verificationEvidence.runtime_log_path,
    },
    input.verificationEvidence.approval_artifact_path
      ? {
          label: "Decision artifact",
          path: input.verificationEvidence.approval_artifact_path,
        }
      : null,
  ]);
  const decisionFacts = compact([
    `Decision status: ${humanizeToken(input.approvalWorkflow.decision.status)}`,
    input.approvalWorkflow.decision.recorded_by
      ? `Recorded by: ${input.approvalWorkflow.decision.recorded_by}`
      : "Recorded by: pending",
    input.approvalWorkflow.decision.recorded_at
      ? `Recorded at: ${input.approvalWorkflow.decision.recorded_at}`
      : "Recorded at: pending",
  ]);
  const releaseFacts = [
    `Promotion action: ${humanizeToken(input.approvalWorkflow.release.promotion_action)}`,
    `Release blocked: ${input.approvalWorkflow.release.release_blocked ? "yes" : "no"}`,
    `Next owner: ${humanizeToken(input.approvalWorkflow.release.next_owner)}`,
  ];
  const trustBoundarySummary = input.verificationEvidence.input_boundary_summary.map(
    (entry) =>
      `${entry.input_ref} (${humanizeToken(entry.input_kind)} / ${humanizeToken(entry.trust_zone)})`,
  );
  const nextActions = compact([
    input.operatorSummary?.next_action ?? null,
    input.approvalWorkflow.release.release_blocked
      ? `Unblock checklist: ${input.approvalWorkflow.release.unblock_checklist.join(" | ")}`
      : "Release path is open for promotion.",
    input.verificationEvidence.authorization_exception ?? null,
  ]);

  return {
    title,
    summaryFacts,
    requestFacts,
    requestSummary: input.approvalWorkflow.request.summary,
    requestEvidence,
    requestPaths,
    decisionFacts,
    decisionCriteria: input.approvalWorkflow.decision.resolution_criteria,
    decisionBlockedReason: input.approvalWorkflow.decision.blocked_reason,
    releaseFacts,
    releaseBlockers: input.approvalWorkflow.release.blockers,
    releaseChecklist: input.approvalWorkflow.release.unblock_checklist,
    trustBoundarySummary,
    validationCommands: input.approvalWorkflow.request.validation_commands,
    nextActions,
  };
}

export function renderApprovalWorkbenchHtml(input: ApprovalWorkbenchInput): string {
  const model = buildApprovalWorkbenchViewModel(input);

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(model.title)}</title>`,
    "<style>",
    APPROVAL_WORKBENCH_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    '<section class="hero panel">',
    '<p class="eyebrow">Approval workbench</p>',
    `<h1>${escapeHtml(model.title)}</h1>`,
    renderTagList(model.summaryFacts),
    "</section>",
    '<section class="grid">',
    '<article class="panel">',
    "<h2>Request</h2>",
    renderBulletList(model.requestFacts),
    '<p class="section-label">Summary</p>',
    `<p>${escapeHtml(model.requestSummary)}</p>`,
    model.requestEvidence.length
      ? `<p class="section-label">Required evidence</p>${renderBulletList(model.requestEvidence)}`
      : '<p class="empty">No required evidence is listed.</p>',
    '<p class="section-label">Paths</p>',
    renderPathList(model.requestPaths),
    "</article>",
    '<article class="panel">',
    "<h2>Decision</h2>",
    renderBulletList(model.decisionFacts),
    model.decisionBlockedReason
      ? `<p class="section-label">Blocked reason</p><p>${escapeHtml(model.decisionBlockedReason)}</p>`
      : '<p class="empty">No blocked reason is attached.</p>',
    model.decisionCriteria.length
      ? `<p class="section-label">Resolution criteria</p>${renderBulletList(model.decisionCriteria)}`
      : '<p class="empty">No resolution criteria are attached.</p>',
    "</article>",
    '<article class="panel">',
    "<h2>Release</h2>",
    renderBulletList(model.releaseFacts),
    model.releaseBlockers.length
      ? `<p class="section-label">Blockers</p>${renderBulletList(model.releaseBlockers)}`
      : '<p class="empty">No release blockers remain.</p>',
    model.releaseChecklist.length
      ? `<p class="section-label">Unblock checklist</p>${renderBulletList(model.releaseChecklist)}`
      : "",
    "</article>",
    '<article class="panel support">',
    "<h2>Operator Support</h2>",
    model.trustBoundarySummary.length
      ? `<p class="section-label">Trust boundaries</p>${renderBulletList(model.trustBoundarySummary)}`
      : '<p class="empty">No trust boundaries are attached.</p>',
    model.validationCommands.length
      ? `<p class="section-label">Validation commands</p>${renderCodeList(model.validationCommands)}`
      : '<p class="empty">No validation commands are listed.</p>',
    '<p class="section-label">Next actions</p>',
    renderBulletList(model.nextActions),
    "</article>",
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function renderTagList(items: string[]): string {
  return `<ul class="tags">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderBulletList(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPathList(items: Array<{ label: string; path: string }>): string {
  return `<ul>${items
    .map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> <code>${escapeHtml(item.path)}</code></li>`)
    .join("")}</ul>`;
}

function renderCodeList(commands: string[]): string {
  return `<ul>${commands
    .map((command) => `<li><code>${escapeHtml(command)}</code></li>`)
    .join("")}</ul>`;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function compactPaths(
  values: Array<{ label: string; path: string } | null>,
): Array<{ label: string; path: string }> {
  return values.filter(
    (value): value is { label: string; path: string } =>
      value !== null && value.path.length > 0,
  );
}

function humanizeToken(value: string): string {
  return value.replaceAll("_", " ").replaceAll(".", " ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const APPROVAL_WORKBENCH_CSS = `
:root {
  color-scheme: light;
  --bg: #f4efe7;
  --panel: rgba(255, 251, 244, 0.92);
  --ink: #1d1813;
  --muted: #6d655b;
  --line: #d9cfc2;
  --accent: #9f4d1c;
  --accent-soft: rgba(159, 77, 28, 0.1);
  --shadow: 0 20px 48px rgba(29, 24, 19, 0.09);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    radial-gradient(circle at top right, rgba(159, 77, 28, 0.14), transparent 28%),
    linear-gradient(180deg, #fcf7ef 0%, var(--bg) 100%);
  color: var(--ink);
  font: 16px/1.55 "Avenir Next", "Segoe UI", sans-serif;
}
.shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}
.hero {
  margin-bottom: 16px;
}
.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--shadow);
  padding: 20px;
}
.support {
  grid-column: 1 / -1;
}
.eyebrow,
.section-label,
.empty {
  color: var(--muted);
  font-size: 0.92rem;
}
h1, h2 {
  margin: 0 0 12px;
}
h1 {
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 1.04;
}
h2 {
  font-size: 1.25rem;
}
ul {
  margin: 0;
  padding-left: 20px;
}
p {
  margin: 0 0 12px;
}
code {
  font-family: "SFMono-Regular", "SF Mono", Consolas, monospace;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  list-style: none;
  padding: 0;
}
.tags li {
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--accent-soft);
}
@media (max-width: 720px) {
  .shell {
    padding: 20px 14px 32px;
  }
  .panel {
    border-radius: 18px;
  }
}
`;
