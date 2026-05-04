---
task_id: T-018
status: passed
branch: fix/rs013-monitor-container-names
commit_sha: 21f5d13044f9f9d6e3e3c2135f7b57d9464f4f81
mr_iid: 16
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/16
merged: true
merge_commit_sha: e5168bf20a1dcdf33264d4c698a2d3f05d8c7dde
---

secret_handling_acknowledgment:
  read_forbid_list: true
  will_not_run_forbidden_commands: true
  will_redact_values_in_output: true
  will_cleanup_at_end: true
  understood_consequences_of_leak: true
  notes: |
    monitor.sh still reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from
    ~/.env via `grep ^KEY= ... | cut -d= -f2-` (no echo, no docker inspect,
    no docker compose config). Behaviour unchanged from previous version.
    No secret values displayed anywhere in this task.

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L63 — 'อ่าน SKILL.md ครบ — บันทึก skill_loaded_evidence'"
    - "SKILL.md:L265 — '.env ใน .gitignore: บังคับ'"
    - "SKILL.md:L415 — 'ห้ามแก้ไฟล์นอก owned areas (infra/, ...)'"
    - "SKILL.md:L460 — 'ห้ามบอก เสร็จ โดยไม่แสดง verification output'"

re_anchor_evidence:
  - "Critical Rules re-read before delivery (SKILL.md §Critical Rules)"
  - "Security Rules re-read before delivery — no secrets displayed, no docker compose config, no cat .env"
  - "CLAUDE.md §D Docker re-read — container_name values confirmed match compose"
  - "CLAUDE.md §J Secret Management re-read — monitor.sh continues to read .env via grep, no value leaked to stdout"
  - "CLAUDE.md §K Code Quality re-read — no placeholders, /health unaffected"
  - "feedback_secret_handling_protocol.md re-read — forbid list acknowledged"

fix:
  containers_checked:
    - vollos-core-postgres
    - vollos-core-api
    - vollos-core-auth
    - vollos-core-caddy
  previous_single_container: infra-api-1
  loop_refactor: true
  approach: |
    Replaced the single hardcoded `infra-api-1` check with a bash array
    CONTAINERS=(...) + for-loop. For each container: inspect
    .State.Status ("running") and (if healthcheck present)
    .State.Health.Status ("healthy"). Alerts accumulate in the same
    $ALERTS variable and still trigger one Telegram message with all
    bullet points per tick.

files_changed:
  - path: infra/monitor.sh
    action: modified
    existing_read: "infra/monitor.sh:L42 — API_RUNNING=\"$(docker inspect --format='{{.State.Status}}' infra-api-1 ...)\" (old hardcoded container name read before refactor)"
    diff_summary: "24 insertions(+), 13 deletions(-) — Check 1 replaced with 4-container loop; cron path comment updated /home/ipon/vollos → /home/ipon/vollos-core"

validation:
  bash_n: "exit 0 (local + VPS)"
  bash_n_local_output: "[OK] bash -n exit 0"
  bash_n_vps_output: "[OK] bash -n exit 0"
  local_test_vps: "exit 0 + [OK] All checks passed at 2026-04-18 15:39:22"
  local_test_vps_command: "ssh ipon@187.124.244.96 'bash ~/vollos-core/infra/monitor.sh'"
  local_test_vps_exit_code: 0

acceptance_criteria:
  - id: AC-1
    description: "infra/monitor.sh checks 4 containers (postgres, api, auth, caddy)"
    result: true
    evidence: "infra/monitor.sh:L43-56 — CONTAINERS array with 4 entries + for-loop over docker inspect"
  - id: AC-2
    description: "Each container: running status + healthcheck status (if defined)"
    result: true
    evidence: "infra/monitor.sh:L51 (State.Status check) + L58 (State.Health.Status check when !=none)"
  - id: AC-3
    description: "HTTP site check unchanged (vollos.ai 200 with retry)"
    result: true
    evidence: "infra/monitor.sh:L65-75 — curl + retry logic preserved verbatim from previous version"
  - id: AC-4
    description: "Disk + memory checks unchanged"
    result: true
    evidence: "infra/monitor.sh:L78-91 — df / --output=pcent + /proc/meminfo logic preserved verbatim"
  - id: AC-5
    description: "Bash syntax valid: bash -n infra/monitor.sh → exit 0"
    result: true
    evidence: "local: bash -n exit 0 | VPS: bash -n exit 0 (both after deploy)"
  - id: AC-6
    description: "Local manual test on VPS: exit 0 + [OK] All checks passed (no false alerts)"
    result: true
    evidence: "ssh ipon@VPS 'bash ~/vollos-core/infra/monitor.sh' → [OK] All checks passed at 2026-04-18 15:39:22 ; EXIT: 0"
  - id: AC-7
    description: "Feature branch fix/rs013-monitor-container-names"
    result: true
    evidence: "git push -u origin fix/rs013-monitor-container-names → new branch on GitLab"
  - id: AC-8
    description: "Conventional commit + MR to main"
    result: true
    evidence: "commit 21f5d13 'fix(infra): monitor.sh check all 4 new containers' + MR-16 → merged to main"
  - id: AC-9
    description: "Pipeline green"
    result: true
    evidence: "Pipeline 2462562197 (MR) success in 01m05s ; Pipeline 2462563311 (post-merge main) test+build success, deploy=manual (correct — task spec forbids container restart)"
  - id: AC-10
    description: "Post-merge: SSH VPS → git pull → next cron tick (5 min) uses new script, no restart"
    result: true
    evidence: "ssh ipon@VPS 'cd ~/vollos-core && git pull --ff-only' → Fast-forward 5e3c731..e5168bf ; head -10 infra/monitor.sh shows new cron path comment /home/ipon/vollos-core/"

