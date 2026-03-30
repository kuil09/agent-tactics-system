import type { StatePatch } from "../contracts/types.js";
import type { CompletionVerificationInput } from "../contracts/types.js";
import {
  type AppliedStatePatch,
  type CanonicalState,
  type StateSnapshot,
  StateStore,
} from "./state-store.js";
import { TurnQueue } from "./queue.js";
import { planCompletionPromotion } from "../verifier/verify.js";

export interface ReadTurnContext<TState extends CanonicalState = CanonicalState> {
  getSnapshot: () => StateSnapshot<TState>;
}

export interface WriteTurnContext<TState extends CanonicalState = CanonicalState> {
  getSnapshot: () => StateSnapshot<TState>;
}

export interface CompletionPromotionInput extends CompletionVerificationInput {
  issue_id: string;
  actor_id: string;
  verified_patch_id: string;
  complete_patch_id: string;
}

export class TurnLoop<TState extends CanonicalState = CanonicalState> {
  constructor(
    private readonly stateStore: StateStore<TState> = new StateStore<TState>(),
    private readonly queue: TurnQueue = new TurnQueue(),
  ) {}

  runRead<T>(task: (context: ReadTurnContext<TState>) => Promise<T> | T): Promise<T> {
    return this.queue.enqueueRead(() =>
      task({
        getSnapshot: () => this.stateStore.getSnapshot(),
      }),
    );
  }

  runWrite<T>(
    task: (context: WriteTurnContext<TState>) => Promise<StatePatch> | StatePatch,
  ): Promise<AppliedStatePatch<TState>> {
    return this.queue.enqueueWrite(async () => {
      const patch = await task({
        getSnapshot: () => this.stateStore.getSnapshot(),
      });

      return this.stateStore.applyPatch(patch);
    });
  }

  runWritePatch(patch: StatePatch): Promise<AppliedStatePatch<TState>> {
    return this.queue.enqueueWrite(() => this.stateStore.applyPatch(patch));
  }

  promoteDoneCandidate(
    input: CompletionPromotionInput,
  ): Promise<{
    verified: AppliedStatePatch<TState>;
    completed: AppliedStatePatch<TState>;
  }> {
    return this.queue.enqueueWrite(async () => {
      const snapshot = this.stateStore.getSnapshot();
      const status = snapshot.state["status"];

      if (status !== "done_candidate") {
        throw new Error("only done_candidate state can be promoted");
      }

      const promotionPlan = planCompletionPromotion(input);
      const verified = this.stateStore.applyPatch({
        patch_id: input.verified_patch_id,
        issue_id: input.issue_id,
        actor_id: input.actor_id,
        base_state_version: snapshot.version,
        operations: promotionPlan.verified_operations,
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: snapshot.version,
      });

      const completed = this.stateStore.applyPatch({
        patch_id: input.complete_patch_id,
        issue_id: input.issue_id,
        actor_id: input.actor_id,
        base_state_version: verified.version,
        operations: promotionPlan.complete_operations,
        requires_lock: true,
        verifier_required: false,
        rollback_to_version: snapshot.version,
      });

      return { verified, completed };
    });
  }

  getSnapshot(): StateSnapshot<TState> {
    return this.stateStore.getSnapshot();
  }

  getQueueStats() {
    return this.queue.getStats();
  }
}
