import { describe, expect, it } from "vitest";

import {
  buildDashboardViewModel,
  renderDashboardHtml,
  type DashboardIssue,
} from "../../src/control-plane/dashboard.js";

describe("dashboard", () => {
  it("filters the inbox to active operator statuses and highlights warning signals", () => {
    const model = buildDashboardViewModel({
      issues: [
        createIssue({
          id: "issue-blocked",
          identifier: "NIT-85",
          title: "Dashboard implementation",
          status: "blocked",
          priority: "high",
          updatedAt: "2026-04-03T11:30:00.000Z",
          blockedReason: "Waiting for CTO review on deployment scope.",
          nextOwner: "cto",
          signals: {
            hasNewComments: true,
            hasCheckoutConflict: true,
            awaitingApproval: true,
          },
        }),
        createIssue({
          id: "issue-review",
          identifier: "NIT-84",
          title: "Approval workbench",
          status: "in_review",
          priority: "medium",
          updatedAt: "2026-04-03T12:00:00.000Z",
          activeRun: {
            id: "run-123",
            status: "running",
            startedAt: "2026-04-03T11:55:00.000Z",
            agentId: "founding-engineer",
          },
        }),
        createIssue({
          id: "issue-todo",
          identifier: "NIT-83",
          title: "Backlog item",
          status: "todo",
          updatedAt: "2026-04-03T13:00:00.000Z",
        }),
      ],
    });

    expect(model.summaryFacts).toEqual([
      "Visible issues: 2",
      "Attention needed: 1",
      "Status filters: in progress, blocked, in review",
    ]);
    expect(model.availableStatuses).toEqual([
      { status: "blocked", count: 1 },
      { status: "in_review", count: 1 },
      { status: "todo", count: 1 },
    ]);
    expect(model.issues.map((issue) => issue.id)).toEqual(["issue-review", "issue-blocked"]);
    expect(model.issues[1].warnings).toEqual([
      "Waiting for CTO review on deployment scope.",
      "New comments arrived on a blocked or active issue.",
      "Checkout conflict was recorded and needs operator review.",
      "Approval is still pending before promotion can continue.",
    ]);
    expect(model.issues[0].activeRunSummary).toBe(
      "Run run-123 · running · owner founding-engineer · started 2026-04-03T11:55:00.000Z",
    );
  });

  it("supports custom status filters and preserves parent context", () => {
    const model = buildDashboardViewModel({
      selectedStatuses: ["todo"],
      issues: [
        createIssue({
          id: "issue-parented",
          title: "Queue dashboard card",
          status: "todo",
          updatedAt: "2026-04-03T12:30:00.000Z",
          parent: {
            identifier: "NIT-80",
            title: "Dashboard program",
          },
        }),
      ],
    });

    expect(model.issues).toEqual([
      expect.objectContaining({
        parentSummary: "NIT-80 · Dashboard program",
      }),
    ]);
    expect(model.selectedStatuses).toEqual(["todo"]);
  });

  it("preserves parent titles without an identifier and custom headings", () => {
    const model = buildDashboardViewModel({
      heading: "My inbox",
      selectedStatuses: ["todo"],
      issues: [
        createIssue({
          id: "issue-parent-title",
          title: "Plain parent link",
          status: "todo",
          updatedAt: "2026-04-03T12:40:00.000Z",
          parent: {
            identifier: null,
            title: "Parent title only",
          },
        }),
      ],
    });

    expect(model.heading).toBe("My inbox");
    expect(model.issues).toEqual([
      expect.objectContaining({
        parentSummary: "Parent title only",
      }),
    ]);
  });

  it("sorts equal timestamps by priority and then title", () => {
    const model = buildDashboardViewModel({
      selectedStatuses: ["in_progress"],
      issues: [
        createIssue({
          id: "issue-zeta",
          title: "Zeta follow-up",
          status: "in_progress",
          priority: "medium",
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
        createIssue({
          id: "issue-critical",
          title: "Critical path",
          status: "in_progress",
          priority: "critical",
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
        createIssue({
          id: "issue-alpha",
          title: "Alpha refinement",
          status: "in_progress",
          priority: "medium",
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
      ],
    });

    expect(model.issues.map((issue) => issue.id)).toEqual([
      "issue-critical",
      "issue-alpha",
      "issue-zeta",
    ]);
  });

  it("pushes unknown priorities behind ranked priorities when timestamps match", () => {
    const model = buildDashboardViewModel({
      selectedStatuses: ["in_progress"],
      issues: [
        createIssue({
          id: "issue-ranked",
          title: "Ranked priority",
          status: "in_progress",
          priority: "low",
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
        createIssue({
          id: "issue-unranked",
          title: "Unranked priority",
          status: "in_progress",
          priority: "urgent",
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
      ],
    });

    expect(model.issues.map((issue) => issue.id)).toEqual([
      "issue-ranked",
      "issue-unranked",
    ]);
  });

  it("falls back to title ordering when priorities are both absent", () => {
    const model = buildDashboardViewModel({
      selectedStatuses: ["in_progress"],
      issues: [
        createIssue({
          id: "issue-title-z",
          title: "Zulu task",
          status: "in_progress",
          priority: null,
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
        createIssue({
          id: "issue-title-a",
          title: "Alpha task",
          status: "in_progress",
          priority: null,
          updatedAt: "2026-04-03T12:30:00.000Z",
        }),
      ],
    });

    expect(model.issues.map((issue) => issue.id)).toEqual([
      "issue-title-a",
      "issue-title-z",
    ]);
  });

  it("renders empty and escaped dashboard states safely", () => {
    const html = renderDashboardHtml({
      issues: [
        createIssue({
          id: "issue-hidden",
          title: "<unsafe issue>",
          status: "todo",
          updatedAt: "2026-04-03T13:00:00.000Z",
        }),
      ],
    });

    expect(html).toContain("No visible issues");
    expect(html).not.toContain("<unsafe issue>");
    expect(html).toContain("Control-plane dashboard");
    expect(html).toContain("todo (1)");
  });

  it("renders calm cards and fallback blocked messaging", () => {
    const html = renderDashboardHtml({
      issues: [
        createIssue({
          id: "issue-blocked-default",
          title: "Missing unblock plan",
          status: "blocked",
          updatedAt: "2026-04-03T14:00:00.000Z",
          blockedReason: null,
        }),
        createIssue({
          id: "issue-calm",
          title: "Quiet review",
          status: "in_review",
          updatedAt: "2026-04-03T13:00:00.000Z",
          projectName: null,
          activeRun: null,
          nextOwner: null,
        }),
      ],
    });

    expect(html).toContain("Blocked issue needs an explicit unblock decision.");
    expect(html).toContain("No warning signals are attached.");
  });

  it("renders issue cards, warnings, and active run facts", () => {
    const html = renderDashboardHtml({
      issues: [
        createIssue({
          id: "issue-card",
          identifier: "NIT-81",
          title: "Approval inbox",
          status: "in_progress",
          priority: "critical",
          updatedAt: "2026-04-03T14:00:00.000Z",
          projectName: "agent-tactics-system",
          signals: {
            awaitingApproval: true,
          },
          activeRun: {
            id: "run-900",
            status: "pending_human_approval",
          },
        }),
      ],
    });

    expect(html).toContain("Approval inbox");
    expect(html).toContain("Priority: critical");
    expect(html).toContain("Project: agent-tactics-system");
    expect(html).toContain("Run run-900");
    expect(html).toContain("Approval is still pending before promotion can continue.");
    expect(html).toContain("Warnings");
  });

  it("renders parent and next-owner facts when they exist", () => {
    const html = renderDashboardHtml({
      issues: [
        createIssue({
          id: "issue-contextual",
          identifier: "NIT-99",
          title: "Coordinated follow-up",
          status: "in_progress",
          updatedAt: "2026-04-03T15:00:00.000Z",
          projectName: null,
          parent: {
            identifier: "NIT-70",
            title: "Program thread",
          },
          nextOwner: "qa_lead",
        }),
      ],
    });

    expect(html).toContain("Parent: NIT-70 · Program thread");
    expect(html).toContain("Next owner: qa lead");
  });
});

function createIssue(overrides: Partial<DashboardIssue> & Pick<DashboardIssue, "id" | "title" | "status" | "updatedAt">): DashboardIssue {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status,
    updatedAt: overrides.updatedAt,
    identifier: overrides.identifier ?? null,
    priority: overrides.priority ?? null,
    projectName:
      overrides.projectName === undefined ? "agent-tactics-system" : overrides.projectName,
    blockedReason: overrides.blockedReason ?? null,
    parent: overrides.parent === undefined ? null : overrides.parent,
    activeRun: overrides.activeRun === undefined ? null : overrides.activeRun,
    signals: overrides.signals ?? null,
    nextOwner: overrides.nextOwner ?? null,
  };
}
