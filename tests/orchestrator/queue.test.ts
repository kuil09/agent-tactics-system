import { describe, expect, it } from "vitest";

import { TurnQueue } from "../../src/orchestrator/queue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("turn queue", () => {
  it("tracks pending and in-flight writes while serializing execution", async () => {
    const queue = new TurnQueue();
    const gate = deferred();

    const first = queue.enqueueWrite(async () => {
      expect(queue.getStats()).toEqual({
        pending_writes: 1,
        in_flight_writes: 1,
      });

      await gate.promise;
      return "first";
    });

    const second = queue.enqueueWrite(async () => "second");

    expect(queue.getStats()).toEqual({
      pending_writes: 2,
      in_flight_writes: 0,
    });

    await Promise.resolve();

    expect(queue.getStats()).toEqual({
      pending_writes: 1,
      in_flight_writes: 1,
    });

    gate.resolve();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(queue.getStats()).toEqual({
      pending_writes: 0,
      in_flight_writes: 0,
    });
  });
});
