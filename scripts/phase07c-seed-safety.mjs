const EXPECTED_DATABASE = "rheinahr_visual_test";
const EXPECTED_PORT = "54329";
const EXPECTED_USER = "iquik";
const CONFIRMATION = "SEED_EMPTY_LOCAL_PHASE07C_DATABASE";

export function assertSyntheticSeedTarget(env) {
  if (env.PHASE07C_SYNTHETIC_SEED !== CONFIRMATION) {
    throw new Error("Synthetic seed requires an explicit one-time confirmation flag.");
  }
  if (!env.DATABASE_URL || !env.DIRECT_URL || env.DATABASE_URL !== env.DIRECT_URL) {
    throw new Error("DATABASE_URL and DIRECT_URL must be identical explicit local URLs.");
  }
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("Invalid synthetic database URL.");
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port !== EXPECTED_PORT ||
    url.pathname !== `/${EXPECTED_DATABASE}` ||
    decodeURIComponent(url.username) !== EXPECTED_USER ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Synthetic seed target is outside the dedicated local allowlist.");
  }
  return env.DATABASE_URL;
}

export function assertSyntheticDatabaseIdentity(identity) {
  if (
    identity.database !== EXPECTED_DATABASE ||
    identity.user !== EXPECTED_USER ||
    identity.port !== Number(EXPECTED_PORT) ||
    !["127.0.0.1", "::1"].includes(identity.address)
  ) {
    throw new Error("Connected database identity does not match the dedicated local allowlist.");
  }
}
