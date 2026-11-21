import { randomUUID } from "node:crypto";
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { PlanExecutor } from "@repo/agent";
import { POLICY_ABI } from "@repo/chain-client";
import {
  ErrorCode,
  type OnchainRunResult,
  type TransactionEvidence,
  type NetworkEnv,
} from "@repo/shared";
import { assertion, unchanged, verdictFor } from "./assertions";
import { scenarios } from "./scenarios/catalog";
import {
  LocalAdapter,
  ORACLE_ABI,
  ROUTER_ABI,
  VAULT_ABI,
} from "./adapters/local";

export const VERSION = "lab-1.0.0";
type Update = (run: OnchainRunResult) => void;
export function newRun(
  kind: OnchainRunResult["kind"],
  environment: NetworkEnv,
  scenarioId?: string,
): OnchainRunResult {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (kind === "SCENARIO" && !scenario) throw new Error("Unknown scenario.");
  return {
    id: randomUUID(),
    kind,
    scenarioId,
    scenarioVersion: scenario?.version,
    version: VERSION,
    environment,
    chainId: environment === "local" ? 31337 : 43113,
    simulatedYield: true,
    status: "QUEUED",
    source: scenario?.source ?? "AGENT_RULE",
    createdAt: new Date().toISOString(),
    steps: [],
    assertions: [],
    transactions: [],
  };
}
function progress(run: OnchainRunResult, label: string, update: Update) {
  run.steps.push({
    id: randomUUID(),
    label,
    timestamp: new Date().toISOString(),
  });
  update(run);
}
async function captureAgentTransactions(
  adapter: LocalAdapter,
  run: OnchainRunResult,
  execution: Awaited<ReturnType<PlanExecutor["execute"]>>,
  update: Update,
) {
  for (const step of execution.steps) {
    if (!step.hash || !step.transaction) continue;
    const receipt = await adapter.client.publicClient.getTransactionReceipt({
      hash: step.hash,
    });
    run.transactions.push({
      label: `Agent step ${step.stepIndex + 1}`,
      stage: "TEST",
      source: "AGENT_RULE",
      from: adapter.session,
      to: step.transaction.to,
      data: step.transaction.data,
      hash: step.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      receiptStatus: receipt.status,
    });
  }
  run.assertions.push(
    assertion(
      "agent-completed",
      "Agent hoàn tất các bước",
      "COMPLETED",
      execution.status,
    ),
  );
  if (execution.status === "PENDING") {
    run.uncertainSubmission = true;
    throw new Error(
      "Giao dịch chưa rõ kết quả; giữ hash và kiểm tra lại, không tự gửi lại.",
    );
  }
  update(run);
}
async function assertAssetEffects(adapter: LocalAdapter, run: OnchainRunResult) {
  if (!run.before || !run.after) throw new Error("Missing balance evidence.");
  const expected = {
    safeUsdc: BigInt(run.before.balances.safeUsdc),
    safeTokenA: BigInt(run.before.balances.safeTokenA),
    safeVaultShares: BigInt(run.before.balances.safeVaultShares),
  };
  for (const tx of run.transactions.filter(
    (t) => t.stage === "TEST" && t.receiptStatus === "success" && t.hash,
  )) {
    const receipt = await adapter.client.publicClient.getTransactionReceipt({
      hash: tx.hash as Hex,
    });
    for (const log of receipt.logs.filter(
      (l) =>
        l.address.toLowerCase() ===
        adapter.addresses.PolicyModule.toLowerCase(),
    )) {
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: POLICY_ABI,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }
      const args = decoded.args as unknown as Record<string, unknown>;
      if (decoded.eventName === "SwapExecuted") {
        const input =
          String(args.tokenIn).toLowerCase() ===
          adapter.addresses.MockUSDC.toLowerCase()
            ? "safeUsdc"
            : "safeTokenA";
        const output =
          String(args.tokenOut).toLowerCase() ===
          adapter.addresses.MockUSDC.toLowerCase()
            ? "safeUsdc"
            : "safeTokenA";
        expected[input] -= BigInt(String(args.amountIn));
        expected[output] += BigInt(String(args.amountOut));
      } else if (decoded.eventName === "VaultDeposited") {
        expected.safeUsdc -= BigInt(String(args.assets));
        expected.safeVaultShares += BigInt(String(args.shares));
      } else if (decoded.eventName === "VaultWithdrawn") {
        expected.safeUsdc += BigInt(String(args.assets));
        expected.safeVaultShares -= BigInt(String(args.shares));
      }
    }
  }
  for (const [key, value] of Object.entries(expected))
    run.assertions.push(
      assertion(
        `effect-${key}`,
        `${key}: số dư khớp giao dịch`,
        value.toString(),
        run.after.balances[key],
      ),
    );
  for (const key of ["outsiderUsdc", "outsiderTokenA", "outsiderVaultShares"])
    run.assertions.push(
      assertion(
        `recipient-${key}`,
        "Ví lạ không nhận tài sản",
        run.before.balances[key],
        run.after.balances[key],
      ),
    );
  run.assertions.push(
    assertion(
      "allowances-zero",
      "Allowance router/vault bằng 0",
      true,
      Object.values(run.after.allowances).every((v) => v === "0"),
    ),
  );
}

