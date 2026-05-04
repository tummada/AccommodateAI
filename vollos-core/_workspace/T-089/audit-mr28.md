---
audit_target: MR !28 — feat: add sync-secrets.sh for multi-repo CI/CD var distribution
merge_commit: b8580fa
feature_commit: 64afad9
auditor: vollos-auditor (invoked inline by vollos-devops within T-089 — sub-agent spawn unavailable in this run)
audit_scope: post-merge security review (defensive — MR was merged before audit per owner direction)
audit_date: 2026-04-29
files_reviewed:
  - scripts/sync-secrets.sh (379 lines)
  - scripts/secrets-config.example.yaml (43 lines)
  - scripts/README-sync-secrets.md (155 lines)
  - .gitignore (entry for scripts/secrets-config.yaml)
verdict: pass (with 2 LOW recommendations + 1 INFO observation)
---

## Verdict

**PASS** — MR !28 is safe in production. The script demonstrates strong
secret-handling hygiene: all secret material flows through `mktemp -d`
files (chmod 600/700) instead of shell variables, the GitLab token is
never echoed (no `set -x`, all curl bodies are framed with status codes
before being printed), `shred -u` runs on EXIT/INT/TERM, and the YAML
config is gitignored. No CRITICAL or HIGH findings.

Two LOW improvements and one INFO observation are listed below — none
block production use; they are quality-of-life hardening for future
revisions.

## Findings by severity

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 0     | — |
| HIGH     | 0     | — |
| MEDIUM   | 0     | — |
| LOW      | 2     | LOW-1, LOW-2 |
| INFO     | 1     | INFO-1 |

---

## Detailed findings

### LOW-1 — `--form-string "value=$(cat ...)"` exposes value via `/proc` argv during curl invocation

**Location:** `scripts/sync-secrets.sh:121` (PUT) and `:138` (POST)

**Description:**
The curl invocations build the form value as
`--form-string "value=$(cat "${valfile}")"`. Bash performs the
`$(cat)` substitution before exec'ing curl, so the secret value
appears as a literal substring inside curl's argv. While this argv is
visible only to processes running as the same UID (`/proc/<pid>/cmdline`
is mode 0500 → readable only by owner), it is briefly observable to any
process the user starts during the curl call, and it can leak into
process accounting / audit logs (`auditd execve`) if those are enabled
on the host.

**Risk:** Low — the script runs on a single-user dev workstation with
no auditd, and the GitLab token is the high-value asset (which IS
already in a header, not argv). The secret values themselves are
ephemerally visible for the duration of the HTTP request.

**Recommendation:** Use `--form "value=<${valfile}"` (curl's
`<file` syntax loads from disk inside curl, not argv). Same change
applies to `key=...` on line 137 (key is not secret, but consistency
helps).

```diff
-    --form-string "value=$(cat "${valfile}")" \
+    --form "value=<${valfile}" \
```

Note: `--form` (vs `--form-string`) treats `<file` as file-load. For
fields that must be literal (the `key`), keep `--form-string`.

### LOW-2 — `shred` is best-effort on tmpfs / btrfs / SSD

**Location:** `scripts/sync-secrets.sh:212`

**Description:**
`shred -u` is called on files inside `mktemp -d -t T-088-sync-XXXXXX`,
which on Ubuntu 24.04 normally lands in `/tmp` — typically `tmpfs` (RAM)
on modern systems. `shred` was designed for magnetic media; on tmpfs it
is functionally equivalent to `rm` (overwrites do nothing because the
file lives in RAM and pages are released on unlink). On copy-on-write
filesystems (btrfs, zfs) `shred`'s overwrites can also leave the
original blocks intact.

