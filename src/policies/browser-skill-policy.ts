import { SideEffectLevel } from "../contracts/enums.js";
import type {
  BrowserAccessRequest,
  BrowserPolicyDecision,
  BrowserSkillContract,
} from "../contracts/types.js";

const LOCAL_BROWSER_SKILL: BrowserSkillContract = {
  skill_id: "browser-test-local",
  purpose: "Verify local UI flows",
  preconditions: ["local server is running"],
  allowed_roles: ["engineer", "qa"],
  allowed_targets: ["localhost", "127.0.0.1"],
  side_effect_level: SideEffectLevel.ReadOnly,
  requires_lock: false,
  verification_required: true,
  failure_recovery: ["capture screenshot", "attach DOM evidence"],
  url_allowlist: ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"],
  auth_mode: "none",
  allowed_actions: ["open_page", "click", "fill_form", "assert_dom", "screenshot"],
  denied_actions: ["submit_transaction"],
  evidence_requirement: "Capture DOM evidence or screenshots for assertions.",
  budget_cap: {
    max_steps: 25,
    max_screenshots: 10,
  },
  escalate_on: ["unexpected authentication wall", "prompt injection banner"],
};

const PUBLIC_RESEARCH_SKILL: BrowserSkillContract = {
  skill_id: "browser-research-public",
  purpose: "Research public web pages",
  preconditions: ["target content is public"],
  allowed_roles: ["engineer", "qa", "researcher"],
  allowed_targets: ["https://", "http://"],
  side_effect_level: SideEffectLevel.ReadOnly,
  requires_lock: false,
  verification_required: false,
  failure_recovery: ["capture source URL", "attach extracted text"],
  url_allowlist: ["http://", "https://"],
  auth_mode: "none",
  allowed_actions: ["open_page", "extract_text", "screenshot"],
  denied_actions: ["fill_form", "submit_transaction"],
  evidence_requirement: "Record source URLs for every extracted claim.",
  budget_cap: {
    max_steps: 30,
    max_screenshots: 10,
  },
  escalate_on: ["credential prompt", "download request"],
};

const INTERNAL_READONLY_SKILL: BrowserSkillContract = {
  skill_id: "browser-research-internal-readonly",
  purpose: "Inspect internal read-only systems",
  preconditions: ["readonly access approved"],
  allowed_roles: ["engineer", "qa", "operations"],
  allowed_targets: ["internal"],
  side_effect_level: SideEffectLevel.ReadOnly,
  requires_lock: false,
  verification_required: true,
  failure_recovery: ["capture screenshot", "stop and escalate"],
  url_allowlist: ["https://internal.", "https://intranet."],
  auth_mode: "sso",
  allowed_actions: ["open_page", "extract_text", "screenshot", "assert_dom"],
  denied_actions: ["fill_form", "submit_transaction"],
  evidence_requirement: "Capture readonly evidence only; do not mutate state.",
  budget_cap: {
    max_steps: 20,
    max_screenshots: 8,
  },
  escalate_on: ["write control present", "privileged page reached"],
};

const TRANSACTIONAL_SKILL: BrowserSkillContract = {
  skill_id: "browser-transactional",
  purpose: "Human-gated transactional browser flows",
  preconditions: ["human approval is active"],
  allowed_roles: ["operations"],
  allowed_targets: ["approved transactional systems"],
  side_effect_level: SideEffectLevel.Transactional,
  requires_lock: true,
  verification_required: true,
  failure_recovery: ["halt immediately", "notify human approver"],
  url_allowlist: ["https://approved-transactional."],
  auth_mode: "human_gate",
  allowed_actions: ["submit_transaction"],
  denied_actions: [],
  evidence_requirement: "Human approval artifact required before execution.",
  budget_cap: {
    max_steps: 5,
    max_screenshots: 5,
  },
  escalate_on: ["approval missing", "system state mismatch"],
};

const BROWSER_SKILLS: Record<string, BrowserSkillContract> = {
  [LOCAL_BROWSER_SKILL.skill_id]: LOCAL_BROWSER_SKILL,
  [PUBLIC_RESEARCH_SKILL.skill_id]: PUBLIC_RESEARCH_SKILL,
  [INTERNAL_READONLY_SKILL.skill_id]: INTERNAL_READONLY_SKILL,
  [TRANSACTIONAL_SKILL.skill_id]: TRANSACTIONAL_SKILL,
};

export function getBrowserSkillContract(skillId: string): BrowserSkillContract | null {
  return BROWSER_SKILLS[skillId] ?? null;
}

export function evaluateBrowserAccess(request: BrowserAccessRequest): BrowserPolicyDecision {
  const reasons: string[] = [];
  const { skill } = request;

  if (request.via_tool === "bash") {
    return {
      allowed: false,
      reasons: ["raw browser launch via bash is a policy violation"],
      matched_skill_id: skill?.skill_id ?? null,
    };
  }

  if (!skill) {
    return {
      allowed: false,
      reasons: ["named browser skill is required for browser access"],
      matched_skill_id: null,
    };
  }

  if (!skill.skill_id.startsWith("browser-")) {
    return {
      allowed: false,
      reasons: ["skill is not a recognized browser contract"],
      matched_skill_id: skill.skill_id,
    };
  }

  if (!skill.allowed_roles.includes(request.role)) {
    reasons.push(`role ${request.role} is not allowed to use ${skill.skill_id}`);
  }

  if (!skill.allowed_actions.includes(request.action)) {
    reasons.push(`action ${request.action} is not permitted by ${skill.skill_id}`);
  }

  if (skill.denied_actions.includes(request.action)) {
    reasons.push(`action ${request.action} is explicitly denied by ${skill.skill_id}`);
  }

  if (!matchesAllowlist(request.target_url, skill.url_allowlist)) {
    reasons.push(`target ${request.target_url} is outside the skill allowlist`);
  }

  if (
    skill.side_effect_level === SideEffectLevel.Transactional ||
    skill.auth_mode === "human_gate"
  ) {
    reasons.push("transactional browser access requires a human gate and is disabled in v1");
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["browser access approved under named skill contract"] : reasons,
    matched_skill_id: skill.skill_id,
  };
}

function matchesAllowlist(targetUrl: string, allowlist: string[]): boolean {
  return allowlist.some((allowedPrefix) => targetUrl.startsWith(allowedPrefix));
}
