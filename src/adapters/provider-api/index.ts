import { ProviderKind } from "../../contracts/enums.js";
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

export interface ProviderHandshakeContext {
  scenario?: string;
  workspace_root?: string;
  artifact_dir?: string;
}

export interface ProviderHandshakeResult {
  provider_id: string;
  provider_kind: ProviderKind;
  model_id: string;
  protocol_version: string;
  summary: string;
  metadata?: Record<string, string>;
}

export interface ProviderModuleExecutionRequest extends ProviderExecutionRequest {
  handshake: ProviderHandshakeResult;
}

export interface ProviderApiModule {
  handshake(
    context: ProviderHandshakeContext,
  ): Promise<ProviderHandshakeResult> | ProviderHandshakeResult;
  execute(
    request: ProviderModuleExecutionRequest,
  ): Promise<ProviderExecutionResult> | ProviderExecutionResult;
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

export interface ConnectedProviderApiAdapter extends ProviderApiAdapter {
  provider_kind: ProviderKind;
  handshake: ProviderHandshakeResult;
}

export async function connectProviderApiAdapter(input: {
  module: ProviderApiModule;
  context?: ProviderHandshakeContext;
}): Promise<ConnectedProviderApiAdapter> {
  const handshake = await input.module.handshake(input.context ?? {});

  if (
    handshake.provider_id.length === 0 ||
    handshake.model_id.length === 0 ||
    handshake.protocol_version.length === 0
  ) {
    throw new Error(
      "provider handshake must include provider_id, model_id, and protocol_version",
    );
  }

  return {
    provider_id: handshake.provider_id,
    provider_kind: handshake.provider_kind,
    model_id: handshake.model_id,
    handshake,
    execute(request) {
      return input.module.execute({
        ...request,
        handshake,
      });
    },
  };
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
