import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionMode, NetworkEnv } from '@repo/shared';
import { TreasuryApiService } from './services/treasury-service';
import { createApiServer } from './routes/server';

export * from './db/migrations/database';
export * from './services/treasury-service';
export * from './routes/server';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  const env = (process.env.NETWORK_ENV as NetworkEnv) ?? 'local';
  const mode = (process.env.EXECUTION_MODE as ExecutionMode) ?? 'SIMULATED_POLICY';
  const dbPath = process.env.SQLITE_DB_PATH ?? path.resolve(process.cwd(), '.runtime/treasury-lab.sqlite');

  const service = new TreasuryApiService(dbPath, env, mode);
  const server = createApiServer(service);

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Treasury Agent Lab API] Listening on http://localhost:${port} (env=${env}, mode=${mode}, db=${dbPath})`);
  });
}
