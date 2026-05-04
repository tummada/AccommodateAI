# T-107 — Add REFERENCES to ALTER DEFAULT PRIVILEGES for acmd schema (init-db.sh template)

## Summary
Add `REFERENCES` to the `ALTER DEFAULT PRIVILEGES IN SCHEMA acmd` GRANT list in `scripts/init-db.sh`, so that future tables created in `acmd` schema by superuser get `REFERENCES` granted to `acmd_user` automatically. This unblocks acmd FK migrations on fresh DB volumes.

## Context (from owner relay of Lead@acmd, 2026-04-30 11:xx ICT)
- acmd has new migration with FK pointing to `acmd.users`
- `acmd.users` is owned by superuser (`vollos`), NOT `acmd_user` (created during init-db.sh schema bootstrap, before migrations run as `acmd_user`)
- `acmd_user` currently has SELECT/INSERT/UPDATE/DELETE on `acmd.users` (via existing ALTER DEFAULT PRIVILEGES) but lacks REFERENCES
- Postgres requires REFERENCES on referenced table to create FK constraint → migration fails with error code 42501 "permission denied" on fresh volume
- Lead@acmd already fixed local DB; needs template (`scripts/init-db.sh`) updated for future fresh deploys
- Priority: Low (only affects fresh volume / DB reset) — no prod DB action needed (existing prod DB unaffected since no FK migration has been attempted there yet)
- ref (cross-repo, do NOT open): `acmd/_workspace/T-118-FIX-local-migrations/output.md:25, 50-52`

