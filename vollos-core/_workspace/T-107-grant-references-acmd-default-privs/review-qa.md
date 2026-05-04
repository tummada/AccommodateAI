# T-107 QA Review (fresh eyes — Data Integrity)

**Reviewed:** 2026-04-30T11:30+07:00
**Files reviewed:** `scripts/init-db.sh` (full), `docker-compose.yml` (full),
`_workspace/T-107-grant-references-acmd-default-privs/task.md` (full),
`_workspace/T-107-grant-references-acmd-default-privs/output.md` (full),
plus `git show 0841eccd` and `git diff origin/main..fix/infra-grant-references-acmd -- scripts/init-db.sh`.
**Verification approach:** Read all files myself; re-ran shellcheck + placeholder grep
locally; cross-checked postgres GRANT / ALTER DEFAULT PRIVILEGES grammar and ACL
abbreviation table from postgres docs; did NOT trust `output.md` `self_review` blindly —
spot-checked every `file:line` claim.

## Findings

### [Q1] GRANT syntax — CORRECT — Note
- **What:** The new privilege list `SELECT, INSERT, UPDATE, DELETE, REFERENCES`
  on line 78 conforms to postgres `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES`
  grammar. The grammar accepts a comma-separated list of any subset of
  `{ SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }`,
  order is not significant.
- **Where:** `scripts/init-db.sh:77-78`
  ```
  ALTER DEFAULT PRIVILEGES IN SCHEMA acmd
    GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO acmd_user;
  ```
- **Why it matters for data integrity:** Wrong syntax would cause `init-db.sh`
  to abort under `ON_ERROR_STOP=1`, leaving the schema half-bootstrapped on a
  fresh volume. Syntax verified correct.
- **Evidence (verified by me):** Postgres docs (GRANT / ALTER DEFAULT PRIVILEGES
  reference) define the privilege token set explicitly; `REFERENCES` is one of
  the seven tokens valid `ON TABLES`. Append-at-end placement keeps diff minimal
  (1 line modified, no reflow).
- **Recommendation:** None — accept as-is.

### [Q2] Schema scope — CONFINED to `acmd` — Note
- **What:** Auth and vollos `ALTER DEFAULT PRIVILEGES` blocks are byte-identical
  to pre-change state (still 4-privilege list).
- **Where:**
  - `scripts/init-db.sh:66-67` — auth block: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;`
  - `scripts/init-db.sh:71-72` — vollos block: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;`
- **Why it matters for data integrity:** Confirms no collateral privilege widening
  on adjacent schemas; FK-creation capability is granted only where requested.
- **Evidence (verified by me):** `git diff origin/main..fix/infra-grant-references-acmd -- scripts/init-db.sh`
  shows ONLY the acmd block hunk (`@@ -73,6 +73,7 @@`); auth and vollos hunks are
  absent from the patch. `git diff --stat` reports `1 file changed, 2 insertions(+), 1 deletion(-)`
  — matches AC #5.
- **Recommendation:** None.

### [Q3] Idempotency / fresh-volume semantics — CORRECT — Note
- **What:** `init-db.sh` is mounted at `/docker-entrypoint-initdb.d/init-db.sh`
  and executed by the official `postgres:17-alpine` entrypoint, which only runs
  `initdb.d/*` on an empty `$PGDATA` (fresh volume). Existing volumes skip the
  script entirely.
- **Where:** `docker-compose.yml:18-21` (volume mount), `scripts/init-db.sh:33-36`
  (in-script comment confirms fresh-volume contract).
- **Why it matters for data integrity:** Existing prod DB will NOT re-run this
  script (no double-GRANT, no role-collision). The change only takes effect on
  truly fresh volumes (local dev resets, brand-new VPS). Matches owner constraint
  "template change only".
- **Evidence (verified by me):** docker-compose.yml line 21 mounts the script
  read-only at the entrypoint path; no `command:` override forces a re-run.
- **Recommendation:** None.

### [Q4] Migration unblock claim — CORRECT for stated scenario — Note
- **What:** Task.md (lines 7-10) states `acmd.users` is owned by superuser
  (`vollos`), not `acmd_user`. The migrations create downstream tables and add FKs
  pointing at `acmd.users`. Postgres requires REFERENCES on the target table to
  create an FK pointing to it.
- **Where:** Logic spans `scripts/init-db.sh:75-78` (the change) plus task.md
  context (no in-repo migration verifies this directly — acmd repo is separate
  per task.md line 13 and CLAUDE.md repo isolation rule).
