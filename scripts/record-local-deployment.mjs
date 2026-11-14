import { readFile, writeFile } from 'node:fs/promises';

// Record ONLY a successful broadcast on the currently running local chain.
// No signing keys are read or written by this command.
const rpcUrl = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpcUrl).hostname)) {
  throw new Error('Local recorder requires a loopback RPC URL.');
}
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}
if (await rpc('eth_chainId') !== '0x7a69') throw new Error('Expected local chainId 31337.');
const broadcast = JSON.parse(await readFile(new URL(
  '../contracts/broadcast/DeployLocal.s.sol/31337/run-latest.json', import.meta.url), 'utf8'));
const addresses = {};
const verifiedTransactions = [];
const minedByNonce = new Map();
// Correlate by sender + nonce + payload. Some Foundry builds attach the wrong
// hash to planned transactions when broadcasting a batch concurrently.
for (const savedReceipt of broadcast.receipts || []) {
  const hash = savedReceipt.transactionHash;
  const receipt = await rpc('eth_getTransactionReceipt', [hash]);
  const mined = await rpc('eth_getTransactionByHash', [hash]);
  if (!receipt || receipt.status !== '0x1' || !mined) throw new Error(`Transaction not successful: ${hash}`);
  const key = `${mined.from.toLowerCase()}:${BigInt(mined.nonce)}`;
  if (minedByNonce.has(key)) throw new Error(`Duplicate transaction nonce: ${key}`);
  minedByNonce.set(key, { receipt, mined });
}
if (minedByNonce.size !== broadcast.transactions.length) throw new Error('Incomplete broadcast receipts.');
for (const transaction of broadcast.transactions) {
  const planned = transaction.transaction;
  const confirmed = minedByNonce.get(`${planned.from.toLowerCase()}:${BigInt(planned.nonce)}`);
  if (!confirmed) throw new Error('Missing confirmed transaction for planned nonce.');
  const { receipt, mined } = confirmed;
  if ((mined.to || '').toLowerCase() !== (planned.to || '').toLowerCase()
    || mined.input.toLowerCase() !== planned.input.toLowerCase()
    || BigInt(mined.value) !== BigInt(planned.value)) throw new Error('On-chain payload differs from plan.');
  verifiedTransactions.push({ hash: mined.hash, blockNumber: Number(BigInt(receipt.blockNumber)) });
  if (transaction.transactionType === 'CREATE') {
    if (!receipt.contractAddress || await rpc('eth_getCode', [receipt.contractAddress, 'latest']) === '0x') {
      throw new Error(`Missing deployed code for ${mined.hash}`);
    }
    const name = transaction.contractName;
    if (name === 'MockERC20') {
      addresses[addresses.MockUSDC ? 'MockTokenA' : 'MockUSDC'] = receipt.contractAddress;
    } else {
      addresses[name === 'SafeProxy' ? 'Safe' : name === 'Safe' ? 'SafeSingleton' : name] = receipt.contractAddress;
    }
  }
}
for (const required of ['Safe', 'PolicyModule', 'MockUSDC', 'MockTokenA', 'MockPriceOracle', 'MockRouter', 'MockVault4626']) {
  if (!addresses[required]) throw new Error(`Missing ${required} deployment`);
}
const metadata = { environment: 'local', chainId: 31337, simulatedYield: true,
  verifiedAt: new Date().toISOString(), addresses, transactions: verifiedTransactions };
await writeFile(new URL('../deployments/local.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
console.log(`Recorded ${verifiedTransactions.length} confirmed local transactions in deployments/local.json`);
