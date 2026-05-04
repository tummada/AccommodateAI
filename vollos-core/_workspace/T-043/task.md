---
id: T-043
title: Security audit — T-040 GPG backup encryption pipeline
assigned_to: vollos-auditor
priority: high
status: in_progress
spawn_started_at: 2026-04-20T10:10+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-040]
review_target:
  branch: origin/fix/backup-gpg-encrypt
  commit: 0bd0081
  mr: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/6
  base: origin/main (a65660d)
---

## Context

T-040 added GPG asymmetric encryption to the DB backup pipeline. VPS holds public key only; owner holds private key offline. This review must verify: (a) the pipeline is cryptographically sound, (b) no private key material leaks, (c) failure modes are handled safely (no silent unencrypted upload).

## Scope (READ-ONLY)

Review the diff `origin/main..origin/fix/backup-gpg-encrypt` against Docker CIS Benchmark + crypto/shell best practice.

Use `git show origin/fix/backup-gpg-encrypt:<path>` to read target files.

Files to review:
- `infra/backup.sh` — encryption pipeline + error handling
- `infra/restore.sh` — decryption path + hostname guard
- `infra/backup-public.asc` — placeholder content
- `infra/README.md` — operational documentation
- `_workspace/T-040/RUNBOOK-key-setup.md` — key generation instructions
- `.env.example` — GPG_RECIPIENT variable documentation
- `.gitignore` — ensures `*.sql.gz.gpg` and private keys excluded

## Audit Checklist

Rate each with 🔴/🟡/🟢/⚪ + file:line.

### Shell-script robustness
1. Is `set -euo pipefail` (or equivalent) set? (any pipeline failure aborts)
2. Does `pg_dump | gzip | gpg` check `PIPESTATUS` / `pipefail` so a gpg failure doesn't produce a "successful" empty file?
3. Are temporary files created securely (`mktemp -d`, not `$$`-based)?
4. Is the ephemeral GNUPGHOME isolated from `$HOME/.gnupg`?
5. Are all `set -e` interactions with `grep`/`cut` safe? (grep returning 1 when no match = script abort)
6. Are file permissions set correctly on the ciphertext before upload?
7. Does script refuse to run against a placeholder `backup-public.asc` (early abort)?

### Crypto correctness
8. Does GPG use a strong algorithm? (RSA-4096 per runbook — verify no weaker algo hardcoded)
9. Is the recipient key validated before encryption? (`--trust-model always` is acceptable here since we own the key — but verify that's the only trust bypass)
10. Does the script avoid `--symmetric` / passphrase mode that would put the secret on VPS?
11. Are there any paths where an unencrypted `.sql.gz` could be uploaded? (e.g. gpg failure + script doesn't abort → partial file → uploaded anyway)

### Secret handling
12. Does ANY committed file contain private key material? (grep `BEGIN PGP PRIVATE|BEGIN PGP SECRET|-----BEGIN (RSA|EC|OPENSSH) PRIVATE`)
13. Does runbook contain actual passphrase values? (should use `$OWNER_PASSPHRASE`)
14. Is `backup-public.asc` clearly marked as placeholder so owner replaces it?
15. Is `.gitignore` updated to prevent accidental commit of private `.asc` files?

### Restore safety
16. Does `restore.sh` refuse to run on VPS? (hostname or env check)
17. Is restore documented as "admin workstation only"?
18. Does restore avoid decrypting to stdout where it might end up in logs?

### Docker CIS checks (if containerized)
19. Is backup script run with least privilege?
20. Is the public key file read-only in the container mount?

### Supply-chain
21. Is `gpg` / `gnupg` a known-safe dependency? Pin versions where possible?

## Compliance

- PDPA/CCPA data-at-rest encryption: does GPG-encrypted `.sql.gz.gpg` at R2 meet "encrypted at rest" requirement?
- Incident response: if R2 is breached, is there a documented procedure in RUNBOOK or README?

## Deliverable

Write `review-auditor.md` with:

```yaml
verdict: pass | conditional_pass | fail
summary: |
  Overall assessment
findings:
  - severity: critical|warning|note
    id: A-T040-NN
    title: ...
    location: "infra/backup.sh:NN"
    impact: ...
    fix: ...
compliance_verdict:
  pdpa_data_at_rest: pass|fail|review-needed
  incident_response_doc: pass|fail|review-needed
approved_for_merge: true | false
```

## Deliverable path

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-043/review-auditor.md`
