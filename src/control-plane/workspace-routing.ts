export interface ExecutionWorkspaceCandidate {
  workspaceId: string;
  rootPath: string;
  repoUrl: string;
}

export interface ExecutionWorkspacePreference {
  repoUrl?: string | null;
}

export interface ExecutionWorkspaceSettings {
  allowProjectWorkspaceFallback?: boolean;
}

export interface ExecutionWorkspaceRoutingIssue {
  issueId: string;
  projectWorkspaceId?: string | null;
  executionWorkspaceId?: string | null;
  executionWorkspacePreference?: ExecutionWorkspacePreference | null;
  executionWorkspaceSettings?: ExecutionWorkspaceSettings | null;
}

export interface RouteExecutionWorkspaceInput {
  issue: ExecutionWorkspaceRoutingIssue;
  runId: string;
  at: string;
  candidates: ExecutionWorkspaceCandidate[];
}

export interface ExecutionWorkspaceBindingRecord {
  issueId: string;
  runId: string;
  workspaceId: string;
  workspaceRoot: string;
  repoUrl: string;
  projectWorkspaceId: string | null;
  boundAt: string;
  bindingSource:
    | "issue_execution_workspace"
    | "repo_preference_match"
    | "project_workspace_default"
    | "single_candidate_default";
  candidateWorkspaceIds: string[];
  preferenceSnapshot: {
    executionWorkspaceId: string | null;
    repoUrl: string | null;
    allowProjectWorkspaceFallback: boolean;
  };
}

export interface ExecutionWorkspaceExcludedCandidate {
  workspaceId: string;
  reason: string;
}

export interface ExecutionWorkspaceRecoveryPlan {
  action:
    | "set_execution_workspace_id"
    | "restore_project_workspace"
    | "fix_execution_workspace_preference";
  summary: string;
  targetWorkspaceId: string | null;
}

export interface BlockedExecutionWorkspaceRouting {
  status: "blocked";
  code:
    | "workspace_missing"
    | "workspace_repo_mismatch"
    | "workspace_selection_ambiguous";
  issueId: string;
  runId: string;
  reason: string;
  candidateWorkspaceIds: string[];
  requestedWorkspaceId: string | null;
  requestedRepoUrl: string | null;
  recovery: ExecutionWorkspaceRecoveryPlan;
}

export interface SelectedExecutionWorkspaceRouting {
  status: "selected";
  binding: ExecutionWorkspaceBindingRecord;
  excluded: ExecutionWorkspaceExcludedCandidate[];
}

export type ExecutionWorkspaceRoutingResult =
  | BlockedExecutionWorkspaceRouting
  | SelectedExecutionWorkspaceRouting;

export function routeExecutionWorkspace(
  input: RouteExecutionWorkspaceInput,
): ExecutionWorkspaceRoutingResult {
  const candidates = [...input.candidates];
  const candidateWorkspaceIds = candidates.map((candidate) => candidate.workspaceId);
  const requestedWorkspaceId = input.issue.executionWorkspaceId ?? null;
  const requestedRepoUrl = input.issue.executionWorkspacePreference?.repoUrl ?? null;
  const allowProjectWorkspaceFallback =
    input.issue.executionWorkspaceSettings?.allowProjectWorkspaceFallback !== false;
  const projectWorkspace =
    input.issue.projectWorkspaceId === undefined || input.issue.projectWorkspaceId === null
      ? null
      : candidates.find(
          (candidate) => candidate.workspaceId === input.issue.projectWorkspaceId,
        ) ?? null;

  if (requestedWorkspaceId) {
    const explicitWorkspace =
      candidates.find((candidate) => candidate.workspaceId === requestedWorkspaceId) ?? null;

    if (!explicitWorkspace) {
      return blockedRouting({
        input,
        code: "workspace_missing",
        reason: `execution workspace ${requestedWorkspaceId} is not available in the routed workspace set`,
        requestedWorkspaceId,
        requestedRepoUrl,
        candidateWorkspaceIds,
        recovery:
          allowProjectWorkspaceFallback && projectWorkspace
            ? {
                action: "restore_project_workspace",
                summary: `requeue on project workspace ${projectWorkspace.workspaceId}`,
                targetWorkspaceId: projectWorkspace.workspaceId,
              }
            : {
                action: "set_execution_workspace_id",
                summary: "set a valid execution workspace id before retrying the run",
                targetWorkspaceId: projectWorkspace?.workspaceId ?? null,
              },
      });
    }

    if (requestedRepoUrl && !repoUrlsMatch(explicitWorkspace.repoUrl, requestedRepoUrl)) {
      return blockedRouting({
        input,
        code: "workspace_repo_mismatch",
        reason: `execution workspace ${requestedWorkspaceId} points to ${explicitWorkspace.repoUrl}, not ${requestedRepoUrl}`,
        requestedWorkspaceId,
        requestedRepoUrl,
        candidateWorkspaceIds,
        recovery: {
          action: "fix_execution_workspace_preference",
          summary: "align executionWorkspaceId and executionWorkspacePreference.repoUrl before retrying",
          targetWorkspaceId: explicitWorkspace.workspaceId,
        },
      });
    }

    return selectedRouting({
      input,
      selected: explicitWorkspace,
      bindingSource: "issue_execution_workspace",
      reasonForExclusion: "another workspace was explicitly bound on the issue",
      allowProjectWorkspaceFallback,
    });
  }

  if (requestedRepoUrl) {
    const repoMatches = candidates.filter((candidate) =>
      repoUrlsMatch(candidate.repoUrl, requestedRepoUrl),
    );

    if (repoMatches.length === 1) {
      return selectedRouting({
        input,
        selected: repoMatches[0],
        bindingSource: "repo_preference_match",
        reasonForExclusion: "repo url does not match the issue workspace preference",
        allowProjectWorkspaceFallback,
      });
    }

    if (repoMatches.length > 1) {
      if (projectWorkspace && repoMatches.some((candidate) => candidate.workspaceId === projectWorkspace.workspaceId)) {
        return selectedRouting({
          input,
          selected: projectWorkspace,
          bindingSource: "project_workspace_default",
          reasonForExclusion: (candidate) =>
            repoUrlsMatch(candidate.repoUrl, requestedRepoUrl)
              ? "repo preference matched multiple workspaces, so the project workspace default broke the tie"
              : "repo url does not match the issue workspace preference",
          allowProjectWorkspaceFallback,
        });
      }

      return blockedRouting({
        input,
        code: "workspace_selection_ambiguous",
        reason: `workspace preference ${requestedRepoUrl} matches multiple workspaces`,
        requestedWorkspaceId,
        requestedRepoUrl,
        candidateWorkspaceIds,
        recovery: {
          action: "set_execution_workspace_id",
          summary: "set executionWorkspaceId to the intended workspace before retrying",
          targetWorkspaceId: null,
        },
      });
    }

    if (allowProjectWorkspaceFallback && projectWorkspace) {
      return selectedRouting({
        input,
        selected: projectWorkspace,
        bindingSource: "project_workspace_default",
        reasonForExclusion: "repo url does not match the issue workspace preference",
        allowProjectWorkspaceFallback,
      });
    }

    return blockedRouting({
      input,
      code: "workspace_repo_mismatch",
      reason: `workspace preference ${requestedRepoUrl} did not match any available workspace`,
      requestedWorkspaceId,
      requestedRepoUrl,
      candidateWorkspaceIds,
      recovery: {
        action: "fix_execution_workspace_preference",
        summary: "update executionWorkspacePreference.repoUrl or add the missing workspace before retrying",
        targetWorkspaceId: projectWorkspace?.workspaceId ?? null,
      },
    });
  }

  if (projectWorkspace) {
    return selectedRouting({
      input,
      selected: projectWorkspace,
      bindingSource: "project_workspace_default",
      reasonForExclusion: "project workspace default selected a different workspace",
      allowProjectWorkspaceFallback,
    });
  }

  if (candidates.length === 1) {
    return selectedRouting({
      input,
      selected: candidates[0],
      bindingSource: "single_candidate_default",
      reasonForExclusion: "workspace was not selected by the routing policy",
      allowProjectWorkspaceFallback,
    });
  }

  return blockedRouting({
    input,
    code: "workspace_selection_ambiguous",
    reason: "no execution workspace binding or project workspace default was available",
    requestedWorkspaceId,
    requestedRepoUrl,
    candidateWorkspaceIds,
    recovery: {
      action: "set_execution_workspace_id",
      summary: "set executionWorkspaceId or projectWorkspaceId before retrying",
      targetWorkspaceId: null,
    },
  });
}

