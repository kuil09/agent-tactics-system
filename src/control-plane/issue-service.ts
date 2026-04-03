export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface IssueRecord {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  checkout: IssueCheckout | null;
  comments: IssueComment[];
}

export interface IssueCheckout {
  agentId: string;
  runId: string;
  lockedAt: string;
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  kind: "comment" | "system";
  createdAt: string;
}

export interface IssueEvent {
  id: string;
  issueId: string;
  actorId: string;
  action:
    | "issue.created"
    | "status.changed"
    | "status.rejected"
    | "checkout.granted"
    | "checkout.rejected"
    | "release.granted"
    | "release.rejected"
    | "comment.created";
  outcome: "succeeded" | "rejected";
  detail: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface CreateIssueInput {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  initialStatus?: IssueStatus;
}

export interface TransitionIssueInput {
  issueId: string;
  actorId: string;
  nextStatus: IssueStatus;
  at: string;
  reason?: string;
}

export interface CheckoutIssueInput {
  issueId: string;
  agentId: string;
  runId: string;
  expectedStatuses: IssueStatus[];
  at: string;
}

export interface ReleaseIssueInput {
  issueId: string;
  agentId: string;
  runId: string;
  at: string;
  nextStatus?: IssueStatus;
}

export interface AddCommentInput {
  issueId: string;
  authorId: string;
  body: string;
  at: string;
}

export class IssueTransitionError extends Error {
  readonly code: "invalid_transition" | "permission_denied";

  constructor(code: "invalid_transition" | "permission_denied", message: string) {
    super(message);
    this.name = "IssueTransitionError";
    this.code = code;
  }
}

export class IssueCheckoutError extends Error {
  readonly code: "status_mismatch" | "checkout_conflict";

  constructor(code: "status_mismatch" | "checkout_conflict", message: string) {
    super(message);
    this.name = "IssueCheckoutError";
    this.code = code;
  }
}

export class IssueReleaseError extends Error {
  readonly code: "not_checked_out" | "permission_denied" | "invalid_transition";

  constructor(
    code: "not_checked_out" | "permission_denied" | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "IssueReleaseError";
    this.code = code;
  }
}

const TERMINAL_ISSUE_STATUSES: IssueStatus[] = ["done", "cancelled"];

const ALLOWED_STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "in_review", "done", "blocked", "cancelled"],
  in_review: ["in_progress", "done", "blocked", "cancelled"],
  done: [],
  blocked: ["todo", "in_progress", "cancelled"],
  cancelled: [],
};

export class InMemoryIssueService {
  private readonly issues = new Map<string, IssueRecord>();

  private readonly events = new Map<string, IssueEvent[]>();

  private commentSequence = 0;

  private eventSequence = 0;

  createIssue(input: CreateIssueInput): IssueRecord {
    const issue: IssueRecord = {
      id: input.id,
      title: input.title,
      description: input.description,
      status: input.initialStatus ?? "backlog",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      checkout: null,
      comments: [],
    };

    this.issues.set(issue.id, issue);
    this.recordEvent(issue.id, {
      actorId: "system",
      action: "issue.created",
      outcome: "succeeded",
      detail: `issue created in ${issue.status} status`,
      createdAt: input.createdAt,
      metadata: {
        status: issue.status,
      },
    });

    return cloneIssue(issue);
  }

  getIssue(issueId: string): IssueRecord {
    return cloneIssue(this.requireIssue(issueId));
  }

