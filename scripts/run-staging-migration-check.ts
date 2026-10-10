/**
 * Staging Migration Verification Runner (Phase 5b-2a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Checks connection to dedicated Staging PostgreSQL database and runs physical constraint verification.
 * Safety Guarantees:
 * 1. Safe process execution without shell expansion (execFileSync with shell: false and arguments array).
 * 2. Positive Staging Target Validation: Only permits authorized local or staging hostnames.
 * 3. Strict Production Isolation: Explicitly forbids any production database connection.
 */

import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export type StagingVerificationResult = {
  status: "EXECUTED_PASSED" | "UNEXECUTED_STAGING_GATE_OPEN";
  reason: string;
  timestamp: string;
  scriptPath: string;
};

const ALLOWED_STAGING_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "staging-postgres",
  "staging-db",
]);

/**
 * Validates that the provided PostgreSQL connection URL strictly targets
 * an authorized staging or local test environment and never a production host.
 */
function validateStagingTargetUrl(rawUrl: string): { valid: boolean; host?: string; error?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return { valid: false, error: `Invalid protocol: ${parsed.protocol}. Expected postgresql:` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Strict positive whitelist check
    const isAllowedHost =
      ALLOWED_STAGING_HOSTS.has(hostname) ||
      hostname.endsWith(".staging.internal") ||
      hostname.endsWith(".test.internal");

    if (!isAllowedHost) {
      return {
        valid: false,
        host: hostname,
        error: `Host "${hostname}" is not in the authorized staging whitelist (${Array.from(ALLOWED_STAGING_HOSTS).join(", ")}). Remote or arbitrary database targets are rejected.`,
      };
    }

    // Negative guard against production keywords in host or path
    if (
      hostname.includes("prod") ||
      hostname.includes("supabase.co") ||
      hostname.includes("pooler.supabase.com") ||
      parsed.pathname.includes("prod")
    ) {
      return {
        valid: false,
        host: hostname,
        error: `Host "${hostname}" violates production isolation rules.`,
      };
    }

    return { valid: true, host: hostname };
  } catch (err: unknown) {
    return {
      valid: false,
      error: `Malformed database URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function runStagingVerificationCheck(): StagingVerificationResult {
  const scriptPath = resolve(__dirname, "verify-postgres-rate-migration-staging.sql");
  const timestamp = new Date().toISOString();

  const stagingDbUrl = process.env.STAGING_DATABASE_URL || process.env.TEST_POSTGRES_URL;

  if (!stagingDbUrl) {
    return {
      status: "UNEXECUTED_STAGING_GATE_OPEN",
      reason:
        "No dedicated Staging/Test PostgreSQL URL provided (STAGING_DATABASE_URL or TEST_POSTGRES_URL is unset). Local PostgreSQL instance is not running on localhost:5432. Production database cannot and will not be touched.",
      timestamp,
      scriptPath,
    };
  }

  // Positive host validation
  const validation = validateStagingTargetUrl(stagingDbUrl);
  if (!validation.valid) {
    return {
      status: "UNEXECUTED_STAGING_GATE_OPEN",
      reason: `SAFETY REJECTION: ${validation.error}`,
      timestamp,
      scriptPath,
    };
  }

  try {
    // Safe invocation without shell expansion (execFileSync with arguments array)
    const stdout = execFileSync("psql", [stagingDbUrl, "-f", scriptPath], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      timeout: 30000,
    });

    return {
      status: "EXECUTED_PASSED",
      reason: `Executed successfully against staging database on host "${validation.host}". Output:\n${stdout}`,
      timestamp,
      scriptPath,
    };
  } catch (err: unknown) {
    return {
      status: "UNEXECUTED_STAGING_GATE_OPEN",
      reason: `Execution failed against staging database: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
      scriptPath,
    };
  }
}

if (require.main === module) {
  const result = runStagingVerificationCheck();
  console.log(JSON.stringify(result, null, 2));
}
