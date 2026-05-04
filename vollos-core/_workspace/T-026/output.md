---
task_id: T-026
status: completed
assigned_to: vollos-devops
completed_at: 2026-04-19T15:50+07:00
---

# Output — T-026: Remove TODO.md / CHANGELOG.md / roadmap.md from vollos-core/CLAUDE.md allowlist (D7 sync)

## Summary

ลบ 3 บรรทัด (L10-L12) จาก `vollos-core/CLAUDE.md` Lead Tool Gate allowlist:
- `- \`_workspace/roadmap.md\``
- `- \`TODO.md\``
- `- \`CHANGELOG.md\``

เหลือ allowlist เฉพาะ `_board.md` + `_workspace/*/task.md` ให้ sync กับ Decision D7.

MR #20 opened on GitLab — **ไม่ merge** รอ owner review.

## skill_loaded_evidence

```yaml
files_read:
  - "SKILL.md:L36-40 — 🔴 SECRET HANDLING (non-negotiable — read FIRST) ... ห้ามทำ"
  - "SKILL.md:L49-59 — Routing Protocol (บังคับ) ... re_anchor_evidence field"
  - "SKILL.md:L67-76 — Before Starting (บังคับทุก task): อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข"
  - "SKILL.md:L390-402 — Pre-Delivery Checklist"
  - "SKILL.md:L464-472 — Critical Rules"
```

## re_anchor_evidence

- Critical Rules: read before delivery (SKILL.md:L464-472)
- Security Rules: read before delivery (SKILL.md:L264-275)
- Secret Handling Protocol: no secrets resolved, no plaintext values in output; GitLab token sourced via `set -a; source .env; set +a` and used only via curl header `-H "PRIVATE-TOKEN: ${VOLLOS_CLI}"` — never echoed

## files_changed

```yaml
- path: /home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md
  action: modified
  existing_read: "CLAUDE.md:L7-12 — ### Allowlist (Lead เขียนได้) / - _board.md / - _workspace/*/task.md / - _workspace/roadmap.md / - TODO.md / - CHANGELOG.md"
  change: "removed L10-L12 (three contiguous lines listing roadmap.md / TODO.md / CHANGELOG.md)"
  diff_stat: "1 file changed, 3 deletions(-)"
```

## git_workflow

```yaml
base_ref: origin/main @ f860a0f (Merge branch 'docs/update-l3-rule' into 'main')
branch: docs/cleanup-allowlist-d7
commit_sha: db3ad925e39ae1125ff0ad9c3ddbef32b3331e29
commit_message: "docs(claude): remove TODO/CHANGELOG/roadmap from Lead allowlist per D7"
push_target: origin/docs/cleanup-allowlist-d7 (new branch)
mr:
  iid: 20
  web_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/20
  state: opened
  merged: false
  source_branch: docs/cleanup-allowlist-d7
  target_branch: main
restored_branch: feat/auth-rate-limit (owner's working branch — CLAUDE.md unchanged on this branch)
```

## verification_commands

