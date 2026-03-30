import type { SkillContract } from "../contracts/types.js";
import type {
  LoadedSkillContract,
  SkillLoader,
  SkillResolutionResult,
} from "./contracts.js";

export class StaticSkillLoader implements SkillLoader {
  private readonly registry: Map<string, LoadedSkillContract>;

  constructor(
    entries: Iterable<LoadedSkillContract | { contract: SkillContract; source?: string }>,
  ) {
    this.registry = new Map();

    for (const entry of entries) {
      const loaded: LoadedSkillContract = {
        contract: entry.contract,
        source: entry.source ?? "static",
      };

      this.registry.set(loaded.contract.skill_id, loaded);
    }
  }

  load(skillId: string): LoadedSkillContract | null {
    return this.registry.get(skillId) ?? null;
  }
}

export async function loadRequiredSkills(
  loader: SkillLoader,
  skillIds: string[],
): Promise<SkillResolutionResult> {
  const contracts: LoadedSkillContract[] = [];
  const missing: string[] = [];

  for (const skillId of new Set(skillIds)) {
    const loaded = await loader.load(skillId);

    if (!loaded) {
      missing.push(skillId);
      continue;
    }

    contracts.push(loaded);
  }

  return {
    contracts,
    missing,
  };
}
