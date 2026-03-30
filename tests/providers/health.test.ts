import { describe, expect, it } from "vitest";

import { hasFreshHeartbeat } from "../../src/providers/health.js";

describe("provider heartbeat health", () => {
  it("returns false when no heartbeat is present", () => {
    expect(
      hasFreshHeartbeat(null, {
        now: new Date("2026-03-30T12:05:00Z"),
        maxStalenessMs: 60_000,
      }),
    ).toBe(false);
  });

  it("returns false for invalid heartbeat timestamps", () => {
    expect(
      hasFreshHeartbeat("not-a-date", {
        now: new Date("2026-03-30T12:05:00Z"),
        maxStalenessMs: 60_000,
      }),
    ).toBe(false);
  });

  it("uses the provided clock or the default clock when checking staleness", () => {
    expect(
      hasFreshHeartbeat("2026-03-30T12:04:30Z", {
        now: new Date("2026-03-30T12:05:00Z"),
        maxStalenessMs: 60_000,
      }),
    ).toBe(true);

    expect(
      hasFreshHeartbeat(new Date().toISOString(), {
        maxStalenessMs: 60_000,
      }),
    ).toBe(true);
  });
});
