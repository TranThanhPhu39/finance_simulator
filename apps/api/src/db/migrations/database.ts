import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore - Built-in module in Node >= 22.5 / Node 24
import { DatabaseSync } from 'node:sqlite';
import type { PaperTradeAction, RegisteredAgent, RunResult } from '@repo/shared';

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export class ApiDatabase {
  public db: SqliteDatabase;

  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath) as SqliteDatabase;
    this.migrate();
  }

  public close(): void { this.db.close(); }

  public migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        scenario_name TEXT NOT NULL,
        env TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        verdict TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        spent_before_usd TEXT NOT NULL,
        spent_after_usd TEXT NOT NULL,
        explanation TEXT NOT NULL,
        error_message TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        action_source TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        error_code TEXT,
        detail TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assertions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        name TEXT NOT NULL,
        passed INTEGER NOT NULL,
        expected TEXT NOT NULL,
        actual TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transaction_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        token_address TEXT NOT NULL,
        before_raw TEXT NOT NULL,
        after_raw TEXT NOT NULL,
        before_usd TEXT NOT NULL,
        after_usd TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS launchpad_agents (
        agent_id TEXT PRIMARY KEY,
        erc8004_id TEXT NOT NULL,
        name TEXT NOT NULL,
        strategy_type TEXT NOT NULL,
        bond_usdc TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS launchpad_actions (
        action_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        notional_usd TEXT NOT NULL,
        price_usd TEXT NOT NULL,
        proof_hash TEXT NOT NULL,
        compliant INTEGER NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  public saveRun(run: RunResult): void {
    const upsertRun = this.db.prepare(`
      INSERT OR REPLACE INTO runs (
        run_id, scenario_id, scenario_name, env, execution_mode, status, verdict,
        started_at, finished_at, spent_before_usd, spent_after_usd, explanation, error_message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    upsertRun.run(
      run.runId,
      run.scenarioId,
      run.scenarioName,
      run.env,
      run.executionMode,
      run.status,
      run.verdict,
      run.startedAt,
      run.finishedAt ?? null,
      run.spent24hBeforeUsd,
      run.spent24hAfterUsd,
      run.explanation,
      run.errorMessage ?? null,
      JSON.stringify(run)
    );

    this.db.prepare('DELETE FROM run_steps WHERE run_id = ?').run(run.runId);
    const insertStep = this.db.prepare(`
      INSERT INTO run_steps (run_id, step_index, label, action_source, status, tx_hash, error_code, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of run.steps) {
      insertStep.run(
        run.runId,
        s.stepIndex,
        s.label,
        s.actionSource,
        s.status,
        s.txHash ?? null,
        s.errorCode ?? null,
        s.detail
      );
    }

    this.db.prepare('DELETE FROM assertions WHERE run_id = ?').run(run.runId);
    const insertAssertion = this.db.prepare(`
      INSERT INTO assertions (run_id, name, passed, expected, actual)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const a of run.assertions) {
      insertAssertion.run(run.runId, a.name, a.passed ? 1 : 0, a.expected, a.actual);
    }

    this.db.prepare('DELETE FROM transaction_evidence WHERE run_id = ?').run(run.runId);
    const insertDiff = this.db.prepare(`
      INSERT INTO transaction_evidence (run_id, symbol, token_address, before_raw, after_raw, before_usd, after_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of run.balanceDiffs) {
      insertDiff.run(run.runId, b.symbol, b.tokenAddress, b.beforeRaw, b.afterRaw, b.beforeUsd, b.afterUsd);
    }
  }

  public getRun(runId: string): RunResult | undefined {
    const row = this.db.prepare('SELECT payload_json FROM runs WHERE run_id = ?').get(runId) as
      | { payload_json: string }
      | undefined;
    return row ? (JSON.parse(row.payload_json) as RunResult) : undefined;
  }

  public listRuns(limit = 50): RunResult[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Array<{ payload_json: string }>;
    return rows.map(r => JSON.parse(r.payload_json) as RunResult);
  }

  public saveAgent(agent: RegisteredAgent): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO launchpad_agents (
          agent_id, erc8004_id, name, strategy_type, bond_usdc, status, created_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        agent.agentId,
        agent.erc8004Id,
        agent.name,
        agent.strategyType,
        agent.bondUsdc,
        agent.status,
        agent.createdAt,
        JSON.stringify(agent)
      );
  }

  public listAgents(): RegisteredAgent[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM launchpad_agents ORDER BY created_at ASC')
      .all() as Array<{ payload_json: string }>;
    return rows.map(r => JSON.parse(r.payload_json) as RegisteredAgent);
  }

  public savePaperAction(action: PaperTradeAction): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO launchpad_actions (
          action_id, agent_id, timestamp, symbol, side, notional_usd, price_usd, proof_hash, compliant, reason, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        action.actionId,
        action.agentId,
        action.timestamp,
        action.symbol,
        action.side,
        action.notionalUsd,
        action.priceUsd,
        action.proofHash,
        action.compliant ? 1 : 0,
        action.reason,
        JSON.stringify(action)
      );
  }

  public listPaperActions(agentId?: string): PaperTradeAction[] {
    if (agentId) {
      const rows = this.db
        .prepare('SELECT payload_json FROM launchpad_actions WHERE agent_id = ? ORDER BY timestamp DESC, rowid DESC')
        .all(agentId) as Array<{ payload_json: string }>;
      return rows.map(r => JSON.parse(r.payload_json) as PaperTradeAction);
    }
    const rows = this.db
      .prepare('SELECT payload_json FROM launchpad_actions ORDER BY timestamp DESC, rowid DESC')
      .all() as Array<{ payload_json: string }>;
    return rows.map(r => JSON.parse(r.payload_json) as PaperTradeAction);
  }
}
