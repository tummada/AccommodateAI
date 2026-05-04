# T-105 — Board sync MR after T-104 merge (D14 enforcement)

```yaml
task_id: T-105
title: "Commit _board.md updates (T-104 Done row + Pending resolved + session #011 anchor + spawn counter) via single MR per D14"
spawned_by: lead
spawn_started_at: "2026-04-30T10:12:00+07:00"
agent: vollos-devops
mode: 1
decision_mode: detailed

task_type: "DevOps/Infra"
reviewer_scope:
  auditor: "Audit trail integrity (no historical row mutated, only additions/Pending-resolution; 9-pattern secret scan)"
  qa: "Conventional commit format + single MR + diff scope correctness"
pipeline: "pipeline-small"
rubric_yes_count: 0
rubric_evaluation:
  q1_3_files_dependent: "NO — touches 1 file (_board.md)"
  q2_500_loc_new: "NO — small diff (~5 lines added/changed)"
  q3_design_spec: "NO — D14 policy already approved"
  q4_schema_interface: "NO"
  q5_cascade_regression: "NO — board doc only"
  q6_determinism: "NO"
mandatory_gate_override: "none"
```

## Context

**Trigger:** Owner merged MR !40 (T-104 cleanup) at 2026-04-30T10:10 ICT. Per **D14** (`_board.md` Decisions Log), `_board.md` MUST be committed via MR every time it's modified. Lead made 4 in-place edits to `_board.md` during session #011 (allowed — Lead writes _board.md per allowlist). Now those edits need to land in `main` via a separate MR.

**Goal:** Open a small follow-up MR that commits the current `_board.md` working-tree state.

**Local edits already in working tree (pre-existing — DevOps does NOT re-edit, just commits):**
1. Session Anchor Log — new row `#011 | 2026-04-30 09:17 ICT | Resume session...`
2. Pending follow-up — entry replaced with strikethrough `[x] ~~vollos-core cleanup...~~ — done T-104 2026-04-30 09:38 ICT (MR !40 awaiting owner merge approval)` (note: at time of edit MR !40 was awaiting; you may update text to reflect post-merge reality if desired — see AC-3)
3. Done table — new row `| T-104 | Cleanup CLAUDE.md + best-practice.md ... | merge !40 |`
4. Spawn Counter — reset to 3 (session #011)

## Owned files

```
_board.md
```

## Acceptance Criteria

- [ ] **AC-1:** Branch: `chore/board-sync-t-104` created from latest `origin/main` (which now contains MR !40 merge commit `2346f13`).
- [ ] **AC-2:** Single commit on branch with conventional commits message:
  ```
  chore(board): sync _board.md after T-104 merge (D14)

  - Add session #011 anchor row (2026-04-30 09:17 ICT)
  - Resolve Pending follow-up "vollos-core cleanup" → done T-104 (MR !40 merged)
  - Add T-104 to Done — pipeline-small (Writer + Auditor + QA fresh-eye)
  - Reset Spawn Counter to 3 (session #011)

  Refs: D14, T-104, MR !40
  ```
- [ ] **AC-3:** (Optional improvement, DevOps decides) Update Pending follow-up resolved-line text from "MR !40 awaiting owner merge approval" → "MR !40 merged 2026-04-30 10:10 ICT (commit 2346f13)" since merge already happened. If updated, document in `output.md`. If left as-is, also fine — historical accurate at time of write.
- [ ] **AC-4:** `git diff origin/main --name-only` returns ONLY `_board.md`. No other file in MR.
- [ ] **AC-5:** No other section of `_board.md` mutated. Specifically verify `git diff origin/main -- _board.md` shows ONLY:
  - Session Anchor Log: 1 added row (#011)
  - Pending follow-up: 1 line replaced (the cleanup entry)
  - Done table: 1 added row (T-104)
  - Spawn Counter: 4 lines changed (count + last_re_read_at)
  No other lines should change. If `git diff` shows mutations elsewhere → CRITICAL — abort and escalate Lead.
- [ ] **AC-6:** D14 / D15 / D16 entries — UNCHANGED in diff.
- [ ] **AC-7:** Other Done table rows (T-001 ... ACMD-01) — UNCHANGED.
- [ ] **AC-8:** 9-pattern secret scan run on `_board.md` + `_workspace/T-105-board-sync-after-t104/` BEFORE push, document `0 matches`.
- [ ] **AC-9:** MR opened via `glab mr create` — single MR, target=main, source=`chore/board-sync-t-104`.
- [ ] **AC-10:** Forward edits only — no `git revert`, no `--no-verify`, no force-push.

## Self-Review Protocol

DevOps MUST include `self_review` field in `output.md` with `result: true/false` + `evidence: "file:line — description"` for every AC. See T-104 task.md for evidence-format pattern.

Specific evidence commands to run:
- AC-1: `git log -1 origin/main --format=%H` → must equal merge commit `2346f13...`; `git merge-base chore/board-sync-t-104 origin/main` → must equal `2346f13...`
- AC-4: `git diff origin/main --name-only`
- AC-5: paste `git diff origin/main -- _board.md` and annotate which 4 hunks correspond to which AC
- AC-6: `git show origin/main:_board.md | grep "^| D14\\|^| D15\\|^| D16"` vs `grep "^| D14\\|^| D15\\|^| D16" _board.md` → must be identical
- AC-8: paste 9 grep outputs

## Output

Write `output.md` to:
`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-105-board-sync-after-t104/output.md`

Format same as T-104 output.md.

## Pipeline note

Pipeline-small. Lead will spawn Auditor + QA fresh-eye after output.md, 1 round only.

## References

- `_board.md` Decisions Log D14
- `_workspace/T-104-cleanup-claude-and-best-practice/` (preceding task)
- MR !40 (just merged: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/40)
