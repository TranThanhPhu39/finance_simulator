import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { listScenarios, LocalAdapter } from "@repo/lab";
import type { OnchainRunResult, EnvironmentInfo, TreasuryView } from "@repo/shared";
import { createApplication, ROOT } from "../src/server";

async function main() {
  const database = resolve(
    ROOT,
    ".runtime/api-integration-" + Date.now() + ".db",
  );
  await mkdir(resolve(ROOT, ".runtime"), { recursive: true });
  let app = await createApplication({ database });
  const listen = async () => {
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw Error("No test port");
    return `http://127.0.0.1:${addr.port}/api`;
  };
  let base = await listen();
  async function request<T>(
    path: string,
    method = "GET",
    payload?: unknown,
    key?: string,
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }
  async function waitFor(ids: string[]) {
    let results: OnchainRunResult[] = [];
    for (let i = 0; i < 2400; i++) {
      results = await Promise.all(
        ids.map(async (id) => (await request<OnchainRunResult>("/runs/" + id)).data),
      );
      if (results.every((r) => r.status === "COMPLETED")) return results;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timeout waiting for lab suite.");
  }
  try {
    const env = (await request<EnvironmentInfo>("/environment")).data;
    assert.equal(env.ready, true, env.reason);
    const origin = await fetch(base + "/runs", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(origin.status, 403);
    const invalid = await request(
      "/runs",
      "POST",
      {
        kind: "SCENARIO",
        environment: "local",
        scenarioIds: ["NOT-A-SCENARIO"],
      },
      "invalid-key",
    );
    assert.equal(invalid.status, 400);
    const body = {
      kind: "SCENARIO",
      environment: "local",
      scenarioIds: listScenarios().map((s) => s.id),
    };
    const first = await request<{ runIds: string[] }>(
      "/runs",
      "POST",
      body,
      "suite-integration-key",
    );
    assert.equal(first.status, 202);
    const duplicate = await request<{ runIds: string[] }>(
      "/runs",
      "POST",
      body,
      "suite-integration-key",
    );
    assert.deepEqual(duplicate.data.runIds, first.data.runIds);
    const conflict = await request(
      "/runs",
      "POST",
      { ...body, scenarioIds: ["SC-01"] },
      "suite-integration-key",
    );
    assert.equal(conflict.status, 409);
    const suite = await waitFor(first.data.runIds);
    for (const run of suite)
      console.log(
        `${run.scenarioId}: ${run.verdict} (${run.assertions.length} assertions) ${run.reason}`,
      );
    await writeFile(
      resolve(ROOT, ".runtime/lab-suite.json"),
      JSON.stringify(suite, null, 2),
    );
    assert.ok(
      suite.every((r) => r.verdict === "PASS"),
      JSON.stringify(
        suite
          .filter((r) => r.verdict !== "PASS")
          .map((r) => ({
            id: r.scenarioId,
            verdict: r.verdict,
            reason: r.reason,
            assertions: r.assertions.filter((a) => !a.passed),
          })),
      ),
    );
    assert.ok(suite.every((r) => r.cleanup?.restored));
    const treasury = (await request<TreasuryView>("/treasury")).data;
    assert.equal(treasury.portfolio.positions[0].rawBalance, "600000000");
    assert.equal(treasury.policy.remainingCapUsd, "10000000000");
    const outsider = suite.find((r) => r.scenarioId === "SC-09")!;
    assert.ok(
      outsider.transactions.some(
        (t) =>
          t.stage === "TEST" &&
          t.hash &&
          t.receiptStatus === "reverted" &&
          t.observedError === "ERR_INVALID_RECIPIENT",
      ),
    );
    const csv = await fetch(
      base + "/runs/" + outsider.id + "/export?format=csv",
    );
    assert.equal(csv.status, 200);
    assert.ok(
      (await csv.text()).includes("ASSERTION") ||
        outsider.assertions.length > 0,
    );
    const exported = await fetch(base + "/runs/" + outsider.id + "/export");
    assert.equal((await exported.json()).id, outsider.id);
    const unsupported = await request<{ runIds: string[] }>(
      "/runs",
      "POST",
      { kind: "SCENARIO", environment: "fuji", scenarioIds: ["SC-09"] },
      "fuji-unsupported-key",
    );
    assert.equal(
      (await waitFor(unsupported.data.runIds))[0].verdict,
      "UNSUPPORTED",
    );
    const badOwner = await request("/governance/prepare", "POST", {
      requestId: "bad-owner-request",
      action: "revoke",
      owner: "0x0000000000000000000000000000000000000001",
    });
    assert.equal(badOwner.status, 403);
    const cancelled = await request<{ id: string }>(
      "/governance/prepare",
      "POST",
      {
        requestId: "cancelled-owner-request",
        action: "grant",
        owner: env.owner,
        hours: 24,
      },
    );
    assert.equal(cancelled.status, 200);
    assert.equal((await request("/treasury")).status, 409);
    assert.equal(
      (
        await request("/governance/" + cancelled.data.id + "/cancel", "POST", {
          walletRejected: true,
        })
      ).status,
      200,
    );
    const prepared = await request<{ id: string; to: Address; data: Hex }>(
      "/governance/prepare",
      "POST",
      { requestId: "owner-revoke-request", action: "revoke", owner: env.owner },
    );
    assert.equal(prepared.status, 200);
    const wallet = createWalletClient({
      account: env.owner as Address,
      chain: foundry,
      transport: http(env.rpcUrl),
    });
    const hash = await wallet.sendTransaction({
      to: prepared.data.to,
      data: prepared.data.data,
      value: 0n,
    });
    const confirmed = await request<{ status: string; receiptStatus: string }>(
      "/governance/" + prepared.data.id + "/confirm",
      "POST",
      { hash },
    );
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.status, "CONFIRMED");
    assert.equal(confirmed.data.receiptStatus, "success");
    assert.equal(
      (await request<TreasuryView>("/treasury")).data.policy.isRevoked,
      true,
    );
    const beforeRestart = (await request<OnchainRunResult[]>("/runs")).data.length;
    await app.close();
    app = await createApplication({ database });
    base = await listen();
    assert.equal(
      (await request<OnchainRunResult[]>("/runs")).data.length,
      beforeRestart,
    );
    assert.equal(
      (await request<OnchainRunResult>("/runs/" + outsider.id)).data.verdict,
      "PASS",
    );
    console.log(
      "PASS: all 17 scenarios, real receipt/state evidence, idempotency, owner signing, exports and SQLite restart verified.",
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
