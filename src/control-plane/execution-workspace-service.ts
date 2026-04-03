import type {
  ExecutionWorkspaceRecoveryPlan,
  ExecutionWorkspaceRoutingResult,
} from "./workspace-routing.js";

export interface ExecutionWorkspaceRecord {
  id: string;
  companyId: string;
  projectId: string | null;
  name: string;
  rootPath: string;
  repoUrl: string;
  status: "ready" | "blocked";
  blockedReason: string | null;
  recoveryPlan: ExecutionWorkspaceRecoveryPlan | null;
  lastRouting: ExecutionWorkspaceRoutingResult | null;
  updatedAt: string;
}

export interface CreateExecutionWorkspaceInput extends ExecutionWorkspaceRecord {}

export interface UpdateExecutionWorkspaceInput {
  workspaceId: string;
  name?: string;
  rootPath?: string;
  repoUrl?: string;
  status?: "ready" | "blocked";
  blockedReason?: string | null;
  recoveryPlan?: ExecutionWorkspaceRecoveryPlan | null;
  lastRouting?: ExecutionWorkspaceRoutingResult | null;
  at: string;
}

export class InMemoryExecutionWorkspaceService {
  private readonly workspaces = new Map<string, ExecutionWorkspaceRecord>();

  createWorkspace(input: CreateExecutionWorkspaceInput): ExecutionWorkspaceRecord {
    const record = cloneWorkspace(input);
    this.workspaces.set(record.id, record);
    return cloneWorkspace(record);
  }

  listWorkspaces(companyId: string): ExecutionWorkspaceRecord[] {
    return [...this.workspaces.values()]
      .filter((workspace) => workspace.companyId === companyId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => cloneWorkspace(workspace));
  }

  listProjectWorkspaces(projectId: string): ExecutionWorkspaceRecord[] {
    return [...this.workspaces.values()]
      .filter((workspace) => workspace.projectId === projectId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((workspace) => cloneWorkspace(workspace));
  }

  getWorkspace(workspaceId: string): ExecutionWorkspaceRecord {
    return cloneWorkspace(this.requireWorkspace(workspaceId));
  }

  updateWorkspace(input: UpdateExecutionWorkspaceInput): ExecutionWorkspaceRecord {
    const workspace = this.requireWorkspace(input.workspaceId);
    workspace.name = input.name ?? workspace.name;
    workspace.rootPath = input.rootPath ?? workspace.rootPath;
    workspace.repoUrl = input.repoUrl ?? workspace.repoUrl;
    workspace.status = input.status ?? workspace.status;
    if (input.blockedReason !== undefined) {
      workspace.blockedReason = input.blockedReason;
    }
    if (input.recoveryPlan !== undefined) {
      workspace.recoveryPlan = input.recoveryPlan ? { ...input.recoveryPlan } : null;
    }
    if (input.lastRouting !== undefined) {
      workspace.lastRouting = input.lastRouting ? cloneRouting(input.lastRouting) : null;
    }
    workspace.updatedAt = input.at;
    return cloneWorkspace(workspace);
  }

  private requireWorkspace(workspaceId: string): ExecutionWorkspaceRecord {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`execution workspace ${workspaceId} not found`);
    }

    return workspace;
  }
}

function cloneWorkspace(record: ExecutionWorkspaceRecord): ExecutionWorkspaceRecord {
  return {
    ...record,
    recoveryPlan: record.recoveryPlan ? { ...record.recoveryPlan } : null,
    lastRouting: record.lastRouting ? cloneRouting(record.lastRouting) : null,
  };
}

function cloneRouting(
  routing: ExecutionWorkspaceRoutingResult,
): ExecutionWorkspaceRoutingResult {
  if (routing.status === "blocked") {
    return {
      ...routing,
      candidateWorkspaceIds: [...routing.candidateWorkspaceIds],
      recovery: { ...routing.recovery },
    };
  }

  return {
    ...routing,
    binding: {
      ...routing.binding,
      candidateWorkspaceIds: [...routing.binding.candidateWorkspaceIds],
      preferenceSnapshot: { ...routing.binding.preferenceSnapshot },
    },
    excluded: routing.excluded.map((entry) => ({ ...entry })),
  };
}