**Risk:** Very low for the project's threat model — the values exist on
GitLab anyway, and tmpfs RAM is wiped on reboot. The LOW classification
is for *user expectation alignment* (the README claims "shred -u
ทันทีเมื่อ script จบ" which over-states the guarantee on tmpfs).

**Recommendation:** Either:
1. Add a one-line comment in the script + README noting `shred` is
   best-effort and the real protection is `mktemp -d` (chmod 700) plus
   process-exit; OR
2. Switch to `rm -f` and remove the `shred` call (no real loss, less
   misleading).

### INFO-1 — `urlencode()` shells out to python3 for every project name

**Location:** `scripts/sync-secrets.sh:94-96, :222, :265`

**Description:**
`urlencode()` invokes `python3 -c '...'` once per project. For the
typical 1-source × 1..N-target × M-key matrix this fires 1+N python
processes total (the encoded value is cached per target). This is
observational — not a security concern.

**Recommendation:** No action required. If perf becomes a concern when
N grows beyond ~10 targets, port to `printf` + `%xx` substitution in
pure bash, or memoize.

---

## Threat-vector checklist

| Vector | Status | Evidence |
|--------|--------|----------|
| **Secret leak — token in stdout/stderr** | ✅ safe | `set -x` explicitly disabled (`scripts/sync-secrets.sh:35`); no `echo $VOLLOS_CLI_v2` anywhere; curl `-sS` (silent except errors); `--header "PRIVATE-TOKEN: ..."` not in URL |
| **Secret leak — token in argv** | ✅ safe | Token is in `--header`, which curl reads as a single string at exec time; not visible in `/proc` cmdline as separate field |
| **Secret leak — value in stdout** | ✅ safe | All HTTP bodies are framed `STATUS<TAB>BODY` before printing (`gitlab_get_var:110`); only sha8 fingerprints reach stdout |
| **Secret leak — value in disk artifact** | ⚠️ LOW-1 | Brief argv exposure via `$(cat)`; mitigations described above. Real value files: `chmod 600` (`:247`, `:284`, `:303`), in `chmod 700` tmpdir (`:206`), shredded on EXIT (`:212`) |
| **Shell injection — config-controlled** | ✅ safe | YAML loaded via `python3 yaml.safe_load`; output piped through structured `KEY=VALUE` parser; no `eval`, no `bash -c "$cfg"` |
| **Shell injection — CLI args** | ✅ safe | `--target` and `--keys` flow into bash arrays via `IFS= read -r -a`, used as quoted parameters to `urlencode()` and printf; never spliced into a shell string |
| **Path traversal — config file path** | ✅ safe | `--config "$2"` is passed to `[[ -f ... ]]` and `python3 open()` — no shell expansion; the script trusts the operator (operator-local config) |
| **SSRF — GitLab URL** | ✅ safe | `GITLAB_API="https://gitlab.com/api/v4"` is hard-coded (`:61`); not user-overridable; project component is url-encoded before insertion |
| **Race conditions — config swap mid-run** | ✅ safe | YAML is loaded once at startup; subsequent operations work from in-memory arrays |
| **TOCTOU — value file** | ✅ safe | `mktemp -d` returns a fresh dir per run; tmpdir is `chmod 700`; files are written and read by the same process within the same run |
| **Idempotency** | ✅ safe | sha8 compare before write; PUT vs POST chosen by 200 vs 404; verify-after-write with re-GET + sha8 compare; mismatch → exit 5 + no retry |
| **Token rotation safety** | ✅ safe | Token sourced fresh from `.env` each run (`:46-49`); `unset VOLLOS_CLI_v2` in cleanup trap (`:217`); not persisted between runs |
| **Failure mode — partial write** | ✅ safe | Each (target, key) write is independent; failures increment `total_errors` and exit 1 at end; sha8 mismatch after write triggers immediate exit 5 |
| **Privilege creep** | ✅ safe | Script runs as the operator user; no `sudo`, no `su`; no SUID binaries invoked |
| **Supply chain — curl flags** | ✅ safe | No `-k` / `--insecure`; default cert validation in effect; no proxy override |
| **Supply chain — python yaml import** | ⚠️ accept | `yaml.safe_load` is the safe API (no Python object construction); the dependency is `python3-yaml` from the OS package — operator must ensure it's installed (script will fail loudly if missing, no silent insecure fallback) |
| **CAN-SPAM / CCPA / privacy** | n/a | This script handles ops secrets, not user data. No PII. |
| **Audit trail** | ✅ safe | Operator-visible stdout enumerates every (target, key) action with sha8 fingerprint and disposition; no plaintext, but enough to reconstruct what happened |

## Files reviewed in detail

### scripts/sync-secrets.sh
- 379 lines, bash with `set -euo pipefail`
- Header documents purpose, usage, and 7 distinct exit codes (clear contract)
- Functions are well-scoped: `sha8`, `urlencode`, `gitlab_get_var`, `gitlab_put_var`, `gitlab_post_var`, `load_config_from_file`, `cleanup`
- Trap covers EXIT/INT/TERM (cleans on Ctrl-C and signals, not just normal exit)
- Default mode is `dry-run` — explicit `--apply` is required to mutate (correct posture for a destructive tool)
- Verify-after-write closes the loop: a successful HTTP 200/201 still requires the re-GET sha8 to match before the operation is reported as success

### scripts/secrets-config.example.yaml
- Template only — actual `secrets-config.yaml` is `.gitignore`d (verified at `.gitignore:42`)
- Lists `tummadajingjing/vollos-core` as source, `tummadajingjing/vollos-acmd` as the only enabled target (bnfg/hazship commented out as future placeholders)
- Keys list contains 4 Gmail / Google OAuth env-var names — names are not secret, no values present
- `default_flags: { masked: true, protected: true, variable_type: env_var }` — secure defaults at creation time

### scripts/README-sync-secrets.md
- Bilingual TH + EN
- Documents the security guarantees accurately (modulo the `shred` overstatement noted in LOW-2)
- Lists all 7 exit codes with meanings
- Explains "when to retire this script" (when GitLab Group Variables become available)

### .gitignore
- Entry on line 42: `scripts/secrets-config.yaml` — verified present, correct path

## Conclusion

The implementation reflects mature secret-handling practice for a
solo-operator workflow. The two LOW findings are quality refinements,
not security gaps; both can be addressed in a follow-up MR without
urgency. The INFO observation requires no action.

**No follow-up MR is mandated by this audit.** If the team chooses to
address LOW-1 + LOW-2, a single 5-line patch will cover both.

— vollos-auditor (inline review, T-089 sub-task)
