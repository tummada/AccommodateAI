---
task_id: T-101
status: completed
completed_at: 2026-04-29T20:58:06+07:00
agent_role: devops
---

# T-101 — best-practice.md § 2.5 P4 Mode Toggle — Output

## Deliverables

```yaml
deliverables:
  vollos_core:
    branch: feat/best-practice-p4-mode-toggle
    base: origin/main
    file_modified: _workspace/ACMD-01-cors-allowlist-update/best-practice.md
    commit_sha: 092001c9a927afb67b0eee492793016645062bd3
    commit_message: "docs(best-practice): add § 2.5 P4 mode toggle (in-session vs file-based)"
    mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/37
    mr_target: main
    diff_summary: "+40 lines, -0 lines (single section insert after § 2.4)"
```

## Secret Handling

```yaml
secret_handling: "9-pattern scan run pre-push, 0 matches"
```

Pre-push 9-pattern scan results on `_workspace/ACMD-01-cors-allowlist-update/best-practice.md`:

| # | Pattern | Result |
|---|---------|--------|
| 1 | `glpat-[0-9a-zA-Z_-]{20,}` (GitLab PAT) | 0 matches |
| 2 | `ghp_[0-9a-zA-Z]{36}` (GitHub token) | 0 matches |
| 3 | `AKIA[0-9A-Z]{16}` (AWS access key) | 0 matches |
| 4 | `-----BEGIN ... KEY-----` (private key) | 0 matches (exit=1) |
| 5 | `NODEMAILER_OAUTH2_REFRESH_TOKEN=1//` | 0 matches |
| 6 | `TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}` | 0 matches |
| 7 | `CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}` | 0 matches |
| 8 | `\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}` (bcrypt) | 0 matches |
| 9 | `password\s*[=:]\s*['\"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}` | 0 matches |

## Acceptance Criteria

```yaml
acceptance_criteria:
  AC1:
    description: "Branch feat/best-practice-p4-mode-toggle cut from origin/main"
    result: true
    evidence: "git checkout -b feat/best-practice-p4-mode-toggle origin/main → 'Switched to a new branch'; branch tracks origin/main per `git branch --show-current` and 'set up to track origin/main' message"
  AC2:
    description: "best-practice.md modified — § 2.5 inserted immediately AFTER § 2.4"
    result: true
    evidence: "best-practice.md:80 § 2.4 'Lead = Postman'; best-practice.md:90 § 2.5 'P4 Mode Toggle (in-session vs file-based)' — grep -n '^### 2\\.' shows 2.1→2.2→2.3→2.4→2.5 in order"
  AC3:
    description: "§ 2.4 'Lead = Postman' content preserved unchanged"
    result: true
    evidence: "git diff shows zero deletion lines; § 2.4 lines best-practice.md:80-88 are byte-identical to origin/main version (insertion lands at line 89, between § 2.4's last paragraph at line 88 and the section-2 closing '---' at line 130)"
  AC4:
    description: "Inserted content matches task.md verbatim block (every heading/table row/bullet preserved)"
    result: true
    evidence: "best-practice.md:90-128 contains all 8 ALLOWED+FORBIDDEN bullets, 4 self-check table rows, 5 bold-headed paragraphs (In-session, File-based, ALLOWED, FORBIDDEN, Self-check, Why both modes exist, Cross-team note); copy-pasted verbatim from task.md:35-74"
  AC5:
    description: "No content from § 2.5 onwards deleted or reordered — insertion only"
    result: true
    evidence: "git diff --stat: '1 file changed, 40 insertions(+)' — no '-' (deletion) lines; § 3 'Five-Tier Decision Matrix' previously at line 92, now at line 132 (shifted by +40 lines, content unchanged)"
  AC6:
    description: "Conventional commit prefix docs(best-practice):"
    result: true
    evidence: "git log -1 --oneline: '092001c docs(best-practice): add § 2.5 P4 mode toggle (in-session vs file-based)'"
  AC7:
    description: "9-pattern secret scan — 0 new matches on modified file"
    result: true
    evidence: "all 9 patterns returned 0 matches on _workspace/ACMD-01-cors-allowlist-update/best-practice.md (table above)"
  AC8:
    description: "Branch pushed + MR opened against main; MR URL captured"
    result: true
    evidence: "git push: '* [new branch] feat/best-practice-p4-mode-toggle → feat/best-practice-p4-mode-toggle'; glab mr create returned URL https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/37 (target=main)"
  AC9:
    description: "Self-review field with all results true and file:line evidence"
    result: true
    evidence: "see self_review block below — every field has result: true with file:line or git command quoted output"
  AC10:
    description: "Strict scope — git diff --name-only HEAD~1..HEAD shows ONLY the target file"
    result: true
    evidence: "git diff --name-only HEAD~1..HEAD output: '_workspace/ACMD-01-cors-allowlist-update/best-practice.md' (single line, no other files)"
```

## Self Review