  transitionIssue(input: TransitionIssueInput): IssueRecord {
    const issue = this.requireIssue(input.issueId);
    const previousStatus = issue.status;

    if (
      issue.checkout &&
      issue.checkout.agentId !== input.actorId &&
      input.nextStatus !== issue.status
    ) {
      const error = new IssueTransitionError(
        "permission_denied",
        `issue ${issue.id} is checked out by ${issue.checkout.agentId}`,
      );
      this.recordEvent(issue.id, {
        actorId: input.actorId,
        action: "status.rejected",
        outcome: "rejected",
        detail: error.message,
        createdAt: input.at,
        metadata: {
          attempted_status: input.nextStatus,
          current_status: issue.status,
          checkout_agent_id: issue.checkout.agentId,
        },
      });
      throw error;
    }

    try {
      ensureStatusTransition(issue.status, input.nextStatus);
    } catch (error) {
      this.recordEvent(issue.id, {
        actorId: input.actorId,
        action: "status.rejected",
        outcome: "rejected",
        detail: formatErrorMessage(error, "status transition rejected"),
        createdAt: input.at,
        metadata: {
          current_status: issue.status,
          attempted_status: input.nextStatus,
          reason: input.reason ?? null,
        },
      });
      throw error;
    }

    const checkoutToRelease =
      issue.checkout &&
      issue.checkout.agentId === input.actorId &&
      TERMINAL_ISSUE_STATUSES.includes(input.nextStatus)
        ? { ...issue.checkout }
        : null;

    if (checkoutToRelease) {
      issue.checkout = null;
      this.recordEvent(issue.id, {
        actorId: input.actorId,
        action: "release.granted",
        outcome: "succeeded",
        detail: `checkout released by ${input.actorId}`,
        createdAt: input.at,
        metadata: {
          run_id: checkoutToRelease.runId,
          next_status: input.nextStatus,
        },
      });
      this.appendSystemComment(
        issue,
        input.at,
        `Checkout released by \`${input.actorId}\`; issue moved to \`${input.nextStatus}\`.`,
      );
    }

    issue.status = input.nextStatus;
    issue.updatedAt = input.at;
    this.recordEvent(issue.id, {
      actorId: input.actorId,
      action: "status.changed",
      outcome: "succeeded",
      detail: `status changed to ${input.nextStatus}`,
      createdAt: input.at,
      metadata: {
        previous_status: previousStatus,
        next_status: input.nextStatus,
        reason: input.reason ?? null,
      },
    });
    this.appendSystemComment(
      issue,
      input.at,
      `Status changed to \`${input.nextStatus}\`${input.reason ? `: ${input.reason}` : "."}`,
    );

    return cloneIssue(issue);
  }

  checkoutIssue(input: CheckoutIssueInput): IssueRecord {
    const issue = this.requireIssue(input.issueId);

    if (!input.expectedStatuses.includes(issue.status)) {
      const error = new IssueCheckoutError(
        "status_mismatch",
        `issue ${issue.id} is ${issue.status}; expected ${input.expectedStatuses.join(", ")}`,
      );
      this.recordEvent(issue.id, {
        actorId: input.agentId,
        action: "checkout.rejected",
        outcome: "rejected",
        detail: error.message,
        createdAt: input.at,
        metadata: {
          current_status: issue.status,
          expected_statuses: input.expectedStatuses,
        },
      });
      throw error;
    }

    if (issue.checkout && issue.checkout.agentId !== input.agentId) {
      const error = new IssueCheckoutError(
        "checkout_conflict",
        `issue ${issue.id} is already checked out by ${issue.checkout.agentId}`,
      );
      this.recordEvent(issue.id, {
        actorId: input.agentId,
        action: "checkout.rejected",
        outcome: "rejected",
        detail: error.message,
        createdAt: input.at,
        metadata: {
          current_checkout_agent_id: issue.checkout.agentId,
          current_checkout_run_id: issue.checkout.runId,
        },
      });
      throw error;
    }

    issue.checkout = {
      agentId: input.agentId,
      runId: input.runId,
      lockedAt: input.at,
    };

    if (issue.status !== "in_progress") {
      ensureStatusTransition(issue.status, "in_progress");
      issue.status = "in_progress";
    }

    issue.updatedAt = input.at;
    this.recordEvent(issue.id, {
      actorId: input.agentId,
      action: "checkout.granted",
      outcome: "succeeded",
      detail: `checkout granted to ${input.agentId}`,
      createdAt: input.at,
      metadata: {
        run_id: input.runId,
        status: issue.status,
      },
    });
    this.appendSystemComment(
      issue,
      input.at,
      `Checkout granted to \`${input.agentId}\` for run \`${input.runId}\`.`,
    );

    return cloneIssue(issue);
  }

