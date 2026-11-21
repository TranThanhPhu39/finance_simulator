import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/server";
test("integrated API isolates simulator runs from real receipts and enforces shared origin policy", async () => {
  const app = await createApplication({
    database: ":memory:",
    simulationDatabase: ":memory:",
    metadata: ".runtime/missing-integration-metadata.json",
  });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const address = app.server.address();
  const base =
    "http://127.0.0.1:" +
    (typeof address === "object" && address ? address.port : 0);
  try {
    const sim = await (
      await fetch(base + "/api/simulation/environment")
    ).json();
    assert.equal(sim.executionMode, "SIMULATED_POLICY");
    const simScenarios = await (
      await fetch(base + "/api/simulation/scenarios")
    ).json();
    assert.equal(simScenarios.length, 10);
    const chainScenarios = await (await fetch(base + "/api/scenarios")).json();
    assert.equal(chainScenarios.length, 17);
    const response = await fetch(base + "/api/simulation/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: "SC-03" }),
    });
    assert.equal(response.status, 200);
    const { run } = await response.json();
    assert.equal(run.executionMode, "SIMULATED_POLICY");
    assert.equal(run.verdict, "PASS");
    assert.ok(run.steps.every((s: { txHash?: string }) => !s.txHash));
    assert.equal((await (await fetch(base + "/api/runs")).json()).length, 0);
    const invalid = await fetch(base + "/api/simulation/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: "SC-03",
        executionMode: "ONCHAIN_RPC",
      }),
    });
    assert.equal(invalid.status, 400);
    const origin = await fetch(base + "/api/simulation/treasury", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(origin.status, 403);
    const malformed = await fetch(base + "/api/simulation/runs", {
      method: "POST",
      body: "{",
    });
    assert.equal(malformed.status, 400);
  } finally {
    await app.close();
  }
});
