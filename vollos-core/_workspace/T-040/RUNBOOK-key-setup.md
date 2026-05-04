# RUNBOOK — Generate VOLLOS Backup GPG Keypair (T-040)

**Audience:** Owner only. DevOps does NOT run this.
**Run on:** A trusted workstation — NOT the VPS.
**Goal:** Produce one asymmetric keypair so the VPS can encrypt DB backups
with the **public** key, while the **private** key stays offline with the
owner and is the ONLY thing that can decrypt those backups.

> If the VPS is compromised or the R2 bucket leaks, the attacker sees
> only ciphertext. Without the private key and passphrase they cannot
> read customer lead data.

---

## 0. Prerequisites

- GnuPG 2.2+ (`gpg --version`)
- A strong passphrase stored in your password manager (1Password /
  Bitwarden). Minimum 20 random characters. Call it `$OWNER_PASSPHRASE`
  from here on — **never type the real value into any file, chat, or MR**.
- A USB key or offline encrypted volume to hold the private-key export.

Verify GPG:

```bash
gpg --version | head -1
# Expected: gpg (GnuPG) 2.2+ or 2.4+
```

---

## 1. Generate the keypair (one time only)

Run on your trusted workstation:

```bash
export OWNER_PASSPHRASE='...paste-from-password-manager...'   # shell only, never commit
gpg --batch --passphrase "$OWNER_PASSPHRASE" \
    --quick-gen-key "VOLLOS Backup <backup@vollos.ai>" rsa4096 encrypt 0
unset OWNER_PASSPHRASE
```

Notes:
- `rsa4096` — 4096-bit RSA encryption subkey (long-term, non-rotating).
- `encrypt` — capability; no signing to keep scope minimal.
- `0` — no expiry (we rotate by generating a new UID if ever needed).
- The `--batch --passphrase "$OWNER_PASSPHRASE"` form avoids an
  interactive prompt, so the passphrase value is never written to disk
  in a scratch file. Make sure your shell history is not synced to a
  cloud clipboard before running.

Confirm the key exists:

```bash
gpg --list-keys backup@vollos.ai
# You should see a pub rsa4096/<FINGERPRINT> line.
```

---

## 2. Export the PUBLIC key (safe to commit)

```bash
cd <path-to>/vollos-core
gpg --armor --export backup@vollos.ai > infra/backup-public.asc

head -1 infra/backup-public.asc
# Expected: -----BEGIN PGP PUBLIC KEY BLOCK-----
tail -1 infra/backup-public.asc
# Expected: -----END PGP PUBLIC KEY BLOCK-----
```

Commit + MR (never push to main):

```bash
git checkout -b chore/backup-public-key
git add infra/backup-public.asc
git commit -m "chore(infra): add VOLLOS backup GPG public key"
git push -u origin chore/backup-public-key
# Open MR in GitLab; Lead reviews; merge via MR.
```

The public key is **safe to commit**. It only grants the ability to
*encrypt*, not decrypt.

---

## 3. Export the PRIVATE key → move OFFLINE

```bash
gpg --armor --export-secret-keys backup@vollos.ai > vollos-backup-private.asc
```

Immediately:

1. Copy `vollos-backup-private.asc` to your offline USB key / encrypted
   volume.
2. Wipe the workstation copy:
   ```bash
   shred -u vollos-backup-private.asc 2>/dev/null || rm -f vollos-backup-private.asc
   ```
3. Store the USB key in a physically secure location (safe / safety
   deposit box). Consider a second copy in a separate location.
4. **Do not upload the private key to any cloud sync service** (Drive,
   iCloud, Dropbox, GitLab, GitHub, etc.).

Record in your password manager (same entry as `OWNER_PASSPHRASE`):

- Key ID / fingerprint (`gpg --list-keys backup@vollos.ai`)
- Location of the offline backup (e.g. "USB #2, blue, home safe")
- Date generated

---

## 4. Verify the VPS-side pipeline (optional, recommended)

On your workstation, after the public key is deployed to the VPS via
the next deploy (the public `.asc` travels with the repo):

```bash
# encrypt a throwaway file with the committed public key
echo "hello vollos" | gpg --trust-model always \
    --encrypt --recipient backup@vollos.ai > /tmp/hello.gpg

# decrypt with your local private key (prompts for $OWNER_PASSPHRASE)
gpg --decrypt /tmp/hello.gpg
# Expected: "hello vollos"

rm -f /tmp/hello.gpg
```

This proves the committed public key matches the private key you hold.

---

## 5. What the VPS does (read-only reference)

The VPS runs `infra/backup.sh` nightly. That script:

1. Imports `infra/backup-public.asc` into an **ephemeral** keyring in
   `/tmp` (never writes to `~/.gnupg`).
2. Streams `pg_dump | gzip | gpg --encrypt --recipient backup@vollos.ai`
   → `vollos-core_<TS>.sql.gz.gpg`.
3. Uploads the `.gpg` file to Cloudflare R2.
4. Deletes the ephemeral keyring via `trap ... EXIT`.

The VPS cannot decrypt its own backups. That is the point.

---

## 6. Restoring a backup

See `infra/restore.sh`. That script must run **on the admin workstation
only**, where the owner's private key is imported into the local
keyring. `gpg-agent` will prompt for `$OWNER_PASSPHRASE` at decrypt time.

---

## 7. Key rotation (future)

When rotating:

1. Generate a new UID (e.g. `VOLLOS Backup 2027 <backup+2027@vollos.ai>`)
   using Section 1 with a fresh `$OWNER_PASSPHRASE`.
2. Replace `infra/backup-public.asc` via a new MR.
3. Update `GPG_RECIPIENT` in `infra/backup.sh` (or set it via env var).
4. Keep the old private key offline until all old backups expire
   (retention window = 30 days).

---

## Secret Handling Summary

| Artifact                      | Where it lives                 | Committed? |
|-------------------------------|--------------------------------|------------|
| Public key (`.asc`)           | `infra/backup-public.asc`      | **Yes**    |
| Private key (`.asc`)          | Offline USB / safe             | **NEVER**  |
| `$OWNER_PASSPHRASE`           | Password manager               | **NEVER**  |
| Key fingerprint               | Password manager note          | No         |
| Recipient email (`backup@…`)  | `infra/backup.sh` + this runbook | Yes     |

If any of the "NEVER" rows ends up in a commit, chat, or log — treat it
as a **full compromise**, rotate the key (Section 7), and invalidate
existing backups.
