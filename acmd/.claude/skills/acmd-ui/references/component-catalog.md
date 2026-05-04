# Component Catalog — VOLLOS AccommodateAI

> Moved from SKILL.md to free space. SKILL.md references this file.

## Core Components (ใช้ซ้ำทั้ง app)

| Component | ใช้เมื่อ | Variants |
|---|---|---|
| Button | Actions ทุกที่ | primary, secondary, danger, ghost, icon-only |
| Badge | Status indicators | danger, warning, success, info, neutral |
| Card | Container สำหรับ content | default, outlined, elevated |
| DataTable | แสดงรายการ cases/employees | sortable, filterable, selectable, paginated |
| Form | Input ทุกประเภท | text, select, textarea, checkbox, radio, date-picker |
| Dialog/Modal | Confirmation, detail view | default, danger-confirm, form-modal |
| Timeline | Activity history, case progress | compact, detailed |
| Sidebar | Navigation หลัก | collapsible, with-badge-counts |
| Command Palette | Quick navigation (Cmd+K) | search, actions, navigation |
| Alert/Banner | System messages, compliance warnings | info, warning, danger, PWFA |
| Stepper | Multi-step flows | horizontal, vertical, clickable |
| Avatar | User/employee photos | image, initials, with-status-dot |
| Tooltip | Contextual help | default, rich (with links) |
| Skeleton | Loading states | text, card, table-row |
| Empty State | No data | illustration + CTA |

## Domain-Specific Blocks (AccommodateAI)

| Block | ใช้เมื่อ | ประกอบด้วย |
|---|---|---|
| CaseCard | แสดง case สรุปใน list | Avatar + status badge + deadline countdown + action menu |
| AccommodationStepper | แสดง 6 ขั้นตอน | Stepper + step descriptions + current position indicator |
| ComplianceAlert | เตือน PWFA/deadline | Banner + icon + action button + dismiss |
| ApprovalChain | แสดง chain อนุมัติ | Avatars in sequence + status per level + current position |
| AIsuggestionCard | แสดง AI recommendation | Card + "AI Suggestion" label + confidence meter + accept/reject |
| MedicalInfoGuard | แสดงข้อมูลแพทย์ | Card with lock icon + access level indicator + view button |
| DeadlineTracker | countdown กำหนด | Progress bar + days remaining + urgency color |
| ActivityTimeline | ประวัติ case | Timeline + user + action + timestamp + detail expand |
| DashboardKPI | สรุป metrics | Number + trend arrow + label + sparkline |
| CaseFilterBar | กรองรายการ case | Status filter + date range + search + assignee |