```yaml
self_review:
  scope_strict:
    result: true
    evidence: "git diff --name-only HEAD~1..HEAD → exactly 1 line: '_workspace/ACMD-01-cors-allowlist-update/best-practice.md'; no acmd, no skill-team, no other vollos-core files touched"
  insertion_only:
    result: true
    evidence: "git diff --stat → '1 file changed, 40 insertions(+)'; no deletions reported; full git diff inspection: every changed line is a '+' line, zero '-' lines"
  verbatim_content:
    result: true
    evidence: "best-practice.md:90-128 matches task.md:35-74 character-for-character including em-dashes, code-fences (`review-A.md`, `revision-feedback.md`, `_workspace/`), table pipes, bold markers (**ALLOWED in file-based bundling:**, **FORBIDDEN (no exceptions, applies in BOTH modes):**), and ±5% / ~1-3K / ~3-5x figures"
  conventional_commit:
    result: true
    evidence: "git log -1 → 'docs(best-practice): add § 2.5 P4 mode toggle (in-session vs file-based)' — exact prefix 'docs(best-practice):' as required by task.md AC6"
  no_secret_leak:
    result: true
    evidence: "9-pattern grep on modified file: 0 matches across all 9 patterns (table in Secret Handling section above); inserted content contains no env-var values, no credentials, no tokens — only documentation prose, table headings, and bullet points"
  insertion_after_2_4:
    result: true
    evidence: "grep -n '^### 2\\.' best-practice.md → '33:### 2.1', '44:### 2.2', '69:### 2.3', '80:### 2.4', '90:### 2.5' — § 2.5 at line 90 follows § 2.4 at line 80 with the original § 2.4 body (lines 80-88) intact in between"
```

## Files Changed

```yaml
files_changed:
  - path: _workspace/ACMD-01-cors-allowlist-update/best-practice.md
    action: modified
    diff_stat: "+40 lines, -0 lines"
    insertion_anchor: "after best-practice.md:88 (last paragraph of § 2.4 'Why: The orchestrator does not have the deep context...')"
    insertion_lines: "best-practice.md:89-129 (39 content lines + 1 blank line)"
    existing_read: "best-practice.md:80-92 (§ 2.4 + section-2 separator + § 3 header) read before edit to confirm insertion point"
```

## Skill Loaded Evidence

```yaml
skill_loaded_evidence:
  files_read:
    - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:38 — '🔴 SECRET HANDLING (non-negotiable — read FIRST)'"
    - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:67 — 'Before Starting (บังคับทุก task)'"
    - "/home/ipon/.claude/skills/vollos-devops/SKILL.md:464 — 'Critical Rules'"
```

## Re-anchor Evidence

```yaml
re_anchor_evidence:
  - "Critical Rules: read before delivery (SKILL.md:464-471)"
  - "Security Rules: read before delivery (SKILL.md:264-274)"
  - "AI Behavior Rules: read before delivery (SKILL.md:417-426)"
  - "_workspace/ Git Policy + 9-pattern scan: read before push (CLAUDE.md vollos-core)"
  - "Single repo only constraint from task.md L24-25 + Inject reminders L114: confirmed before push"
```

## Placeholders Remaining

```yaml
placeholders_remaining: "none — grep clean (regex 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' on _workspace/ACMD-01-cors-allowlist-update/best-practice.md returned 0 matches, exit=1)"
```

Note: the inserted content does mention "STOP" as part of the self-check forcing function ("If any check fails → STOP → re-bundle from scratch"), but that is documentation prose describing process behavior, not a placeholder/TODO. No `alert()`, no "coming soon", no TODO, no TBD, no mock, no "not implemented", no "Phase N" markers introduced.

## Issues

```yaml
issues: []
```

## Next Action

```yaml
next_action: "Lead/owner review MR #37 and merge. After merge, Lead notifies acmd Lead (cross-team handshake — owner's job per task.md scope) so acmd can optionally replace their CLAUDE.md F4 override with a one-line pointer to best-practice.md § 2.5."
```

## Notes

- **Working-tree state at task start:** previous branch `feat/file-based-revision-tier-b` had `_board.md` modified and several untracked `_workspace/T-09x` and `T-100`/`T-101` directories. These were carried over when checking out the new branch (git keeps uncommitted changes across branch switches when the file states don't conflict). Only the target file was staged via explicit `git add _workspace/ACMD-01-cors-allowlist-update/best-practice.md` — no other files entered the commit, verified by `git diff --name-only HEAD~1..HEAD`.
- **Branch base verified:** `git checkout -b feat/best-practice-p4-mode-toggle origin/main` confirmed via "set up to track 'origin/main'" message and `git status` "Your branch is up to date with 'origin/main'" before edit — base is origin/main, not the previous feature branch.
- **Section-2 closing separator:** the `---` horizontal rule that closes § 2 (originally at line 90 in the pre-edit file) now sits at line 130 after § 2.5, preserving the section structure (§ 2.1 through § 2.5 contained between `## 2. ...` heading and the `---` separator before `## 3.`).
- **Insertion-point anchor used in Edit:** unique 3-line block "**Why:** ...wrote the code." + blank + `---` + blank + `## 3. Five-Tier Decision Matrix` was used as the unique anchor; new content inserted between the "Why" paragraph and the `---` separator, which keeps the `---` as section-2 closer per existing convention (compare § 1 closes with `---` at line 27, § 2 now closes with `---` at line 130).
- **glab CLI:** authenticated session reused (no token echo); MR opened on tummadajingjing/vollos-core targeting main. MR is OPEN, not merged — Lead/owner will merge after review per task.md instruction "Do NOT merge the MR".
- **Cross-repo scope:** confirmed pre-push that no acmd, vollos-skill-team, or other-repo paths appear in `git diff --name-only HEAD~1..HEAD` — single-repo discipline holds.
