---
task_id: T-099
title: Adopt file-based revision pattern (Option B — tier-based) — formal review + CLAUDE.md policy block
spawn_started_at: 2026-04-29T19:45:23+07:00
agent_role: devops
priority: medium
decision_mode: detailed
decision_ref: D16
---

# Task T-099 — Adopt File-Based Revision Pattern (Option B / Tier-Based)

## Background

Owner (Pon) requested vollos-core Lead to formally review the DRAFT doc:
**Source:** `/home/ipon/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern.md`
**Drafted by:** mentor3 coach 2026-04-29 (DRAFT status — awaiting vollos-core Lead + acmd Lead review before official adoption)

Lead reviewed in session #010. Owner picked **Option B (tier-based)** — adopt the pattern only for high-risk tasks. Logged as **D16** in `_board.md`.

This task has 2 deliverables across 2 repos:

### Deliverable 1 — Write formal review file (vollos-skill-team repo)

**Repo:** `/home/ipon/workspace/vollos-ai/vollos-skill-team`
**Branch:** `docs/vollos-core-review-multi-iter-pattern`
**File to create:** `multi-iter-revision-pattern-REVIEW-vollos-core.md` (sibling to the DRAFT doc)

**Content (use exactly this — do not paraphrase):**

```markdown
# Review — multi-iter-revision-pattern.md (vollos-core Lead)

**Reviewer:** vollos-core Lead (AI Tech Lead orchestrator, vollos-skill-team)
**Date:** 2026-04-29
**Source doc:** `multi-iter-revision-pattern.md` (DRAFT, drafted by mentor3 coach)
**Verdict:** ✅ ACCEPTED — CONDITIONAL (Tier-Based Adoption / Option B)

---

## Summary

The pattern correctly identifies a real cross-session limitation in Claude Code's SendMessage: agent context expires on session restart / agent timeout / Claude Code crash, breaking multi-round revision pipelines that span sessions. The proposed file-based stateful pattern (state lives in `_workspace/T-NNN/` files instead of agent memory) is sound and aligns with vollos-upgrade pipeline001's existing file-based handoff (`fix.md` / `review-A.md` / `review-B.md` / `review-log.md`).

## Strengths

1. **Solves a real pain point** — verified in session #010 SendMessage live test: sub-agents cannot reply via SendMessage from their environment, so file-based handoff is the only reliable cross-session channel.
2. **Audit trail via `revision-history.md`** — aligns with vollos-core D14 (commit `_board.md` on every modify) and D15 (pipeline001 tier system) decisions.
3. **Fresh writer per round** — defends against the "agent stuck in wrong assumption" anti-pattern observed in ACMD-01 pipeline001 trial.
4. **3-round limit + escape hatch** — matches vollos-lead Iteration Cap discipline (cap retries, escalate to owner).

## Conditions for Adoption (Option B / Tier-Based)

vollos-core will adopt this pattern **only for high-risk tasks** to avoid blanket 3-5x token cost on routine work. Trigger criteria:

**MUST use file-based pattern when task touches any of:**
- auth / JWT / session / token verification
- deploy to production (MODE 3 — VPS, Caddy, secrets rotation)
- CCPA / PDPA — delete request, opt-out, audit log, privacy policy
- payment / billing / subscription
- encryption / secrets management / key rotation

**OR when:**
- Lead estimates > 1 revision round likely (e.g., complex multi-file refactor, security review with multiple findings expected)

**Default for other tasks** (UI, internal tooling, docs, single-file refactor, routine bug fix): pipeline001 in-session SendMessage (existing behavior).

## Reconciliation Notes (must address before official cross-team adoption)

1. **File naming overlap with pipeline001:** pipeline001 uses `fix.md` / `review-A.md` / `review-B.md` / `review-log.md`. This doc uses `output.md` / `review-auditor.md` / `review-qa.md` / `revision-feedback.md` / `revision-history.md`. Recommend pipeline001 ref doc adds a section explaining when to use which naming (e.g., pipeline001-file-mode for cross-session, pipeline001-message-mode for in-session).
2. **Iteration cap mismatch:** This doc says max 3 rounds. vollos-lead SKILL.md Iteration Cap says 8 retries. Recommend reconciling — file-based is more expensive so 3-round cap is reasonable, but vollos-lead doc should explicitly link to this 3-round override when file-based mode active.
3. **Template files (§9):** `_workspace/_templates/` not currently scaffolded in vollos-core or acmd. Optional improvement, not blocking.

## vollos-core Adoption Plan

1. **CLAUDE.md update** — add new section "File-Based Revision Pattern (Tier-Based Trigger — D16)" with the trigger criteria above (this task's deliverable 2).
2. **No retroactive migration** — existing tasks (T-001..T-098, ACMD-01) keep their current pattern. Apply file-based starting from T-099+.
3. **Owner re-review** — after first 3 file-based runs, Lead reports cost actuals + reliability + propose tweaks if needed.

## Out of Scope (this review)

- acmd Lead review — separate review file, separate adoption decision per repo policy.
- mentor3 SKILL.md cross-references (§11) — owned by mentor3 coach, not Lead's call.
- Forcing Function template files (§9) — optional, defer to later.

---

**Status after this review:** DRAFT → ACCEPTED-CONDITIONAL (vollos-core only)
**Pending:** acmd Lead independent review for acmd repo adoption.
```

### Deliverable 2 — CLAUDE.md policy block (vollos-core repo)

