import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionMode, NetworkEnv } from '@repo/shared';
import { TreasuryApiService } from './services/treasury-service';
import { createApiServer } from './routes/server';

export * from './db/migrations/database';
export * from './services/treasury-service';
export * from './routes/server';

// The single supported entry point serves simulation and Anvil on loopback 8787.
// Importing this module (including in tests) never starts a second server.
