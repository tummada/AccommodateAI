# T-104 — Cleanup CLAUDE.md + best-practice.md (post-skill-canonicalization)

```yaml
task_id: T-104
title: "Delete duplicated rules from CLAUDE.md + best-practice.md (now canonical in vollos-lead skill)"
spawned_by: lead
spawn_started_at: "2026-04-30T09:24:29+07:00"
agent: vollos-devops
mode: 1
decision_mode: detailed

# Pipeline routing (from Lead Routing Protocol)
task_type: "DevOps/Infra"   # docs cleanup + git/MR workflow + 9-pattern secret scan
reviewer_scope:
  auditor: "Security Hardening (audit trail integrity + no secret leak in deleted content + git history clean + 9-pattern secret scan validation)"
  qa: "Infra Correctness (verify deleted sections are actually canonicalized in skill / verify KEEP sections preserved verbatim / verify single MR conventional commit / verify forward-edit only — no git revert)"
pipeline: "pipeline-small"
rubric_yes_count: 0
rubric_evaluation:
  q1_3_files_dependent: "NO — touches 2 files independently"
  q2_500_loc_new: "NO — deletion only, ~245 lines removed, 0 added"
  q3_design_spec: "NO — spec already approved (D15 + D16, board L48-58)"
  q4_schema_interface: "NO"
  q5_cascade_regression: "NO — doc cleanup, no runtime impact"
  q6_determinism: "NO — but KEEP-vs-DELETE boundary deterministic via Pending follow-up spec"
mandatory_gate_override: "none — no auth/JWT/email/payment/public-endpoint/PII/CORS/TLS/deploy"
```

## Context

