---
task_id: T-088
title: Create sync-secrets.sh — distribute GitLab CI/CD vars from vollos-core → multiple target repos
agent: vollos-devops
spawn_started_at: 2026-04-29T09:25+07:00
mode: MODE_1
priority: medium
estimated_time: 30 min
dependencies: [T-087]
parent_context: "Owner decided 2026-04-29 to use Script + API sync (option 3) instead of Group Variables (because GitLab build quota is bound to personal namespace, not group). This task institutionalizes the manual T-087 steps into a reusable script for all future product repos (acmd, bnfg, hazship, ฯลฯ)."
---

## Goal

สร้าง `vollos-core/scripts/sync-secrets.sh` ที่:
1. Read source-of-truth secrets จาก `tummadajingjing/vollos-core` GitLab CI/CD Variables
2. Sync ไป 1 หรือหลาย target repos (ผ่าน CLI argument หรือ TARGET_REPOS list)
3. Support 2 modes: **dry-run** (ดูว่าอะไรจะเปลี่ยน) + **apply** (ทำจริง)
4. Verify sha256 match หลัง sync
5. ห้ามแสดง raw secret ใน stdout/stderr/log file

## Owned Files

- **NEW:** `scripts/sync-secrets.sh` (root ของ vollos-core repo)
- **NEW:** `scripts/secrets-config.example.yaml` (config template เก็บ source/targets/key list)
- **NEW:** `scripts/README-sync-secrets.md` (วิธีใช้สั้น ๆ — TH + EN)
- **MODIFIED:** `.gitignore` — เพิ่ม `scripts/secrets-config.yaml` (actual config — ห้าม commit)

## Branch Strategy

- Branch: `feat/sync-secrets-script`
- ตามกฎ MR Workflow: push branch → open MR → wait Auditor → merge

## Implementation Spec

### Script behavior

```bash
# Usage
./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --dry-run
./scripts/sync-secrets.sh --config scripts/secrets-config.yaml --apply
./scripts/sync-secrets.sh --target vollos-acmd --keys GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET --apply  # ad-hoc mode
```

### Config file format (`secrets-config.example.yaml`)

```yaml
source:
  project: tummadajingjing/vollos-core

targets:
  - tummadajingjing/vollos-acmd
  # - tummadajingjing/vollos-bnfg          # uncomment when bnfg repo exists
  # - tummadajingjing/vollos-hazship       # uncomment when hazship repo exists

# Keys to sync (must exist in source)
keys:
  - GOOGLE_CLIENT_ID
  - GOOGLE_CLIENT_SECRET
  - GOOGLE_REFRESH_TOKEN
  - GMAIL_USER
  # add more as products need them

# Default flags applied at target (overridden if target already has different flags)
default_flags:
  masked: true
  protected: true
  variable_type: env_var
```

### Token loading

Script ต้อง:
1. `set -a; source <repo-root>/.env; set +a` automatic (find repo root via `git rev-parse --show-toplevel`)
2. Use `$VOLLOS_CLI_v2` token from .env
3. Fail fast ถ้า token ไม่มี (exit 2 + clear error message)

### Behavior per key per target

```
For each target in targets:
  For each key in keys:
    1. GET source value (vollos-core)
    2. Compute source sha256:8
    3. GET target current value (if exists)
    4. Compute target sha256:8
    5. If match → skip ("✅ KEY @ target already in sync")
    6. If no match or missing → 
       - dry-run: print "WOULD UPDATE/CREATE KEY @ target (src sha256:abc12345)"
       - apply: POST or PUT to target → re-verify sha256 → print result
```

### Output format (no secret leak)

