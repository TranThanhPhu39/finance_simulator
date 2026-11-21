import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Run after `forge build` in contracts/. This exports the complete contract ABI,
// including governance, typed requests, return values, events and custom errors.
const artifact = new URL('../contracts/out/PolicyModule.sol/PolicyModule.json', import.meta.url);
const directory = new URL('../packages/chain-client/src/abi/', import.meta.url);
const destination = new URL('PolicyModule.json', directory);
const { abi } = JSON.parse(await readFile(artifact, 'utf8'));
if (!Array.isArray(abi) || abi.length === 0) throw new Error('Missing PolicyModule ABI; run forge build first.');
await mkdir(directory, { recursive: true });
await writeFile(destination, JSON.stringify(abi, null, 2) + '\n', 'utf8');
console.log(`Exported ${abi.length} ABI entries to packages/chain-client/src/abi/PolicyModule.json`);
