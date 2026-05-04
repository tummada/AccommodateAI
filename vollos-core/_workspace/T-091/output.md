---
task_id: T-091
agent: vollos-devops
status: completed
started_at: 2026-04-29T10:25+07:00
finished_at: 2026-04-29T10:30+07:00
branch: fix/sync-secrets-curl-argv-leak
commit: 27a3aae54ab0b9e6420ccce5713a9a9684d1ef0f
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/31
mr_state: opened
secret_handling: "9-pattern scan run pre-push, 0 matches in _workspace/T-091/"
---

## secret_handling_acknowledgment

```yaml
read_forbid_list: true
will_not_run_forbidden_commands: true
will_redact_values_in_output: true   # only sentinel values + sha8 fingerprints printed
will_cleanup_at_end: true            # TEST_FIX_T091 deleted from both ends, /tmp/T-091-* shredded
understood_consequences_of_leak: true
```

## skill_loaded_evidence

- `/home/ipon/.claude/skills/vollos-devops/SKILL.md:36-39` — "ก่อนรัน command ที่อาจ resolve env vars/secrets ... อ่าน memory feedback_secret_handling_protocol.md ก่อน"
- `/home/ipon/.claude/skills/vollos-devops/SKILL.md:464-471` — "Critical Rules: ห้าม spawn Agent tool ... ห้ามบอก เสร็จ โดยไม่แสดง verification output"

## re_anchor_evidence

- Critical Rules re-read before delivery: spawn-Agent-forbidden + verification-output-required
- Security Rules re-read before delivery: Secret Handling Protocol forbid list, sha8 fingerprints only, cleanup mandatory
- vollos-core CLAUDE.md re-read: F1-F6 (CI/CD), G1-G3 (MR review), J1-J3 (secret management)

## summary

Fixed LOW-1 from `_workspace/T-089/audit-mr28.md`: curl `--form-string "value=$(cat ${valfile})"` exposed plaintext secret in argv during `gitlab_put_var` and `gitlab_post_var` execution. Replaced with curl's native `--form value=<${valfile}` syntax (curl loads from disk inside its own process — argv contains only the file path).

Secondary necessary fix: switched the four `jq -r '.value' > file` writes to `jq -j` (no trailing newline). Without this, `--form value=<file` would have uploaded the trailing `\n` that `jq -r` adds, mutating values and breaking GitLab's `masked=true` validation. Verified empirically (POST 400 with `jq -r`, POST 201 with `jq -j`). Sha8 fingerprints stay byte-identical between source/target reads because both sides now use `jq -j`.

No other functions touched. No env vars added. No new docs.

## files_changed

- path: `scripts/sync-secrets.sh`
  action: modified
  lines: +19 / -6 (1 file changed)
  existing_read: "scripts/sync-secrets.sh:113-152 — gitlab_put_var/gitlab_post_var pre-fix; :245-260 — source value file write; full file read before edit"
  changes:
    - "lines 118-122 — added SECURITY comment block above gitlab_put_var curl"
    - "line 126 — `--form-string \"value=$(cat ...)\"` → `--form \"value=<${valfile}\"` (PUT)"
    - "lines 139-141 — added SECURITY comment block above gitlab_post_var curl"
    - "line 146 — `--form-string \"value=$(cat ...)\"` → `--form \"value=<${valfile}\"` (POST)"
    - "lines 251-256 — added SECURITY comment block explaining jq -j choice"
    - "lines 254, 297, 316, 349 — `jq -r '.value'` → `jq -j '.value'` (4 sites; no trailing newline)"

## verification

### bash -n + shellcheck

```
$ bash -n scripts/sync-secrets.sh && shellcheck scripts/sync-secrets.sh && echo "ALL CLEAN"
ALL CLEAN
```

shellcheck version: 0.10.0 — 0 warnings.

### Dry-run regression (production config)

```
$ ./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --dry-run
=== sync-secrets.sh — dry-run mode ===
Source: tummadajingjing/vollos-core
Targets: tummadajingjing/vollos-acmd
Keys:    GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN GMAIL_USER

[tummadajingjing/vollos-acmd]
  GOOGLE_CLIENT_ID       sha256:4825240a  ✅ already in sync
  GOOGLE_CLIENT_SECRET   sha256:f56ab154  ✅ already in sync
  GOOGLE_REFRESH_TOKEN   sha256:57523e6e  ✅ already in sync
  GMAIL_USER             sha256:ab64470e  ✅ already in sync

Summary: 0 created, 0 updated, 4 already in sync, 0 errors.
```

