import type { RunResult } from '@repo/shared';

function escapeCsvCell(value: string | number | boolean | undefined): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportRunAsJson(run: RunResult): string {
  return JSON.stringify(run, null, 2);
}

export function exportRunAsCsv(run: RunResult): string {
  const headers = [
    'runId',
    'scenarioId',
    'scenarioName',
    'env',
    'executionMode',
    'status',
    'verdict',
    'startedAt',
    'finishedAt',
    'spent24hBeforeUsd',
    'spent24hAfterUsd',
    'recordType',
    'indexOrName',
    'recordStatusOrPassed',
    'expectedOrBefore',
    'actualOrAfter',
    'errorCode',
    'txHash',
    'detail'
  ];

  const rows: string[][] = [headers];

  for (const step of run.steps) {
    rows.push([
      run.runId,
      run.scenarioId,
      run.scenarioName,
      run.env,
      run.executionMode,
      run.status,
      run.verdict,
      String(run.startedAt),
      String(run.finishedAt ?? ''),
      run.spent24hBeforeUsd,
      run.spent24hAfterUsd,
      'STEP',
      String(step.stepIndex),
      step.status,
      step.actionSource,
      step.label,
      step.errorCode ?? '',
      step.txHash ?? '',
      step.detail
    ]);
  }

  for (const assertion of run.assertions) {
    rows.push([
      run.runId,
      run.scenarioId,
      run.scenarioName,
      run.env,
      run.executionMode,
      run.status,
      run.verdict,
      String(run.startedAt),
      String(run.finishedAt ?? ''),
      run.spent24hBeforeUsd,
      run.spent24hAfterUsd,
      'ASSERTION',
      assertion.name,
      assertion.passed ? 'PASS' : 'FAIL',
      assertion.expected,
      assertion.actual,
      '',
      '',
      ''
    ]);
  }

  for (const diff of run.balanceDiffs) {
    rows.push([
      run.runId,
      run.scenarioId,
      run.scenarioName,
      run.env,
      run.executionMode,
      run.status,
      run.verdict,
      String(run.startedAt),
      String(run.finishedAt ?? ''),
      run.spent24hBeforeUsd,
      run.spent24hAfterUsd,
      'BALANCE_DIFF',
      diff.symbol,
      diff.beforeRaw === diff.afterRaw ? 'UNCHANGED' : 'CHANGED',
      diff.beforeRaw,
      diff.afterRaw,
      '',
      '',
      diff.tokenAddress
    ]);
  }

  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
}
