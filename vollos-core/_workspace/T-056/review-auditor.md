# Security Audit — T-056: CI SSH hardening + docker login stdin

```yaml
task_id: T-056
verdict: "pass"
working_mode: "infra"

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L75-L111 — Pre-Audit Protocol + Evidence Protocol"
    - "SKILL.md:L136-L150 — Verdict Policy"
    - "references/security-checklists.md:L34 — Secrets Detection (CI surface)"

files_reviewed:
  - "origin/fix/ci-ssh-hardening:.gitlab-ci.yml — full 55 lines (via git show)"
  - "origin/main..origin/fix/ci-ssh-hardening diff — 4 insertions, 2 deletions, 1 file"

greps_executed:
  - "git show origin/fix/ci-ssh-hardening:.gitlab-ci.yml | grep -c 'StrictHostKeyChecking=no' → 0"
  - "git show ...:.gitlab-ci.yml | grep -c -- '-p \\$CI_REGISTRY_PASSWORD' → 0"
  - "grep -n 'StrictHostKeyChecking|docker login|UserKnownHostsFile|VPS_SSH_HOST_KEY' → L29 password-stdin; L48 known_hosts write; L50 StrictHostKeyChecking=yes + UserKnownHostsFile=~/.ssh/known_hosts"
  - "git diff --stat main..branch → .gitlab-ci.yml only (1 file, +4/-2)"

scope_compliance:
  files_changed_vs_owned: "match — only .gitlab-ci.yml modified; test/build image lines, docker build/push, deploy image, only/needs/manual/environment untouched"

checklist_8_items:
  - "1. StrictHostKeyChecking=no removed: PASS (grep=0)"
  - "2. StrictHostKeyChecking=yes set: PASS (.gitlab-ci.yml:L50)"
  - "3. UserKnownHostsFile populated: PASS (.gitlab-ci.yml:L48 writes $VPS_SSH_HOST_KEY to ~/.ssh/known_hosts with chmod 644; L50 consumes same path)"
  - "4. VPS_SSH_HOST_KEY format (multi-line, 3 key types): UNVERIFIED — value lives in GitLab CI/CD Variables, not in repo; DevOps must confirm populated via `ssh-keyscan -t rsa,ecdsa,ed25519 $VPS_HOST`"
  - "5. --password-stdin used: PASS (.gitlab-ci.yml:L29)"
  - "6. Password piped with quoted var: PASS — `echo \"$CI_REGISTRY_PASSWORD\" | docker login -u \"$CI_REGISTRY_USER\" --password-stdin \"$CI_REGISTRY\"` (all three vars double-quoted, safe from word-splitting/glob)"
  - "7. -p $CI_REGISTRY_PASSWORD removed: PASS (grep=0; only one CI_REGISTRY_PASSWORD reference, the stdin pipe)"
  - "8. No unrelated changes: PASS — diff shows exactly L29 (build) + L47-48 (mkdir+known_hosts write inserted) + L50 (ssh flags) touched; test stage, build image, docker build/push targets, deploy image, needs, when:manual, environment:production all untouched"

security_findings:
  - id: SEC-001
    severity: "low"
    cvss_estimate: "~3.1 (estimated, CWE-295)"
    category: "supply_chain (A03:2025)"
    description: "known_hosts is written with `>` (overwrite) each pipeline run. Safe today because only VPS_SSH_HOST_KEY is needed; if future ops require additional hosts, the `>` will silently drop them."
    file: ".gitlab-ci.yml:L48"
    evidence: "echo \"$VPS_SSH_HOST_KEY\" > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts"
    recommendation: ".gitlab-ci.yml:L48 — keep `>` for now (single-host deploy); if multi-host added, switch to `>>` and ensure VPS_SSH_HOST_KEY contains all entries. No action required this MR."

us_privacy_compliance:
  unsubscribe_mechanism: "N/A — CI config, no user-facing flow"
  physical_address_in_email: "N/A"
  audit_log: "N/A"
  data_minimization: "N/A — infra scope"

unverified_items:
  - "VPS_SSH_HOST_KEY content (CI variable, not in repo) — content, format, and 3-key-type coverage must be confirmed by DevOps before merge-to-main auto-deploy fires"

skipped_sections: []
conditional_conditions: []
approved_for_merge: true
merge_conditions:
  - "DevOps confirms VPS_SSH_HOST_KEY CI variable is populated via `ssh-keyscan -t rsa,ecdsa,ed25519 $VPS_HOST` output (multi-line, all 3 key types) BEFORE merging to main — main auto-deploys, so an empty/wrong value fails ssh and breaks deploy"

completion_signal: "task_id=T-056 verdict=pass findings=1 path=_workspace/T-056/review-auditor.md"
```