export async function runScenario(
  run: OnchainRunResult,
  adapter: LocalAdapter,
  update: Update = () => {},
): Promise<OnchainRunResult> {
  const scenario = scenarios.find((s) => s.id === run.scenarioId);
  if (!scenario) throw new Error("Unknown scenario.");
  run.status = "RUNNING";
  run.startedAt = new Date().toISOString();
  update(run);
  if (!scenario.environments.includes(run.environment)) {
    run.status = "COMPLETED";
    run.verdict = "UNSUPPORTED";
    run.reason =
      "Tình huống cần reset/owner setup của Anvil; không chạy trên Fuji.";
    run.completedAt = new Date().toISOString();
    update(run);
    return run;
  }
  let snapshot: string | undefined;
  let environmentError: string | undefined;
  try {
    await adapter.connect();
    run.addresses = adapter.addresses;
    adapter.resetEvidence(scenario.source, (tx) => {
      run.transactions.push(tx);
      update(run);
    });
    snapshot = await adapter.rpc<string>("evm_snapshot");
    run.checkpoint = { snapshotId: snapshot };
    update(run);
    progress(run, "Chuẩn bị trạng thái độc lập trên Anvil", update);
    await adapter.setup();
    const a = adapter.addresses;
    if (scenario.id === "SC-10") {
      const expires =
        (await adapter.client.publicClient.getBlock()).timestamp + 5n;
      await adapter.govern("grantSession", [adapter.session, expires]);
      await adapter.rpc("evm_setNextBlockTimestamp", [Number(expires)]);
      await adapter.rpc("evm_mine");
    }
    if (scenario.id === "SC-11")
      await adapter.govern("revokeSession", [adapter.session]);
    if (scenario.id === "SC-13") {
      const now = (await adapter.client.publicClient.getBlock()).timestamp;
      await adapter.send(
        "Stale mock price",
        adapter.owner,
        a.MockPriceOracle,
        encodeFunctionData({
          abi: ORACLE_ABI,
          functionName: "setPriceWithTimestamp",
          args: [a.MockUSDC, 100000000n, now - 3601n],
        }),
      );
    }
    if (scenario.id === "SC-15")
      await adapter.send(
        "Router failure enabled",
        adapter.owner,
        a.MockRouter,
        encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: "setShouldFail",
          args: [true],
        }),
      );
    if (scenario.id === "SC-17") {
      await adapter.send(
        "Accrue mock yield",
        adapter.owner,
        a.MockVault4626,
        encodeFunctionData({ abi: VAULT_ABI, functionName: "accrueYield" }),
      );
      const shares = await adapter.client.publicClient.readContract({
        address: a.MockVault4626,
        abi: VAULT_ABI,
        functionName: "convertToShares",
        args: [100000000n],
      });
      await adapter.send(
        "Seed vault position",
        adapter.session,
        a.PolicyModule,
        encodeFunctionData({
          abi: POLICY_ABI,
          functionName: "executeVaultDeposit",
          args: [
            {
              vault: a.MockVault4626,
              assets: 100000000n,
              minShares: (shares * 99n) / 100n,
              recipient: a.Safe,
              deadline:
                (await adapter.client.publicClient.getBlock()).timestamp +
                3600n,
            },
          ],
        }),
      );
    }
    run.before = await adapter.capture();
    run.policy = await adapter.client.readPolicyConfig(
      a.PolicyModule,
      adapter.session,
      {
        tokens: [a.MockUSDC, a.MockTokenA],
        routers: [a.MockRouter],
        vaults: [a.MockVault4626],
      },
      BigInt(run.before.blockNumber),
    );
    adapter.stage = "TEST";
    progress(run, "Chạy tình huống và ghi bằng chứng giao dịch", update);
    const expectTx = (tx: TransactionEvidence, expectedError?: ErrorCode) => {
      run.assertions.push(
        assertion(
          `receipt-${run.assertions.length}`,
          tx.label + ": receipt",
          expectedError ? "reverted" : "success",
          tx.receiptStatus,
        ),
      );
      if (expectedError)
        run.assertions.push(
          assertion(
            `revert-${run.assertions.length}`,
            tx.label + ": đúng lỗi policy (preflight)",
            expectedError,
            tx.observedError ?? "NO_REVERT",
          ),
        );
    };
    switch (scenario.id) {
      case "SC-01": {
        const view = await adapter.treasury();
        const targets = view.portfolio.positions.map((p) => p.currentBps);
        targets[targets.length - 1] +=
          10000 - targets.reduce((s, n) => s + n, 0);
        const preview = await adapter.preview(targets);
        run.plan = preview.plan;
        run.assertions.push(
          assertion(
            "no-action",
            "Agent không cần gửi giao dịch",
            "NO_ACTION",
            preview.plan.status,
          ),
        );
        break;
      }
      case "SC-02": {
        const view = await adapter.preview([2000, 3000, 5000]);
        run.plan = view.plan;
        if (view.plan.status !== "READY")
          throw new Error(
            "Scenario seed cannot produce a READY rebalance plan.",
          );
        const execution = await new PlanExecutor(
          adapter.client,
          a.PolicyModule,
          a.Safe,
        ).execute(view.plan);
        await captureAgentTransactions(adapter, run, execution, update);
        break;
      }
      case "SC-03":
        expectTx(await adapter.swap(100000000n));
        break;
      case "SC-04":
        expectTx(
          await adapter.swap(101000000n, ErrorCode.ERR_CAP_EXCEEDED),
          ErrorCode.ERR_CAP_EXCEEDED,
        );
        break;
      case "SC-05":
        expectTx(await adapter.swap(60000000n));
        expectTx(await adapter.swap(30000000n));
        expectTx(
          await adapter.swap(20000000n, ErrorCode.ERR_CAP_EXCEEDED),
          ErrorCode.ERR_CAP_EXCEEDED,
        );
        break;
      case "SC-06": {
        expectTx(await adapter.swap(60000000n));
        const start = (await adapter.capture()).timestamp;
        await adapter.rpc("evm_setNextBlockTimestamp", [start + 86399]);
        await adapter.rpc("evm_mine");
        run.assertions.push(
          assertion(
            "before-boundary",
            "Cap còn hiệu lực ở 24h−1s",
            "6000000000",
            (await adapter.capture()).spent24hUsd,
          ),
        );
        await adapter.rpc("evm_setNextBlockTimestamp", [start + 86400]);
        await adapter.rpc("evm_mine");
        run.assertions.push(
          assertion(
            "at-boundary",
            "Cap hết hiệu lực đúng 24h",
            "0",
            (await adapter.capture()).spent24hUsd,
          ),
        );
        break;
      }
      case "SC-07":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_UNAUTHORIZED_TOKEN, {
            tokenIn: adapter.outsider,
          }),
          ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        );
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_UNAUTHORIZED_TOKEN, {
            tokenOut: adapter.outsider,
          }),
          ErrorCode.ERR_UNAUTHORIZED_TOKEN,
        );
        break;
      case "SC-08":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_UNAUTHORIZED_ROUTER, {
            router: adapter.outsider,
          }),
          ErrorCode.ERR_UNAUTHORIZED_ROUTER,
        );
        break;
      case "SC-09":
        expectTx(
          await adapter.swap(50000000n, ErrorCode.ERR_INVALID_RECIPIENT, {
            recipient: adapter.outsider,
          }),
          ErrorCode.ERR_INVALID_RECIPIENT,
        );
        break;
      case "SC-10":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_SESSION_EXPIRED),
          ErrorCode.ERR_SESSION_EXPIRED,
        );
        break;
      case "SC-11":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_SESSION_REVOKED),
          ErrorCode.ERR_SESSION_REVOKED,
        );
        break;
      case "SC-12":
        expectTx(
          await adapter.swap(
            10000000n,
            ErrorCode.ERR_UNAUTHORIZED_SESSION,
            {},
            adapter.outsider,
          ),
          ErrorCode.ERR_UNAUTHORIZED_SESSION,
        );
        break;
      case "SC-13":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_STALE_PRICE),
          ErrorCode.ERR_STALE_PRICE,
        );
        break;
      case "SC-14":
        expectTx(
          await adapter.swap(10000000n, ErrorCode.ERR_SLIPPAGE_TOO_HIGH, {
            minAmountOut: 0n,
          }),
          ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
        );
        break;
      case "SC-15":
        expectTx(
          await adapter.swap(50000000n, ErrorCode.ERR_ROUTER_FAILED),
          ErrorCode.ERR_ROUTER_FAILED,
        );
        break;
      case "SC-16": {
        const data = encodeFunctionData({
          abi: POLICY_ABI,
          functionName: "executeVaultDeposit",
          args: [
            {
              vault: adapter.outsider,
              assets: 50000000n,
              minShares: 1n,
              recipient: a.Safe,
              deadline:
                (await adapter.client.publicClient.getBlock()).timestamp +
                3600n,
            },
          ],
        });
        expectTx(
          await adapter.send(
            "Unknown vault",
            adapter.session,
            a.PolicyModule,
            data,
            ErrorCode.ERR_UNAUTHORIZED_VAULT,
          ),
          ErrorCode.ERR_UNAUTHORIZED_VAULT,
        );
        break;
      }
      case "SC-17": {
        const data = encodeFunctionData({
          abi: POLICY_ABI,
          functionName: "executeVaultWithdraw",
          args: [
            {
              vault: a.MockVault4626,
              assets: 50000000n,
              maxShares: 50000000n,
              recipient: adapter.outsider,
              deadline:
                (await adapter.client.publicClient.getBlock()).timestamp +
                3600n,
            },
          ],
        });
        expectTx(
          await adapter.send(
            "Withdraw to outsider",
            adapter.session,
            a.PolicyModule,
            data,
            ErrorCode.ERR_INVALID_RECIPIENT,
          ),
          ErrorCode.ERR_INVALID_RECIPIENT,
        );
        break;
      }
    }
    run.after = await adapter.capture();
    if (
      [
        "SC-01",
        "SC-04",
        "SC-07",
        "SC-08",
        "SC-09",
        "SC-10",
        "SC-11",
        "SC-12",
        "SC-13",
        "SC-14",
        "SC-15",
        "SC-16",
        "SC-17",
      ].includes(scenario.id)
    )
      run.assertions.push(...unchanged(run.before, run.after));
    await assertAssetEffects(adapter, run);
    if (scenario.id === "SC-03")
      run.assertions.push(
        assertion(
          "full-cap",
          "Spent đúng 100 USD",
          "10000000000",
          run.after.spent24hUsd,
        ),
      );
    if (scenario.id === "SC-05")
      run.assertions.push(
        assertion(
          "split-cap",
          "Spent chỉ bằng 90 USD",
          "9000000000",
          run.after.spent24hUsd,
        ),
      );
    if (scenario.id === "SC-02") {
      const expected = run
        .plan!.steps.filter((s) => s.action === "SWAP_EXACT_IN")
        .reduce((sum, s) => sum + BigInt(s.estimatedValueUsd), 0n);
      run.assertions.push(
        assertion(
          "agent-cap",
          "Cap khớp tổng đầu vào swap",
          expected.toString(),
          run.after.spent24hUsd,
        ),
      );
      run.assertions.push(
        assertion(
          "vault-shares",
          "Shares vault đã về Safe",
          true,
          BigInt(run.after.balances.safeVaultShares) >
            BigInt(run.before.balances.safeVaultShares),
        ),
      );
    }
    progress(run, "Đối chiếu assertions với trạng thái trước/sau", update);
  } catch (error) {
    environmentError =
      error instanceof Error ? error.message : "Lỗi môi trường";
  } finally {
    if (snapshot) {
      try {
        const restored = await adapter.rpc<boolean>("evm_revert", [snapshot]);
        run.cleanup = { restored };
        if (!restored)
          environmentError =
            "Không khôi phục được snapshot; dừng các lượt sau.";
      } catch (error) {
        run.cleanup = { restored: false, error: String(error) };
        environmentError = "Snapshot restore failed; môi trường cần reset.";
      }
    }
  }
  run.status = "COMPLETED";
  run.verdict = verdictFor(run.assertions, environmentError);
  run.reason =
    environmentError ??
    (run.verdict === "PASS"
      ? "Tất cả điều kiện có bằng chứng xác nhận."
      : "Có quan sát không khớp kỳ vọng.");
  run.completedAt = new Date().toISOString();
  update(run);
  return run;
}