4/4 in sync (matches T-088 baseline). Note: sha8 fingerprints differ from T-087/T-088 because values are now hashed without their trailing `\n` — this is the intended behavior change of `jq -r → jq -j`. Within this run, source and target fingerprints match exactly because both are computed via the same path.

### Apply test (throwaway TEST_FIX_T091, full round-trip)

**Step 1 — created at source via direct API** (using `--form-string key=...` + `--form-string value=...` for pre-condition only — irrelevant to script):
```
HTTP 201 → tummadajingjing/vollos-core/variables/TEST_FIX_T091 = hello-fix-2026 (protected=false, masked=false)
```

**Step 2 — script POST to acmd (CREATE path)**:
```
$ ./scripts/sync-secrets.sh --target tummadajingjing/vollos-acmd --keys TEST_FIX_T091 --apply
[tummadajingjing/vollos-acmd]
  TEST_FIX_T091          sha256:f3095f31  ➕ CREATED
Summary: 1 created, 0 updated, 0 already in sync, 0 errors.
```
Script's verify-after-write loop confirmed sha8 match (would have exit 5 otherwise).

**Step 3 — value updated at source then script PUT to acmd (UPDATE path)**:
```
$ ./scripts/sync-secrets.sh --target tummadajingjing/vollos-acmd --keys TEST_FIX_T091 --apply
[tummadajingjing/vollos-acmd]
  TEST_FIX_T091          sha256:80caae18  🔄 UPDATED (was sha256:f3095f31)
Summary: 0 created, 1 updated, 0 already in sync, 0 errors.
```

**Step 4 — cleanup**:
```
core_delete=204
acmd_delete=204
core_get=404
acmd_get=404
```

Both ends deleted (204) and confirmed gone (404). No artifacts left.

### Argv leak verification

Watcher script polled `pgrep -x curl` and read `/proc/<pid>/cmdline` for any curl process during the PUT in step 3 above. Watched for two sentinel patterns: `changed-value-T091-argv-test` (current source value) and `hello-fix-2026` (prior source value).

```
samples_observed=64
RESULT=NO_LEAK
```

64 distinct curl process samples taken via `/proc/<pid>/cmdline` during sync execution → **0 hits** for either sentinel value in any curl argv. The fix is empirically verified: secret no longer appears in process command-line.

(Pre-fix the same watcher would have found at least one match per sync, since `$(cat ${valfile})` placed the value as a literal argv element.)

### Secret scan (9-pattern, _workspace/T-091/)

Per `feedback_secret_handling_protocol.md` + CLAUDE.md `_workspace/` Git Policy:
```
glpat-*       → 0 matches
ghp_*         → 0 matches
AKIA*         → 0 matches
BEGIN KEY     → 0 matches (verified with /bin/grep -- to bypass ugrep flag parsing)
NODEMAILER..  → 0 matches
TELEGRAM...   → 0 matches
CLOUDFLARE..  → 0 matches
bcrypt $2[aby]→ 0 matches
password=...  → 0 matches
```

Safe to push.

## self_review

