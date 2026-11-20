import { randomUUID } from "node:crypto";
import { LocalAdapter, runScenario, runRebalance } from "@repo/lab";
import type { RunResult } from "@repo/shared";
import { Store } from "../db/store";

export class RunQueue {
  private instance = randomUUID();
  private active?: Promise<void>;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    readonly store: Store,
    readonly adapter: () => LocalAdapter,
  ) {
    store.claimInstance(this.instance);
  }
  async start() {
    for (const run of this.store.running()) {
      run.status = "COMPLETED";
      run.verdict = "ERROR";
      run.reason = "API bị gián đoạn; không tự gửi lại giao dịch.";
      run.completedAt = new Date().toISOString();
      if (run.kind === "SCENARIO" && run.checkpoint?.snapshotId) {
        try {
          const adapter = await this.adapter().connect();
          if (
            run.addresses?.Safe.toLowerCase() !==
            adapter.addresses.Safe.toLowerCase()
          )
            throw new Error(
              "Deployment changed; refusing stale snapshot restore.",
            );
          const restored = await adapter.rpc<boolean>("evm_revert", [
            run.checkpoint.snapshotId,
          ]);
          run.cleanup = { restored };
          if (restored) this.store.unlock("chain", run.id);
        } catch (error) {
          run.cleanup = { restored: false, error: String(error) };
        }
      }
      this.store.save(run);
    }
    this.timer = setInterval(() => this.pump(), 500);
    this.timer.unref();
    this.pump();
  }
  pump() {
    if (this.closed || this.active) return;
    const run = this.store.queued()[0];
    if (!run || !this.store.lock("chain", run.id)) return;
    this.active = this.execute(run).finally(() => {
      this.active = undefined;
      this.pump();
    });
  }
  private async execute(run: RunResult) {
    try {
      if (run.kind === "SCENARIO")
        await runScenario(run, this.adapter(), (r) => this.store.save(r));
      else if (run.environment !== "local") {
        run.status = "COMPLETED";
        run.verdict = "UNSUPPORTED";
        run.reason = "Fuji chưa có signer/deployment được cấu hình.";
        run.completedAt = new Date().toISOString();
        this.store.save(run);
      } else
        await runRebalance(
          run,
          this.adapter(),
          run.targets ?? this.store.targets(),
          (r) => this.store.save(r),
        );
    } catch (error) {
      run.status = "COMPLETED";
      run.verdict = "ERROR";
      run.reason = String(error);
      run.completedAt = new Date().toISOString();
      this.store.save(run);
    } finally {
      // Keep chain quarantined after failed restore or an uncertain live submission.
      const uncertain = run.uncertainSubmission === true;
      if (run.cleanup?.restored !== false && !uncertain)
        this.store.unlock("chain", run.id);
    }
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
    this.store.unlock("instance", this.instance);
  }
}
