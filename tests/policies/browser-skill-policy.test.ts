import { describe, expect, it } from "vitest";

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
});