```
=== sync-secrets.sh — apply mode ===
Source: tummadajingjing/vollos-core
Targets: tummadajingjing/vollos-acmd

[vollos-acmd]
  GOOGLE_CLIENT_ID      sha256:170eefb5  ✅ already in sync
  GOOGLE_CLIENT_SECRET  sha256:ab8cb5cb  🔄 UPDATED (was sha256:11223344)
  GOOGLE_REFRESH_TOKEN  sha256:c29311d4  ➕ CREATED
  GMAIL_USER            sha256:cdd35c43  ✅ already in sync

Summary: 1 created, 1 updated, 2 already in sync, 0 errors.
```

### Forbidden

- Display raw value
- Write value to file (only fingerprints to log)
- `set -x` debug mode (would echo curl commands with token)
- Default to `--apply` (must be explicit — default = `--dry-run`)

### Error handling

- HTTP error from GitLab → exit 1 + clear message (no value leak in error msg)
- Source key missing → exit 3 + list missing keys
- Target repo not accessible → exit 4 + suggest token check
- sha256 mismatch after apply → exit 5 (CRITICAL — investigation needed)

## Acceptance Criteria

1. ✅ `scripts/sync-secrets.sh` exists, executable (chmod +x), shellcheck clean
2. ✅ `scripts/secrets-config.example.yaml` exists with comments
3. ✅ `scripts/README-sync-secrets.md` exists (TH + EN usage examples)
4. ✅ `.gitignore` excludes `scripts/secrets-config.yaml`
5. ✅ Dry-run mode works without modifying anything (verify on vollos-acmd → must show "already in sync" 4/4 from T-087)
6. ✅ Apply mode works — test by rotating 1 dummy key (e.g., add `TEST_SYNC_KEY=hello`) in source then sync to acmd → verify match → cleanup test key
7. ✅ Output contains only sha256:8 fingerprints, no raw values
8. ✅ Branch pushed + MR opened (NOT merged — wait Lead/Auditor review)

## Pre-Spawn State Check

- Branch ปัจจุบัน: `feat/acmd-caddy-routes` (HEAD `7efa83d`) — DevOps ต้อง checkout main + create new branch `feat/sync-secrets-script` ก่อนเริ่ม
- Working tree: มี untracked `_workspace/T-076..T-087/` — ไม่กระทบ branch ใหม่ (อยู่นอก scope)

## Self-Review Required

```yaml
self_review:
  - field: "script_executable_and_shellcheck_clean"
    result: true/false
    evidence: "scripts/sync-secrets.sh:1 — bash shebang; chmod +x verified; shellcheck output 0 warnings"
  - field: "dry_run_correct_on_vollos_acmd"
    result: true/false
    evidence: "Step 5 test output → 4/4 KEYS shown 'already in sync' matching T-087 sha256 fingerprints"
  - field: "apply_test_with_dummy_key"
    result: true/false
    evidence: "Step 6 test → TEST_SYNC_KEY created at acmd, sha256 match, then deleted both ends"
  - field: "no_value_leak_in_script_or_output"
    result: true/false
    evidence: "grep -E 'GOCSPX-|1//0|noreply@|<actual base64>' scripts/* output.md → 0 matches"
  - field: "gitignore_updated"
    result: true/false
    evidence: ".gitignore:N — entry 'scripts/secrets-config.yaml' present"
  - field: "branch_pushed_mr_opened"
    result: true/false
    evidence: "MR URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/N (status open)"
```

## Applicable Rules

- **CLAUDE.md SECURITY** — never display secrets, mask in output
- **feedback_secret_handling_protocol.md** — full FORBID list applies
- **feedback_mr_workflow.md** — MR ทุก commit หลัง initial push
- **Architecture Rule J1** — secrets in GitLab CI/CD Variables (masked + protected)
- **feedback_check_pipeline_before_push_main.md** — push main = auto-deploy; ตรวจ .gitlab-ci.yml ก่อน (แต่ task นี้ push branch ไม่ใช่ main → safe)

## Domain Consultation

ไม่ต้อง — pure infra script

## Cleanup at end

- `unset` all shell vars holding secret values
- Remove any /tmp/T-088-* temp files
- `history -c && history -w`