- **Why it matters for data integrity:** ALTER DEFAULT PRIVILEGES (no `FOR ROLE`
  clause) defaults to "tables created by the role issuing the statement" — here
  `${POSTGRES_USER}` = `vollos` superuser (per `docker-compose.yml:9` and
  `scripts/init-db.sh:38`). So when superuser later creates `acmd.users`,
  `acmd_user` automatically inherits REFERENCES → FK migrations from
  `acmd_user` succeed. Caveat: if any future acmd table is created **by
  `acmd_user` itself**, that user already owns it and trivially has REFERENCES
  — ALTER DEFAULT PRIVILEGES is irrelevant in that path but does no harm. The
  stated scenario (FK → superuser-owned `acmd.users`) is exactly the case this
  patch unblocks.
- **Evidence (verified by me):** Postgres docs (ALTER DEFAULT PRIVILEGES,
  "Notes" section): "ALTER DEFAULT PRIVILEGES allows you to set the privileges
  that will be applied to objects created in the future. … The privileges will
  be applied to objects created by the user that runs `ALTER DEFAULT PRIVILEGES`
  unless `FOR ROLE` is specified." `init-db.sh` runs as `${POSTGRES_USER}`
  (verified at `scripts/init-db.sh:38` `--username "${POSTGRES_USER}"`), and
  docker-compose injects `POSTGRES_USER` at line 9.
- **Recommendation:** None — fix is correct for the stated scenario. (Out of
  scope but worth flagging for owner if relevant: if acmd repo ever migrates
  to running schema-bootstrap as `acmd_user` itself, this default-privs entry
  becomes moot but harmless.)

### [Q5] Runtime ACL interpretation `acmd_user=arwdx/vollos` — CORRECT — Note
- **What:** Output.md (lines 19-22) reports `\dp acmd.users` showed
  `acmd_user=arwdx/vollos` after running the script in a throwaway
  postgres:16-alpine container, and decodes `x` = REFERENCES.
- **Where:** `output.md:19-22`, `output.md:47`.
- **Why it matters for data integrity:** This is the load-bearing piece of
  evidence that the GRANT actually produced REFERENCES at runtime, not just
  syntactically.
