---
audit_target: MR !31 — fix(scripts): close LOW-1 curl argv leak in sync-secrets.sh (T-091)
branch: fix/sync-secrets-curl-argv-leak
commit: 27a3aae
auditor: vollos-auditor (invoked inline by vollos-devops within T-091 — sub-agent spawn forbidden by vollos-devops SKILL.md "Critical Rules: ห้าม spawn Agent tool"; mirrors T-089 pattern)
audit_scope: targeted re-review of LOW-1 fix + regression check on the diff
audit_date: 2026-04-29
files_reviewed:
  - scripts/sync-secrets.sh (lines 113-152, 245-260, plus 4 jq -j sites)
  - diff against main: 1 file changed, 19 insertions(+), 6 deletions(-)
verdict: pass — LOW-1 closed, 0 new findings
---

## Verdict

**PASS** — LOW-1 from T-089/audit-mr28.md is closed. The fix is minimal,
correct, and verifiable: curl now reads the secret from disk inside its
own process (`--form value=<${valfile}`), so the secret never enters
the curl argv. The accompanying `jq -r → jq -j` change is a necessary
correctness fix (without it, `--form value=<file` would upload the
trailing `\n` that `jq -r` adds, mutating the value and breaking
`masked=true`); it does not introduce any new attack surface.

No CRITICAL/HIGH/MEDIUM findings. No new LOW findings.

## Findings by severity

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 0     | — |
| HIGH     | 0     | — |
| MEDIUM   | 0     | — |
| LOW      | 0     | — |
| INFO     | 1     | INFO-A (observation, no action) |

## LOW-1 closure verification

**Before** (`scripts/sync-secrets.sh@b8580fa:121, :138`):
```bash
--form-string "value=$(cat "${valfile}")"
```
Bash performed `$(cat)` substitution before `exec`, placing the
plaintext value as a literal argv string of curl.

**After** (`scripts/sync-secrets.sh@27a3aae:126, :146`):
```bash
--form "value=<${valfile}"
```
curl's documented `--form value=<filename` syntax: the `<` prefix
instructs curl to load the field's value from the named file at
request-build time, inside the curl process. `${valfile}` is a path
under `mktemp -d -t T-088-sync-XXXXXX` (still chmod 700, files chmod
600, shredded on EXIT/INT/TERM via the existing trap at `:219`).

**Empirical confirmation:**
A 25-second `/proc/<pid>/cmdline` watcher captured 64 distinct curl
process samples while the script ran a PUT against vollos-acmd with
source value `changed-value-T091-argv-test`. Watcher result:
`RESULT=NO_LEAK` — neither the new sentinel value nor the prior
sentinel `hello-fix-2026` ever appeared in any curl argv. Recorded in
`_workspace/T-091/output.md` § Evidence.

LOW-1 is **closed**.

## Regression checklist on the diff

| Check | Status | Evidence |
|-------|--------|----------|
| Token still passed via `--header` (not argv) | ✅ | `:125, :144` — `--header "PRIVATE-TOKEN: ${VOLLOS_CLI_v2}"` unchanged |
| Source value file mode preserved | ✅ | `:262` — `chmod 600 "${vf}"` unchanged |
| Tmpdir mode preserved | ✅ | `:213` — `chmod 700 "${TMPDIR_RUN}"` unchanged |
| Trap cleanup still wires EXIT/INT/TERM | ✅ | `:226` — `trap cleanup EXIT INT TERM` unchanged; `shred -u` on `:219` unchanged |
| sha8 fingerprint logic unchanged | ✅ | `:89-92` (sha8) + `:264, :297, :316, :349` (sha8 sites) all read from the same set of files now written with `jq -j` — fingerprints stay byte-identical between source and target reads |
| Verify-after-write loop preserved | ✅ | `:303-318` (PUT verify) and `:336-358` (POST verify) re-GET, sha8 compare, exit 5 on mismatch — all unchanged |
| `--form-string "key=..."` retained for non-secret key | ✅ | `:145` — key is not secret + value comes from a trusted bash array; argv exposure is acceptable |
| No new shell expansions of secret material | ✅ | `grep -n '\$(.*valfile' scripts/sync-secrets.sh` → 0 matches; `grep -n 'echo.*VOLLOS_CLI' scripts/sync-secrets.sh` → 0 matches |
| Set -x still disabled | ✅ | `:35` — comment `# NB: do NOT enable set -x` unchanged; `set -euo pipefail` only |
| Token cleanup on exit | ✅ | `:217` — `unset VOLLOS_CLI_v2` unchanged |

