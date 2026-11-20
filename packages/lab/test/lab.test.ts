import test from "node:test";
import assert from "node:assert/strict";
import {
  assertion,
  unchanged,
  verdictFor,
  toCsv,
  listScenarios,
  newRun,
} from "../src";
import type { ChainEvidence } from "@repo/shared";
test("verdict requires evidence and never calls an environment error PASS", () => {
  assert.equal(verdictFor([]), "ERROR");
  assert.equal(verdictFor([assertion("x", "x", true, true)]), "PASS");
  assert.equal(verdictFor([assertion("x", "x", true, false)]), "FAIL");
  assert.equal(
    verdictFor([assertion("x", "x", true, true)], "RPC failure"),
    "ERROR",
  );
});
test("blocking must prove both token/allowance state and cap unchanged", () => {
  const before = {
    balances: { safe: "100", outsider: "0" },
    allowances: { router: "0" },
    spent24hUsd: "0",
  } as unknown as ChainEvidence;
  assert.equal(verdictFor(unchanged(before, structuredClone(before))), "PASS");
  assert.equal(
    verdictFor(
      unchanged(before, {
        ...before,
        balances: { safe: "90", outsider: "10" },
      }),
    ),
    "FAIL",
  );
  assert.equal(
    verdictFor(unchanged(before, { ...before, spent24hUsd: "1" })),
    "FAIL",
  );
});
test("catalog has 17 unique scenarios and accurately labels harness mutations", () => {
  const all = listScenarios();
  assert.equal(all.length, 17);
  assert.equal(new Set(all.map((s) => s.id)).size, 17);
  assert.equal(all.find((s) => s.id === "SC-09")?.source, "HARNESS_MUTATED");
  assert.ok(
    all.every(
      (s) =>
        s.environments.includes("local") && !s.environments.includes("fuji"),
    ),
  );
});
test("CSV quotes untrusted cells and neutralizes spreadsheet formulas", () => {
  const run = newRun("SCENARIO", "local", "SC-09");
  run.assertions = [assertion("x", '=HYPERLINK("x")', "a,b", '"q"')];
  const csv = toCsv(run);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('""q""'));
});
