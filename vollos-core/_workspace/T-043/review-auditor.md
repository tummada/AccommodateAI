---
task_id: T-043
verdict: pass
working_mode: static-analysis
approved_for_merge: true
review_target:
  branch: origin/fix/backup-gpg-encrypt
  commit: 0bd0081
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/6
  base: origin/main (a65660d)
---

# T-043 — Security audit: T-040 GPG backup encryption

## skill_loaded_evidence

files_read:
  - "SKILL.md:L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
  - "SKILL.md:L98 — 'ถ้าอ่านไฟล์ซ้ำ > 5 ครั้งแล้วหา evidence ไม่ได้ → บันทึก UNVERIFIED'"
  - "SKILL.md:L108 — 'ถ้าพบ CRITICAL → verdict: fail เสมอ'"
  - "SKILL.md:L234 — 'ห้าม spawn Agent tool'"

## files_reviewed

- "infra/backup.sh: lines 1-172 (via `git show origin/fix/backup-gpg-encrypt:infra/backup.sh`)"
- "infra/restore.sh: lines 1-117 (via `git show`)"
- "infra/backup-public.asc: lines 1-29 (placeholder)"
- "infra/README.md: lines 1-86"
- "_workspace/T-040/RUNBOOK-key-setup.md: lines 1-184"
- ".env.example: lines 80-97 (T-040 additions)"
- ".gitignore: lines 1-28"
- "_workspace/T-040/output.md: lines 1-349 (local copy — branch does not carry output.md)"

## greps_executed

- "git grep -E 'BEGIN PGP PRIVATE|BEGIN PGP SECRET|-----BEGIN (RSA|EC|OPENSSH) PRIVATE' origin/fix/backup-gpg-encrypt → NO MATCHES (0 hits — private key leak check CLEAN)"
- "git grep -n 'OWNER_PASSPHRASE|passphrase' origin/fix/backup-gpg-encrypt → only documentation refs in RUNBOOK / README / .env.example comments / restore.sh comment — all placeholder `$OWNER_PASSPHRASE` form, NO literal passphrase values"
- "grep for `set -euo pipefail` → infra/backup.sh:L18 + infra/restore.sh:L33 — both in force"
- "grep for `mktemp.*gnupg` + `trap.*GPG_HOME` → backup.sh:L37 GPG_HOME=\"$(mktemp -d -t vollos-backup-gnupg-XXXXXX)\" + L39 trap 'rm -rf \"$GPG_HOME\"' EXIT"

## scope_compliance

files_changed_vs_owned: "match — diff touches only infra/*.sh, infra/backup-public.asc, infra/README.md, .env.example, .gitignore, _workspace/T-040/RUNBOOK-key-setup.md (as declared in task.md Scope)"

## audit_checklist_result

Shell-script robustness:
  1. set_euo_pipefail: "🟢 infra/backup.sh:L18 + infra/restore.sh:L33"
  2. pipefail_check_on_pipeline: "🟢 backup.sh:L108-117 — pipeline is inside `if ...; then ... else fail ...; fi`; pipefail + if-test routes any stage failure to fail() which rm -f $BACKUP_FILE before exit. Also size-guard at L119-122 ( -lt 500 ⇒ fail)."
  3. mktemp_secure: "🟢 backup.sh:L37 `mktemp -d -t vollos-backup-gnupg-XXXXXX`; restore.sh:L74 `mktemp -t vollos-restore-XXXXXX.sql.gz.gpg`. No $$-based names."
  4. ephemeral_gnupghome: "🟢 backup.sh:L37-39 isolated /tmp keyring + trap EXIT wipe. Never touches $HOME/.gnupg."
  5. set_e_interactions: "🟢 backup.sh:L47-57 env-load uses `|| true` after each grep/cut — documented at L42-45. Prevents missing-key false abort while leaving pipefail armed for the actual pipeline."
  6. ciphertext_permissions: "🟡 No explicit chmod on $BACKUP_FILE. Default umask on VPS will create 0664 / 0644. Content is GPG-encrypted, so this is defense-in-depth only — not a real risk. NOTE, not finding."
  7. placeholder_refusal: "🟢 backup.sh:L85-96 imports the public asc and calls `gpg --list-keys $GPG_RECIPIENT`; placeholder (infra/backup-public.asc:L1 '-----BEGIN PLACEHOLDER-----') is not valid ASCII-armor so import fails and fail() aborts before any pg_dump. Proof 3 in T-040 output.md captured the live abort."

Crypto correctness:
  8. strong_algo: "🟢 Runbook L32 mandates rsa4096; backup.sh does not hardcode a weaker algo; uses recipient-driven algo from imported key. --compress-algo none documented (data already gzipped)."
  9. recipient_validated: "🟢 backup.sh:L95 pre-flight `gpg --list-keys $GPG_RECIPIENT`. `--trust-model always` only bypasses web-of-trust, not signature validation of the key block; acceptable here because we own the key and validated it via the runbook roundtrip (output.md Proof 1+2)."
  10. no_symmetric_passphrase_on_vps: "🟢 .env.example:L91 'There is NO passphrase or private-key env var on the VPS'; backup.sh uses `--encrypt --recipient` (asymmetric), no `--symmetric` anywhere. No passphrase in argv."
  11. no_unencrypted_upload_path: "🟢 Upload is inside the `then` branch (backup.sh:L132-154) — only reached after `gpg --encrypt --output $BACKUP_FILE` succeeds AND size ≥ 500 bytes. If pipeline fails, fail() removes $BACKUP_FILE at L72 before exit, so R2 cp is never invoked. No code path uploads a `.sql.gz` (unencrypted)."

