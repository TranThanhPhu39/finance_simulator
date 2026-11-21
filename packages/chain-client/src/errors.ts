import { decodeErrorResult, type Hex } from 'viem';
import { ErrorCode } from '@repo/shared';
import { POLICY_ABI } from './policy-abi';

const codes: Record<string, ErrorCode> = {
  CapExceeded: ErrorCode.ERR_CAP_EXCEEDED,
  TokenNotWhitelisted: ErrorCode.ERR_UNAUTHORIZED_TOKEN,
  RouterNotWhitelisted: ErrorCode.ERR_UNAUTHORIZED_ROUTER,
  VaultNotWhitelisted: ErrorCode.ERR_UNAUTHORIZED_VAULT,
  InvalidRecipient: ErrorCode.ERR_INVALID_RECIPIENT,
  UnauthorizedSession: ErrorCode.ERR_UNAUTHORIZED_SESSION,
  SessionExpired: ErrorCode.ERR_SESSION_EXPIRED,
  SessionRevoked: ErrorCode.ERR_SESSION_REVOKED,
  Paused: ErrorCode.ERR_PAUSED,
  InvalidPrice: ErrorCode.ERR_INVALID_PRICE,
  StalePrice: ErrorCode.ERR_STALE_PRICE,
  SlippageExceeded: ErrorCode.ERR_SLIPPAGE_TOO_HIGH,
  DeadlineExpired: ErrorCode.ERR_DEADLINE_EXPIRED,
  InvalidAmount: ErrorCode.ERR_INVALID_AMOUNT,
  SpendHistoryFull: ErrorCode.ERR_HISTORY_FULL,
  OnlySafe: ErrorCode.ERR_ONLY_SAFE,
  InvalidConfiguration: ErrorCode.ERR_INVALID_CONFIG,
  TokenOperationFailed: ErrorCode.ERR_TOKEN_OPERATION,
  UnexpectedBalanceChange: ErrorCode.ERR_BALANCE_CHANGE,
  VaultAssetChanged: ErrorCode.ERR_VAULT_ASSET_CHANGED,
  ExecutionFailed: ErrorCode.ERR_EXECUTION_FAILED,
};

export interface DecodedPolicyError {
  code: ErrorCode;
  name?: string;
  args?: readonly unknown[];
  nested?: DecodedPolicyError;
}

function decode(data: Hex, depth = 0): DecodedPolicyError | undefined {
  if (depth > 8) return undefined;
  try {
    const value = decodeErrorResult({ abi: POLICY_ABI, data });
    if (value.errorName === 'Error') {
      const reason = String(value.args?.[0]);
      const code = reason === 'GS104' ? ErrorCode.ERR_MODULE_DISABLED
        : reason === 'Router: Simulated failure' ? ErrorCode.ERR_ROUTER_FAILED
        : reason.includes('Insufficient output') ? ErrorCode.ERR_SLIPPAGE_TOO_HIGH
        : ErrorCode.ERR_EXECUTION_FAILED;
      return { code, name: 'Error', args: value.args };
    }
    const nested = value.errorName === 'ExecutionFailed' && typeof value.args?.[1] === 'string'
      ? decode(value.args[1] as Hex, depth + 1) : undefined;
    return { code: nested?.code ?? codes[value.errorName] ?? ErrorCode.ERR_EXECUTION_FAILED,
      name: value.errorName, args: value.args, ...(nested ? { nested } : {}) };
  } catch { return undefined; }
}

export function decodePolicyErrorDetails(error: unknown): DecodedPolicyError {
  // Inspect only structured revert-data/cause fields. Never classify an RPC failure
  // as a policy rejection just because its message contains an error name.
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let i = 0; i < queue.length && i < 64; ++i) {
    const item = queue[i];
    if (seen.has(item)) continue;
    seen.add(item);
    if (typeof item === 'string' && /^0x[\da-f]+$/i.test(item)) {
      const result = decode(item as Hex);
      if (result) return result;
    } else if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      for (const key of ['raw', 'data', 'cause', 'error', 'originalError', 'returnData', 'result']) {
        if (record[key] !== undefined) queue.push(record[key]);
      }
    }
  }
  return { code: ErrorCode.ERR_RPC_OR_ENV };
}
