import { describe, expect, it } from "vitest";

import { routeExecutionWorkspace } from "../../src/control-plane/workspace-routing.js";

describe("routeExecutionWorkspace", () => {
  const candidates = [
    {
      workspaceId: "workspace-app",
      rootPath: "/tmp/workspaces/app",
      repoUrl: "https://github.com/kuil09/agent-tactics-system",
    },
    {
      workspaceId: "workspace-docs",
      rootPath: "/tmp/workspaces/docs",
      repoUrl: "https://github.com/kuil09/operator-playbooks",
    },
    {
      workspaceId: "workspace-app-shadow",
      rootPath: "/tmp/workspaces/app-shadow",
      repoUrl: "https://github.com/kuil09/agent-tactics-system",
    },
  ];

  it("selects the explicitly bound execution workspace", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-1",
        projectWorkspaceId: "workspace-app",
        executionWorkspaceId: "workspace-docs",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/operator-playbooks.git",
        },
      },
      runId: "run-1",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toMatchObject({
      status: "selected",
      binding: {
        issueId: "issue-1",
        runId: "run-1",
        workspaceId: "workspace-docs",
        workspaceRoot: "/tmp/workspaces/docs",
        repoUrl: "https://github.com/kuil09/operator-playbooks",
        bindingSource: "issue_execution_workspace",
      },
      excluded: [
        {
          workspaceId: "workspace-app",
          reason: "another workspace was explicitly bound on the issue",
        },
        {
          workspaceId: "workspace-app-shadow",
          reason: "another workspace was explicitly bound on the issue",
        },
      ],
    });
  });

  it("uses the project workspace to break a repo-match tie", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-2",
        projectWorkspaceId: "workspace-app",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/agent-tactics-system",
        },
      },
      runId: "run-2",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toMatchObject({
      status: "selected",
      binding: {
        workspaceId: "workspace-app",
        bindingSource: "project_workspace_default",
      },
      excluded: [
        {
          workspaceId: "workspace-docs",
          reason: "repo url does not match the issue workspace preference",
        },
        {
          workspaceId: "workspace-app-shadow",
          reason:
            "repo preference matched multiple workspaces, so the project workspace default broke the tie",
        },
      ],
    });
  });

  it("blocks when the explicit workspace binding is missing", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-3",
        projectWorkspaceId: "workspace-app",
        executionWorkspaceId: "workspace-missing",
      },
      runId: "run-3",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_missing",
      issueId: "issue-3",
      runId: "run-3",
      reason:
        "execution workspace workspace-missing is not available in the routed workspace set",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: "workspace-missing",
      requestedRepoUrl: null,
      recovery: {
        action: "restore_project_workspace",
        summary: "requeue on project workspace workspace-app",
        targetWorkspaceId: "workspace-app",
      },
    });
  });

  it("blocks with a direct reset action when the explicit workspace is missing and fallback is disabled", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-3b",
        executionWorkspaceId: "workspace-missing",
        executionWorkspaceSettings: {
          allowProjectWorkspaceFallback: false,
        },
      },
      runId: "run-3b",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_missing",
      issueId: "issue-3b",
      runId: "run-3b",
      reason:
        "execution workspace workspace-missing is not available in the routed workspace set",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: "workspace-missing",
      requestedRepoUrl: null,
      recovery: {
        action: "set_execution_workspace_id",
        summary: "set a valid execution workspace id before retrying the run",
        targetWorkspaceId: null,
      },
    });
  });

  it("keeps the project workspace as the recovery target when fallback is disabled", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-3c",
        projectWorkspaceId: "workspace-app",
        executionWorkspaceId: "workspace-missing",
        executionWorkspaceSettings: {
          allowProjectWorkspaceFallback: false,
        },
      },
      runId: "run-3c",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_missing",
      issueId: "issue-3c",
      runId: "run-3c",
      reason:
        "execution workspace workspace-missing is not available in the routed workspace set",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: "workspace-missing",
      requestedRepoUrl: null,
      recovery: {
        action: "set_execution_workspace_id",
        summary: "set a valid execution workspace id before retrying the run",
        targetWorkspaceId: "workspace-app",
      },
    });
  });

  it("blocks when repo preference is ambiguous without a project default", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-4",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/agent-tactics-system",
        },
        executionWorkspaceSettings: {
          allowProjectWorkspaceFallback: false,
        },
      },
      runId: "run-4",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_selection_ambiguous",
      issueId: "issue-4",
      runId: "run-4",
      reason:
        "workspace preference https://github.com/kuil09/agent-tactics-system matches multiple workspaces",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: null,
      requestedRepoUrl: "https://github.com/kuil09/agent-tactics-system",
      recovery: {
        action: "set_execution_workspace_id",
        summary: "set executionWorkspaceId to the intended workspace before retrying",
        targetWorkspaceId: null,
      },
    });
  });

  it("blocks when an explicit workspace conflicts with the repo preference", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-5",
        executionWorkspaceId: "workspace-docs",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/agent-tactics-system",
        },
      },
      runId: "run-5",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_repo_mismatch",
      issueId: "issue-5",
      runId: "run-5",
      reason:
        "execution workspace workspace-docs points to https://github.com/kuil09/operator-playbooks, not https://github.com/kuil09/agent-tactics-system",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: "workspace-docs",
      requestedRepoUrl: "https://github.com/kuil09/agent-tactics-system",
      recovery: {
        action: "fix_execution_workspace_preference",
        summary:
          "align executionWorkspaceId and executionWorkspacePreference.repoUrl before retrying",
        targetWorkspaceId: "workspace-docs",
      },
    });
  });

  it("falls back to the project workspace when the repo preference misses", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-6",
        projectWorkspaceId: "workspace-docs",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/nonexistent-repo",
        },
      },
      runId: "run-6",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toMatchObject({
      status: "selected",
      binding: {
        workspaceId: "workspace-docs",
        bindingSource: "project_workspace_default",
        preferenceSnapshot: {
          repoUrl: "https://github.com/kuil09/nonexistent-repo",
          allowProjectWorkspaceFallback: true,
        },
      },
      excluded: [
        {
          workspaceId: "workspace-app",
          reason: "repo url does not match the issue workspace preference",
        },
        {
          workspaceId: "workspace-app-shadow",
          reason: "repo url does not match the issue workspace preference",
        },
      ],
    });
  });

  it("blocks when repo preference misses and project fallback is disabled", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-7",
        projectWorkspaceId: "workspace-app",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/nonexistent-repo",
        },
        executionWorkspaceSettings: {
          allowProjectWorkspaceFallback: false,
        },
      },
      runId: "run-7",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_repo_mismatch",
      issueId: "issue-7",
      runId: "run-7",
      reason:
        "workspace preference https://github.com/kuil09/nonexistent-repo did not match any available workspace",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: null,
      requestedRepoUrl: "https://github.com/kuil09/nonexistent-repo",
      recovery: {
        action: "fix_execution_workspace_preference",
        summary:
          "update executionWorkspacePreference.repoUrl or add the missing workspace before retrying",
        targetWorkspaceId: "workspace-app",
      },
    });
  });

  it("blocks with a null recovery target when a repo preference misses without any project workspace", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-7b",
        executionWorkspacePreference: {
          repoUrl: "https://github.com/kuil09/nonexistent-repo",
        },
      },
      runId: "run-7b",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_repo_mismatch",
      issueId: "issue-7b",
      runId: "run-7b",
      reason:
        "workspace preference https://github.com/kuil09/nonexistent-repo did not match any available workspace",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: null,
      requestedRepoUrl: "https://github.com/kuil09/nonexistent-repo",
      recovery: {
        action: "fix_execution_workspace_preference",
        summary:
          "update executionWorkspacePreference.repoUrl or add the missing workspace before retrying",
        targetWorkspaceId: null,
      },
    });
  });

  it("uses the project workspace when no explicit binding or preference exists", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-8",
        projectWorkspaceId: "workspace-docs",
      },
      runId: "run-8",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toMatchObject({
      status: "selected",
      binding: {
        workspaceId: "workspace-docs",
        bindingSource: "project_workspace_default",
      },
      excluded: [
        {
          workspaceId: "workspace-app",
          reason: "project workspace default selected a different workspace",
        },
        {
          workspaceId: "workspace-app-shadow",
          reason: "project workspace default selected a different workspace",
        },
      ],
    });
  });

  it("treats an unknown project workspace id as unavailable", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-8b",
        projectWorkspaceId: "workspace-missing",
      },
      runId: "run-8b",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_selection_ambiguous",
      issueId: "issue-8b",
      runId: "run-8b",
      reason: "no execution workspace binding or project workspace default was available",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: null,
      requestedRepoUrl: null,
      recovery: {
        action: "set_execution_workspace_id",
        summary: "set executionWorkspaceId or projectWorkspaceId before retrying",
        targetWorkspaceId: null,
      },
    });
  });

  it("uses the sole candidate when only one workspace is available", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-9",
      },
      runId: "run-9",
      at: "2026-04-03T00:00:00Z",
      candidates: [candidates[0]],
    });

    expect(routed).toEqual({
      status: "selected",
      binding: {
        issueId: "issue-9",
        runId: "run-9",
        workspaceId: "workspace-app",
        workspaceRoot: "/tmp/workspaces/app",
        repoUrl: "https://github.com/kuil09/agent-tactics-system",
        projectWorkspaceId: null,
        boundAt: "2026-04-03T00:00:00Z",
        bindingSource: "single_candidate_default",
        candidateWorkspaceIds: ["workspace-app"],
        preferenceSnapshot: {
          executionWorkspaceId: null,
          repoUrl: null,
          allowProjectWorkspaceFallback: true,
        },
      },
      excluded: [],
    });
  });

  it("blocks when no preference, project default, or single candidate is available", () => {
    const routed = routeExecutionWorkspace({
      issue: {
        issueId: "issue-10",
      },
      runId: "run-10",
      at: "2026-04-03T00:00:00Z",
      candidates,
    });

    expect(routed).toEqual({
      status: "blocked",
      code: "workspace_selection_ambiguous",
      issueId: "issue-10",
      runId: "run-10",
      reason: "no execution workspace binding or project workspace default was available",
      candidateWorkspaceIds: [
        "workspace-app",
        "workspace-docs",
        "workspace-app-shadow",
      ],
      requestedWorkspaceId: null,
      requestedRepoUrl: null,
      recovery: {
        action: "set_execution_workspace_id",
        summary: "set executionWorkspaceId or projectWorkspaceId before retrying",
        targetWorkspaceId: null,
      },
    });
  });
});