```yaml
self_review:
  - field: "all_curl_calls_use_value_from_file"
    result: true
    evidence: "scripts/sync-secrets.sh:126 (PUT) and :146 (POST) — both use `--form value=<${valfile}` reading from disk inside curl process; verified by `grep -n -E 'curl.*(--form|--form-string).*value' scripts/sync-secrets.sh` returning 0 matches for the vulnerable pattern, plus diff in MR !31 shows -2/+2 on the targeted lines"
  - field: "shellcheck_clean"
    result: true
    evidence: "shellcheck 0.10.0 on scripts/sync-secrets.sh → exit 0, 0 warnings printed (output captured under § verification: bash -n + shellcheck above)"
  - field: "dry_run_no_regression"
    result: true
    evidence: "scripts/sync-secrets.sh dry-run with production config → 4 keys all `✅ already in sync`, `Summary: 0 created, 0 updated, 4 already in sync, 0 errors.` — matches T-088 baseline (4/4 in sync, 0 errors). Sha8 fingerprints differ from T-088 because of the `jq -r → jq -j` byte-content change; within-run source/target consistency confirmed by the in-sync verdict"
  - field: "apply_test_throwaway_key_passed"
    result: true
    evidence: "TEST_FIX_T091 round-trip captured under § verification: Apply test — POST 201 → CREATED (sha256:f3095f31), then source updated → PUT 200 → UPDATED (sha256:80caae18 was f3095f31), then DELETE 204 from both vollos-core + vollos-acmd, GET 404 confirms gone. Script's own verify-after-write loop (sync-secrets.sh:303-318 + :336-358) would have exit 5 on sha8 mismatch — exited 0 in both runs"
  - field: "argv_leak_check_passed"
    result: true
    evidence: "/proc/<pid>/cmdline watcher script captured 64 curl process samples during PUT round (sentinel value `changed-value-T091-argv-test` plus prior sentinel `hello-fix-2026`); RESULT=NO_LEAK reported. Watcher source at /tmp/T-091-argv-watch.sh during run (now removed); evidence preserved verbatim under § verification: Argv leak verification"
  - field: "tmp_files_cleanup_verified"
    result: true
    evidence: "scripts/sync-secrets.sh:213-226 — `mktemp -d -t T-088-sync-XXXXXX` + chmod 700 + trap cleanup EXIT INT TERM (calls `find -type f -exec shred -u + && rm -rf` on the tmpdir + `unset VOLLOS_CLI_v2`) — UNCHANGED by this MR. Post-task spot-check: `ls -d /tmp/T-088-sync-* 2>&1` → 'no matches found' (zero residual tmpdirs). Local test files /tmp/T-091-* also removed (`ls /tmp/T-091-* 2>&1` → 'no matches found')"
  - field: "auditor_low1_closed"
    result: true
    evidence: "_workspace/T-091/audit-fix.md:13-15 verdict PASS + LOW-1 explicitly marked closed (§ LOW-1 closure verification, lines 25-50) + 0 new findings (§ Findings by severity: CRITICAL/HIGH/MEDIUM/LOW = 0/0/0/0, INFO=1 observation only). Audit invoked inline because vollos-devops SKILL.md:466 forbids `Agent tool` spawn — same precedent as T-089/audit-mr28.md (auditor inline)"
  - field: "branch_pushed_mr_opened"
    result: true
    evidence: "MR URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/31 (state: opened) — verified via `curl GET /merge_requests?source_branch=fix/sync-secrets-curl-argv-leak&state=opened` returning iid=31 + state=opened + matching title; commit 27a3aae54ab0b9e6420ccce5713a9a9684d1ef0f on branch fix/sync-secrets-curl-argv-leak"
```

## placeholders_remaining

none — grep clean.

```
$ grep -nE "alert\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]" scripts/sync-secrets.sh
(no output)
```

## next_action

null — task completed. Awaiting Lead review of MR !31 + owner approval.

If Lead wants formal vollos-auditor (separate context) sub-spawn instead of inline audit, that is a separate task: spawn vollos-auditor with `_workspace/T-091/audit-fix.md` as starting context + ask for confirmation/disagreement. The inline audit followed the T-089 precedent because vollos-devops SKILL.md:466 forbids spawning Agent tool from this role.

## issues

[]

## notes

- Sha8 fingerprints visible in dry-run output changed vs prior runs (T-087/T-088) because values are now hashed without trailing `\n`. This is one-time and expected. Documented in audit-fix.md.
- The `jq -r → jq -j` change was discovered necessary during apply test (initial attempt with `--form value=<file` + `jq -r` returned HTTP 400 because of trailing-newline + masked=true). Without this fix the security improvement would have broken the script. Now both correctness and security are addressed in the same patch.
- TEST_FIX_T091 was created via direct API call (`--form-string key=... --form-string value=...`) only as a pre-condition to test the script — not via the script. No production secret value entered any test argv.
- `bash history` will contain the sentinel value `hello-fix-2026` and `changed-value-T091-argv-test` strings (used in test). These are not secrets, but operator may run `history -c && history -w` if desired.
