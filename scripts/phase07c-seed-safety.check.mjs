import assert from "node:assert/strict";
import test from "node:test";
import { assertSyntheticSeedTarget, assertSyntheticDatabaseIdentity } from "./phase07c-seed-safety.mjs";

const safe = {
  PHASE07C_SYNTHETIC_SEED: "SEED_EMPTY_LOCAL_PHASE07C_DATABASE",
  DATABASE_URL: "postgresql://iquik@127.0.0.1:54329/rheinahr_visual_test",
  DIRECT_URL: "postgresql://iquik@127.0.0.1:54329/rheinahr_visual_test",
};

test("accepts only the exact dedicated local database", () => {
  assert.equal(assertSyntheticSeedTarget(safe), safe.DATABASE_URL);
  assertSyntheticDatabaseIdentity({ database: "rheinahr_visual_test", user: "iquik", address: "127.0.0.1", port: 54329 });
});

test("rejects inherited, remote, altered, or unconfirmed targets before client construction", () => {
  const urls = [
    "postgresql://iquik@db.example.com:54329/rheinahr_visual_test",
    "postgresql://iquik@localhost:5432/rheinahr_visual_test",
    "postgresql://iquik@localhost:54329/production",
    "postgresql://other@localhost:54329/rheinahr_visual_test",
    "postgresql://iquik@localhost:54329/rheinahr_visual_test?schema=public",
  ];
  for (const url of urls) {
    assert.throws(() => assertSyntheticSeedTarget({ ...safe, DATABASE_URL: url, DIRECT_URL: url }));
  }
  assert.throws(() => assertSyntheticSeedTarget({ ...safe, PHASE07C_SYNTHETIC_SEED: "" }));
  assert.throws(() => assertSyntheticSeedTarget({ ...safe, DIRECT_URL: "" }));
  assert.throws(() => assertSyntheticDatabaseIdentity({ database: "production", user: "iquik", address: "127.0.0.1", port: 54329 }));
});