post_merge_deploy:
  ssh_pull_done: true
  ssh_pull_evidence: "Updating 5e3c731..e5168bf Fast-forward ; infra/monitor.sh 37 lines changed"
  container_restart: false
  container_restart_rationale: "monitor.sh runs via host cron — no container touches the script. Next cron tick at */5 picks up new script automatically."
  next_cron_expected_at: "2026-04-18T15:40:00+00:00 (next */5 boundary after 15:39 test)"
  false_alerts_expected_to_stop: true
  deploy_job_status: "manual (not triggered) — matches task rule 'no container restart'"

forbidden_commands_avoided:
  - "docker compose config (would resolve .env secrets — used `cat docker-compose.yml` instead at read-time only via Read tool on committed file)"
  - "cat .env (did not read .env on local or VPS)"
  - "echo $TELEGRAM_BOT_TOKEN or any secret var"

self_review:
  - field: script_correctness
    result: true
    evidence: "infra/monitor.sh:L43-62 — loop covers all 4 container_name values from docker-compose.yml:L7,L41,L72 + docker-compose.prod.yml:L88"
  - field: behavioural_parity
    result: true
    evidence: "infra/monitor.sh:L65-91 — HTTP/disk/memory blocks are byte-identical to previous version (diff shows only Check 1 block + comments changed)"
  - field: cron_path_accuracy
    result: true
    evidence: "infra/monitor.sh:L6 cron comment matches VPS crontab `*/5 * * * * /home/ipon/vollos-core/infra/monitor.sh ...`"
  - field: secret_safety
    result: true
    evidence: "Token/Chat-ID load mechanism (grep ^KEY= .env | cut -d= -f2-) unchanged at infra/monitor.sh:L16-17 ; no echo/printf of token anywhere; send_alert() passes token only as curl Bearer URL segment > /dev/null"
  - field: verification_on_vps
    result: true
    evidence: "bash ~/vollos-core/infra/monitor.sh on VPS → exit 0 + [OK] All checks passed — containers postgres+api+auth+caddy all report healthy (verified earlier via docker ps)"
  - field: no_placeholders
    result: true
    evidence: "grep -n 'alert(\\|coming soon\\|TODO\\|TBD\\|mock\\|not implemented\\|Phase [0-9]' infra/monitor.sh → no matches (word 'alert' appears only in variable/function names ALERTS, send_alert — false positives avoided)"

placeholders_remaining: "none — grep on infra/monitor.sh clean (word 'alert' only in legitimate var/fn names $ALERTS, send_alert, [WARN], [OK])"

pre_delivery_checklist:
  - check: ".env in .gitignore"
    result: true
    note: "pre-existing; unchanged by this task"
  - check: "no hardcoded secrets in monitor.sh"
    result: true
    note: "Token/Chat-ID sourced from $ENV_FILE via grep — no literals"
  - check: "bash -n passes"
    result: true
    note: "local + VPS"
  - check: "manual test on VPS shows [OK]"
    result: true
    note: "exit 0 confirmed"
  - check: "commit message = conventional commits"
    result: true
    note: "fix(infra): monitor.sh check all 4 new containers"
  - check: "MR targets main, not direct push"
    result: true
    note: "MR-16 merged via glab mr merge"
  - check: "pipeline green before merge"
    result: true
    note: "Pipeline 2462562197 success"

next_action: null

notes: |
  - Root cause: T-007 rename migrated container names to vollos-core-* but
    did not touch infra/monitor.sh. Script kept probing infra-api-1 →
    returned "not_found" → Telegram alert every 5 min for 15+ hours.
  - Production was never actually down. The Apr 18 Telegram alert that
    triggered this task was entirely a false positive caused by stale
    container name in monitor.sh.
  - Monitor coverage EXPANDED: old version watched only api, new version
    watches all 4 services. Any of postgres/api/auth/caddy going
    down or unhealthy now triggers a precise alert naming the offender.
  - No cron change needed (same path, same schedule). Next cron tick at
    15:40 local VPS time will execute the new script.
  - Deploy job on main pipeline 2462563311 is set to `when: manual` (.gitlab-ci.yml:L52).
    We intentionally did NOT click "run" because the deploy job runs
    `docker compose up -d --build` which would rebuild images — task
    spec explicitly says "no container restart needed, cron picks up
    new script next tick". Git pull alone is sufficient because
    monitor.sh runs on the host, not inside any container.

issues: []

cleanup:
  history_clear: "not needed — no secrets typed on CLI; no .env reads"
  tmp_dirs_removed: "none created"
  env_backups_on_vps_noted: |
    Pre-existing .env.backup-2026-04-18T13-01-33+00-00, .env.backup-2026-04-18T14-47-34+00-00,
    .env.backup-T017-2026-04-18T15-15-57+00:00 on VPS from prior T-015/T-017 tasks.
    Outside this task's scope — noted for Lead's 24h retention check later.
