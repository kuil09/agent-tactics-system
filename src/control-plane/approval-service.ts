import type { ApprovalWorkflowHandoff } from "../runtime/executable-runtime.js";

import type { IssueWorkbenchVerificationEvidence } from "./issue-workbench.js";

export type ApprovalDecisionOutcome =
  | "pending"
  | "approved"
  | "rejected"
  | "revision_requested";

export interface ApprovalIssueLink {
  issueId: string;
  identifier?: string | null;
  title: string;
  status: string;
}

export interface ApprovalComment {
  id: string;
  approvalId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  companyId: string;
  issueLinks: ApprovalIssueLink[];
  workflow: ApprovalWorkflowHandoff;
  verificationEvidence: IssueWorkbenchVerificationEvidence;
  decisionOutcome: ApprovalDecisionOutcome;
  comments: ApprovalComment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateApprovalInput {
  id: string;
  companyId: string;
  issueLinks: ApprovalIssueLink[];
  workflow: ApprovalWorkflowHandoff;
  verificationEvidence: IssueWorkbenchVerificationEvidence;
  createdAt: string;
  decisionOutcome?: ApprovalDecisionOutcome;
  comments?: ApprovalComment[];
}

export interface AddApprovalCommentInput {
  approvalId: string;
  authorId: string;
  body: string;
  at: string;
}

export interface TransitionApprovalInput {
  approvalId: string;
  actorId: string;
  action: "approve" | "reject" | "request_revision" | "resubmit";
  at: string;
}

export class ApprovalTransitionError extends Error {
  readonly code: "invalid_action";

  constructor(message: string) {
    super(message);
    this.name = "ApprovalTransitionError";
    this.code = "invalid_action";
  }
}

export class InMemoryApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();

  private commentSequence = 0;

  createApproval(input: CreateApprovalInput): ApprovalRecord {
    const approval: ApprovalRecord = {
      id: input.id,
      companyId: input.companyId,
      issueLinks: input.issueLinks.map((link) => ({ ...link })),
      workflow: cloneWorkflow(input.workflow),
      verificationEvidence: cloneEvidence(input.verificationEvidence),
      decisionOutcome: input.decisionOutcome ?? "pending",
      comments: (input.comments ?? []).map((comment) => ({ ...comment })),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };

    this.approvals.set(approval.id, approval);
    return cloneApproval(approval);
  }

  listApprovals(companyId: string): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter((approval) => approval.companyId === companyId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((approval) => cloneApproval(approval));
  }

  getApproval(approvalId: string): ApprovalRecord {
    return cloneApproval(this.requireApproval(approvalId));
  }

  listComments(approvalId: string): ApprovalComment[] {
    return this.requireApproval(approvalId).comments.map((comment) => ({ ...comment }));
  }

  addComment(input: AddApprovalCommentInput): ApprovalComment {
    const approval = this.requireApproval(input.approvalId);
    const comment: ApprovalComment = {
      id: this.nextCommentId(),
      approvalId: approval.id,
      authorId: input.authorId,
      body: input.body,
      createdAt: input.at,
    };

    approval.comments.push(comment);
    approval.updatedAt = input.at;
    return { ...comment };
  }