function selectedRouting(input: {
  input: RouteExecutionWorkspaceInput;
  selected: ExecutionWorkspaceCandidate;
  bindingSource: ExecutionWorkspaceBindingRecord["bindingSource"];
  reasonForExclusion:
    | string
    | ((candidate: ExecutionWorkspaceCandidate) => string);
  allowProjectWorkspaceFallback: boolean;
}): SelectedExecutionWorkspaceRouting {
  return {
    status: "selected",
    binding: {
      issueId: input.input.issue.issueId,
      runId: input.input.runId,
      workspaceId: input.selected.workspaceId,
      workspaceRoot: input.selected.rootPath,
      repoUrl: input.selected.repoUrl,
      projectWorkspaceId: input.input.issue.projectWorkspaceId ?? null,
      boundAt: input.input.at,
      bindingSource: input.bindingSource,
      candidateWorkspaceIds: input.input.candidates.map((candidate) => candidate.workspaceId),
      preferenceSnapshot: {
        executionWorkspaceId: input.input.issue.executionWorkspaceId ?? null,
        repoUrl: input.input.issue.executionWorkspacePreference?.repoUrl ?? null,
        allowProjectWorkspaceFallback: input.allowProjectWorkspaceFallback,
      },
    },
    excluded: input.input.candidates
      .filter((candidate) => candidate.workspaceId !== input.selected.workspaceId)
      .map((candidate) => ({
        workspaceId: candidate.workspaceId,
        reason:
          typeof input.reasonForExclusion === "string"
            ? input.reasonForExclusion
            : input.reasonForExclusion(candidate),
      })),
  };
}

function blockedRouting(input: {
  input: RouteExecutionWorkspaceInput;
  code: BlockedExecutionWorkspaceRouting["code"];
  reason: string;
  candidateWorkspaceIds: string[];
  requestedWorkspaceId: string | null;
  requestedRepoUrl: string | null;
  recovery: ExecutionWorkspaceRecoveryPlan;
}): BlockedExecutionWorkspaceRouting {
  return {
    status: "blocked",
    code: input.code,
    issueId: input.input.issue.issueId,
    runId: input.input.runId,
    reason: input.reason,
    candidateWorkspaceIds: input.candidateWorkspaceIds,
    requestedWorkspaceId: input.requestedWorkspaceId,
    requestedRepoUrl: input.requestedRepoUrl,
    recovery: input.recovery,
  };
}

function repoUrlsMatch(left: string, right: string): boolean {
  return normalizeRepoUrl(left) === normalizeRepoUrl(right);
}

function normalizeRepoUrl(value: string): string {
  return value.trim().replace(/\.git$/u, "").toLowerCase();
}
