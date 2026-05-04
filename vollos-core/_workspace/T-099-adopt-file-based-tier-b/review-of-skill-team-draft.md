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