## Threat-vector recheck

| Vector | Status | Notes |
|--------|--------|-------|
| Secret leak — argv during curl | ✅ closed (was LOW-1) | `--form value=<file` reads inside curl process; argv only contains the file path |
| Secret leak — argv during cat (replaced subshell) | ✅ N/A | The `$(cat ...)` subshell is removed; cat is no longer invoked at all |
| Secret leak — file content corruption from `--form value=<file` | ✅ safe | curl `--form` with `<filename` sends the file as raw content (no urlencode); appropriate for multipart/form-data field. Verified in apply test: GitLab returned `value:"hello-fix-2026"` exactly (HTTP 201) |
| Trailing-newline mutation (introduced by file→curl path) | ✅ closed | `jq -j` writes byte-exact value; verified by sha8 round-trip and apply test (no value mutation observed) |
| `masked=true` validation regression | ✅ safe | apply test ran with default `masked=true` flag; GitLab accepted POST 201 + PUT 200 (would have rejected 400 had trailing `\n` been present) |
| Race — file replaced between curl open and read | ✅ safe (no change) | curl opens the file at request-build time within a single `mktemp -d` per-run tmpdir owned by the script process; no other writer touches it within that window |
| `--form value=<` with leading `<` in actual data | ✅ N/A here | The `<` prefix is interpreted by curl on the right-hand side of `=`, not in file content. Even if a secret happened to start with `<`, that byte would still be uploaded literally because it is inside the file, not the argv |
| Path injection via `${valfile}` | ✅ safe | `valfile` is constructed from `${TMPDIR_RUN}/src-${key}` where TMPDIR_RUN is `mktemp -d -t T-088-sync-XXXXXX` and `key` flows from a trusted YAML-or-CLI-array path. No user input reaches the path. |
| New secret display in stdout/stderr | ✅ safe | Diff adds only sha8 fingerprints (already done) and HTTP status codes; no plaintext secret introduced |
| Test artifact leak (TEST_FIX_T091) | ✅ cleaned | Deleted from both `vollos-core` (HTTP 204) and `vollos-acmd` (HTTP 204), confirmed gone (404 on re-GET). No mention in commit message or output beyond the sentinel name |

## INFO-A — `--form value=<file` always sends as `text/plain` (observation only)

**Location:** `scripts/sync-secrets.sh:126, :146`

**Description:** curl's `--form value=<filename` syntax reads the file
content and sends it as a multipart form field with implicit
`Content-Type: text/plain`. For GitLab's `/projects/.../variables`
endpoint this is correct (the `value` field is a string). If a future
key happened to need a binary value or a custom content type, the form
would need `--form "value=<${valfile};type=application/octet-stream"`.

**Risk:** None for VOLLOS's current use case (Google OAuth strings,
URLs, refresh tokens — all UTF-8 text).

**Recommendation:** No action.

## Files reviewed in detail

### scripts/sync-secrets.sh (post-fix)
- 386 lines (was 379, +7 from the security comment block)
- `set -euo pipefail` retained (`:34`)
- `set -x` warning retained (`:35`)
- Two functions touched (`gitlab_put_var:113`, `gitlab_post_var:134`); other functions (`sha8`, `urlencode`, `gitlab_get_var`, `load_config_from_file`, `cleanup`) unchanged
- Four `jq -r '.value' >file` writes converted to `jq -j` (`:262, :297, :316, :349`); justification documented in inline comment `:251-256`
- Trap, tmpdir creation, chmod 600/700, shred-on-exit, token unset all unchanged

### Diff stats
```
1 file changed, 19 insertions(+), 6 deletions(-)
```
Insertion-heavy because of the inline security comment blocks; the
behavioral diff is 6 line changes (2 curl + 4 jq).

## Conclusion

The patch closes LOW-1 cleanly and correctly. The supporting `jq -j`
change is justified (and required — without it, `--form value=<file`
would upload trailing `\n` and trip GitLab's masked validation). All
prior security guarantees of MR !28 are preserved: token in `--header`
not argv, value files chmod 600 inside chmod 700 tmpdir, shred-on-trap,
sha8 verify-after-write, no `set -x`. No new findings.

The MR is **safe to merge**.

— vollos-auditor (inline review, T-091 sub-task — sub-agent spawn
forbidden by vollos-devops SKILL.md Critical Rules)