```bash
# 1) Diff against origin/main (the MR target)
$ git diff --stat origin/main..docs/cleanup-allowlist-d7
 CLAUDE.md | 3 ---
 1 file changed, 3 deletions(-)

# 2) Full diff — single contiguous block, 3 deletions / 0 insertions
$ git diff origin/main..docs/cleanup-allowlist-d7 -- CLAUDE.md
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -7,9 +7,6 @@
 ### Allowlist (Lead เขียนได้)
 - `_board.md`
 - `_workspace/*/task.md`
-- `_workspace/roadmap.md`
-- `TODO.md`
-- `CHANGELOG.md`

 ### ไฟล์อื่นทุกไฟล์ = ห้าม Edit/Write

# 3) Grep on branch — zero matches for removed tokens
$ git show docs/cleanup-allowlist-d7:CLAUDE.md | grep -nE "roadmap\.md|TODO\.md|CHANGELOG\.md"
(no output — grep clean)

# 4) MR state via GitLab API
$ curl -s ".../merge_requests/20" -H "PRIVATE-TOKEN: ***"
state: opened
merged: None
web_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/20
source: docs/cleanup-allowlist-d7
target: main

# 5) Working tree on owner's branch
$ git branch --show-current
feat/auth-rate-limit
$ git status --short CLAUDE.md
(no output — CLAUDE.md clean on feat/auth-rate-limit, my commit isolated to docs/cleanup-allowlist-d7)
```

## self_review

```yaml
criteria:
  - id: 1
    description: "CLAUDE.md L10-12 ลบออก (grep roadmap|TODO|CHANGELOG = 0 match)"
    result: true
    evidence: "CLAUDE.md@docs/cleanup-allowlist-d7:L7-12 — allowlist now contains only `_board.md` + `_workspace/*/task.md`; `git show docs/cleanup-allowlist-d7:CLAUDE.md | grep -nE 'roadmap\\.md|TODO\\.md|CHANGELOG\\.md'` returns zero matches"

  - id: 2
    description: "Section อื่นของ CLAUDE.md ไม่ถูกแตะ (diff ≤ 3 deletions, 0 insertions)"
    result: true
    evidence: "git diff --stat origin/main..docs/cleanup-allowlist-d7 → 'CLAUDE.md | 3 ---' / '1 file changed, 3 deletions(-)' — single contiguous hunk at CLAUDE.md:L7-12 inside '### Allowlist (Lead เขียนได้)' block"

  - id: 3
    description: "Branch docs/cleanup-allowlist-d7 pushed"
    result: true
    evidence: "git push output: '* [new branch]      docs/cleanup-allowlist-d7 -> docs/cleanup-allowlist-d7' + 'branch docs/cleanup-allowlist-d7 set up to track origin/docs/cleanup-allowlist-d7' — commit db3ad92 on remote"

  - id: 4
    description: "MR open บน GitLab (ไม่ merge)"
    result: true
    evidence: "GitLab API response for MR iid=20: state=opened, merged_at=None — https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/20 — source_branch=docs/cleanup-allowlist-d7, target_branch=main"

  - id: 5
    description: "Conventional commit message"
    result: true
    evidence: "commit db3ad925 subject: 'docs(claude): remove TODO/CHANGELOG/roadmap from Lead allowlist per D7' — prefix 'docs(claude):' matches Conventional Commits type 'docs' per CLAUDE.md:L79-81 + F6"

  - id: 6
    description: "Working tree clean"
    result: true
    evidence: "git status --short CLAUDE.md → no output on feat/auth-rate-limit (owner's branch restored after commit+push); commit isolated to docs/cleanup-allowlist-d7 branch — no stray uncommitted CLAUDE.md changes on any branch"
```

## placeholders_remaining

none — grep clean

No `alert(`, `coming soon`, `TODO`, `TBD`, `mock`, `not implemented`, or `Phase [0-9]` introduced by this change. The change is pure deletion of existing allowlist entries.

Note: `grep -n "TODO"` against the full CLAUDE.md matches existing pre-existing lines in Placeholder Audit section (L46, L48) — those are rule text describing the policy, not placeholders being added. My diff touches only L10-L12 (the three deleted lines) and those deletions contain the literal strings `roadmap.md` / `TODO.md` / `CHANGELOG.md` as allowlist entries, not as placeholder markers.

## pre_delivery_checklist

- [x] No secrets in output.md — VOLLOS_CLI sourced only, never echoed; all values masked/omitted
- [x] Branch != main — `docs/cleanup-allowlist-d7`
- [x] Conventional commit — `docs(claude): ...`
- [x] MR opened, not merged — state=opened, merged=None
- [x] No placeholder introduced — diff is pure deletion
- [x] Diff matches spec — exactly 3 deletions, 0 insertions, single hunk
- [x] Working tree clean on owner's restored branch
- [x] Verification commands + output quoted in output.md

## next_action

null — task completed. Awaiting owner review on MR #20.

## issues

[]

## notes

- branch `docs/cleanup-allowlist-d7` created from `origin/main` (f860a0f) — not from local `main` (which was stale at e5168bf) — to ensure the MR target is the true upstream main
- local `main` ref was intentionally not fast-forwarded to avoid side effects on owner's environment
- after push+MR, checked back out `feat/auth-rate-limit` so owner's working context is restored exactly as before
- did NOT touch any uncommitted files (_board.md, _workspace/T-0*, security-check-output/) — per task instructions
- verified via `git show docs/cleanup-allowlist-d7:CLAUDE.md | grep ...` that the committed version on the branch is clean, not just the working copy
