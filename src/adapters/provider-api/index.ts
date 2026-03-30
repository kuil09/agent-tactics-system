import type { TaskEnvelope } from "../../contracts/types.js";
import type { LoadedSkillContract, SkillLoader } from "../../skills/contracts.js";
import { loadRequiredSkills } from "../../skills/loader.js";
import type { MaterializedTaskInput, RepoAdapter } from "../repo/index.js";
import { materializeTaskInputs } from "../repo/index.js";

export interface ProviderExecutionRequest {
  envelope: TaskEnvelope;
  inputs: MaterializedTaskInput[];
  skills: LoadedSkillContract[];
  repo: RepoAdapter;
}

export interface ProviderExecutionResult {
  provider_id: string;
  model_id: string;
  summary: string;
}

export interface ProviderApiAdapter {
  provider_id: string;
  model_id: string;
  execute(
    request: ProviderExecutionRequest,
  ): Promise<ProviderExecutionResult> | ProviderExecutionResult;
}

export interface ExecuteTaskEnvelopeInput {
  envelope: TaskEnvelope;
  provider: ProviderApiAdapter;
  repo: RepoAdapter;
  skill_loader: SkillLoader;
  required_skill_ids?: string[];
}

export interface ExecutedTaskEnvelope {
  result: ProviderExecutionResult;
  inputs: MaterializedTaskInput[];
  skills: LoadedSkillContract[];
}

export async function executeTaskEnvelope(
  input: ExecuteTaskEnvelopeInput,
): Promise<ExecutedTaskEnvelope> {
  const inputs = await materializeTaskInputs(input.envelope, input.repo);
  const skillResolution = await loadRequiredSkills(
    input.skill_loader,
    input.required_skill_ids ?? [],
  );

  if (skillResolution.missing.length > 0) {
    throw new Error(
      `missing required skills: ${skillResolution.missing.join(", ")}`,
    );
  }

  const result = await input.provider.execute({
    envelope: input.envelope,
    inputs,
    skills: skillResolution.contracts,
    repo: input.repo,
  });

  return {
    result,
    inputs,
    skills: skillResolution.contracts,
  };
}
