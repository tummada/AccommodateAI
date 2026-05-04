# T-107 Auditor Review (fresh eyes — Logic + Security)

**Reviewed:** 2026-04-30T11:35+07:00
**Files audited:** scripts/init-db.sh (full read, 1-79), docker-compose.yml (mount/env, 1-104), CLAUDE.md (Architecture rules C1-C7), commit 0841eccd diff
**Verification approach:** Read all files myself; ran independent greps; did NOT trust output.md self_review claims at face value.

## Findings

### [A1] ACL correctness — REFERENCES is metadata-only, no data access leak — Note (PASS)
- **What:** The added `REFERENCES` privilege grants only the right to create FK constraints referencing the column(s); it does NOT grant `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or any data read/write capability. Postgres ACL letter `x` (REFERENCES) is independent of `r/a/w/d`. The change therefore cannot expose PII rows in `acmd.users` to `acmd_user` beyond what it already had.
- **Where:** scripts/init-db.sh:77-78
- **Why it matters:** Owner explicitly flagged the PII concern — needed to confirm REFERENCES is not a sneaky data-access vector.
- **Evidence (verified by me):** Line 78 reads `  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO acmd_user;`. Note that `acmd_user` already had SELECT on these tables since the previous version of the line — adding REFERENCES is strictly orthogonal to PII visibility (which was already permitted by SELECT). REFERENCES is per the SQL standard and Postgres docs purely a "may create FK pointing here" privilege.
- **Recommendation:** None. ACL semantics are sound.

### [A2] Cross-schema isolation preserved — auth/vollos blocks untouched — Note (PASS)
- **What:** Confirmed by independent grep that the `auth` and `vollos` `ALTER DEFAULT PRIVILEGES` blocks were not modified, and no privilege spillover occurred to those schemas or to `auth_user`/`vollos_user`/`PUBLIC`.
- **Where:** scripts/init-db.sh:65-72 (auth + vollos blocks)
- **Evidence (verified by me):** `grep -nE "ALTER DEFAULT PRIVILEGES|GRANT SELECT|GRANT ALL|REFERENCES" scripts/init-db.sh` returned:
  - `65:GRANT ALL ON SCHEMA auth TO auth_user;`
  - `66:ALTER DEFAULT PRIVILEGES IN SCHEMA auth`
  - `67:  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;` (no REFERENCES)
  - `70:GRANT ALL ON SCHEMA vollos TO vollos_user;`
  - `71:ALTER DEFAULT PRIVILEGES IN SCHEMA vollos`
  - `72:  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;` (no REFERENCES)
  - `75-78:` acmd block (only block changed).
  Diff `git show 0841eccd -- scripts/init-db.sh` confirms exactly +2/-1 lines, all inside the acmd block. No `PUBLIC` GRANT introduced; `REVOKE ALL ON SCHEMA public FROM PUBLIC;` (line 47) still in place.
- **Recommendation:** None. C5 (per-schema user isolation) preserved.

### [A3] Privilege escalation surface — bounded to acmd schema by design — Note (PASS)
- **What:** `ALTER DEFAULT PRIVILEGES IN SCHEMA acmd` is scoped to the schema clause; the `FOR ROLE` clause is implicit (= the current role, the superuser running init-db.sh). Future tables created in `acmd` by any other role would NOT inherit this default privilege. That's a desired property — it limits blast radius.
- **Where:** scripts/init-db.sh:77 (`ALTER DEFAULT PRIVILEGES IN SCHEMA acmd`)
- **Evidence (verified by me):** No `FOR ROLE` clause is present, so per Postgres docs the implicit grantor is `current_user` at script run time = POSTGRES_USER (superuser `vollos`). The script runs once on fresh volume via `/docker-entrypoint-initdb.d/` (verified at docker-compose.yml:21 and confirmed superuser context via line 38: `--username "${POSTGRES_USER}"`). Any tables created later by a non-superuser (e.g., `acmd_user` running Drizzle migrations) would NOT inherit these defaults — but that's fine because `acmd_user` already has full DML on its own schema-owned tables by virtue of being the table owner.
- **Recommendation:** None. The implicit-grantor scoping is correct for the stated use case (FK references to `acmd.users` which is owned by superuser).

### [A4] Implicit assumption — `acmd.users` ownership by superuser — Note (PASS, with maintainer caveat)
- **What:** The fix only works if `acmd.users` is created by the superuser (matching the implicit grantor of the ALTER DEFAULT PRIVILEGES statement). Task.md context line 8 states explicitly: "`acmd.users` is owned by superuser (`vollos`), NOT `acmd_user`". If a future migration changes ownership of `acmd.users` to `acmd_user` (or another role), this default-privilege rule would no longer apply to that table — but the table would then be owned by `acmd_user` and FK creation would not need REFERENCES anyway (owners always have full privilege on their own tables).
- **Where:** scripts/init-db.sh:75-78 (acmd block); task.md:8
- **Evidence (verified by me):** init-db.sh creates schemas + users only — no CREATE TABLE for `acmd.users`. Table creation is delegated to migrations (task.md:8). The comment on line 76 correctly captures the dependency: "FK -> acmd.users owned by superuser".
- **Recommendation:** None required for this change. Note for future maintainers: if migration policy ever flips to making `acmd_user` own `acmd.users`, the REFERENCES default will become a no-op (harmless) — no security consequence either way.

### [A5] Idempotency / fresh-volume scope — production DB safety — Note (PASS)
- **What:** `init-db.sh` only executes on a fresh `$PGDATA` (postgres entrypoint behavior, documented in scripts/init-db.sh:6 and :33-35). Existing prod volume is therefore unaffected by this change. Task.md:12 explicitly acknowledges: "no prod DB action needed (existing prod DB unaffected since no FK migration has been attempted there yet)."
- **Where:** scripts/init-db.sh:6, 33-35; task.md:12
- **Evidence (verified by me):** scripts/init-db.sh:6 — `# Executed by the official postgres image when it discovers this file under /docker-entrypoint-initdb.d/. Runs ONCE on a fresh data volume`. docker-compose.yml:18-21 mounts the script read-only into `/docker-entrypoint-initdb.d/`, confirming the official postgres-image semantics apply.
- **Recommendation:** None. Production safety preserved (rule I1-I5 not triggered since no migration applies here).

