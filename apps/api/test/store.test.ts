import test from "node:test";
import assert from "node:assert/strict";
import { newRun } from "@repo/lab";
import { Store } from "../src/db/store";
import { RunQueue } from "../src/worker/queue";
test("SQLite idempotency creates one run and rejects changed payload", () => {
  const store = new Store(":memory:");
  try {
    const run = newRun("SCENARIO", "local", "SC-01");
    assert.deepEqual(store.createRequest("same-key", "payload", [run]), [
      run.id,
    ]);
    assert.deepEqual(
      store.createRequest("same-key", "payload", [
        newRun("SCENARIO", "local", "SC-02"),
      ]),
      [run.id],
    );
    assert.equal(store.list().length, 1);
    assert.throws(
      () => store.createRequest("same-key", "changed", []),
      /nội dung khác/,
    );
  } finally {
    store.close();
  }
});
test("progress and normalized evidence are committed together", () => {
  const store = new Store(":memory:");
  try {
    const run = newRun("SCENARIO", "local", "SC-01");
    run.steps.push({
      id: "s",
      label: "Snapshot",
      timestamp: new Date().toISOString(),
    });
    run.assertions.push({
      id: "a",
      label: "No loss",
      expected: "10",
      observed: "10",
      passed: true,
    });
    store.save(run);
    assert.equal(store.get(run.id)?.assertions.length, 1);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM assertions WHERE run_id=?")
        .get(run.id)?.n,
      1,
    );
    store.save(run);
    assert.equal(
      store.db
        .prepare("SELECT count(*) n FROM run_steps WHERE run_id=?")
        .get(run.id)?.n,
      1,
    );
  } finally {
    store.close();
  }
});
test("chain lease excludes concurrent job or owner mutation", () => {
  const store = new Store(":memory:");
  try {
    assert.equal(store.lock("chain", "one"), true);
    assert.equal(store.lock("chain", "two"), false);
    store.unlock("chain", "two");
    assert.equal(store.lockOwner("chain"), "one");
    store.unlock("chain", "one");
    assert.equal(store.lock("chain", "two"), true);
  } finally {
    store.close();
  }
});
test("restart quarantines interrupted money movement instead of resending", async () => {
  const store = new Store(":memory:");
  const run = newRun("REBALANCE", "local");
  run.status = "RUNNING";
  store.save(run);
  store.lock("chain", run.id);
  let called = false;
  const queue = new RunQueue(store, () => {
    called = true;
    throw Error("Must not execute");
  });
  try {
    await queue.start();
    assert.equal(store.get(run.id)?.verdict, "ERROR");
    assert.equal(store.lockOwner("chain"), run.id);
    assert.equal(called, false);
  } finally {
    await queue.close();
    store.close();
  }
});
