---
task_id: T-091
title: Fix LOW-1 — sync-secrets.sh curl argv leak (use --form value=<file)
agent: vollos-devops
spawn_started_at: 2026-04-29T10:25+07:00
mode: MODE_1
priority: medium (hardening — owner approved 2026-04-29)
estimated_time: 20 min
dependencies: [T-088 (sync-secrets.sh on main), T-089 (audit findings)]
parent_context: "Auditor T-089 review of MR !28 found LOW-1: curl `--form-string \"value=$(cat ${valfile})\"` exposes secret value in process argv (briefly visible to ps/proc on the runner during execution). Owner approved fix 2026-04-29. Reference: _workspace/T-089/audit-mr28.md."
---

## Goal

แก้ LOW-1 finding — เปลี่ยน curl call ใน `scripts/sync-secrets.sh` ให้อ่าน value จากไฟล์โดยตรง (`--form value=<file`) แทนการ inline ผ่าน `$(cat ...)` หรือ `--form-string "value=$VAR"` ที่ทำให้ value โผล่ใน argv

## Owned Files

- **MODIFIED:** `scripts/sync-secrets.sh` (เฉพาะ curl POST/PUT calls — ห้ามแตะส่วนอื่น)

## Branch Strategy

- Sync main (มี MR !28..!30 merged แล้ว)
- Branch: `fix/sync-secrets-curl-argv-leak`
- Open MR + spawn Auditor verify fix

## Exact Fix Pattern

### Before (vulnerable — value visible in argv briefly):

```bash
curl ... --form-string "value=$VALUE" ...
# OR
curl ... --form "value=$(cat $valfile)" ...
```

### After (safe — curl reads from file directly, never enters argv):

```bash
# Use curl's @file syntax for --form OR <file for --form-string-from-file
curl ... --form "value=<${valfile}" ...
```

อ้างอิง: curl manual `--form` supports `<filename` to read content from file (raw, no urlencode), ดู `man curl` ค้น `<filename`.

⚠️ **Verify** ว่า curl behavior ของ `--form "value=<file"` ส่ง raw content ตรง ไม่ทำ urlencode (เหมาะกับ GitLab API ที่รับ multipart/form-data) — ถ้ามีปัญหา switch ไปใช้ `--data-binary "@file"` + `--header "Content-Type: ..."` แทน

## Implementation Steps

```bash
cd /home/ipon/workspace/vollos-ai/vollos-core
git checkout main
git pull origin main
git branch -d chore/caddy-acmd-upstream-port-8080  # cleanup if MR !30 merged
git checkout -b fix/sync-secrets-curl-argv-leak

# Identify all curl calls handling secret values in scripts/sync-secrets.sh
grep -n -E "curl.*(--form|--form-string).*value" scripts/sync-secrets.sh

# Refactor: write VALUE to a temp file (mode 0600), then curl reads via <file syntax
# Pattern (per curl call):
#   - Write value to /tmp/T-091-val-$$ with mktemp + chmod 600
#   - curl ... --form "value=<$valfile" ...
#   - shred -u $valfile after curl returns

# Use Edit tool to make exact changes — preserve all logic + indent

# Validate:
bash -n scripts/sync-secrets.sh                         # syntax check
shellcheck scripts/sync-secrets.sh                      # 0 warnings expected (per T-088 baseline)
```

### Test plan (must pass before commit)

1. **Dry-run regression:** `./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --dry-run`
   - Expected: 4/4 keys "already in sync" (matches T-087/T-088 baseline)
2. **Apply test with throwaway key:**
   - Add `TEST_FIX_T091=hello-fix-2026` to vollos-core
   - Run sync to vollos-acmd
   - Verify sha256 match (auto by script)
   - Delete TEST_FIX_T091 from both ends
3. **Argv leak verification:**
   - Run sync in background + immediately `ps -ef | grep curl` in another shell
   - Expected: NO secret value in argv list (only file path or `<filename` syntax)
   - This is the actual fix verification — must demonstrate

## Acceptance Criteria

1. ✅ All curl calls in `scripts/sync-secrets.sh` no longer expose value via argv
2. ✅ shellcheck 0 warnings
3. ✅ Dry-run still shows 4/4 in sync (no behavior regression)
4. ✅ Apply test with throwaway key works (full round-trip + cleanup)
5. ✅ ps argv check: NO plaintext value in `curl` process argv during execution
6. ✅ Branch pushed + MR opened (NOT merged)
7. ✅ Auditor sub-spawn confirms LOW-1 closed + no new findings

## Self-Review Required

```yaml
self_review:
  - field: "all_curl_calls_use_value_from_file"
    result: true/false
    evidence: "scripts/sync-secrets.sh:LINE — diff shows --form value=<file pattern in N curl invocations"
  - field: "shellcheck_clean"
    result: true/false
    evidence: "shellcheck output: 0 warnings"
  - field: "dry_run_no_regression"
    result: true/false
    evidence: "dry-run output → 4/4 KEYS already in sync (matches T-088 baseline)"
  - field: "apply_test_throwaway_key_passed"
    result: true/false
    evidence: "TEST_FIX_T091 sha256 match between source/target, then deleted from both"
  - field: "argv_leak_check_passed"
    result: true/false
    evidence: "ps -ef during run shows curl args containing '<filename' or file path, NOT plaintext secret"
  - field: "tmp_files_cleanup_verified"
    result: true/false
    evidence: "trap handler shreds /tmp/T-091-val-* + post-task ls returns 0 matches"
  - field: "auditor_low1_closed"
    result: true/false
    evidence: "_workspace/T-091/audit-fix.md verdict: pass + LOW-1 closed + 0 new findings"
  - field: "branch_pushed_mr_opened"
    result: true/false
    evidence: "MR URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/N (state: opened)"
```

## Applicable Rules

- **CLAUDE.md SECURITY** — no secrets in argv/log/output
- **feedback_secret_handling_protocol.md** — temp file mode 0600 + shred cleanup mandatory
- **feedback_mr_workflow.md** — MR required, no direct main push
- **D14** — board not touched in this task → no board commit needed

## Forbidden

- `--form-string "value=$VAR"` (argv leak)
- `--form "value=$(cat ...)"` (argv leak)
- `echo $VALUE | curl ...` (argv leak in echo + may pipe through process)
- Display value in test output (`set -x`, `echo`)
- Touch any function NOT involving curl secret handling

## Cleanup

- shred temp value files at end (trap handler)
- delete TEST_FIX_T091 from both source + target after test
- bash history clear

## Domain Consultation

ไม่ต้อง — pure shell hardening
