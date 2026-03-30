import { describe, expect, it } from "vitest";

import { SideEffectLevel } from "../../src/contracts/enums.js";
import {
  evaluateBrowserAccess,
  getBrowserSkillContract,
} from "../../src/policies/browser-skill-policy.js";

describe("browser skill policy", () => {
  it("rejects browser access without a named browser skill", () => {
    const decision = evaluateBrowserAccess({
      role: "engineer",
      target_url: "http://localhost:3000",
      action: "open_page",
      via_tool: "dev-browser",
      skill: null,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("named browser skill is required for browser access");
  });

  it("allows local browser testing when the named skill matches the target and action", () => {
    const decision = evaluateBrowserAccess({
      role: "engineer",
      target_url: "http://localhost:3000/dashboard",
      action: "assert_dom",
      via_tool: "dev-browser",
      skill: getBrowserSkillContract("browser-test-local"),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.matched_skill_id).toBe("browser-test-local");
  });

  it("rejects raw bash browser launches even when a browser skill is attached", () => {
    const decision = evaluateBrowserAccess({
      role: "engineer",
      target_url: "http://localhost:3000",
      action: "open_page",
      via_tool: "bash",
      skill: getBrowserSkillContract("browser-test-local"),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("raw browser launch via bash is a policy violation");
  });

  it("keeps the matched skill id null when bash access is attempted without a skill", () => {
    const decision = evaluateBrowserAccess({
      role: "engineer",
      target_url: "http://localhost:3000",
      action: "open_page",
      via_tool: "bash",
      skill: null,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.matched_skill_id).toBeNull();
  });

  it("rejects transactional browser skills in v1", () => {
    const decision = evaluateBrowserAccess({
      role: "operations",
      target_url: "https://approved-transactional.example/pay",
      action: "submit_transaction",
      via_tool: "dev-browser",
      skill: getBrowserSkillContract("browser-transactional"),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "transactional browser access requires a human gate and is disabled in v1",
    );
  });

  it("rejects unknown skill ids and accumulates policy violations", () => {
    const decision = evaluateBrowserAccess({
      role: "intern",
      target_url: "https://example.com/private",
      action: "fill_form",
      via_tool: "dev-browser",
      skill: {
        skill_id: "non-browser-skill",
        purpose: "Invalid browser contract",
        preconditions: [],
        allowed_roles: ["engineer"],
        allowed_targets: ["https://"],
        side_effect_level: SideEffectLevel.ReadOnly,
        requires_lock: false,
        verification_required: false,
        failure_recovery: [],
        url_allowlist: ["http://localhost"],
        auth_mode: "none",
        allowed_actions: ["open_page"],
        denied_actions: ["fill_form"],
        evidence_requirement: "n/a",
        budget_cap: {
          max_steps: 1,
          max_screenshots: 1,
        },
        escalate_on: [],
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("skill is not a recognized browser contract");
  });

  it("rejects role, action, denylist, and allowlist violations together", () => {
    const skill = getBrowserSkillContract("browser-research-internal-readonly");
    expect(skill).not.toBeNull();

    const decision = evaluateBrowserAccess({
      role: "researcher",
      target_url: "https://external.example.com",
      action: "fill_form",
      via_tool: "dev-browser",
      skill,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "role researcher is not allowed to use browser-research-internal-readonly",
    );
    expect(decision.reasons).toContain(
      "action fill_form is not permitted by browser-research-internal-readonly",
    );
    expect(decision.reasons).toContain(
      "action fill_form is explicitly denied by browser-research-internal-readonly",
    );
    expect(decision.reasons).toContain(
      "target https://external.example.com is outside the skill allowlist",
    );
  });

  it("returns contracts for public and internal browser skills", () => {
    const publicSkill = getBrowserSkillContract("browser-research-public");
    const internalSkill = getBrowserSkillContract("browser-research-internal-readonly");

    expect(publicSkill?.auth_mode).toBe("none");
    expect(internalSkill?.auth_mode).toBe("sso");
    expect(getBrowserSkillContract("missing-browser-skill")).toBeNull();
  });
});
