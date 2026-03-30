export interface QueueStats {
  pending_writes: number;
  in_flight_writes: number;
}

export class TurnQueue {
  private writeTail: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private inFlightWrites = 0;

  enqueueRead<T>(task: () => Promise<T> | T): Promise<T> {
    return Promise.resolve().then(task);
  }

  enqueueWrite<T>(task: () => Promise<T> | T): Promise<T> {
    this.pendingWrites += 1;

    const run = async () => {
      this.pendingWrites -= 1;
      this.inFlightWrites += 1;

      try {
        return await task();
      } finally {
        this.inFlightWrites -= 1;
      }
    };

    const result = this.writeTail.then(run, run);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  getStats(): QueueStats {
    return {
      pending_writes: this.pendingWrites,
      in_flight_writes: this.inFlightWrites,
    };
  }
}