  releaseIssue(input: ReleaseIssueInput): IssueRecord {
    const issue = this.requireIssue(input.issueId);

    if (!issue.checkout) {
      const error = new IssueReleaseError(
        "not_checked_out",
        `issue ${issue.id} is not checked out`,
      );
      this.recordEvent(issue.id, {
        actorId: input.agentId,
        action: "release.rejected",
        outcome: "rejected",
        detail: error.message,
        createdAt: input.at,
        metadata: {
          attempted_status: input.nextStatus ?? null,
        },
      });
      throw error;
    }

    if (issue.checkout.agentId !== input.agentId) {
      const error = new IssueReleaseError(
        "permission_denied",
        `issue ${issue.id} is checked out by ${issue.checkout.agentId}`,
      );
      this.recordEvent(issue.id, {
        actorId: input.agentId,
        action: "release.rejected",
        outcome: "rejected",
        detail: error.message,
        createdAt: input.at,
        metadata: {
          current_checkout_agent_id: issue.checkout.agentId,
          current_checkout_run_id: issue.checkout.runId,
        },
      });
      throw error;
    }

    const nextStatus = input.nextStatus ?? (issue.status === "in_progress" ? "todo" : issue.status);
    if (nextStatus !== issue.status) {
      try {
        ensureStatusTransition(issue.status, nextStatus);
      } catch (error) {
        const releaseError = new IssueReleaseError(
          "invalid_transition",
          formatErrorMessage(error, "invalid release transition"),
        );
        this.recordEvent(issue.id, {
          actorId: input.agentId,
          action: "release.rejected",
          outcome: "rejected",
          detail: releaseError.message,
          createdAt: input.at,
          metadata: {
            current_status: issue.status,
            attempted_status: nextStatus,
          },
        });
        throw releaseError;
      }
    }

    issue.checkout = null;
    issue.status = nextStatus;
    issue.updatedAt = input.at;
    this.recordEvent(issue.id, {
      actorId: input.agentId,
      action: "release.granted",
      outcome: "succeeded",
      detail: `checkout released by ${input.agentId}`,
      createdAt: input.at,
      metadata: {
        run_id: input.runId,
        next_status: nextStatus,
      },
    });
    this.appendSystemComment(
      issue,
      input.at,
      `Checkout released by \`${input.agentId}\`; issue moved to \`${nextStatus}\`.`,
    );

    return cloneIssue(issue);
  }

  addComment(input: AddCommentInput): IssueComment {
    const issue = this.requireIssue(input.issueId);
    const comment: IssueComment = {
      id: this.nextCommentId(),
      issueId: issue.id,
      authorId: input.authorId,
      body: input.body,
      kind: "comment",
      createdAt: input.at,
    };

    issue.comments.push(comment);
    issue.updatedAt = input.at;
    this.recordEvent(issue.id, {
      actorId: input.authorId,
      action: "comment.created",
      outcome: "succeeded",
      detail: `comment ${comment.id} created`,
      createdAt: input.at,
      metadata: {
        comment_id: comment.id,
      },
    });

    return { ...comment };
  }

  listComments(issueId: string, afterCommentId?: string): IssueComment[] {
    const issue = this.requireIssue(issueId);
    const startIndex =
      afterCommentId === undefined
        ? -1
        : issue.comments.findIndex((comment) => comment.id === afterCommentId);

    return issue.comments
      .slice(startIndex + 1)
      .map((comment) => ({ ...comment }))
      .sort(sortByCreatedAt);
  }

  listEvents(issueId: string): IssueEvent[] {
    return [...(this.events.get(issueId) ?? [])].map((event) => ({
      ...event,
      metadata: { ...event.metadata },
    }));
  }

  private appendSystemComment(issue: IssueRecord, at: string, body: string): void {
    issue.comments.push({
      id: this.nextCommentId(),
      issueId: issue.id,
      authorId: "system",
      body,
      kind: "system",
      createdAt: at,
    });
  }

  private recordEvent(
    issueId: string,
    input: Omit<IssueEvent, "id" | "issueId">,
  ): void {
    const issueEvents = this.events.get(issueId) ?? [];
    issueEvents.push({
      id: this.nextEventId(),
      issueId,
      ...input,
      metadata: { ...input.metadata },
    });
    issueEvents.sort(sortByCreatedAt);
    this.events.set(issueId, issueEvents);
  }

  private requireIssue(issueId: string): IssueRecord {
    const issue = this.issues.get(issueId);
    if (!issue) {
      throw new Error(`issue ${issueId} not found`);
    }

    return issue;
  }

  private nextCommentId(): string {
    this.commentSequence += 1;
    return `comment-${this.commentSequence}`;
  }

  private nextEventId(): string {
    this.eventSequence += 1;
    return `event-${this.eventSequence}`;
  }
}

function ensureStatusTransition(current: IssueStatus, next: IssueStatus): void {
  if (current === next) {
    return;
  }

  if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
    throw new IssueTransitionError(
      "invalid_transition",
      `status ${current} cannot transition to ${next}`,
    );
  }
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

/* v8 ignore start */
function cloneIssue(issue: IssueRecord): IssueRecord {
  return {
    ...issue,
    checkout: issue.checkout ? { ...issue.checkout } : null,
    comments: issue.comments.map((comment) => ({ ...comment })),
  };
}
/* v8 ignore stop */

function sortByCreatedAt<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  if (left.createdAt === right.createdAt) {
    return left.id.localeCompare(right.id);
  }

  return left.createdAt.localeCompare(right.createdAt);
}
