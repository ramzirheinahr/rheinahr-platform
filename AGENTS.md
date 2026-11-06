# AGENTS.md

Instructions for any AI coding agent (Codex, Cursor, Gemini, Claude, …) working on this
repository live in **[CLAUDE.md](CLAUDE.md)** — read it fully before changing anything.

Most important, in short:

1. **Two companies, one codebase.** RheinAhr and RheinLand run the same code against
   separate databases and env files. Every change must work for both; never hardcode one
   company's identity.
2. **Deploy only with `scripts/deploy.sh`** after committing (RheinLand first, then
   RheinAhr, with backup, migrations, smoke test and auto-rollback). Rollback:
   `scripts/rollback.sh <company>`. Never edit or build on the server by hand.
3. **Production data is business-critical.** Fresh backup and a dry run before any data
   change; migrations must be additive.
4. `sudo` on the server needs the owner's password — ask the owner, never work around it.
