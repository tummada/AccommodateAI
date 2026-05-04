# Accessibility Patterns — VOLLOS AccommodateAI

> Referenced from SKILL.md. Contains ARIA patterns, focus management, and testing requirements.

## ARIA Patterns สำหรับ Accommodation Dashboard Components (บังคับ)

### 1. Case Detail Dialog

```html
<div
  role="dialog"
  aria-labelledby="case-detail-title"
  aria-describedby="case-detail-description"
  aria-modal="true"
>
  <h2 id="case-detail-title">Case #{case_id} — {employee_name}</h2>
  <p id="case-detail-description">
    {accommodation_type} — Status: {status}
  </p>
  <!-- Case detail content -->
  <button aria-label="Close case detail dialog">X</button>
</div>
```

**กฎ:**
- `role="dialog"` + `aria-modal="true"` บังคับ
- `aria-labelledby` ชี้ไปที่ heading ของ case (case ID + employee name)
- `aria-describedby` ชี้ไปที่ summary (accommodation type + status)
- ปุ่มปิดต้องมี `aria-label`

### 2. Accommodation Status Dropdown

```html
<div role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-label="Change case status">
  <button aria-controls="status-listbox">
    <span>{current_status_icon}</span>
    <span>{current_status_label}</span>
  </button>
  <ul id="status-listbox" role="listbox" aria-label="Available statuses">
    <li role="option" aria-selected="true">{status_1}</li>
    <li role="option" aria-selected="false">{status_2}</li>
  </ul>
</div>
```

**กฎ:**
- ใช้ `role="combobox"` wrapper + `role="listbox"` dropdown
- `aria-expanded` toggle ตามสถานะเปิด/ปิด
- `aria-selected="true"` บน option ปัจจุบัน
- Arrow keys navigate options, Enter selects, Esc closes
- แต่ละ option ต้องมี icon + text (ห้ามพึ่งสีอย่างเดียว)

### 3. Timeline / Audit Trail

```html
<section aria-label="Case audit trail">
  <ol role="list">
    <li>
      <time datetime="2026-03-15T09:30:00-05:00">Mar 15, 2026 9:30 AM ET</time>
      <span class="sr-only">Action by</span>
      <span>{actor_name} ({actor_role})</span>
      <span class="sr-only">Action:</span>
      <span>{action_description}</span>
    </li>
  </ol>
</section>
```

**กฎ:**
- ใช้ `<ol role="list">` (chronological ordered list)
- `aria-label="Case audit trail"` บน container `<section>`
- ทุก entry ต้องมี: `<time datetime>` (machine-readable) + actor name + role + action description
- ห้ามพึ่งสีอย่างเดียวบอกประเภท action — ต้องมี text description
- Keyboard: Tab เข้า list, Arrow keys navigate entries (ถ้า entries expandable)
- Status change events ต้องระบุ: **ใคร** (actor) + **เมื่อไร** (timestamp) + **ทำอะไร** (action) ในรูปแบบ text ไม่ใช่สีอย่างเดียว

## Focus Management Lifecycle สำหรับ Modals (บังคับ)

ทุก modal/dialog ใน accommodation case workflow ต้องปฏิบัติตาม lifecycle 3 ขั้นตอน:

### ขั้นตอนที่ 1: Focus เข้า Dialog เมื่อเปิด
- เมื่อ dialog เปิด focus ย้ายไปที่ element แรกที่ interactive ภายใน dialog
- สำหรับ danger-confirm dialog: focus ไปที่ปุ่ม Cancel (ไม่ใช่ Confirm — ป้องกัน accidental action)
- สำหรับ form dialog: focus ไปที่ input field แรก
- สำหรับ info dialog: focus ไปที่ปุ่ม Close

### ขั้นตอนที่ 2: Focus Trap ภายใน Dialog
- Tab / Shift+Tab วนอยู่ภายใน dialog เท่านั้น — ห้ามหลุดไป background
- Background content ต้องมี `aria-hidden="true"` + `inert` attribute
- Tab จาก element สุดท้าย กลับไป element แรก (circular)

### ขั้นตอนที่ 3: Focus คืนเมื่อปิด
- เมื่อ dialog ปิด (ไม่ว่าจะ Confirm, Cancel, หรือ Esc) focus กลับไปที่ **element ที่ trigger dialog**
- ถ้า trigger element ถูกลบ (เช่น ลบ row หลัง confirm) focus ไปที่ element ถัดไปในลำดับ DOM
- ห้ามปล่อยให้ focus หายหรือไปที่ `<body>`

### ตัวอย่าง: Deny Accommodation Flow
```
1. HR Manager กด "Deny" button ใน case row     -> จำ trigger element
2. ConfirmationDialog เปิด                       -> focus ไปที่ Cancel button
3. Tab cycles: Cancel -> Reason textarea -> Deny Request button -> Cancel (วน)
4. HR กด "Deny Request"                          -> dialog ปิด
5. Focus กลับไปที่ "Deny" button (หรือ row ถัดไปถ้า row ถูกลบ)
```

## Manual Accessibility Testing Requirements (บังคับ)

**Automated tools (axe-core, Lighthouse) ตรวจพบแค่ ~40% ของ WCAG 2.2 issues** — ส่วนที่เหลือต้องทดสอบ manual

### Manual Testing Checklist สำหรับ AccommodateAI

| Test Area | วิธีทดสอบ | ตรวจอะไร |
|---|---|---|
| Focus visibility บน sticky headers | Tab ผ่าน elements ขณะ scroll — ตรวจว่า focus ring ไม่ถูก sticky dashboard header/sidebar บัง | WCAG 2.4.11 Focus Not Obscured |
| Redundant entry ใน multi-step accommodation intake form | กรอก intake form ครบทุก step — ตรวจว่า employee name, case ID, department ไม่ถูกถามซ้ำในขั้นตอนถัดไป | WCAG 3.3.7 Redundant Entry |
| Keyboard path ผ่าน case approval workflow | ใช้ keyboard อย่างเดียว: เปิด case list -> เลือก case -> เปิด detail -> กด Approve/Deny -> ยืนยัน -> กลับไป list | ครบทุก action ไม่ติดจุดไหน |
| Color-independent status comprehension | เปิด grayscale mode -> อ่าน case list -> ตรวจว่าทุก status เข้าใจได้โดยไม่ต้องเห็นสี | WCAG 1.4.1 Use of Color |
| Screen reader announcement | เปิด NVDA/VoiceOver -> navigate case detail -> ตรวจว่า status, deadline, actions ถูกอ่านครบ | Semantic HTML + ARIA correctness |
| Touch target sizing | วัด touch target ของ Approve/Deny buttons บน mobile -> ต้อง >= 24x24 CSS px | WCAG 2.5.8 Target Size |

**กฎ:**
- ทุก design spec ต้องระบุ manual testing items ที่เกี่ยวข้องกับ component นั้นๆ ใน a11y notes
- ห้ามบอกว่า "ผ่าน automated test แล้ว" โดยไม่ทำ manual test — automated test เป็นแค่ขั้นต่ำ
- QA review ต้องตรวจว่า manual testing items ถูก cover ด้วย