# Worked Examples

### Example 1: consult mode — "Can employer deny telework?"

**Input (from task.md):**
```
mode: consult
question: "Employee with anxiety disorder requests full-time telework. Employer wants to deny. Is this defensible?"
jurisdiction: federal + California
```

**Expected output structure:**
```yaml
analysis: |
  Federal ADA: Telework is a form of reasonable accommodation per EEOC guidance
  (Feb 2026 joint FAQ). Employer must consider before denying.
  Employer may offer alternative (e.g., hybrid schedule) if equally effective
  at removing the barrier — employer chooses among effective options (42 USC 12112).
  Denial requires documented undue hardship under all 4 factors of 42 USC 12112(b)(5)(A).

  California FEHA: Broader standard — Gov. Code 12940 requires good faith
  interactive process. CA courts apply stricter scrutiny to telework denials.
  State standard governs because it provides greater protection.

recommendation: |
  1. Engage interactive process — document all options considered
  2. If denying telework, document undue hardship with concrete evidence
     (not speculative) addressing all 4 statutory factors
  3. Offer alternative accommodation that is effective
  4. Apply California FEHA standard (stricter than federal)

citations:
  - "42 USC 12112(b)(5)(A) — undue hardship factors"
  - "EEOC/OPM Joint FAQ Feb 2026 — telework as reasonable accommodation"
  - "Cal. Gov. Code 12940 — FEHA interactive process"

disclaimer: "AI-generated legal guidance. Review by licensed employment attorney required."
```

### Example 2: write-rules mode — PWFA per se accommodations

**Input (from task.md):**
```
mode: write-rules
task: "Create PWFA per se reasonable accommodation rules for rules engine"
```

**Expected output (JSON):**
```json
{
  "rule_set": "pwfa_per_se_accommodations",
  "statute": "42 USC 2000gg; 29 CFR 1636",
  "description": "Accommodations presumptively reasonable under PWFA — grant without interactive process",
  "rules": [
    {
      "id": "PWFA-PS-001",
      "accommodation": "Carrying water or keeping water nearby",
      "auto_approve": true,
      "documentation_required": false,
      "interactive_process_required": false
    },
    {
      "id": "PWFA-PS-002",
      "accommodation": "Additional restroom breaks",
      "auto_approve": true,
      "documentation_required": false,
      "interactive_process_required": false
    },
    {
      "id": "PWFA-PS-003",
      "accommodation": "Sitting when job requires standing or standing when job requires sitting",
      "auto_approve": true,
      "documentation_required": false,
      "interactive_process_required": false
    },
    {
      "id": "PWFA-PS-004",
      "accommodation": "Breaks to eat and drink",
      "auto_approve": true,
      "documentation_required": false,
      "interactive_process_required": false
    }
  ]
}
```
