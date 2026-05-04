---
task_id: T-090
agent: vollos-devops
status: done — MR opened, NOT merged (awaiting Lead coordination with acmd Lead)
started_at: 2026-04-29T10:35+07:00
finished_at: 2026-04-29T10:50+07:00
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/30
mr_iid: 30
mr_state: opened
mr_auto_merge: false
branch: chore/caddy-acmd-upstream-port-8080
commit_sha: e96d9de
secret_handling: "no _workspace files modified before push; output.md added post-MR-open; will be scanned with 9-pattern grep before any future push touching _workspace/"
---

## Summary

Updated `infra/Caddyfile` to retarget `acmd-landing` and `acmd-web` reverse_proxy upstreams from port `:80` → `:8080`, matching acmd repo's MR T-071 (nginx-unprivileged container hardening). Branch pushed, MR !30 opened with explicit DO-NOT-MERGE warning. Auto-merge disabled.

## Files Changed

- **MODIFIED:** `infra/Caddyfile` (4 lines changed: L227, L234, L242, L249)
  - L227 comment: `acmd-landing:80 (static SPA marketing site)` → `acmd-landing:8080 (static SPA, nginx-unprivileged on port 8080)`
  - L234: `reverse_proxy acmd-landing:80 {` → `reverse_proxy acmd-landing:8080 {`
  - L242 comment: `acmd-web:80 (nginx-served React SPA)` → `acmd-web:8080 (React SPA, nginx-unprivileged on port 8080)`
  - L249: `reverse_proxy acmd-web:80 {` → `reverse_proxy acmd-web:8080 {`

Note: actual line numbers (227/234/242/249) differ slightly from task.md's spec line numbers (230/237/243/250) — file content matched exactly via Edit tool's old_string match, so the change is correct regardless of line-number drift in task.md.

## Verification

- `git diff infra/Caddyfile` → exactly 4 lines changed (`-` and `+` blocks each show 4 lines), all within `accommodate.vollos.ai` (L228-240) and `accommodate-app.vollos.ai` (L243-253) blocks
- `grep 'acmd-api:3101' infra/Caddyfile` → 3 matches (L205 header comment, L255 block comment, L262 reverse_proxy) — all unchanged from main
- `caddy validate` exit 0 with stub TLS certs mounted: `"Valid configuration"` — first run failed only because real Cloudflare cert files are not on local; syntax adapter ("adapted config to JSON") succeeded both times
- vollos.ai subdomains (auth/api/landing) blocks not in diff hunk → untouched
- Header comment block (L203-204) lists `acmd-landing:80` / `acmd-web:80` — these are documentation-only header lines outside the 4-line spec. Per task: "DO NOT touch ANY line outside the 4 specified" → left untouched. **Follow-up note for Lead:** consider a separate doc-cleanup MR to update L203-204 header comments for consistency (cosmetic only, no behavior impact).

## MR Details

- **URL:** https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/30
- **Title:** `chore(caddy): retarget acmd-web/landing upstream to :8080 (handshake [3] from acmd)`
- **State:** `opened` (not merged, not draft)
- **Auto-merge:** disabled (`auto_merge_enabled: None`, `merge_when_pipeline_succeeds: false`)
- **Body includes:** explicit `⚠️ DO NOT MERGE YET` warning + merge-order sequence + 502 risk explanation + cross-repo reference to `acmd/_workspace/T-071-t061-fix-r2/output.md` (I-1)

## Coordination Required (Lead action)

Lead@vollos-core must:
1. Notify acmd Lead that vollos-core MR !30 is open and ready
2. Coordinate merge sequence: open both MRs (done) → acmd merges T-071 → vollos-core merges !30 → both deploys land within seconds → run smoke test on 3 acmd subdomains
3. After both merges land, smoke test:
   - `curl -I https://accommodate.vollos.ai` → expect 200
   - `curl -I https://accommodate-app.vollos.ai` → expect 200
   - `curl -I https://accommodate-api.vollos.ai/health` → expect 200

## Self-Review (evidence-based, file:line)

```yaml
self_review:
  - field: caddyfile_2_upstream_lines_changed
    result: true
    evidence: "infra/Caddyfile:234 reverse_proxy acmd-landing:8080 + infra/Caddyfile:249 reverse_proxy acmd-web:8080 — confirmed via git diff hunk @@ -224,14 +224,14 (4 lines + and 4 lines -)"
  - field: caddyfile_2_comments_updated
    result: true
    evidence: "infra/Caddyfile:227 '# accommodate.vollos.ai → acmd-landing:8080 (static SPA, nginx-unprivileged on port 8080)' + infra/Caddyfile:242 '# accommodate-app.vollos.ai → acmd-web:8080 (React SPA, nginx-unprivileged on port 8080)' — both contain '8080' and 'nginx-unprivileged'"
  - field: acmd_api_3101_untouched
    result: true
    evidence: "grep 'acmd-api:3101' infra/Caddyfile → 3 matches at L205 (header), L255 (block comment), L262 (reverse_proxy) — none in git diff output, all unchanged from main HEAD"
  - field: vollos_subdomains_untouched
    result: true
    evidence: "git diff infra/Caddyfile → only 1 hunk @@ -224,14 +224,14 @@ — entirely within acmd subdomain blocks (L227-249); no diff hunks at L125 (vollos.ai), L156 (auth.vollos.ai), L188 (api.vollos.ai)"
  - field: caddy_validate_passed
    result: true
    evidence: "docker run caddy:2-alpine validate with stub TLS certs mounted at /etc/caddy/certs/ → stdout 'Valid configuration', exit 0; first run without stub certs failed at TLS cert load (post-syntax) — syntax adapter 'adapted config to JSON' succeeded both times"
  - field: branch_pushed_mr_opened
    result: true
    evidence: "git push -u origin chore/caddy-acmd-upstream-port-8080 → 'new branch' message; GitLab API POST /projects/81441960/merge_requests → MR_IID=30, MR_URL=https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/30, STATE=opened, AUTO_MERGE=None"
  - field: mr_body_warns_no_merge_yet
    result: true
    evidence: "MR !30 description includes section '## ⚠️ DO NOT MERGE YET' with merge-order sequence (1-4) + 502 risk explanation for both wrong-order scenarios + Lead-coordinates note (see /tmp/mr_body.txt → MR description body submitted via API)"
```

## Placeholder Audit

```bash
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" infra/Caddyfile
```

Result: only matches are pre-existing comments unrelated to this change (none introduced in the 4-line diff).

`placeholders_remaining: none — grep clean for the 4 lines added in this MR`

## Boundaries Respected

- ✅ Did NOT push to main (pushed to branch `chore/caddy-acmd-upstream-port-8080`)
- ✅ Did NOT merge MR (state=opened, auto_merge_enabled=None)
- ✅ Did NOT touch any line outside the 4 specified (git diff confirms 4-line change in single hunk)
- ✅ Used Edit tool with exact-match strings (no full-file regenerate)

## Blockers

None. MR !30 is awaiting Lead@vollos-core to coordinate merge timing with Lead@acmd before merging.
