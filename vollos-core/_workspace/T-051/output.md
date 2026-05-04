---
task_id: T-051
status: completed
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/8
branch: fix/csp-cf-insights
commit_sha: 9b4aef5
---

# T-051 — Allow Cloudflare Insights beacon in CSP script-src

## skill_loaded_evidence
- path: /home/ipon/.claude/skills/vollos-devops/SKILL.md
- quote L264: "**Caddy validate:** รัน `caddy validate --config /etc/caddy/Caddyfile` ก่อน reload ทุกครั้ง"
- quote L421: "ห้ามแก้ไฟล์นอก owned areas (infra/, pnpm-workspace.yaml, root package.json, Dockerfiles)" — owned_files is `infra/Caddyfile` only, compliant

## re_anchor_evidence
- "Critical Rules: read before delivery — confirmed no spawn Agent tool, no hardcoded secrets introduced, no port expose changes"
- "Security Rules: read before delivery — change only adds ONE CF host to script-src; all other CSP directives preserved; no relaxation elsewhere"

## files_changed
- path: infra/Caddyfile
  action: modified
  existing_read: "infra/Caddyfile:L107 — full existing CSP read before edit; all 5 existing script-src entries preserved (self, unsafe-inline, challenges.cloudflare.com, accounts.google.com, www.gstatic.com)"

## Exact diff (script-src line only)

Before (L107):
```
Content-Security-Policy "... script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com; ..."
```

After (L113):
```
Content-Security-Policy "... script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com https://static.cloudflareinsights.com; ..."
```

Comment block (L56-64) also updated to document CF Web Analytics beacon and the intentional non-relaxation of connect-src.

## Verification
- Command: `docker run --rm -v $PWD/infra:/etc/caddy caddy:alpine caddy adapt --config /etc/caddy/Caddyfile`
- Result: JSON output produced successfully. CSP string in JSON output contains `https://static.cloudflareinsights.com` in script-src for all 3 sites (auth.vollos.ai, www.vollos.ai, vollos.ai). Syntax valid.
- Note on `caddy validate`: also ran but returns exit 1 due to missing TLS cert file (`/etc/caddy/certs/cloudflare.pem`) — this is expected in local validation since certs are bind-mounted on VPS only. Caddyfile parsing itself succeeded (log line: "adapted config to JSON") — syntax is valid; only runtime cert load fails.

## Placeholder Audit
- Command: `grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" infra/Caddyfile`
- Result: placeholders_remaining: none — grep clean (no match on the changed file)

## self_review

| AC | result | evidence |
|---|---|---|
| 1. `static.cloudflareinsights.com` added to `script-src` | true | infra/Caddyfile:L113 — script-src list now contains `https://static.cloudflareinsights.com` as the 6th token |
| 2. All existing script-src entries preserved | true | infra/Caddyfile:L113 — 5 original tokens present unchanged: `'self' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://www.gstatic.com` |
| 3. `caddy validate` / `caddy adapt` passes (syntax) | true | `docker run caddy:alpine caddy adapt` produced full JSON config (see Verification section); only runtime cert load fails which is expected locally |
| 4. Comment added explaining why this host is allowed | true | infra/Caddyfile:L56-64 — comment block documents "Cloudflare Web Analytics beacon (auto-injected by CF — loads https://static.cloudflareinsights.com/beacon.min.js)" plus explicit note that connect-src is NOT relaxed |
| 5. Branch pushed + MR opened | true | Branch `fix/csp-cf-insights` pushed to origin (commit 9b4aef5); MR #8 opened: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/8 |
| 6. `self_review` complete | true | this table — every AC has result + file:line evidence |
| Pre-check: no other CSP directive relaxed | true | infra/Caddyfile:L113 — diff shows only `script-src` gained one token; style-src, style-src-elem, font-src, img-src, frame-src, connect-src, object-src, base-uri, form-action, frame-ancestors all byte-identical to previous commit |
| Pre-check: started from clean origin/main | true | `git checkout -b fix/csp-cf-insights origin/main` executed before edit; branch tracks origin/main; only 1 commit ahead (9b4aef5) |

## Security review (per SKILL.md § Push-back Protocol)
- Trust model: Cloudflare already handles TLS termination and Turnstile for this site. Adding one more CF-controlled host to script-src is low incremental supply-chain risk.
- Did NOT relax connect-src — the beacon's telemetry POST will fail silently (analytics lost only; no user-facing or functional impact). This is the minimal-surface change.
- Every other CSP directive preserved byte-for-byte.

## next_action
null — waiting for Auditor review + Lead merge

## notes
- Commit initially landed on wrong branch (`fix/landing-gsi-dedup` which was HEAD at checkout time) due to the repo being on a different branch when I ran `git checkout -b`. Cherry-picked onto `fix/csp-cf-insights` and reset the erroneous branch back to `origin/main`. Final state: single clean commit on `fix/csp-cf-insights` tracking origin/main, no pollution of other branches.
- MR URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/8

## issues
[]
