import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const rpcUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
const url = new URL(rpcUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw Error("Local prepare requires loopback RPC.");
const bin = (name) => {
  const file = join(
    homedir(),
    ".foundry/bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  return (
    process.env[name.toUpperCase() + "_BIN"] || (existsSync(file) ? file : name)
  );
};
async function rpc(method) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(1000),
  });
  const result = await response.json();
  if (result.error) throw Error(result.error.message);
  return result.result;
}
try {
  const response = await fetch("http://127.0.0.1:8787/api/health", {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok)
    throw Error("API is running: stop it before creating a new deployment.");
} catch (error) {
  if (error.message?.startsWith("API is running")) throw error;
}
mkdirSync(resolve(root, ".runtime"), { recursive: true });
let connected = false;
try {
  connected = (await rpc("web3_clientVersion")).toLowerCase().includes("anvil");
  if (!connected) throw Error("Existing RPC is not Anvil.");
} catch (error) {
  if (error.message === "Existing RPC is not Anvil.") throw error;
}
if (!connected) {
  const child = spawn(
    bin("anvil"),
    ["--host", "127.0.0.1", "--port", url.port || "8545", "--silent"],
    {
      detached: true,
      windowsHide: true,
      stdio: [
        "ignore",
        openSync(resolve(root, ".runtime/anvil.stdout.log"), "a"),
        openSync(resolve(root, ".runtime/anvil.stderr.log"), "a"),
      ],
    },
  );
  child.unref();
  writeFileSync(resolve(root, ".runtime/anvil.pid"), String(child.pid));
  for (let i = 0; i < 100; i++) {
    try {
      await rpc("web3_clientVersion");
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
if (!connected || (await rpc("eth_chainId")) !== "0x7a69")
  throw Error("Anvil chain 31337 is required.");
const key = execFileSync(
  bin("cast"),
  [
    "wallet",
    "private-key",
    "test test test test test test test test test test test junk",
    "0",
  ],
  { encoding: "utf8", windowsHide: true },
).trim();
const result = spawnSync(
  bin("forge"),
  [
    "script",
    "script/DeployLocal.s.sol:DeployLocal",
    "--rpc-url",
    rpcUrl,
    "--broadcast",
    "--non-interactive",
  ],
  {
    cwd: resolve(root, "contracts"),
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: key,
      SESSION_ADDRESS: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    },
    encoding: "utf8",
    windowsHide: true,
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || String(result.error));
  process.exitCode = 1;
} else {
  const record = spawnSync(
    process.execPath,
    [resolve(root, "scripts/record-local-deployment.mjs")],
    {
      cwd: root,
      env: { ...process.env, LOCAL_RPC_URL: rpcUrl },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (record.status !== 0) process.exitCode = 1;
  else
    console.log(
      "Local demo ready. Run pnpm api:dev and pnpm web:dev in separate terminals.",
    );
}
