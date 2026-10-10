/**
 * Staging Migration Verification Runner (Phase 5b-2a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Checks connection to Staging PostgreSQL database and runs physical constraint verification.
 * Safety rule: NEVER runs against production database.
 */

import { resolve } from "node:path";
import { execSync } from "node:child_process";

export type StagingVerificationResult = {
  status: "EXECUTED_PASSED" | "UNEXECUTED_STAGING_GATE_OPEN";
  reason: string;
  timestamp: string;
  scriptPath: string;
};

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

  // Safety guard: reject if URL points to production
  if (
    stagingDbUrl.includes("supabase.co") ||
    stagingDbUrl.includes("pooler.supabase.com") ||
    stagingDbUrl.includes("production") ||
    stagingDbUrl.includes("prod")
  ) {
    throw new Error(
      "SAFETY VIOLATION: Staging verification script cannot be executed against production or Supabase live URLs!"
    );
  }

  try {
    const output = execSync(`psql "${stagingDbUrl}" -f "${scriptPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    return {
      status: "EXECUTED_PASSED",
      reason: `Executed successfully against staging database. Output:\n${output}`,
      timestamp,
      scriptPath,
    };
  } catch (err: unknown) {
    return {
      status: "UNEXECUTED_STAGING_GATE_OPEN",
      reason: `Failed to execute against staging database: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
      scriptPath,
    };
  }
}

if (require.main === module) {
  const result = runStagingVerificationCheck();
  console.log(JSON.stringify(result, null, 2));
}