**Repo:** `/home/ipon/workspace/vollos-ai/vollos-core`
**Branch:** `feat/file-based-revision-tier-b`
**File:** `CLAUDE.md`
**Action:** Add new top-level section RIGHT BEFORE the `## Best Practices` section (preserve all existing content).

**Content to add (copy verbatim):**

```markdown
## File-Based Revision Pattern (Tier-Based — D16)

**Decision ref:** `_board.md` Decisions Log D16 (2026-04-29 owner approved)
**Source doc:** `~/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern.md`
**Review:** `~/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern-REVIEW-vollos-core.md`

### Trigger criteria (when Lead MUST use file-based pattern)

Use file-based revision pattern (state in `_workspace/T-NNN/` files, fresh writer per round) when task touches ANY of:

1. **auth / session / token** — JWT verify, login flow, session management, refresh token, password reset
2. **deploy production** — MODE 3 work touching VPS, Caddy config, production secrets rotation
3. **CCPA / PDPA** — delete request endpoint, opt-out flow, audit log code, privacy policy text in production
4. **payment / billing** — subscription, charge, refund, invoice
5. **encryption / secrets** — key rotation, secrets management code, GitLab CI/CD variable distribution

**OR** when Lead estimates > 1 revision round likely (Lead judgment call — e.g., multi-file refactor with cross-cutting concerns, security review with multiple findings expected).

### Default for other tasks (UI, internal tooling, docs, single-file fix)

Use pipeline001 in-session SendMessage (existing behavior — see `~/.claude/skills/vollos-upgrade/references/pipeline001.md`).

### File structure (when file-based mode active)

```
_workspace/T-NNN/
├── task.md                  # Lead — immutable spec
├── domain-brief.md          # optional — Lead inject domain context
├── output.md                # Writer — current best output (overwrite per round)
├── review-auditor.md        # Reviewer-A — overwrite per round
├── review-qa.md             # Reviewer-B — overwrite per round
├── revision-feedback.md     # Lead — consolidated findings for next writer
└── revision-history.md      # APPEND-ONLY — log of every round + verdict
```

### Iteration cap

**Max 3 rounds in file-based mode** (overrides vollos-lead 8-retry cap which applies to single-spawn tasks). If round 3 still fails → Lead MUST escalate owner with 3 options:
1. Rollback (discard, revert to pre-task state)
2. Descope (split unfinished findings into new task, accept current output)
3. Continue (owner override — log as `bypass_approved` in Decisions Log)

### Audit trail enforcement

`revision-history.md` is append-only and committed to git as part of `_workspace/` audit trail (per existing `_workspace/` Git Policy in CLAUDE.md). Reviewers see full revision history before verdict.
```

## Acceptance Criteria

- [ ] AC1: vollos-skill-team repo — new branch `docs/vollos-core-review-multi-iter-pattern` created from main
- [ ] AC2: vollos-skill-team repo — file `multi-iter-revision-pattern-REVIEW-vollos-core.md` created with content from "Deliverable 1" verbatim (no paraphrasing)
- [ ] AC3: vollos-skill-team repo — committed with conventional commit message (e.g., `docs: vollos-core Lead formal review of multi-iter-revision-pattern (D16 / Option B)`)
- [ ] AC4: vollos-skill-team repo — branch pushed + MR opened against main; MR URL captured
- [ ] AC5: vollos-core repo — new branch `feat/file-based-revision-tier-b` created from main
- [ ] AC6: vollos-core repo — CLAUDE.md updated with new "## File-Based Revision Pattern (Tier-Based — D16)" section inserted **immediately before** the existing `## Best Practices` section. All existing content preserved (verify via `git diff` only addition is new section).
- [ ] AC7: vollos-core repo — committed with conventional commit message (e.g., `feat: add file-based revision pattern policy (D16 / tier-based / option B)`)
- [ ] AC8: vollos-core repo — branch pushed + MR opened against main; MR URL captured
- [ ] AC9: No secret leak — run 9-pattern secret scan on both branches before push (per CLAUDE.md "_workspace/ Git Policy"). Report `secret_handling: "9-pattern scan run pre-push, 0 matches"` in output.md.
- [ ] AC10: Self-review field included in output.md per CLAUDE.md "Agent Self-Review" rule (each AC has `result: true/false` + `evidence: file:line — description`).

## Owned Files

- `/home/ipon/workspace/vollos-ai/vollos-skill-team/multi-iter-revision-pattern-REVIEW-vollos-core.md` (CREATE)
- `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` (EDIT — add 1 new section, no other changes)

## Out of Scope

- Do NOT update `~/.claude/skills/vollos-lead/SKILL.md` — that is a separate cross-team change requiring vollos-skill-team team review.
- Do NOT create `_workspace/_templates/` files — optional per review §3, defer.
- Do NOT update mentor3 doc cross-references — owned by mentor3 coach.
- Do NOT modify the original DRAFT `multi-iter-revision-pattern.md` — only write a sibling review file.

## Dependencies

None. Both branches can be created in parallel from current main.

## Reporting

After both MRs are open:
- Write `output.md` in this folder with: branches created, files changed, MR URLs (both), commit SHAs (both), 9-pattern secret scan result, self_review field.
- Return brief summary to Lead.

## Inject reminders (verbatim from CLAUDE.md)

- **9-pattern secret scan** mandatory before any `_workspace/` push (this task does not touch `_workspace/` content but DevOps must still scan branches before push as standard hygiene).
- **Conventional commits** mandatory (`docs:` for review file, `feat:` for CLAUDE.md addition).
- **No skip hooks** (`--no-verify` forbidden unless owner explicitly approves).
- **Self-review** mandatory in output.md.
