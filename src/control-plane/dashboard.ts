export interface DashboardIssue {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  priority?: string | null;
  updatedAt: string;
  projectName?: string | null;
  blockedReason?: string | null;
  parent?: {
    identifier?: string | null;
    title: string;
  } | null;
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
  nextOwner?: string | null;
}

export interface DashboardInput {
  heading?: string;
  selectedStatuses?: string[];
  issues: DashboardIssue[];
}

export interface DashboardIssueCard {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string | null;
  updatedAt: string;
  projectName: string | null;
  parentSummary: string | null;
  activeRunSummary: string | null;
  warnings: string[];
  nextOwner: string | null;
}

export interface DashboardViewModel {
  heading: string;
  summaryFacts: string[];
  selectedStatuses: string[];
  availableStatuses: Array<{ status: string; count: number }>;
  issues: DashboardIssueCard[];
}

const DEFAULT_SELECTED_STATUSES = ["in_progress", "blocked", "in_review"];

export function buildDashboardViewModel(input: DashboardInput): DashboardViewModel {
  const selectedStatuses =
    input.selectedStatuses && input.selectedStatuses.length > 0
      ? [...input.selectedStatuses]
      : [...DEFAULT_SELECTED_STATUSES];
  const selectedStatusSet = new Set(selectedStatuses);
  const availableStatuses = Array.from(
    input.issues.reduce((counts, issue) => {
      counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => left.status.localeCompare(right.status));
  const filteredIssues = input.issues
    .filter((issue) => selectedStatusSet.has(issue.status))
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        comparePriority(left.priority ?? null, right.priority ?? null) ||
        left.title.localeCompare(right.title),
    )
    .map((issue) => ({
      id: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title,
      status: issue.status,
      priority: issue.priority ?? null,
      updatedAt: issue.updatedAt,
      projectName: issue.projectName ?? null,
      parentSummary: issue.parent
        ? formatLinkedSummary(issue.parent.identifier ?? null, issue.parent.title)
        : null,
      activeRunSummary: buildActiveRunSummary(issue),
      warnings: buildWarnings(issue),
      nextOwner: issue.nextOwner ?? null,
    }));
  const urgentCount = filteredIssues.filter((issue) => issue.warnings.length > 0).length;

  return {
    heading: input.heading ?? "Operator dashboard",
    summaryFacts: [
      `Visible issues: ${filteredIssues.length}`,
      `Attention needed: ${urgentCount}`,
      `Status filters: ${selectedStatuses.map(humanizeToken).join(", ")}`,
    ],
    selectedStatuses,
    availableStatuses,
    issues: filteredIssues,
  };
}

export function renderDashboardHtml(input: DashboardInput): string {
  const model = buildDashboardViewModel(input);

  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(model.heading)}</title>`,
    "<style>",
    DASHBOARD_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<main class="shell">',
    '<section class="hero panel">',
    '<p class="eyebrow">Control-plane dashboard</p>',
    `<h1>${escapeHtml(model.heading)}</h1>`,
    renderTagList(model.summaryFacts),
    '<p class="section-label">Available statuses</p>',
    renderStatusList(model.availableStatuses, model.selectedStatuses),
    "</section>",
    '<section class="board">',
    model.issues.length
      ? model.issues.map(renderIssueCard).join("")
      : '<article class="panel empty-state"><h2>No visible issues</h2><p>No assigned issues match the active status filters.</p></article>',
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function renderIssueCard(issue: DashboardIssueCard): string {
  const facts = compact([
    issue.identifier ? `${issue.identifier} · ${humanizeToken(issue.status)}` : humanizeToken(issue.status),
    issue.priority ? `Priority: ${humanizeToken(issue.priority)}` : null,
    issue.projectName ? `Project: ${issue.projectName}` : null,
    issue.parentSummary ? `Parent: ${issue.parentSummary}` : null,
    `Updated: ${issue.updatedAt}`,
    issue.activeRunSummary,
    issue.nextOwner ? `Next owner: ${humanizeToken(issue.nextOwner)}` : null,
  ]);

  return [
    '<article class="panel issue-card">',
    `<h2>${escapeHtml(issue.title)}</h2>`,
    renderTagList(facts),
    issue.warnings.length
      ? `<p class="section-label">Warnings</p>${renderBulletList(issue.warnings)}`
      : '<p class="empty">No warning signals are attached.</p>',
    "</article>",
  ].join("");
}

function renderStatusList(
  items: Array<{ status: string; count: number }>,
  selectedStatuses: string[],
): string {
  const selected = new Set(selectedStatuses);

  return `<ul class="status-list">${items
    .map(
      (item) =>
        `<li class="${selected.has(item.status) ? "selected" : "muted"}">${escapeHtml(
          `${humanizeToken(item.status)} (${item.count})`,
        )}</li>`,
    )
    .join("")}</ul>`;
}

function renderTagList(items: string[]): string {
  return `<ul class="tags">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderBulletList(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildWarnings(issue: DashboardIssue): string[] {
  return compact([
    issue.status === "blocked" ? issue.blockedReason ?? "Blocked issue needs an explicit unblock decision." : null,
    issue.signals?.hasNewComments ? "New comments arrived on a blocked or active issue." : null,
    issue.signals?.hasCheckoutConflict ? "Checkout conflict was recorded and needs operator review." : null,
    issue.signals?.awaitingApproval ? "Approval is still pending before promotion can continue." : null,
  ]);
}

function buildActiveRunSummary(issue: DashboardIssue): string | null {
  if (!issue.activeRun) {
    return null;
  }

  const parts = compact([
    `Run ${issue.activeRun.id}`,
    humanizeToken(issue.activeRun.status),
    issue.activeRun.agentId ? `owner ${issue.activeRun.agentId}` : null,
    issue.activeRun.startedAt ? `started ${issue.activeRun.startedAt}` : null,
  ]);

  return parts.join(" · ");
}

function comparePriority(left: string | null, right: string | null): number {
  const rank = new Map<string, number>([
    ["critical", 0],
    ["high", 1],
    ["medium", 2],
    ["low", 3],
  ]);

  return (rank.get(left ?? "") ?? 99) - (rank.get(right ?? "") ?? 99);
}

function formatLinkedSummary(identifier: string | null, title: string): string {
  return identifier ? `${identifier} · ${title}` : title;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
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

const DASHBOARD_CSS = `
:root {
  color-scheme: light;
  font-family: "Iowan Old Style", "Palatino Linotype", serif;
  background:
    radial-gradient(circle at top left, rgba(245, 222, 179, 0.35), transparent 30%),
    linear-gradient(180deg, #f4efe5 0%, #e8e0d1 100%);
  color: #1f2328;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

.shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}

.hero,
.panel {
  border: 1px solid rgba(72, 54, 35, 0.16);
  border-radius: 24px;
  background: rgba(255, 251, 244, 0.9);
  box-shadow: 0 20px 60px rgba(82, 54, 24, 0.08);
}

.hero {
  padding: 28px;
}

.board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.issue-card {
  padding: 20px;
}

.eyebrow,
.section-label,
.timeline-meta {
  font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.73rem;
  color: #7a5b39;
}

h1,
h2 {
  margin: 0;
}

h1 {
  font-size: clamp(2.1rem, 4vw, 3.5rem);
  margin-top: 8px;
}

h2 {
  font-size: 1.35rem;
}

.tags,
.status-list,
ul {
  margin: 0;
  padding-left: 18px;
}

.tags,
.status-list {
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.tags li,
.status-list li {
  border-radius: 999px;
  padding: 7px 12px;
  font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
  font-size: 0.92rem;
}

.tags li {
  background: rgba(115, 87, 49, 0.08);
}

.status-list li.selected {
  background: #4d6b50;
  color: #f8f5ef;
}

.status-list li.muted {
  background: rgba(115, 87, 49, 0.08);
  color: #6c5b48;
}

.section-label {
  margin: 18px 0 8px;
}

.empty,
.empty-state p {
  color: #5f5a52;
}

.empty-state {
  padding: 24px;
}

@media (max-width: 720px) {
  .shell {
    width: min(100vw - 20px, 1180px);
    padding-top: 20px;
  }

  .hero,
  .issue-card,
  .empty-state {
    padding: 18px;
  }
}
`;