Secret handling:
  12. no_private_key_committed: "🟢 git grep -E 'BEGIN PGP PRIVATE|BEGIN PGP SECRET|-----BEGIN (RSA|EC|OPENSSH) PRIVATE' origin/fix/backup-gpg-encrypt → 0 hits. backup-public.asc is placeholder text, not a key."
  13. no_passphrase_value_in_runbook: "🟢 RUNBOOK-key-setup.md:L37 uses `'...paste-from-password-manager...'` literal placeholder + `$OWNER_PASSPHRASE` variable form throughout. No real passphrase anywhere."
  14. placeholder_clearly_marked: "🟢 backup-public.asc:L1 '-----BEGIN PLACEHOLDER-----' + L3 'THIS FILE IS A PLACEHOLDER — NOT A REAL GPG PUBLIC KEY' + L25-28 refers owner to runbook. Could not be mistaken for a real key."
  15. gitignore_blocks_private: "🟢 .gitignore:L6 `*.sql.gz.gpg` (defensive) + L19 `*.pem` + L20 `*.key` + L21 `private.*` (covers vollos-backup-private.asc style names if committed accidentally)."

Restore safety:
  16. restore_refuses_vps: "🟢 restore.sh:L58-65 `case $HOSTNAME` matches `vollos-vps*|vollos-prod*|*.vollos.ai` → exit 2. Documented as best-effort at L56-57, which is honest (hostname rename bypass is acknowledged, not silently trusted)."
  17. admin_only_docs: "🟢 restore.sh:L4 header banner 'ADMIN WORKSTATION ONLY — DO NOT RUN ON VPS'; README.md:L45-58 same message; RUNBOOK L140-144 likewise."
  18. no_plaintext_to_logs: "🟢 restore.sh:L107-109 streams decrypt→gunzip→`docker exec -i psql`. Never redirects decrypted SQL to a file or echoes to stdout. Dry-run (L98-103) caps at 4096 bytes and discards via `>/dev/null`."

Docker CIS:
  19. least_privilege: "🟢 Script runs as the cron user (host), not root-in-container. docker exec into vollos-core-postgres uses postgres user (-U postgres). No privilege escalation added by this change."
  20. public_key_readonly_mount: "N/A — backup.sh runs on the HOST (cron), not inside a container mount. The `.asc` file is read from the repo-checkout path on the VPS. Not a container-mount surface."

Supply chain:
  21. gpg_version_pin: "🟡 NOTE — RUNBOOK L24 requires GnuPG 2.2+ on the owner workstation. VPS uses whatever gpg the base OS ships. Not a vulnerability, but an explicit `command -v gpg` check + version log line at cron start would help reproducibility. Minor, not a finding."

## security_findings

[]

## us_privacy_compliance

unsubscribe_mechanism: "N/A — backup task, not an email surface"
physical_address_in_email: "N/A"
audit_log: "present — Telegram success + failure notifications (backup.sh:L61-68, L146-154) provide a durable log; stdout with `[$(date)]` prefixes on every stage"
data_minimization: "ok — pg_dump uses `--no-owner --no-privileges` (backup.sh:L107); only DB content, no OS metadata"

## compliance_verdict

pdpa_data_at_rest: "pass — RSA-4096 GPG asymmetric encryption before leaving VPS meets 'encrypted at rest' for R2-stored ciphertext. Private key is offline-only per RUNBOOK §3. output.md Proof 2 captured a 965-byte ciphertext header `PGP RSA encrypted session key ... RSA 4096b` confirming the algorithm."
incident_response_doc: "pass — README.md:L82-86 documents the compromise playbook (rotate keypair + invalidate existing R2 backups). RUNBOOK §7 documents rotation procedure end-to-end."

## skipped_sections

[]

## conditional_conditions

[]

## notes

- No CRITICAL or HIGH findings. Two 🟡 NOTEs (ciphertext file permissions defense-in-depth; explicit gpg version log) are below MEDIUM threshold and do not block merge.
- The design principle "VPS can encrypt, only owner can decrypt" is correctly enforced: ephemeral keyring, no passphrase env var on VPS, pipeline guarded by `pipefail` + `if/else`, early abort on placeholder.
- Private-key leak grep across the entire branch returned 0 hits, matching T-040 AC#8.
- Placeholder at infra/backup-public.asc is intentional and safely short-circuits the pipeline until the owner completes the RUNBOOK. This is the correct fail-safe default (fail closed, not open).

completion_signal: "task_id=T-043 verdict=pass findings=0 path=_workspace/T-043/review-auditor.md"