  transitionApproval(input: TransitionApprovalInput): ApprovalRecord {
    const approval = this.requireApproval(input.approvalId);
    const currentOutcome = approval.decisionOutcome;

    if (!isAllowedTransition(currentOutcome, input.action)) {
      throw new ApprovalTransitionError(
        `approval ${approval.id} cannot ${input.action.replaceAll("_", " ")} from ${currentOutcome}`,
      );
    }

    approval.updatedAt = input.at;
    approval.workflow.decision.recorded_by = input.actorId;
    approval.workflow.decision.recorded_at = input.at;

    switch (input.action) {
      case "approve":
        approval.decisionOutcome = "approved";
        approval.workflow.decision.blocked_reason = null;
        approval.workflow.release.release_blocked = false;
        approval.workflow.release.blockers = [];
        approval.workflow.release.unblock_checklist = [];
        approval.workflow.release.next_owner = "system_orchestrator";
        break;
      case "reject":
        approval.decisionOutcome = "rejected";
        approval.workflow.decision.blocked_reason = "approval was rejected by the assigned operator";
        approval.workflow.release.release_blocked = true;
        approval.workflow.release.blockers = ["approval rejected"];
        approval.workflow.release.unblock_checklist = [
          "address the rejected decision feedback",
          "resubmit the approval request after changes are ready",
        ];
        approval.workflow.release.next_owner = "human_operator";
        break;
      case "request_revision":
        approval.decisionOutcome = "revision_requested";
        approval.workflow.decision.blocked_reason =
          "operator requested revision evidence before approval can resume";
        approval.workflow.release.release_blocked = true;
        approval.workflow.release.blockers = ["revision requested by operator"];
        approval.workflow.release.unblock_checklist = [
          "update the execution evidence",
          "resubmit the approval request with refreshed artifacts",
        ];
        approval.workflow.release.next_owner = "human_operator";
        break;
      case "resubmit":
        approval.decisionOutcome = "pending";
        approval.workflow.decision.blocked_reason = "human approval has not been recorded yet";
        approval.workflow.release.release_blocked = true;
        approval.workflow.release.blockers = [
          "human approval artifact missing",
          "approval:grant permission missing",
        ];
        approval.workflow.release.unblock_checklist = [
          "record the approval decision artifact",
          "confirm independent verification evidence still passes",
          "rerun promotion with approval:grant",
        ];
        approval.workflow.release.next_owner = "human_operator";
        break;
    }

    return cloneApproval(approval);
  }

  private requireApproval(approvalId: string): ApprovalRecord {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`approval ${approvalId} not found`);
    }

    return approval;
  }

  private nextCommentId(): string {
    this.commentSequence += 1;
    return `approval-comment-${this.commentSequence}`;
  }
}

function isAllowedTransition(
  current: ApprovalDecisionOutcome,
  action: TransitionApprovalInput["action"],
): boolean {
  switch (action) {
    case "approve":
    case "reject":
    case "request_revision":
      return current === "pending";
    case "resubmit":
      return current === "rejected" || current === "revision_requested";
  }
}

function cloneApproval(record: ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    issueLinks: record.issueLinks.map((link) => ({ ...link })),
    workflow: cloneWorkflow(record.workflow),
    verificationEvidence: cloneEvidence(record.verificationEvidence),
    comments: record.comments.map((comment) => ({ ...comment })),
  };
}

function cloneWorkflow(workflow: ApprovalWorkflowHandoff): ApprovalWorkflowHandoff {
  return {
    ...workflow,
    request: {
      ...workflow.request,
      required_evidence: [...workflow.request.required_evidence],
      validation_commands: [...workflow.request.validation_commands],
    },
    decision: {
      ...workflow.decision,
      resolution_criteria: [...workflow.decision.resolution_criteria],
    },
    release: {
      ...workflow.release,
      blockers: [...workflow.release.blockers],
      unblock_checklist: [...workflow.release.unblock_checklist],
    },
  };
}

function cloneEvidence(
  evidence: IssueWorkbenchVerificationEvidence,
): IssueWorkbenchVerificationEvidence {
  return {
    ...evidence,
    input_boundary_summary: evidence.input_boundary_summary.map((entry) => ({ ...entry })),
    validation_commands: [...evidence.validation_commands],
    recovery_scope: {
      ...evidence.recovery_scope,
      attempted_write_paths: [...evidence.recovery_scope.attempted_write_paths],
      changed_paths: [...evidence.recovery_scope.changed_paths],
      modified_preexisting_paths: [...evidence.recovery_scope.modified_preexisting_paths],
      created_paths: [...evidence.recovery_scope.created_paths],
      restored_paths: [...evidence.recovery_scope.restored_paths],
      unrestored_paths: [...evidence.recovery_scope.unrestored_paths],
      artifact_paths_missing_after_recovery: [
        ...evidence.recovery_scope.artifact_paths_missing_after_recovery,
      ],
      residual_risk_paths: [...evidence.recovery_scope.residual_risk_paths],
    },
  };
}
