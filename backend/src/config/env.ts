import * as fs from 'fs';
import * as path from 'path';

export interface EnvConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  requireDb: boolean;
  jwtSecret: string;
  corsOrigins: string[];
}

const DEFAULT_DEV_JWT_SECRET = 'dev-only-insecure-secret-change-in-production';

let envLoaded = false;

/**
 * Loads backend/.env into process.env without overriding already-set variables.
 */
export function loadEnvFileOnce(): void {
  if (envLoaded) return;
  envLoaded = true;

  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

export function getEnvConfig(): EnvConfig {
  loadEnvFileOnce();

  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const port = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
  const databaseUrl = process.env.DATABASE_URL || '';
  const requireDb =
    process.env.REQUIRE_DB !== undefined
      ? process.env.REQUIRE_DB === 'true'
      : isProduction;

  const rawJwtSecret = (process.env.JWT_SECRET || '').trim();
  if (
    isProduction &&
    (!rawJwtSecret ||
      rawJwtSecret.length < 16 ||
      rawJwtSecret.startsWith('change-me') ||
      rawJwtSecret === 'super-secret-jwt-key-change-in-production' ||
      rawJwtSecret === 'replace-with-long-random-32-plus-char-secret')
  ) {
    throw new Error(
      'JWT_SECRET must be set to a strong secret (>= 16 chars) when NODE_ENV=production.',
    );
  }

  const jwtSecret = rawJwtSecret || DEFAULT_DEV_JWT_SECRET;
  const corsRaw = process.env.CORS_ORIGIN || '';
  const corsOrigins = corsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    isProduction,
    port,
    databaseUrl,
    requireDb,
    jwtSecret,
    corsOrigins,
  };
}

/**
 * Validates whether an incoming Origin header is permitted by CORS policy.
 */
export function isOriginAllowed(
  origin: string | undefined,
  config: EnvConfig,
): boolean {
  if (!origin) return true; // Same-origin, curl, or server-to-server

  if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
    return true;
  }

  // In non-production, allow local loopback and private LAN origins for mobile Wi-Fi testing
  if (!config.isProduction) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
      origin,
    );
  }

  return false;
}
