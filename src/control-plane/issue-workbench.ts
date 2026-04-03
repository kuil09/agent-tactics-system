import type { RuntimeFixtureOperatorSummary } from "../runtime/cli.js";

export interface IssueWorkbenchIssue {
  id: string;
  identifier?: string | null;
  title: string;
  description: string;
  status: string;
  priority?: string | null;
  assigneeLabel?: string | null;
  projectName?: string | null;
  parent?: {
    identifier?: string | null;
    title: string;
  } | null;
  updatedAt: string;
  checkout?: {
    agentId: string;
    runId: string;
    lockedAt: string;
  } | null;
  blockedReason?: string | null;
  nextOwner?: string | null;
}

export interface IssueWorkbenchAncestor {
  identifier?: string | null;
  title: string;
  status: string;
}

export interface IssueWorkbenchComment {
  id: string;
  authorId: string;
  authorLabel?: string | null;
  body: string;
  kind: "comment" | "system";
  createdAt: string;
}

export interface IssueWorkbenchEvent {
  id: string;
  actorId: string;
  action: string;
  outcome: "succeeded" | "rejected";
  detail: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface IssueWorkbenchVerificationEvidence {
  promotion_gate:
    | "waiting_for_human_approval_and_independent_verifier"
    | "waiting_for_human_approval"
    | "waiting_for_independent_verifier"
    | "rollback_and_requeue_recorded"
    | "not_required";
  approval_status:
    | "pending_human_approval"
    | "blocked_by_recovery"
    | "not_required";
  approval_artifact_path: string | null;
  authorization_exception: string | null;
  input_boundary_summary: Array<{
    input_ref: string;
    input_kind: string;
    trust_zone: string;
  }>;
  validation_commands: string[];
  artifact_dir: string;
  workspace_dir: string;
  summary_path: string;
  runtime_log_path: string;
  recovery_outcome: string;
  recovery_scope: {
    attempted_write_paths: string[];
    changed_paths: string[];
    modified_preexisting_paths: string[];
    created_paths: string[];
    restored_paths: string[];
    unrestored_paths: string[];
    artifact_paths_missing_after_recovery: string[];
    residual_risk_paths: string[];
  };
}

export interface IssueWorkbenchInput {
  issue: IssueWorkbenchIssue;
  ancestors?: IssueWorkbenchAncestor[];
  comments?: IssueWorkbenchComment[];
  events?: IssueWorkbenchEvent[];
  verificationEvidence?: IssueWorkbenchVerificationEvidence | null;
  operatorSummary?: RuntimeFixtureOperatorSummary | null;
}

export interface IssueWorkbenchTimelineItem {
  id: string;
  createdAt: string;
  actorLabel: string;
  title: string;
  body: string;
  tone: "default" | "muted" | "warning";
  metadata: string[];
}

export interface IssueWorkbenchViewModel {
  title: string;
  identifier: string | null;
  summaryFacts: string[];
  ancestorSummary: string[];
  description: string;
  timeline: IssueWorkbenchTimelineItem[];
  checkoutSummary: string[];
  checkoutConflicts: string[];
  blockers: string[];
  nextActions: string[];
  nextOwner: string | null;
  evidenceSummary: string[];
  evidencePaths: Array<{ label: string; path: string }>;
  validationCommands: string[];
  trustBoundarySummary: string[];
  recoverySummary: string[];
}

export function buildIssueWorkbenchViewModel(
  input: IssueWorkbenchInput,
): IssueWorkbenchViewModel {
  const identifier = input.issue.identifier ?? null;
  const summaryFacts = compact([
    identifier,
    `Status: ${humanizeToken(input.issue.status)}`,
    input.issue.priority ? `Priority: ${humanizeToken(input.issue.priority)}` : null,
    input.issue.assigneeLabel ? `Assignee: ${input.issue.assigneeLabel}` : null,
    input.issue.projectName ? `Project: ${input.issue.projectName}` : null,
    input.issue.parent
      ? `Parent: ${formatLinkedSummary(input.issue.parent.identifier ?? null, input.issue.parent.title)}`
      : null,
    `Updated: ${input.issue.updatedAt}`,
  ]);
  const ancestorSummary = (input.ancestors ?? []).map(
    (ancestor) =>
      `${formatLinkedSummary(ancestor.identifier ?? null, ancestor.title)} (${humanizeToken(ancestor.status)})`,
  );
  const timeline = buildTimeline(input.comments ?? [], input.events ?? []);
  const checkoutSummary = buildCheckoutSummary(input.issue);
  const checkoutConflicts = buildCheckoutConflicts(input.events ?? []);
  const blockers = buildBlockers(input);
  const nextOwner = deriveNextOwner(input);
  const nextActions = compact([
    input.operatorSummary?.next_action ?? null,
    nextOwner ? `Next owner: ${humanizeToken(nextOwner)}` : null,
    input.verificationEvidence?.validation_commands.length
      ? `Validation commands: ${input.verificationEvidence.validation_commands.join(" | ")}`
      : null,
    input.issue.status === "blocked" && !input.issue.blockedReason
      ? "Issue is blocked and needs a clear unblock action before more execution."
      : null,
  ]);
  const evidenceSummary = buildEvidenceSummary(input);
  const evidencePaths = buildEvidencePaths(input);
  const validationCommands = input.verificationEvidence?.validation_commands ?? [];
  const trustBoundarySummary =
    input.verificationEvidence?.input_boundary_summary.map(
      (entry) =>
        `${entry.input_ref} (${humanizeToken(entry.input_kind)} / ${humanizeToken(entry.trust_zone)})`,
    ) ?? [];
  const recoverySummary = buildRecoverySummary(input.verificationEvidence ?? null);

  return {
    title: input.issue.title,
    identifier,
    summaryFacts,
    ancestorSummary,
    description: input.issue.description,
    timeline,
    checkoutSummary,
    checkoutConflicts,
    blockers,
    nextActions,
    nextOwner,
    evidenceSummary,
    evidencePaths,
    validationCommands,
    trustBoundarySummary,
    recoverySummary,
  };
}

export function renderIssueWorkbenchHtml(input: IssueWorkbenchInput): string {
  const model = buildIssueWorkbenchViewModel(input);

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(model.identifier ? `${model.identifier} · ${model.title}` : model.title)}</title>`,
    "<style>",
    ISSUE_WORKBENCH_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    '<section class="hero card">',
    `<p class="eyebrow">${escapeHtml(model.identifier ?? "Issue workbench")}</p>`,
    `<h1>${escapeHtml(model.title)}</h1>`,
    renderTagList(model.summaryFacts),
    "</section>",
    '<section class="grid">',
    '<article class="card">',
    "<h2>Overview</h2>",
    model.ancestorSummary.length
      ? `<p class="section-label">Ancestors</p>${renderBulletList(model.ancestorSummary)}`
      : '<p class="empty">No ancestor summary is attached.</p>',
    '<p class="section-label">Description</p>',
    `<pre>${escapeHtml(model.description)}</pre>`,
    "</article>",
    '<article class="card">',
    "<h2>Checkout</h2>",
    renderBulletList(model.checkoutSummary),
    model.checkoutConflicts.length
      ? `<p class="section-label">Recent conflicts</p>${renderBulletList(model.checkoutConflicts)}`
      : '<p class="empty">No checkout conflicts recorded.</p>',
    "</article>",
    '<article class="card">',
    "<h2>Next Action</h2>",
    model.blockers.length
      ? `<p class="section-label">Blockers</p>${renderBulletList(model.blockers)}`
      : '<p class="empty">No explicit blockers are attached.</p>',
    model.nextActions.length
      ? `<p class="section-label">Actions</p>${renderBulletList(model.nextActions)}`
      : '<p class="empty">No next action has been derived yet.</p>',
    "</article>",
    '<article class="card">',
    "<h2>Evidence</h2>",
    model.evidenceSummary.length
      ? renderBulletList(model.evidenceSummary)
      : '<p class="empty">No runtime evidence is linked yet.</p>',
    model.evidencePaths.length
      ? `<p class="section-label">Paths</p>${renderPathList(model.evidencePaths)}`
      : "",
    model.validationCommands.length
      ? `<p class="section-label">Validation commands</p>${renderCodeList(model.validationCommands)}`
      : "",
    model.trustBoundarySummary.length
      ? `<p class="section-label">Trust boundaries</p>${renderBulletList(model.trustBoundarySummary)}`
      : "",
    model.recoverySummary.length
      ? `<p class="section-label">Recovery</p>${renderBulletList(model.recoverySummary)}`
      : "",
    "</article>",
    '<article class="card thread">',
    "<h2>Thread</h2>",
    model.timeline.length
      ? `<ol>${model.timeline.map(renderTimelineItem).join("")}</ol>`
      : '<p class="empty">No comments or events have been recorded.</p>',
    "</article>",
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function buildTimeline(
  comments: IssueWorkbenchComment[],
  events: IssueWorkbenchEvent[],
): IssueWorkbenchTimelineItem[] {
  return [...comments.map(commentToTimelineItem), ...events.map(eventToTimelineItem)].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function commentToTimelineItem(comment: IssueWorkbenchComment): IssueWorkbenchTimelineItem {
  return {
    id: comment.id,
    createdAt: comment.createdAt,
    actorLabel: comment.authorLabel ?? comment.authorId,
    title: comment.kind === "system" ? "System note" : "Comment",
    body: comment.body,
    tone: comment.kind === "system" ? "muted" : "default",
    metadata: [],
  };
}

function eventToTimelineItem(event: IssueWorkbenchEvent): IssueWorkbenchTimelineItem {
  return {
    id: event.id,
    createdAt: event.createdAt,
    actorLabel: event.actorId,
    title: humanizeToken(event.action.replaceAll(".", " ")),
    body: event.detail,
    tone: event.outcome === "rejected" ? "warning" : "muted",
    metadata: formatMetadata(event.metadata),
  };
}

function buildCheckoutSummary(issue: IssueWorkbenchIssue): string[] {
  if (!issue.checkout) {
    return ["No active checkout.", "The workbench is ready for a new checkout owner."];
  }

  return [
    `Checked out by ${issue.checkout.agentId}.`,
    `Run: ${issue.checkout.runId}`,
    `Locked at: ${issue.checkout.lockedAt}`,
  ];
}

function buildCheckoutConflicts(events: IssueWorkbenchEvent[]): string[] {
  return events
    .filter((event) => event.action === "checkout.rejected")
    .map((event) => {
      const currentOwner = stringifyMetadataValue(event.metadata.current_checkout_agent_id);
      const currentRun = stringifyMetadataValue(event.metadata.current_checkout_run_id);
      const parts = compact([
        currentOwner ? `owner ${currentOwner}` : null,
        currentRun ? `run ${currentRun}` : null,
      ]);

      return parts.length
        ? `${event.detail} (${parts.join(", ")})`
        : event.detail;
    });
}

function buildBlockers(input: IssueWorkbenchInput): string[] {
  const blockers = compact([
    input.issue.status === "blocked"
      ? input.issue.blockedReason ?? "Issue is blocked pending an explicit unblock decision."
      : null,
    input.verificationEvidence?.approval_status === "blocked_by_recovery"
      ? "Recovery evidence must be reviewed before approval can resume."
      : null,
    input.verificationEvidence?.promotion_gate ===
    "waiting_for_human_approval_and_independent_verifier"
      ? "Human approval and independent verification are still required."
      : null,
    input.verificationEvidence?.promotion_gate === "waiting_for_human_approval"
      ? "Human approval is still required before promotion."
      : null,
    input.verificationEvidence?.promotion_gate === "waiting_for_independent_verifier"
      ? "Independent verification is still required before promotion."
      : null,
    input.operatorSummary?.final_status === "failed_and_requeued"
      ? "The most recent execution failed and the issue has been requeued."
      : null,
    input.verificationEvidence?.authorization_exception ?? null,
  ]);

  return dedupe(blockers);
}

function deriveNextOwner(input: IssueWorkbenchInput): string | null {
  if (input.issue.nextOwner) {
    return input.issue.nextOwner;
  }

  if (
    input.verificationEvidence?.approval_status === "pending_human_approval" ||
    input.verificationEvidence?.approval_status === "blocked_by_recovery"
  ) {
    return "human_operator";
  }

  return null;
}

function buildEvidenceSummary(input: IssueWorkbenchInput): string[] {
  return compact([
    input.operatorSummary?.decision ?? null,
    input.verificationEvidence
      ? `Promotion gate: ${humanizeToken(input.verificationEvidence.promotion_gate)}`
      : null,
    input.verificationEvidence
      ? `Approval status: ${humanizeToken(input.verificationEvidence.approval_status)}`
      : null,
    input.verificationEvidence
      ? `Recovery outcome: ${humanizeToken(input.verificationEvidence.recovery_outcome)}`
      : null,
  ]);
}

function buildEvidencePaths(
  input: IssueWorkbenchInput,
): Array<{ label: string; path: string }> {
  const rawPaths = compactPaths([
    input.operatorSummary
      ? { label: "Artifact dir", path: input.operatorSummary.key_paths.artifact_dir }
      : null,
    input.operatorSummary
      ? { label: "Workspace dir", path: input.operatorSummary.key_paths.workspace_dir }
      : null,
    input.operatorSummary
      ? { label: "Summary", path: input.operatorSummary.key_paths.summary_path }
      : null,
    input.operatorSummary
      ? { label: "Runtime log", path: input.operatorSummary.key_paths.runtime_log_path }
      : null,
    input.operatorSummary
      ? { label: "Governance", path: input.operatorSummary.key_paths.governance_path }
      : null,
    input.operatorSummary
      ? {
          label: "Provider handshake",
          path: input.operatorSummary.key_paths.provider_handshake_path,
        }
      : null,
    input.verificationEvidence
      ? { label: "Artifact dir", path: input.verificationEvidence.artifact_dir }
      : null,
    input.verificationEvidence
      ? { label: "Workspace dir", path: input.verificationEvidence.workspace_dir }
      : null,
    input.verificationEvidence
      ? { label: "Summary", path: input.verificationEvidence.summary_path }
      : null,
    input.verificationEvidence
      ? { label: "Runtime log", path: input.verificationEvidence.runtime_log_path }
      : null,
    input.verificationEvidence?.approval_artifact_path
      ? { label: "Approval artifact", path: input.verificationEvidence.approval_artifact_path }
      : null,
  ]);
  const seen = new Set<string>();

  return rawPaths.filter((entry) => {
    const key = `${entry.label}:${entry.path}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildRecoverySummary(
  verificationEvidence: IssueWorkbenchVerificationEvidence | null,
): string[] {
  if (!verificationEvidence) {
    return [];
  }

  const groups: Array<[string, string[]]> = [
    ["Attempted writes", verificationEvidence.recovery_scope.attempted_write_paths],
    ["Modified existing", verificationEvidence.recovery_scope.modified_preexisting_paths],
    ["Created", verificationEvidence.recovery_scope.created_paths],
    ["Restored", verificationEvidence.recovery_scope.restored_paths],
    ["Unrestored", verificationEvidence.recovery_scope.unrestored_paths],
    [
      "Missing artifacts",
      verificationEvidence.recovery_scope.artifact_paths_missing_after_recovery,
    ],
    ["Residual risk", verificationEvidence.recovery_scope.residual_risk_paths],
  ];

  return groups
    .filter(([, paths]) => paths.length > 0)
    .map(([label, paths]) => `${label}: ${paths.join(", ")}`);
}

function renderTimelineItem(item: IssueWorkbenchTimelineItem): string {
  const metadata =
    item.metadata.length > 0 ? `<ul>${item.metadata.map(renderListItem).join("")}</ul>` : "";

  return [
    `<li class="timeline-item ${item.tone}">`,
    `<div class="timeline-meta">${escapeHtml(item.createdAt)} · ${escapeHtml(item.actorLabel)}</div>`,
    `<h3>${escapeHtml(item.title)}</h3>`,
    `<p>${escapeHtml(item.body)}</p>`,
    metadata,
    "</li>",
  ].join("");
}

function renderTagList(items: string[]): string {
  return `<ul class="tags">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderBulletList(items: string[]): string {
  return `<ul>${items.map(renderListItem).join("")}</ul>`;
}

function renderListItem(item: string): string {
  return `<li>${escapeHtml(item)}</li>`;
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

function formatMetadata(metadata: Record<string, unknown>): string[] {
  return Object.entries(metadata)
    .map(([key, value]) => {
      const rendered = stringifyMetadataValue(value);
      return rendered ? `${humanizeToken(key)}: ${rendered}` : null;
    })
    .filter((value): value is string => value !== null)
    .sort((left, right) => left.localeCompare(right));
}

function stringifyMetadataValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((entry) => stringifyMetadataValue(entry))
      .filter((entry): entry is string => entry !== null)
      .join(", ");
  }

  return null;
}

function formatLinkedSummary(identifier: string | null, title: string): string {
  return identifier ? `${identifier} · ${title}` : title;
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

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

const ISSUE_WORKBENCH_CSS = `
:root {
  color-scheme: light;
  --bg: #f3efe6;
  --card: #fffaf2;
  --ink: #1e1a16;
  --muted: #6b6258;
  --line: #d8cfc1;
  --accent: #0c5c56;
  --warning: #8a3b12;
  --shadow: 0 18px 40px rgba(30, 26, 22, 0.08);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(12, 92, 86, 0.12), transparent 30%),
    linear-gradient(180deg, #f8f4eb 0%, var(--bg) 100%);
  color: var(--ink);
  font: 16px/1.5 "Iowan Old Style", "Palatino Linotype", serif;
}
.shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}
.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  align-items: start;
}
.card {
  background: color-mix(in srgb, var(--card) 92%, white 8%);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--shadow);
  padding: 20px;
}
.hero {
  margin-bottom: 16px;
}
.eyebrow,
.section-label,
.timeline-meta,
.empty {
  color: var(--muted);
  font-size: 0.92rem;
}
h1, h2, h3 {
  margin: 0 0 12px;
  font-weight: 600;
}
h1 { font-size: clamp(2rem, 4vw, 3.4rem); line-height: 1.05; }
h2 { font-size: 1.3rem; }
h3 { font-size: 1rem; margin-bottom: 6px; }
pre, code {
  font-family: "SFMono-Regular", "SF Mono", Consolas, monospace;
}
pre {
  background: rgba(12, 92, 86, 0.05);
  border-radius: 16px;
  margin: 0;
  padding: 16px;
  white-space: pre-wrap;
}
ul, ol {
  margin: 0;
  padding-left: 20px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  list-style: none;
  padding: 0;
}
.tags li {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.7);
}
.thread {
  grid-column: 1 / -1;
}
.timeline-item {
  border-left: 3px solid var(--line);
  list-style: none;
  margin: 0 0 16px;
  padding: 0 0 0 16px;
}
.timeline-item.warning {
  border-left-color: color-mix(in srgb, var(--warning) 60%, var(--line) 40%);
}
.timeline-item.muted {
  border-left-color: color-mix(in srgb, var(--accent) 35%, var(--line) 65%);
}
.timeline-item p {
  margin: 0 0 8px;
}
@media (max-width: 720px) {
  .shell {
    padding: 20px 14px 32px;
  }
  .card {
    border-radius: 18px;
  }
}
`;
