# Lead Workflow Tier System — Multi-Agent Best Practices for VOLLOS Teams

**Author:** Lead@vollos-core
**Date:** 2026-04-29
**Audience:** All VOLLOS product team Leads (acmd, bnfg, hazship, …)
**Inspired by:** `vollos-upgrade` skill (pipeline001 / pipeline001-expand / pipeline003)
**Status:** v1 — adopted as VOLLOS Lead orchestration standard

---

## 1. Why this exists

Single-agent workflows (spawn one Agent → output → spot-check → done) are fast but catch bugs **after** code is applied. For high-stakes work (security, auth, production deploys), this means:

- Bugs surface in production rather than during review
- One agent's blind spots become silent production incidents
- Verification chain (QA + Auditor) inherits whatever assumptions the original agent made

The `vollos-upgrade` skill demonstrated a multi-agent peer-review pattern that catches bugs **before** apply, with empirical results (idea001 fix12–21):

- 21/21 review rounds caught at least one bug — never zero findings
- 0 duplicate bugs between two reviewers when each focused on a distinct domain
- ~10% reviewer false-positive rate caught by Trust-No-One verification

This document codifies that pattern as a tier system any VOLLOS Lead can adopt.

---

## 7. Adoption checklist for a new Lead

To adopt this tier system:

- [ ] Read this document end-to-end
- [ ] Read `vollos-upgrade` skill at `~/.claude/skills/vollos-upgrade/SKILL.md`
- [ ] Read at least `pipeline001.md` reference in detail (skim 001-expand and 003)
- [ ] Update your team's `CLAUDE.md` to reference this tier system
- [ ] Run the next eligible T2 task through pipeline001 to internalize the flow
- [ ] Save a memory rule that triggers tier-routing on every incoming task
- [ ] Confirm with owner that cost increase is acceptable (T2 ~3× T1, T3 ~6× T1)

---

## 8. Open questions / future work

- **T2/T3 partial-success path** — currently if Runner fails, user must choose retry/skip/abort. Could add automatic minimal-rollback-and-loop.
- **Reviewer specialization beyond 2 axes** — Logic+Security and Infra+UX cover most cases but may miss Performance, Accessibility, Compliance, etc. Worth measuring whether 3rd reviewer adds coverage or just noise.
- **Cross-team handshakes inside pipeline003** — when sub-task crosses repo boundary (e.g., vollos-core CORS change for acmd subdomain), need a documented handshake protocol.
- **Reviewer model rotation** — currently both reviewers are Sonnet; experiment with Sonnet+Haiku or Opus+Sonnet for reviewer diversity.

---

## 9. Credit

This pattern was extracted from the `vollos-upgrade` skill (originally `idea001`/`idea002`/`idea003` series, 2026-04-22) by Lead@vollos-core during the ACMD-01 CORS allowlist update on 2026-04-29. The original `vollos-upgrade` skill remains the source of truth for pipeline mechanics; this document is the team-adoption guide.

If you find a better pattern or measurable improvement, please update this file and notify all VOLLOS Leads.