export async function runRebalance(
  run: OnchainRunResult,
  adapter: LocalAdapter,
  targets: number[],
  update: Update = () => {},
): Promise<OnchainRunResult> {
  run.status = "RUNNING";
  run.startedAt = new Date().toISOString();
  update(run);
  try {
    await adapter.connect();
    run.addresses = adapter.addresses;
    run.before = await adapter.capture();
    const preview = await adapter.preview(targets);
    run.policy = preview.policy;
    run.plan = preview.plan;
    progress(run, "Đã đọc snapshot và lập kế hoạch", update);
    if (preview.plan.status === "NO_ACTION")
      run.assertions.push(
        assertion(
          "no-action",
          "Không cần giao dịch",
          "NO_ACTION",
          preview.plan.status,
        ),
      );
    else if (preview.plan.status === "BLOCKED") {
      run.assertions.push(
        assertion(
          "ready",
          "Kế hoạch đủ điều kiện",
          "READY",
          preview.plan.status,
        ),
      );
    } else
      await captureAgentTransactions(
        adapter,
        run,
        await new PlanExecutor(
          adapter.client,
          adapter.addresses.PolicyModule,
          adapter.addresses.Safe,
        ).execute(preview.plan),
        update,
      );
    run.after = await adapter.capture();
    await assertAssetEffects(adapter, run);
    run.verdict = verdictFor(run.assertions);
    run.reason = preview.plan.ruleReasoning;
  } catch (error) {
    run.verdict = "ERROR";
    run.reason = error instanceof Error ? error.message : "Environment error";
  }
  run.status = "COMPLETED";
  run.completedAt = new Date().toISOString();
  update(run);
  return run;
}
