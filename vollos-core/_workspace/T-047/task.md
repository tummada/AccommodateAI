---
id: T-047
title: Export public GPG key + replace placeholder + commit + MR
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-20T10:55+07:00
security_checkpoint: true
owned_files:
  - infra/backup-public.asc
dependencies: [T-040, T-046]
---

## Context

Owner just generated GPG keypair for backup encryption (T-046):
- Fingerprint: `E8A81EC3E6F4C16B377A48E0E757707D056C9DBC`
- UID: `VOLLOS Backup <backup@vollos.ai>`
- Capabilities: Certify + Encrypt (rsa4096)
- Key is in `~/.gnupg` of current user (`ipon`)

Need to: export the PUBLIC portion, overwrite the placeholder `infra/backup-public.asc` on a new branch, open MR to main. Private key stays offline with owner — DevOps does NOT export or touch it.

## Scope (READ + WRITE git only)

1. `git fetch origin && git checkout -b chore/backup-public-key origin/main` — from clean main
2. `gpg --armor --export backup@vollos.ai > infra/backup-public.asc` — overwrite placeholder
3. Verify output:
   - First line MUST be `-----BEGIN PGP PUBLIC KEY BLOCK-----`
   - Last line MUST be `-----END PGP PUBLIC KEY BLOCK-----`
   - File MUST NOT contain `-----BEGIN PGP PRIVATE KEY BLOCK-----` (grep — if found → ABORT, wipe file, escalate to Lead)
   - File size > 2 KB (typical RSA 4096 armored public key is ~3 KB)
4. `git diff infra/backup-public.asc` — should show placeholder removal + real key block
5. `git add infra/backup-public.asc && git commit -m "chore(infra): add VOLLOS backup GPG public key (fingerprint E8A81EC3...DBC)"`
6. `git push -u origin chore/backup-public-key`
7. Open MR via GitLab API (PAT in `/home/ipon/workspace/vollos/.env` as `VOLLOS_CLI`):
   - source: `chore/backup-public-key`
   - target: `main`
   - title: `chore(infra): add VOLLOS backup GPG public key`
   - description: |
     Replaces the placeholder `infra/backup-public.asc` with the real
     VOLLOS backup public key generated 2026-04-20 by owner.

     - Fingerprint: E8A81EC3E6F4C16B377A48E0E757707D056C9DBC
     - UID: VOLLOS Backup <backup@vollos.ai>
     - Type: RSA 4096 [Certify + Encrypt]

     Private key + passphrase held offline by owner. VPS holds only
     this public key → can encrypt backups, cannot decrypt.

     After merge + deploy, next nightly backup will upload
     `.sql.gz.gpg` to R2 instead of `.sql.gz`.
   - remove_source_branch: true
   - squash: false

## Security Requirements (MANDATORY)

- DO NOT export the private key under any circumstance
- DO NOT run `gpg --export-secret-keys` — that's owner's step, done later in their own terminal
- DO NOT print the public key content to terminal (just verify first/last line + size; use `head -1` + `tail -1` + `wc -c`)
- DO NOT push to main directly — must go through MR
- If any grep finds `BEGIN PGP PRIVATE` in the file → abort + wipe + escalate

## Acceptance Criteria

1. [ ] Branch `chore/backup-public-key` created from latest `origin/main`
2. [ ] `infra/backup-public.asc` replaced with real public key (placeholder gone)
3. [ ] File format verified (first/last line + size) WITHOUT printing full content
4. [ ] No private key material in the file (grep clean)
5. [ ] Commit created with conventional-commit message including fingerprint
6. [ ] Branch pushed to origin
7. [ ] MR opened to main with full description; URL returned
8. [ ] Pipeline triggered (URL returned)
9. [ ] `self_review` complete — every field `result: true/false` + `evidence: command → snippet`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-047/output.md`
