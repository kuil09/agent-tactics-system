import type { SkillContract } from "../contracts/types.js";

export interface LoadedSkillContract {
  contract: SkillContract;
  source: string;
}

export interface SkillLoader {
  load(skillId: string): Promise<LoadedSkillContract | null> | LoadedSkillContract | null;
}

export interface SkillResolutionResult {
  contracts: LoadedSkillContract[];
  missing: string[];
}