## Why ALTER DEFAULT PRIVILEGES instead of literal `GRANT REFERENCES ON TABLE acmd.users`
- `init-db.sh` runs ONCE on first init via `/docker-entrypoint-initdb.d/` (verified: it's the only script in that directory; see `docker-compose.yml:21`)
- At that point `acmd.users` table does NOT exist (created later by Drizzle migration)
- A literal `GRANT REFERENCES ON TABLE acmd.users` would crash with "relation does not exist"
- ALTER DEFAULT PRIVILEGES is forward-looking: applies to tables created *afterwards* in that schema by the same role (superuser) — exactly what we need

## Pipeline Routing
- **task_type:** `Database/Migration`
- **pipeline:** `pipeline-small` (rubric 0 YES — single file, 1-line change, no design spec, no cascade risk, deterministic GRANT)
- **rubric_yes_count:** 0
- **reviewer_scope:**
  - **Auditor:** Logic + Security — focus on: ACL correctness (REFERENCES is a metadata privilege only — does NOT grant data access; verify no unintended privilege escalation to other schemas/users); ensure no side effect on `auth` or `vollos` schema grants
  - **QA:** Data Integrity — focus on: GRANT syntax correctness, schema-level scope (only `acmd` schema affected), idempotency (init-db.sh runs once per fresh volume — no rerun concerns), migration unblock evidence (REFERENCES is what postgres requires for FK creation per postgres docs)

## Mandatory QA/Auditor Gate check
- ✅ NOT triggering Mandatory Override:
  - Not auth/JWT/session
  - Not payment/billing
  - Not email/SMTP
  - Not public endpoint
  - Touches PII-containing schema (`acmd.users`) but the change is metadata privilege (REFERENCES = "can be referenced by FK") — does NOT add data read/write access
  - Not CORS/firewall/TLS
  - Not deploy
- → pipeline-small is appropriate

## owned_files
- `scripts/init-db.sh` (line 76-77 region — extend GRANT list for acmd schema only)

**FORBIDDEN:** any other file. Do not touch `auth` or `vollos` schema GRANT blocks. Do not touch CREATE SCHEMA, CREATE USER, GRANT ALL ON SCHEMA, search_path lines, or comments outside the immediate change region.

## acceptance_criteria
1. `ALTER DEFAULT PRIVILEGES IN SCHEMA acmd GRANT ... ON TABLES TO acmd_user;` privilege list includes `REFERENCES` in addition to `SELECT, INSERT, UPDATE, DELETE` (order: alphabetical or grouped — Worker decides; suggest keeping existing order + appending `, REFERENCES` for minimal diff)
2. `auth` schema ALTER DEFAULT PRIVILEGES block unchanged (verify by grep: still has only `SELECT, INSERT, UPDATE, DELETE`)
3. `vollos` schema ALTER DEFAULT PRIVILEGES block unchanged (same grep check)
4. Add a 1-line SQL comment above the changed line (or on same line) noting the reason: e.g. `-- REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK → acmd.users)`
5. No other lines in `scripts/init-db.sh` modified (verify `git diff scripts/init-db.sh` shows ONLY 1 added line and 1 modified line, plus optional comment)
6. shellcheck `scripts/init-db.sh` passes 0 warnings (existing baseline — should stay clean)
7. (Optional verification) On a throwaway local postgres container: run `init-db.sh` → confirm psql exits 0 → confirm `\dp acmd.users` (after creating a dummy `acmd.users` table as superuser) shows `acmd_user` has `r` (REFERENCES) privilege in default ACL — if too costly to set up, skip and note in output.md
8. Branch from FRESH `origin/main` (run `git fetch origin main && git switch -c fix/infra-grant-references-acmd origin/main` — DO NOT branch from current `chore/board-session-011-close` which is already-merged stale state)
9. Conventional commit: `fix(infra): grant REFERENCES on acmd default privileges for FK migrations`
10. Push branch + open MR via `gh`-equivalent (use `glab` for GitLab, or `git push -u origin <branch>` then construct MR URL via API/CLI)
11. `_workspace/T-107-grant-references-acmd-default-privs/output.md` complete with `self_review` field — every field `result: true` + `evidence` referencing `file:line` (per CLAUDE.md "Agent Self-Review" rule)
12. `placeholders_remaining: none — grep clean` (per CLAUDE.md Placeholder Audit) — run the 9-pattern grep on `scripts/init-db.sh` and report result

## domain_consultation
- **expert:** N/A (pure infrastructure DB grant — no domain logic; postgres GRANT semantics is a well-defined SQL standard area)
- **brief:** N/A
- **key_points:** none required

## spawn_started_at
2026-04-30T11:10+07:00

## Worker briefing (for Backend/DevOps agent — pick DevOps since this is infra/init-db.sh)

You are the **DevOps Worker** for T-107 in vollos-core. Read this entire task.md first. Stay strictly within `scripts/init-db.sh` — do NOT touch any other file (rule: ทุก file outside `owned_files` = forbidden).

**Your mission:**
1. Read `scripts/init-db.sh` in full to understand the structure
2. Modify ONLY the `acmd` schema's `ALTER DEFAULT PRIVILEGES` block (around line 76-77) to add `REFERENCES` to the privilege list
3. Add a 1-line comment explaining why (per acceptance_criteria #4)
4. Verify `auth` and `vollos` schema blocks are unchanged
5. Run `shellcheck scripts/init-db.sh` (must be 0 warnings)
6. (Optional, if Docker available) Throwaway local postgres test (per acceptance_criteria #7) — if too costly, skip + note
7. Run 9-pattern secret scan on `_workspace/T-107-grant-references-acmd-default-privs/` per CLAUDE.md "_workspace/ Git Policy" rule before push
8. Branch from FRESH `origin/main` (per acceptance_criteria #8 — important because current local branch `chore/board-session-011-close` was already merged)
9. Commit + push + open MR (per acceptance_criteria #9-10)
10. Write `output.md` with full `self_review` field — every `result: true` must have `evidence: "file:line — description"` referencing concrete proof (per CLAUDE.md "Agent Self-Review")

**Constraints:**
- ❌ NO new files outside `_workspace/T-107-grant-references-acmd-default-privs/`
- ❌ NO touching `auth` or `vollos` schema grants
- ❌ NO touching CREATE SCHEMA, CREATE USER, search_path, REVOKE statements
- ❌ NO `git push --force` to main, NO bypassing pipeline
- ❌ NO running this on prod DB or local DB (template change only — owner explicitly said "เฉพาะ template อย่างเดียวครับ")
- ✅ Conventional commit format
- ✅ Pipeline must succeed before MR can be merged (owner does final merge)

**Output format:**
- Final response: ≤ 200 words summarizing what changed, what was verified, MR URL, and any blockers
- Full evidence in `_workspace/T-107-grant-references-acmd-default-privs/output.md`
