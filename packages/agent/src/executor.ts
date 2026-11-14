import type { Address, Hex } from 'viem';
import { PolicyClient, decodePolicyErrorDetails, type ModuleTransaction, type DecodedPolicyError } from '@repo/chain-client';
import { ErrorCode, type RebalancePlan } from '@repo/shared';

export interface StepExecution {
  stepIndex: number;
  status: 'SUCCESS' | 'PREFLIGHT_REJECTED' | 'REVERTED' | 'PENDING' | 'SUBMISSION_UNKNOWN';
  transaction?: ModuleTransaction;
  hash?: Hex;
  blockNumber?: string;
  error?: DecodedPolicyError;
}
export interface PlanExecution {
  planId: string;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  steps: StepExecution[];
}

/** In-process deduplication; keep one executor per signer/module in the API worker.
 * On process restart the worker must reconcile stored hashes/nonces before resubmission.
 */
export class PlanExecutor {
  private runs = new Map<string, { fingerprint: string; promise: Promise<PlanExecution> }>();
  private running = false;
  constructor(private client: PolicyClient, private module: Address, private safe: Address) {}

  execute(plan: RebalancePlan): Promise<PlanExecution> {
    if (plan.status !== 'READY' || plan.steps.length === 0) return Promise.reject(new Error('Plan is not executable.'));
    if (plan.steps.some((step, index) => step.stepIndex !== index)) return Promise.reject(new Error('Plan step order is invalid.'));
    const stablePlan = structuredClone(plan);
    const fingerprint = JSON.stringify(stablePlan);
    const previous = this.runs.get(plan.planId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return Promise.reject(new Error('Plan ID reused with changed payload.'));
      return previous.promise;
    }
    if (this.running) return Promise.reject(new Error('A plan is already running for this executor.'));
    this.running = true;
    const promise = this.run(stablePlan).finally(() => { this.running = false; });
    this.runs.set(plan.planId, { fingerprint, promise });
    return promise;
  }

  private async run(plan: RebalancePlan): Promise<PlanExecution> {
    const result: PlanExecution = { planId: plan.planId, status: 'COMPLETED', steps: [] };
    for (const step of plan.steps) {
      let transaction: ModuleTransaction;
      try {
        transaction = await this.client.prepareStep(this.module, step, this.safe);
        await this.client.simulateTransaction(transaction);
      } catch (error) {
        result.steps.push({ stepIndex: step.stepIndex, status: 'PREFLIGHT_REJECTED', error: decodePolicyErrorDetails(error) });
        result.status = 'FAILED'; break;
      }
      let hash: Hex;
      try { hash = await this.client.submitTransaction(transaction); }
      catch (error) {
        // RPC send can fail after acceptance. Do not automatically retry a money-moving request.
        result.steps.push({ stepIndex: step.stepIndex, status: 'SUBMISSION_UNKNOWN', transaction, error: decodePolicyErrorDetails(error) });
        result.status = 'PENDING'; break;
      }
      try {
        const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash, timeout: 60000 });
        const success = receipt.status === 'success';
        result.steps.push({ stepIndex: step.stepIndex, status: success ? 'SUCCESS' : 'REVERTED',
          transaction, hash, blockNumber: receipt.blockNumber.toString(),
          ...(!success ? { error: { code: ErrorCode.ERR_TRANSACTION_REVERTED } } : {}) });
        if (!success) { result.status = 'FAILED'; break; }
      } catch (error) {
        result.steps.push({ stepIndex: step.stepIndex, status: 'PENDING', transaction, hash, error: decodePolicyErrorDetails(error) });
        result.status = 'PENDING'; break;
      }
    }
    return result;
  }
}
