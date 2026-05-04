task_id: T-107
status: ready_for_review
files_changed:
  - path: scripts/init-db.sh
    diff_summary: "+1 added line REFERENCES in acmd ALTER DEFAULT PRIVILEGES, +1 added comment line, -1 removed prior GRANT line (net +2 -1)"
branch: fix/infra-grant-references-acmd
commit_sha: 0841eccd79a5a5c2a46cb9286f6e6ad47ca719e8
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/43
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2490688047
shellcheck: "0 warnings"
secret_handling: "9-pattern scan run pre-push, 0 matches"
placeholders_remaining: none — grep clean
optional_test:
  ran: true
  result: |
    Spawned throwaway postgres:16-alpine container with scripts/init-db.sh mounted at /docker-entrypoint-initdb.d/init-db.sh.
    Container logs show clean run: REVOKE, 3x CREATE SCHEMA, 3x CREATE ROLE, 3x ALTER ROLE, 3x GRANT, 3x ALTER DEFAULT PRIVILEGES (all succeeded).
    After init: CREATE TABLE acmd.users (id serial primary key) as superuser → \dp acmd.users shows:
      vollos=arwdDxt/vollos
      acmd_user=arwdx/vollos
    The 'x' in acmd_user=arwdx is the REFERENCES privilege per postgres ACL grammar (a=INSERT r=SELECT w=UPDATE d=DELETE x=REFERENCES).
    has_table_privilege('acmd_user', 'acmd.users', 'REFERENCES') → t (TRUE).
    Control: CREATE TABLE auth.x as superuser → has_table_privilege('auth_user', 'auth.x', 'REFERENCES') → f (FALSE) — confirming auth schema unchanged.
    Container stopped+removed (--rm).

self_review:
  ac1_references_added:
    result: true
    evidence: "scripts/init-db.sh:78 — 'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON TABLES TO acmd_user;' (REFERENCES appended to existing list, minimal diff)"
  ac2_auth_unchanged:
    result: true
    evidence: "scripts/init-db.sh:67 — 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;' (verified by grep; no REFERENCES); also runtime control: has_table_privilege('auth_user','auth.x','REFERENCES')=f"
  ac3_vollos_unchanged:
    result: true
    evidence: "scripts/init-db.sh:72 — 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;' (verified by grep; no REFERENCES)"
  ac4_comment_added:
    result: true
    evidence: "scripts/init-db.sh:76 — '-- REFERENCES: required so acmd_user can create FK constraints pointing to acmd.* tables (e.g., FK -> acmd.users owned by superuser)'"
  ac5_minimal_diff:
    result: true
    evidence: "git diff scripts/init-db.sh: 1 file changed, 2 insertions(+), 1 deletion(-) — only the comment line and the GRANT line; nothing else touched"
  ac6_shellcheck:
    result: true
    evidence: "shellcheck scripts/init-db.sh — exit 0, no output (0 warnings)"
  ac7_optional_db_test:
    result: true
    evidence: "throwaway postgres:16-alpine container ran init-db.sh successfully; \\dp acmd.users showed 'acmd_user=arwdx/vollos' (x=REFERENCES); has_table_privilege('acmd_user','acmd.users','REFERENCES')=t; auth control returned f (see optional_test.result above)"
  ac8_branch_from_fresh_main:
    result: true
    evidence: "git fetch origin main → origin/main at e324e72; git switch -c fix/infra-grant-references-acmd origin/main → branch base = e324e723041b0f9b706e1abbcddf8d38c2a53de2 (verified via git merge-base HEAD origin/main); did NOT branch from chore/board-session-011-close"
  ac9_conventional_commit:
    result: true
    evidence: "commit 0841ecc subject: 'fix(infra): grant REFERENCES on acmd default privileges for FK migrations' (matches required format exactly)"
  ac10_mr_opened:
    result: true
    evidence: "https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/43 (opened via glab mr create against target=main)"
  ac11_self_review_complete:
    result: true
    evidence: "this self_review section — every AC has result: true and file:line evidence"
  ac12_placeholder_audit:
    result: true
    evidence: "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' scripts/init-db.sh → exit 1 (no matches)"

summary: |
  Added REFERENCES to ALTER DEFAULT PRIVILEGES IN SCHEMA acmd in scripts/init-db.sh (line 78) plus a 1-line explanatory comment (line 76). auth and vollos schema blocks remain untouched (lines 67 and 72 still SELECT, INSERT, UPDATE, DELETE only). Diff is +2/-1 in a single file. shellcheck clean (0 warnings), 9-pattern secret scan on _workspace/T-107/ clean (0 matches), placeholder audit clean. End-to-end verified on a throwaway postgres:16-alpine container — has_table_privilege('acmd_user', 'acmd.users', 'REFERENCES') returns true; auth control returns false. Branched from fresh origin/main (e324e72), committed as fix(infra): ..., MR opened at https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/43, pipeline running at https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2490688047. Awaiting CI green + owner approval; no blockers.

blockers: []
