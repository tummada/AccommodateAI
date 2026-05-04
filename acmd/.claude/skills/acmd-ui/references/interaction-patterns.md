# Interaction Patterns — VOLLOS AccommodateAI

> Referenced from SKILL.md. Contains interaction rules for accommodation case UI.

## Action Button Visibility in Data Tables (บังคับ)

**ห้ามใช้ hide-on-hover anti-pattern** สำหรับ accommodation case action buttons (Approve / Deny / Request Info) ใน DataTable:

| Pattern | สถานะ | เหตุผล |
|---|---|---|
| ปุ่มแสดงเมื่อ hover เท่านั้น | ❌ ห้ามเด็ดขาด | Keyboard users / touch devices ไม่สามารถ hover ได้, ทำให้ปุ่มไม่ accessible |
| ปุ่มแสดงตลอดในทุกแถว | ✅ แนะนำ (desktop) | มองเห็นได้ทันที ไม่ต้องเดา |
| Action menu (kebab) ที่ trigger ด้วย click/Enter/Space | ✅ ยอมรับได้ | ใช้เมื่อพื้นที่จำกัด (mobile/tablet) — ต้อง keyboard-accessible |

**กฎเฉพาะ:**
- Desktop (>=1024px): Approve/Deny/Request Info buttons ต้องแสดงเป็น inline buttons ในทุกแถว หรือเป็น action column ที่มองเห็นตลอด
- Mobile/Tablet (<1024px): ใช้ kebab menu ได้ แต่ต้อง:
  - เปิดด้วย Enter/Space (ไม่ใช่แค่ click)
  - `role="menu"` + `aria-label="Case actions"`
  - Focus trap ภายใน menu เมื่อเปิด
  - Esc ปิด menu + คืน focus ไปที่ trigger
- ห้ามใช้ CSS `:hover` เป็นเงื่อนไขเดียวในการแสดง action buttons
- ห้ามใช้ `opacity: 0` → `opacity: 1` on hover สำหรับ action buttons

## Confirmation UI สำหรับ Irreversible HR Compliance Actions (บังคับ)

Actions ต่อไปนี้เป็น irreversible — ต้องมี confirmation dialog ที่มีข้อความอธิบายผลกระทบชัดเจน:

### Actions ที่ต้องมี Confirmation Dialog

| Action | ระดับความร้ายแรง |
|---|---|
| Deny accommodation request | Critical |
| Close case | High |
| Terminate ongoing accommodation | Critical |

### Confirmation Dialog Spec

```
Component: ConfirmationDialog (extends Dialog/danger-confirm variant)
Structure:
  +------------------------------------------+
  | [WarningTriangle icon in --destructive]  |
  |                                          |
  | Title: "{Action Name}"                   |
  | (e.g., "Deny Accommodation Request")     |
  |                                          |
  | Consequence text (plain language):       |
  | "This will permanently deny [Employee    |
  |  Name]'s accommodation request for       |
  |  [Accommodation Type]. The employee will |
  |  be notified and this action will be     |
  |  recorded in the compliance audit trail. |
  |  This cannot be undone."                 |
  |                                          |
  | [Optional: Reason/notes textarea]        |
  |                                          |
  | [Cancel (secondary)]  [Confirm (danger)] |
  +------------------------------------------+
```

**กฎ Confirmation Dialog:**
- Title: ระบุ action ชัดเจน — ห้ามใช้ generic "Are you sure?"
- Consequence text: อธิบาย **ผลกระทบเฉพาะเจาะจง** ต่อ case/employee นั้นๆ — ใช้ชื่อจริงและรายละเอียด case
- ปุ่ม Confirm: ใช้ `--destructive` / `--destructive-foreground` tokens, label ตรงกับ action (เช่น "Deny Request" ไม่ใช่ "OK")
- ปุ่ม Cancel: ใช้ `--secondary` / `--secondary-foreground`, อยู่ทางซ้ายของ Confirm
- ต้องมี `role="alertdialog"` + `aria-labelledby` (title) + `aria-describedby` (consequence text)
- Focus ไปที่ Cancel button เมื่อ dialog เปิด (ป้องกัน accidental confirm)
- Esc ปิด dialog = Cancel
- สำหรับ Critical actions (Deny, Terminate): ต้องพิมพ์ยืนยัน (เช่น พิมพ์ "DENY") ก่อนปุ่ม Confirm จะ enable

### Consequence Text Templates

| Action | Template |
|---|---|
| Deny accommodation | "This will permanently deny {employee_name}'s accommodation request for {accommodation_type}. The employee will be notified and may file a complaint with the EEOC. This action will be recorded in the compliance audit trail and cannot be undone." |
| Close case | "This will close case #{case_id} for {employee_name}. No further actions can be taken on this case. The complete case history will be preserved in the audit trail." |
| Terminate accommodation | "This will terminate the ongoing {accommodation_type} for {employee_name}, effective immediately. The employee will be notified and this may trigger legal review obligations. This action will be recorded in the compliance audit trail and cannot be undone." |