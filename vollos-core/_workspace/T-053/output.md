---
task_id: T-053
status: completed
spawn_completed_at: 2026-04-20T12:30+07:00
skill_loaded_evidence:
  files_read:
    - "SKILL.md:L36 — '🔴 SECRET HANDLING (non-negotiable — read FIRST)'"
    - "SKILL.md:L271 — 'Secrets: environment variables จาก .env — ห้าม hardcode ใน docker-compose'"
    - "SKILL.md:L464 — 'Critical Rules'"
re_anchor_evidence:
  - "Critical Rules: read before delivery — verified no Agent spawn, no hardcoded secrets in .gitlab-ci.yml"
  - "Security Rules: read before delivery — host key treated as public, CI_REGISTRY_PASSWORD never echoed"
files_changed:
  - path: .gitlab-ci.yml
    action: modified
    existing_read: ".gitlab-ci.yml:L48 — 'ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST ...' (before change)"
    diff_summary: |
      build stage (line 29):
        - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
        + echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
      deploy stage (before_script, 2 new lines at 47-48):
        + mkdir -p ~/.ssh && chmod 700 ~/.ssh
        + echo "$VPS_SSH_HOST_KEY" > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts
      deploy stage (script, line 50):
        - ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST "..."
        + ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts $VPS_USER@$VPS_HOST "..."

ci_variable_uploaded:
  key: VPS_SSH_HOST_KEY
  project_id: 81441960
  project_path: tummadajingjing/vollos-core
  variable_type: env_var
  protected: true
  masked: false
  environment_scope: "*"
  value_source: "ssh-keyscan -H -t rsa,ed25519,ecdsa 187.124.244.96"
  value_lines: 3
  value_sha256_first8_local: "e329bcec"
  value_sha256_first8_gitlab: "e329bcec"
  match: true
  verification_method: "fetched variable back via GitLab API and recomputed sha256 — matched local keyscan output"

host_key_fingerprints:  # public info — safe to share
  - "ED25519 SHA256:fDq894bx5T9LOz4PTkSWgvsj0TTraK5AaZMe/3kicBM"
  - "ECDSA   SHA256:4QRqr6qNYFrzuTYgCXazPcSEW2QJMjXxk/D4pTi12M0"
  - "RSA     SHA256:xSPff9GYFT6A2+5ZdWTeU693XTDtHgLc6QF9xksDH0o"

verification_commands:
  - cmd: "grep -c 'docker login.*-p ' .gitlab-ci.yml"
    expected: 0
    actual: 0
    pass: true
  - cmd: "grep -c 'StrictHostKeyChecking=no' .gitlab-ci.yml"
    expected: 0
    actual: 0
    pass: true
  - cmd: "python3 -c 'import yaml; yaml.safe_load(open(\".gitlab-ci.yml\"))'"
    expected: "no exception"
    actual: "yaml OK"
    pass: true
  - cmd: "grep -n 'alert(\\|coming soon\\|TODO\\|TBD\\|mock\\|not implemented\\|Phase [0-9]' .gitlab-ci.yml"
    expected: "no matches"
    actual: "grep clean"
    pass: true

placeholders_remaining: none — grep clean

git:
  branch: fix/ci-ssh-hardening
  base: origin/main (42e305c)
  commit: e3b787a — "fix(ci): harden SSH host checking + stdin docker login"
  pushed: true
  push_target: "git@gitlab.com:tummadajingjing/vollos-core.git"
  note: |
    Initial git commit landed on fix/refresh-race (concurrent task workspace), was immediately
    cherry-picked to fix/ci-ssh-hardening and fix/refresh-race branch pointer reset to the pre-
    commit state (42e305c). Only fix/ci-ssh-hardening was pushed. Verified via git log.

merge_request:
  url: "https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/11"
  iid: 11
  source: fix/ci-ssh-hardening
  target: main
  state: opened

self_review:
  sc_1_vps_ssh_host_key_uploaded:
    result: true
    evidence: "GitLab API GET /projects/81441960/variables/VPS_SSH_HOST_KEY returned protected=True, masked=False, variable_type=env_var, value sha256 first-8 'e329bcec' matches local /tmp/vps_known_hosts sha256"
  sc_2_deploy_strict_host_checking_yes:
    result: true
    evidence: ".gitlab-ci.yml:50 — 'ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/known_hosts ...'; known_hosts pre-populated at .gitlab-ci.yml:48"
  sc_3_build_docker_login_password_stdin:
    result: true
    evidence: ".gitlab-ci.yml:29 — 'echo \"$CI_REGISTRY_PASSWORD\" | docker login -u \"$CI_REGISTRY_USER\" --password-stdin \"$CI_REGISTRY\"'"
  sc_4_no_password_flag_remaining:
    result: true
    evidence: "grep -c 'docker login.*-p ' .gitlab-ci.yml → 0"
  sc_5_no_strict_no_remaining:
    result: true
    evidence: "grep -c 'StrictHostKeyChecking=no' .gitlab-ci.yml → 0"
  sc_6_branch_pushed_mr_opened:
    result: true
    evidence: "Branch fix/ci-ssh-hardening pushed (commit e3b787a); MR !11 opened at https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/11 (state=opened)"
  sc_7_vps_host_key_verified_before_merge:
    result: true
    evidence: "VPS_SSH_HOST_KEY uploaded BEFORE push (timeline: keyscan → upload → verify via API → edit ci yaml → commit → push). Variable exists and matches local keyscan output."
  sc_8_self_review_complete:
    result: true
    evidence: "All 8 fields above have result + evidence with file:line or API call reference"

secret_handling_audit:
  - rule: "No plaintext secret values in output.md"
    evidence: "Only sha256 first-8 fingerprints used (e329bcec) for VPS_SSH_HOST_KEY; CI_REGISTRY_PASSWORD never printed; VOLLOS_CLI PAT never echoed (loaded via `source .env` and len only)"
    pass: true
  - rule: "No `docker compose config` / `cat .env` / `echo $SECRET` used"
    evidence: "Only `set -a; source /home/ipon/workspace/vollos/.env; set +a` used to load PAT; value never echoed directly, only ${#VOLLOS_CLI} length for sanity check"
    pass: true
  - rule: "Host key (public info) handled normally; private secrets never traversed chat"
    evidence: "ssh-keyscan output written to /tmp/vps_known_hosts, uploaded via Python urllib with urlencoded form body (never shell-echoed)"
    pass: true

notes: |
  - Variable upload required Python urllib (curl --form with @file parses host key newlines oddly
    and the first `--form value=<@/tmp/...` invocation actually succeeded even though response
    parsing failed — caught by idempotency check on second attempt returning "has already been taken").
  - After merge the first deploy pipeline will exercise the new known_hosts path. If ssh fails with
    "host key verification failed", owner should re-run ssh-keyscan and re-upload VPS_SSH_HOST_KEY
    (host key could rotate after VPS reinstall).
  - Did NOT run a deploy per task constraint ("do NOT test by running a deploy").

issues: []
next_action: null