**Trigger:** Pending follow-up in `_board.md` L45-59 (recorded session #010, 2026-04-29 22:50 ICT). Owner confirmed 2026-04-30 09:23 ICT that `vollos-lead` skill canonicalization is complete (skill loaded with `pipeline-{small,medium,big}.md` references — verified by Lead via filesystem inspection).

**Goal:** Forward-edit cleanup — remove duplicated rules now living in `~/.claude/skills/vollos-lead/`. NO `git revert <SHA>` — keep history linear.

**Constraints (from Pending follow-up):**
- vollos-core single-repo only — DO NOT touch acmd, skill-team
- NO `git revert <SHA>` — forward edits only
- Single MR for cleanup
- Conventional commit (`chore(cleanup):` or `refactor:`)
- 9-pattern secret scan before push (per CLAUDE.md `_workspace/` Git Policy)
- DevOps does all file edits — Lead does NOT edit files directly (Technical Boundary Rule)

## Owned files

```
CLAUDE.md
_workspace/ACMD-01-cors-allowlist-update/best-practice.md
```

## Acceptance Criteria

### File 1: `CLAUDE.md`

- [ ] **AC-1:** Section `## File-Based Revision Pattern (Tier-Based — D16)` (currently L74–116, the ENTIRE H2 section including its 4 H3 subsections: Trigger criteria / Default for other tasks / File structure / Iteration cap / Audit trail enforcement) is **deleted in full**.
- [ ] **AC-2:** The stale pointer `~/.claude/skills/vollos-upgrade/references/pipeline001.md` is gone (it lives inside the deleted section, so AC-1 covers this — verify post-delete with `grep -n "vollos-upgrade" CLAUDE.md` returns 0 matches).
- [ ] **AC-3:** Surrounding sections preserved verbatim:
  - Section above: `## Placeholder Audit (Mandatory ...)` ending at the line `**ห้ามใช้คำว่า "เสร็จแล้ว" ถ้ายังมี alert() หรือ coming soon ในไฟล์ที่ deliver**`
  - Section below: `## Best Practices — มาตรฐานทีม (บังคับทุก agent ทุก task)`
  - These two sections must now be adjacent (one blank line between them).

### File 2: `_workspace/ACMD-01-cors-allowlist-update/best-practice.md`

- [ ] **AC-4:** Sections **§2 / §3 / §4 / §5 / §6 deleted in full** (currently L29–228):
  - §2 Four Adoption Principles (incl. §2.1 Trust No One / §2.2 FIND-REPLACE / §2.3 Fresh-eye / §2.4 Lead = Postman) — note §2.5 already deleted via T-103/MR !39 (HEAD `7f9bf7f`)
  - §3 Five-Tier Decision Matrix (Rubric + Tier matrix + escalation rules)
  - §4 Pipeline Reference (§4.1 pipeline001 / §4.2 pipeline001-expand / §4.3 pipeline003)
  - §5 Trade-offs (cost vs safety)
  - §6 Anti-patterns to avoid
- [ ] **AC-5:** KEEP sections preserved verbatim (byte-identical):
  - §1 Why this exists (currently L11–28)
  - §7 Adoption checklist for a new Lead (currently L229–242)
  - §8 Open questions / future work (currently L243–251)
  - §9 Credit (currently L252–end)
  - Top-of-file frontmatter / title / lines L1–10
- [ ] **AC-6:** Section numbering NOT renumbered — keep §1, §7, §8, §9 as-is (gap is intentional, signals deletion happened, easier to trace via git log).

### Git workflow

- [ ] **AC-7:** Branch: stay on current branch `chore/best-practice-delete-section-2-5` OR create new branch `chore/cleanup-canonicalized-rules` — DevOps decides + documents in `output.md` (preference: NEW branch from `main` because current branch already has T-103 §2.5 commit and that's already merged via MR !39 — using new branch keeps this MR atomic).
- [ ] **AC-8:** Commit message: conventional commits format. Suggested:
  ```
  chore(cleanup): remove rules now canonical in vollos-lead skill

  - Delete CLAUDE.md "File-Based Revision Pattern" section (L74-116, 43 lines)
    Rules now canonical in ~/.claude/skills/vollos-lead/SKILL.md
  - Delete best-practice.md §2-§6 (~200 lines) — same canonicalization
  - Keep §1/§7/§8/§9 as standalone team-shareable doc
  - No git revert — forward edits only (keeps history linear)

  Refs: _board.md D14/D15/D16, _workspace/T-104/, Pending follow-up
  ```
- [ ] **AC-9:** Single MR opened (push to GitLab, output MR URL in `output.md`).
- [ ] **AC-10:** 9-pattern secret scan run on `_workspace/T-104/` BEFORE push, document `0 matches` evidence in `output.md`.

### Audit trail integrity (DO NOT TOUCH)

- [ ] **AC-11:** `_workspace/T-099-adopt-file-based-tier-b/review-of-skill-team-draft.md` — UNCHANGED (read-only verify via `git diff --name-only` post-edit must NOT include this file).
- [ ] **AC-12:** `_board.md` Decisions Log entries D14, D15, D16 — UNCHANGED.
- [ ] **AC-13:** `_board.md` Session Anchor Log + Done table rows — UNCHANGED.

## Self-Review Protocol (mandatory before submitting output.md)

DevOps MUST include `self_review` field in `output.md` with `result: true/false` + `evidence: "file:line — description"` for every AC. Specifically:

- AC-1 evidence: `grep -c "File-Based Revision Pattern" CLAUDE.md` → must be 0
- AC-2 evidence: `grep -c "vollos-upgrade" CLAUDE.md` → must be 0
- AC-3 evidence: `sed -n '/Placeholder Audit/,/Best Practices/p' CLAUDE.md | head/tail` → show adjacency
- AC-4 evidence: `grep -c "^## 2\. Four Adoption" _workspace/ACMD-01-cors-allowlist-update/best-practice.md` → 0; same for §3, §4, §5, §6
- AC-5 evidence: `git diff main -- _workspace/ACMD-01-cors-allowlist-update/best-practice.md` → §1, §7, §8, §9 lines unchanged (only deletions in §2-§6 range)
- AC-7 evidence: `git branch --show-current` output
- AC-8 evidence: `git log -1 --format=%B` output
- AC-9 evidence: MR URL (https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/...)
- AC-10 evidence: paste 9-grep command outputs (each must show `(no matches)` or `0`)
- AC-11/12/13 evidence: `git diff main --stat` — only the 2 expected files in stat

## Output Format

Write to `_workspace/T-104-cleanup-claude-and-best-practice/output.md`:

```markdown
# T-104 Output

agent: vollos-devops
spawn_completed_at: <ISO timestamp>

## Files Changed
- CLAUDE.md (-43, 0 +)
- _workspace/ACMD-01-cors-allowlist-update/best-practice.md (-200, 0 +)

## Branch + Commit
- branch: <name>
- commit_sha: <sha>
- mr_url: <url>
- mr_pipeline_status: <pending/running/passed>

## Self-Review (evidence-based, mandatory)
<every AC with result: true/false + evidence: "file:line — description">

## Secret Scan
<9-pattern grep outputs>

## Placeholders Remaining
<grep result for "alert(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]" on changed files>

## Notes for Lead
<anything Lead should know — e.g., line drift if real line numbers diverge from spec>
```

## Pipeline note

This is **pipeline-small** (1 round Dual Reviewer):
1. DevOps (Writer) → `output.md` + commit + MR
2. Lead spawns Auditor + QA (fresh-eye, parallel) → `review-auditor.md` + `review-qa.md`
3. If both PASS → Lead marks done; if FAIL → SendMessage DevOps for fix loop (1 round only — small cap)
4. Lead aggregates verdicts → updates `_board.md` Done row

## References

- `_board.md` Pending follow-up L45-59 (spec source-of-truth)
- `_board.md` Decisions Log D14/D15/D16
- `~/.claude/skills/vollos-lead/SKILL.md` (canonical rules — verify via Read for cross-check, do NOT edit)
- `~/.claude/skills/vollos-lead/references/pipeline-{small,medium,big}.md` (3 forge-protected pipeline references)
- `CLAUDE.md` `_workspace/` Git Policy section (9-pattern secret scan list)
