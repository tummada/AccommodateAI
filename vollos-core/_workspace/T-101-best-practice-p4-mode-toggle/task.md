---
task_id: T-101
title: Add "P4 Mode Toggle (in-session vs file-based)" section to best-practice.md
spawn_started_at: 2026-04-29T20:54:25+07:00
agent_role: devops
priority: medium
decision_mode: detailed
---

# Task T-101 — best-practice.md P4 Mode Toggle

## Background

Lead@acmd reached out (2026-04-29 20:50 ICT) flagging a real-world conflict between two rules in our adopted patterns:

- `best-practice.md` § 2.4 "Lead = Postman" — **strict no-edit/no-rank/no-merge/no-dedupe** of review findings
- `multi-iter-revision-pattern.md` § 4 Step 3 — Lead **consolidates findings** into `revision-feedback.md` before next-round Writer

acmd Lead hit this conflict in T-103 (acmd MR #14 already merged) and resolved it via F4 override in their CLAUDE.md: append both reviews verbatim into a single bundle, with thin wrapper, and a self-check forcing function. acmd asks vollos-core to publish the canonical clarification in `best-practice.md` so both repos converge without override drift.

Owner approved option A (publish canonical version) on 2026-04-29 20:54 ICT.

## Scope (single repo only — vollos-core)

This task touches **only** vollos-core. Do **NOT** touch acmd repo. Do **NOT** touch vollos-skill-team repo. Do **NOT** post any comment, MR, or issue on any repo other than vollos-core. acmd Lead will inherit by re-reading the updated file after merge — that handoff is owner's job, not ours.

## Deliverable

### Edit `_workspace/ACMD-01-cors-allowlist-update/best-practice.md`

**Insertion point:** Add a new sub-section **immediately after § 2.4 "Lead = Postman (orchestrator does not filter)"** (which ends around line 84-90 — verify with grep). The new section is § 2.5 (renumber any later subsections in § 2 if they exist; verify before edit).

**Exact content to insert (verbatim — do not paraphrase):**

```markdown
### 2.5 P4 Mode Toggle (in-session vs file-based)

P4 (Lead = Postman) is the default mode but has two operational variants depending on whether SendMessage is available across rounds.

**In-session mode** (SendMessage available, Writer persistent across rounds): Lead routes review artifacts directly to the persistent Writer's next round via SendMessage. No bundling needed; the Postman rule applies as-is — Lead does not edit, rank, filter, merge, or dedupe.

**File-based mode** (SendMessage unavailable, Writer respawned fresh per round per multi-iter-revision-pattern § 4): Lead bundles raw review files into `revision-feedback.md` for the next-round fresh Writer to read. The bundling rule is strict — the Postman rule still applies, but the action becomes "concatenate verbatim" instead of "forward verbatim."

**ALLOWED in file-based bundling:**
- Append `review-A.md` verbatim
- Append `review-B.md` verbatim
- Wrap with thin metadata (round number, source filenames, ISO timestamp)

**FORBIDDEN (no exceptions, applies in BOTH modes):**
- Paraphrasing, summarizing, or rewording any finding
- Reordering, merging, or deduplicating findings
- Prioritizing or ranking by severity
- Filtering out Info / Low / "minor" findings
- Translating between languages
- "Cleaning up" formatting
- Adding Lead commentary or analysis
- Removing reviewer attribution / quoting

The next-round Writer reads `revision-feedback.md` as a single artifact containing both raw reviews and decides on its own (per Trust No One — see § 2.3) which findings to accept, reject, or defer.

**Self-check before save (forcing function for file-based mode):**

| Check | Pass criterion |
|-------|----------------|
| Char-count fidelity | bundled size ≈ (review-A.size + review-B.size + wrapper) within ±5% |
| Finding-ID preservation | every finding ID from review-A and review-B present in bundle |
| `suggested_fix` preservation | every fix block in bundle byte-identical to source |
| Substantive-edit guard | `diff` between bundled section and source review files shows zero substantive content edits (only wrapper additions) |

If any check fails → STOP → re-bundle from scratch (do **NOT** try to fix in-place by editing the bundle — that path leaks Postman violations).

**Why both modes exist:** In-session pipelines are cheaper (~1-3K token diff/round) but bound to a single Claude Code session. File-based pipelines cost ~3-5x but survive session restart, mid-task agent timeout, or owner switching machines, and they create a git-tracked audit trail per the `_workspace/` Git Policy. Use file-based for high-risk tasks (auth, deploy, CCPA, payment, secrets — see vollos-core CLAUDE.md "File-Based Revision Pattern (Tier-Based — D16)").

**Cross-team note:** acmd adopted an equivalent override (F4) in their CLAUDE.md at T-103 / MR #14 (2026-04-29). After this section merges, acmd inherits by re-reading this file; their F4 wording can be replaced with a one-line "see vollos-core best-practice.md § 2.5" pointer at acmd's discretion.
```

**Branch:** `feat/best-practice-p4-mode-toggle`
**Commit message:** `docs(best-practice): add § 2.5 P4 mode toggle (in-session vs file-based)`
**MR target:** main

## Acceptance Criteria

- [ ] AC1: New branch `feat/best-practice-p4-mode-toggle` cut from `origin/main`
- [ ] AC2: File `_workspace/ACMD-01-cors-allowlist-update/best-practice.md` modified — new § 2.5 section inserted immediately AFTER § 2.4 (verify with `grep -n "^### 2\." best-practice.md` showing 2.4 then 2.5 in order)
- [ ] AC3: Existing § 2.4 "Lead = Postman" content preserved unchanged (`git diff` shows zero deletions in 2.4 block — only addition after it)
- [ ] AC4: Inserted content matches the verbatim block in this task.md (Deliverable section) — every heading, table row, ALLOWED bullet, FORBIDDEN bullet, and self-check row preserved
- [ ] AC5: No content from § 2.5 onwards (any subsequent sections that already exist) was deleted or reordered — verify with `git diff` line count: insertion only
- [ ] AC6: Conventional commit message used (`docs(best-practice):` prefix)
- [ ] AC7: 9-pattern secret scan — 0 new matches on the modified file
- [ ] AC8: Branch pushed + MR opened against main; MR URL captured
- [ ] AC9: Self-review field in output.md — every result `true` with file:line evidence
- [ ] AC10: Strict scope — `git diff --name-only HEAD~1..HEAD` shows ONLY `_workspace/ACMD-01-cors-allowlist-update/best-practice.md` changed; no other files

## Owned Files

- `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/ACMD-01-cors-allowlist-update/best-practice.md` (EDIT — single section addition)

## Out of Scope (do NOT touch)

- Do NOT modify acmd repo (forbidden — outside scope)
- Do NOT modify vollos-skill-team repo (forbidden — outside scope)
- Do NOT modify acmd CLAUDE.md F4 wording (acmd Lead's job after this merges)
- Do NOT move best-practice.md to a different folder (Lead noted that consideration but it's a separate task)
- Do NOT modify other sections of best-practice.md (no cleanup, no renumbering of later sections unless verified necessary)
- Do NOT post comments to acmd or skill-team repos
- Do NOT touch `_board.md` (Lead handles)

## Reporting

Write `_workspace/T-101-best-practice-p4-mode-toggle/output.md` with same schema as T-099/T-100: status, branch/commit/MR_URL, ACs (1-10) all `result: true` with file:line evidence, self_review, secret_handling, placeholders_remaining, files_changed, notes.

## Inject reminders

- **Single repo only** — do NOT cross repos. This task is post-T-100 cleanup of cross-repo violation; obey the lesson.
- Conventional commit (`docs(best-practice):`)
- 9-pattern scan before push
- No `--no-verify`
- Self-review mandatory