### [A6] No injection vector introduced — Note (PASS)
- **What:** The new line 76 is a static SQL comment; line 78 is hardcoded SQL with no variable interpolation. No new shell or psql `--set` substitutions were added. Existing password substitution path (psql `:'VAR'` client-side, lines 41-43, 56-58) is unchanged.
- **Where:** scripts/init-db.sh:76-78 (changed region); 41-43, 56-58 (unchanged substitution path)
- **Evidence (verified by me):** Diff shows two added lines, both pure literal SQL, no `$`, `:`, backtick, or `${...}` introduced. The `EOSQL` heredoc is single-quoted (line 43: `<<'EOSQL'`), preventing shell expansion.
- **Recommendation:** None.

### [A7] Comment correctness — accurate and not misleading — Note (PASS)
- **What:** The new comment on line 76 states: "REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK -> acmd.users owned by superuser)". This is technically correct: REFERENCES is the privilege Postgres requires on the *referenced* table for FK creation; the comment specifies "pointing to" (the referenced side); it correctly notes ownership context as the trigger for needing this default-privilege rule.
- **Where:** scripts/init-db.sh:76
- **Evidence (verified by me):** Line content matches output.md ac4 claim exactly. The phrasing distinguishes referencing-table-side vs referenced-table-side correctly (a common confusion). A future maintainer reading this comment would not be misled into thinking it grants data access.
- **Recommendation:** None. (Minor optional improvement: could append "(metadata-only privilege; does not grant data access)" for extra defensive documentation, but this is gold-plating — not required.)

## Verification log (proves Trust No One)
- Read scripts/init-db.sh:1-79 in full — confirmed only the acmd block was modified; auth/vollos/REVOKE/CREATE SCHEMA/CREATE USER/ALTER USER blocks all match pre-change shape.
- Confirmed REFERENCES added at line 78 — quote: `  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO acmd_user;`
- Confirmed auth block at line 67 unchanged — quote: `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;` (no REFERENCES)
- Confirmed vollos block at line 72 unchanged — quote: `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;` (no REFERENCES)
- Confirmed comment at line 76 — quote: `-- REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK -> acmd.users owned by superuser)`
- Ran `git show 0841eccd -- scripts/init-db.sh` — diff is exactly +2/-1, all within the acmd block. Matches output.md ac5 claim.
- Ran `git diff e324e72..0841eccd -- scripts/init-db.sh` independently — same diff confirmed against fresh-main base.
- Ran placeholder grep on scripts/init-db.sh — exit=1 (no matches). Matches output.md ac12 claim.
- Architecture rule C1 (schema-per-product, no prefix) — pass: change uses `acmd` schema, not `acmd_*` table prefix.
- Architecture rule C5 (per-schema user isolation) — pass: `acmd_user` privilege change does not affect `auth.*` or `vollos.*` (verified by grep above); cross-schema isolation preserved.
- Architecture rule C6 (init-db.sh runs as superuser, fresh volume only) — pass: docker-compose.yml:21 mounts script into `/docker-entrypoint-initdb.d/`; scripts/init-db.sh:38 invokes psql with `--username "${POSTGRES_USER}"` (superuser).
- PII handling — assessed: REFERENCES is metadata-only per SQL/Postgres standard; `acmd_user` already has SELECT on acmd.users via prior default privileges; this change does NOT widen data access.
- Cross-repo write check — confirmed all changes are inside `vollos-core/scripts/init-db.sh` only; no acmd repo files touched (consistent with cross-repo policy).

## Verdict
- **PASS**
- Critical: 0 / High: 0 / Medium: 0 / Low: 0 / Note: 7
- Reasoning: Logic + Security review confirms the change is minimal (+2/-1 in a single file, single schema block), introduces no privilege escalation (REFERENCES is metadata-only, not a data-access grant), preserves cross-schema isolation (auth/vollos blocks verified untouched by independent grep), and is correctly scoped to fresh-volume bootstrap (no prod DB impact). Comment is accurate and not misleading. No findings require remediation. Safe to merge after QA confirms migration-unblock evidence (out of my scope).
