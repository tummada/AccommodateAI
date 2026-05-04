---
task_id: T-103
title: Delete § 2.5 "P4 Mode Toggle" from best-practice.md (owner directive)
spawn_started_at: 2026-04-29T22:09:47+07:00
agent_role: devops
priority: medium
---

# Task T-103 — Delete § 2.5 from best-practice.md

## Background

Owner directive 2026-04-29 ~22:08 ICT (verbatim): "ผมสั่งแก้เอง ตอบข้อ2 (c) ลบทิ้ง"

Lead@acmd's handover (T-108) suggested vollos-core point § 2.5 to a canonical file in vollos-skill-team. Owner explicitly rejected the pointer/freeze options and chose **delete**.

Lead pre-checked (read-only, owner-granted):
- skill-team file `vollos-lead/references/p4-mode-toggle.md` exists (5792 bytes, 21:53 ICT)
- vollos-core CLAUDE.md has NO duplicate rule body (grep `CONCAT|ALLOWED in file-based|FORBIDDEN` returned 0 matches)
- § 2.5 in best-practice.md = lines 90-131 (42 lines incl. surrounding blank line)

## Scope (vollos-core only)

- Touch only `_workspace/ACMD-01-cors-allowlist-update/best-practice.md`
- NO acmd, NO skill-team, NO any other repo
- Delete § 2.5 entirely. Do NOT replace with anything (no pointer, no decision-record stub).

## Deliverable

### Edit best-practice.md — delete § 2.5

**Section to delete:** lines 90-131 (begins `### 2.5 P4 Mode Toggle (in-session vs file-based)` and ends just before `## 3. Five-Tier Decision Matrix` at line 132).

**Important:** Delete the trailing blank line(s) between § 2.5 and `## 3` so the result is clean (one blank line between § 2.4 ending and `## 3` opening — verify after edit).

**Branch:** `chore/best-practice-delete-section-2-5`
**Cut from:** `origin/main` HEAD `1efd67f` (current main; MR !38 not yet merged — this is intentional, T-103 base is main not !38's branch).
**Commit message:** `chore(best-practice): delete § 2.5 P4 Mode Toggle (per owner directive)`
**MR target:** main

**Special note for commit body** — include this line in the commit body (after blank line under subject):
```
Reverts T-101 (MR !37 merge 1efd67f). Owner directive 2026-04-29 22:08 ICT after Lead@acmd T-108 raised the conflict: rule body now lives canonically elsewhere (out-of-repo); vollos-core best-practice.md will not host or point to it.
```

## Acceptance Criteria

- [ ] AC1: Branch cut from `origin/main` HEAD `1efd67f` (verify `git merge-base origin/main HEAD == 1efd67f`)
- [ ] AC2: `_workspace/ACMD-01-cors-allowlist-update/best-practice.md` modified — only deletion, no insertion (`git diff --stat`: shows `-` lines only, `+` count = 0)
- [ ] AC3: After delete: `grep -n "^### 2\." best-practice.md` shows `2.1, 2.2, 2.3, 2.4` only (no 2.5)
- [ ] AC4: After delete: `grep -n "P4 Mode Toggle" best-practice.md` returns empty (zero hits)
- [ ] AC5: After delete: `## 3. Five-Tier Decision Matrix` heading still present and readable; lines around the deletion point look clean (blank-line-only between § 2.4 last paragraph and `## 3`)
- [ ] AC6: Conventional commit subject `chore(best-practice):` per Conventional Commits
- [ ] AC7: Commit body includes the "Reverts T-101..." note (verify via `git log -1 --format=%b`)
- [ ] AC8: 9-pattern secret scan on changed file = 0 matches (deletion shouldn't introduce secrets but scan as standard)
- [ ] AC9: MR opened against main; URL captured
- [ ] AC10: `git diff --name-only` shows only `_workspace/ACMD-01-cors-allowlist-update/best-practice.md`
- [ ] AC11: self_review with file:line evidence per CLAUDE.md rule
- [ ] AC12: NO touch of acmd, skill-team, or any other repo

## Owned Files

- `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/ACMD-01-cors-allowlist-update/best-practice.md` (DELETE 42 lines, no replacement)

## Out of Scope

- Do NOT modify CLAUDE.md (no duplicate to remove — Lead pre-checked grep clean)
- Do NOT modify _board.md (Lead handles in separate cycle to avoid conflict with MR !38)
- Do NOT touch acmd or skill-team repos
- Do NOT post comments on acmd MR T-108 (forbidden cross-repo write — owner will relay if needed)
- Do NOT merge the MR

## Reporting

Standard `output.md` schema. Run in background. Begin now.