- **Evidence (verified by me):** Postgres docs (GRANT reference, "Privilege
  Abbreviations" table) defines the canonical mapping:
  `a` = INSERT, `r` = SELECT, `w` = UPDATE, `d` = DELETE, `D` = TRUNCATE,
  `x` = REFERENCES, `t` = TRIGGER. So `arwdx` = INSERT + SELECT + UPDATE +
  DELETE + REFERENCES — exactly the 5-privilege list granted on line 78.
  The grantor `vollos` after the slash matches `POSTGRES_USER` (superuser).
  Worker's interpretation matches postgres docs verbatim.
  I cannot independently re-run the throwaway container from this review
  context, but the reported ACL string is internally consistent with the
  GRANT statement and with `has_table_privilege('acmd_user','acmd.users','REFERENCES') = t`
  also reported. Optional AC #7 satisfied.
- **Recommendation:** None.

### [Q6] Reversibility — TRIVIAL — Note
- **What:** Single commit, single-file change, no DDL on existing tables, no
  data migration. `git revert 0841ecc` fully restores prior state. On already-
  initialized DBs the change has no effect anyway (init-db.sh doesn't re-run).
- **Where:** Commit `0841eccd79a5a5c2a46cb9286f6e6ad47ca719e8`.
- **Why it matters for data integrity:** Worst-case rollback is a one-line
  revert; no orphaned constraints, no data loss path.
- **Recommendation:** None — document via standard git revert if needed.

### [Q7] Constraint integrity on existing tables — UNAFFECTED — Note
- **What:** No `ALTER TABLE`, no `DROP CONSTRAINT`, no DDL on existing objects
  in the diff. Only `ALTER DEFAULT PRIVILEGES` (forward-looking metadata) is
  modified.
- **Where:** Verified via `git diff origin/main..fix/infra-grant-references-acmd -- scripts/init-db.sh`
  — patch hunk touches only the acmd ALTER DEFAULT PRIVILEGES line + an adjacent
  comment line.
- **Why it matters for data integrity:** Existing FK constraints, table
  ownership, and data are untouched. No risk to current data.
- **Recommendation:** None.

### [Q8] Documentation comment quality — ADEQUATE — Note
- **What:** The new comment on line 76 reads:
  `-- REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK -> acmd.users owned by superuser)`
  It tells a future maintainer (a) which privilege was added, (b) why, (c) the
  ownership context that motivates it.
- **Where:** `scripts/init-db.sh:76`.
- **Why it matters for data integrity:** Future maintainers know not to "clean
  up" the privilege without understanding the FK migration dependency. Comment
  is in English, single line, references the concrete failing case.
- **Recommendation:** None — meets AC #4. (Minor nit, not blocking: comment uses
  ASCII `->` rather than the unicode `→` used elsewhere in `init-db.sh`. Both
  render fine; consistency would be marginal polish only.)

## Verification log (proves Trust No One)
- Re-ran `shellcheck scripts/init-db.sh` myself → exit 0, no output. Confirms AC #6.
- Re-ran `grep -nE 'alert\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' scripts/init-db.sh`
  → exit 1 (no matches). Confirms AC #12.
- Ran `git diff --stat origin/main..fix/infra-grant-references-acmd -- scripts/init-db.sh`
  → reported `1 file changed, 2 insertions(+), 1 deletion(-)` — matches AC #5
  exactly.
- Ran `git show 0841eccd -- scripts/init-db.sh` → confirms the exact patch hunk
  is comment line + privilege list change; no other lines modified.
- Confirmed acmd ALTER DEFAULT PRIVILEGES syntax is valid postgres GRANT
  grammar (token list `SELECT, INSERT, UPDATE, DELETE, REFERENCES` is a legal
  subset of `{SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER}`).
- Confirmed `x` in postgres ACL = REFERENCES (postgres docs GRANT reference,
  "Privilege Abbreviations" table: `a` INSERT, `r` SELECT, `w` UPDATE, `d` DELETE,
  `D` TRUNCATE, `x` REFERENCES, `t` TRIGGER). Output.md interpretation matches.
- Confirmed runtime test ACL `acmd_user=arwdx/vollos` decodes as INSERT+SELECT+
  UPDATE+DELETE+REFERENCES granted by superuser `vollos` — internally consistent
  with the GRANT statement on line 78.
- Confirmed `init-db.sh` runs as `${POSTGRES_USER}` (superuser): `scripts/init-db.sh:38`
  `--username "${POSTGRES_USER}"`; docker-compose injects POSTGRES_USER at
  `docker-compose.yml:9`. So ALTER DEFAULT PRIVILEGES (no FOR ROLE) attaches
  defaults to objects created by superuser — the stated scenario.
- Confirmed scenario assumption: per task.md:7-10, `acmd.users` is created by
  superuser during/before migration time, NOT by `acmd_user`. The fix targets
  exactly that path: superuser-created table → default privilege grants
  REFERENCES to acmd_user → acmd_user can author FK pointing to it. No-op (but
  harmless) for the alternate path of acmd_user-owned tables.
- Confirmed `auth` block at lines 66-67 and `vollos` block at lines 71-72 are
  byte-identical to pre-patch (still 4 privileges, no REFERENCES) — Q2 above.
- Confirmed no acmd migration files live in this repo (acmd is a separate
  product repo per CLAUDE.md L5 + task.md:13). The migration that motivated this
  change lives in `vollos-acmd`; it is correctly out-of-scope for this MR.
- Confirmed branch base: commit before `0841ecc` is `e324e72`, which is
  `origin/main` HEAD (`git log --oneline -5 fix/infra-grant-references-acmd`).
  Matches AC #8 (branched from fresh origin/main, not stale
  `chore/board-session-011-close`).
- Confirmed conventional-commit subject:
  `fix(infra): grant REFERENCES on acmd default privileges for FK migrations`
  matches AC #9 verbatim.

## Verdict
- **PASS**
- Critical: 0 / High: 0 / Medium: 0 / Low: 0 / Note: 8
- Reasoning: Within Data Integrity scope, the GRANT syntax is valid postgres
  ALTER DEFAULT PRIVILEGES grammar; the change is byte-confined to the acmd
  block (auth and vollos blocks unchanged); fresh-volume semantics ensure no
  re-run risk on existing prod DB; the runtime ACL string `acmd_user=arwdx/vollos`
  decodes correctly to include REFERENCES per postgres docs; the fix matches
  the stated FK-migration scenario (superuser-owned `acmd.users`); reversal is
  a one-line `git revert`; no existing constraints are touched; the in-file
  comment adequately documents the rationale. All output.md `self_review`
  claims I could verify locally (shellcheck, grep, diff, branch base, commit
  subject) reproduce exactly. Recommend Auditor proceed with security review
  on remaining scope (REFERENCES privilege escalation surface, cross-schema
  leakage check).
