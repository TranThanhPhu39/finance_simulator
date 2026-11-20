import type {
  AssertionResult,
  ChainEvidence,
  RunResult,
  Verdict,
} from "@repo/shared";
export function assertion(
  id: string,
  label: string,
  expected: unknown,
  observed: unknown,
): AssertionResult {
  const normalize = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v);
  return {
    id,
    label,
    expected: normalize(expected),
    observed: normalize(observed),
    passed: normalize(expected) === normalize(observed),
  };
}
export function unchanged(
  before: ChainEvidence,
  after: ChainEvidence,
): AssertionResult[] {
  return [
    assertion(
      "balances",
      "Tài sản token và shares không đổi",
      before.balances,
      after.balances,
    ),
    assertion(
      "allowances",
      "Allowance không đổi",
      before.allowances,
      after.allowances,
    ),
    assertion(
      "spend",
      "Bộ đếm cap không đổi",
      before.spent24hUsd,
      after.spent24hUsd,
    ),
  ];
}
export function verdictFor(
  assertions: AssertionResult[],
  environmentError?: string,
): Verdict {
  if (environmentError || assertions.length === 0) return "ERROR";
  return assertions.every((a) => a.passed) ? "PASS" : "FAIL";
}
export function toCsv(run: RunResult): string {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const header = [
    "runId",
    "environment",
    "chainId",
    "scenario",
    "verdict",
    "recordType",
    "label",
    "expected",
    "observed",
    "passed",
  ];
  const base = [
    run.id,
    run.environment,
    run.chainId,
    run.scenarioId ?? run.kind,
    run.verdict ?? run.status,
  ];
  const rows: unknown[][] = [
    [...base, "RUN", "version", run.version, run.reason ?? "", run.status],
    [
      ...base,
      "POLICY",
      "policy snapshot",
      "",
      JSON.stringify(run.policy ?? {}),
      "",
    ],
    [
      ...base,
      "BEFORE",
      "chain state",
      "",
      JSON.stringify(run.before ?? {}),
      "",
    ],
    [...base, "AFTER", "chain state", "", JSON.stringify(run.after ?? {}), ""],
  ];
  rows.push(
    ...run.assertions.map((a) => [
      ...base,
      "ASSERTION",
      a.label,
      a.expected,
      a.observed,
      a.passed,
    ]),
  );
  rows.push(
    ...run.transactions.map((t) => [
      ...base,
      "TRANSACTION",
      t.label,
      t.expectedError ?? "",
      JSON.stringify(t),
      t.receiptStatus,
    ]),
  );
  rows.push(
    ...run.steps.map((s) => [...base, "STEP", s.label, "", s.timestamp, ""]),
  );
  return (
    [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
