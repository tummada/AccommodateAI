# Color System & Semantic Tokens — VOLLOS AccommodateAI

> Moved from SKILL.md to free space. SKILL.md references this file.

## Token Architecture — 3-Layer OKLCH Hierarchy (บังคับ)

ทุก token ต้องผ่าน 3 ชั้น ห้ามข้ามชั้น:

### Layer 1: Primitive Tokens (raw OKLCH values)
ค่าสีดิบ เป็น OKLCH format — ห้ามใช้ตรงใน component
```css
--primitive-red-500: oklch(0.577 0.245 27.33);
--primitive-red-600: oklch(0.505 0.213 27.33);
--primitive-orange-500: oklch(0.646 0.222 41.12);
--primitive-green-500: oklch(0.627 0.194 149.58);
--primitive-blue-500: oklch(0.546 0.245 262.88);
--primitive-gray-500: oklch(0.551 0.014 264.53);
--primitive-gray-50: oklch(0.985 0.002 264.53);
--primitive-gray-900: oklch(0.21 0.006 264.53);
/* ... เพิ่มเฉดอื่นตาม design needs */
```

### Layer 2: Semantic Tokens (light/dark mode mapping)
Map primitive → ความหมาย แยก light/dark
```css
/* Light mode */
:root {
  --color-status-danger: var(--primitive-red-500);
  --color-status-danger-bg: var(--primitive-red-50);
  --color-status-warning: var(--primitive-orange-500);
  --color-status-success: var(--primitive-green-500);
  --color-status-info: var(--primitive-blue-500);
  --color-status-neutral: var(--primitive-gray-500);
  --color-bg-page: var(--primitive-gray-50);
  --color-text-primary: var(--primitive-gray-900);
}
/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --color-status-danger: var(--primitive-red-400);
    --color-bg-page: var(--primitive-gray-900);
    --color-text-primary: var(--primitive-gray-50);
    /* ... */
  }
}
```

### Layer 3: Component Tokens (reference semantic only)
Component ใช้ semantic tokens เท่านั้น — ห้ามอ้าง primitive หรือ raw color
```css
.btn-danger {
  background: var(--color-status-danger);      /* ✅ semantic */
  color: var(--color-text-on-danger);           /* ✅ semantic */
  /* background: var(--primitive-red-500);       ❌ ห้าม */
  /* background: #DC2626;                       ❌ ห้าม */
  /* background: oklch(0.577 0.245 27.33);      ❌ ห้าม */
}
```

**กฎเด็ดขาด:** ห้าม hardcode hex/rgb/oklch ใน component specs — ใช้ semantic token เท่านั้น ถ้า semantic token ยังไม่มี → สร้าง token ใหม่ใน Layer 2 ก่อน แล้วใช้ token นั้น

## Compliance Status Colors (บังคับ — ห้ามเปลี่ยนความหมาย)

| Token | OKLCH (approx) | Hex (reference) | ใช้เมื่อ | ตัวอย่าง |
|---|---|---|---|---|
| `--color-status-danger` | oklch(0.577 0.245 27) | #DC2626 | ปฏิเสธ/ถูกล็อก/หมดเวลา/บังคับ | ปุ่มปฏิเสธถูกล็อก, deadline ผ่านแล้ว |
| `--color-status-warning` | oklch(0.646 0.222 41) | #EA580C | คำเตือน PWFA/ใกล้ deadline | banner "PWFA applies", 3 วันเหลือ |
| `--color-status-success` | oklch(0.627 0.194 150) | #16A34A | อนุมัติ/สำเร็จ/ครบถ้วน | case approved, document submitted |
| `--color-status-info` | oklch(0.546 0.245 263) | #2563EB | อยู่ระหว่างดำเนินการ/ข้อมูล | case in progress, informational badge |
| `--color-status-neutral` | oklch(0.551 0.014 265) | #6B7280 | ยังไม่เริ่ม/ไม่ relevant | draft, pending start |

**กฎ:** ทุกสี status ต้องมี icon ร่วมด้วย — ห้ามพึ่งสีอย่างเดียว (WCAG 1.4.1 Use of Color)

## Brand Colors

| Token | ใช้เมื่อ |
|---|---|
| `--color-brand-primary` | Primary actions, links, active nav |
| `--color-brand-secondary` | Secondary actions, hover states |
| `--color-bg-page` | Page background |
| `--color-bg-card` | Card/panel background |
| `--color-bg-sidebar` | Sidebar background |
| `--color-border-default` | Default borders |
| `--color-text-primary` | Main text |
| `--color-text-secondary` | Supporting text |
| `--color-text-muted` | Disabled/placeholder text |

## shadcn/ui Token Pair Convention (บังคับ)

ทุก semantic surface token ต้องมีคู่ `-foreground` สำหรับ text/icon บนพื้นผิวนั้น — ตาม shadcn/ui convention:

```css
/* Surface + Foreground pairs (บังคับทุกคู่) */
:root {
  /* Brand */
  --primary: var(--primitive-blue-600);
  --primary-foreground: var(--primitive-gray-50);
  --secondary: var(--primitive-gray-100);
  --secondary-foreground: var(--primitive-gray-900);

  /* Surfaces */
  --background: var(--primitive-gray-50);
  --foreground: var(--primitive-gray-900);
  --card: var(--primitive-gray-50);
  --card-foreground: var(--primitive-gray-900);
  --popover: var(--primitive-gray-50);
  --popover-foreground: var(--primitive-gray-900);
  --muted: var(--primitive-gray-100);
  --muted-foreground: var(--primitive-gray-500);
  --accent: var(--primitive-blue-100);
  --accent-foreground: var(--primitive-blue-900);

  /* Status */
  --destructive: var(--primitive-red-500);
  --destructive-foreground: var(--primitive-gray-50);
  --warning: var(--primitive-orange-500);
  --warning-foreground: var(--primitive-gray-50);
  --success: var(--primitive-green-500);
  --success-foreground: var(--primitive-gray-50);
  --info: var(--primitive-blue-500);
  --info-foreground: var(--primitive-gray-50);

  /* UI elements */
  --border: var(--primitive-gray-200);
  --input: var(--primitive-gray-200);
  --ring: var(--primitive-blue-500);
  --sidebar: var(--primitive-gray-50);
  --sidebar-foreground: var(--primitive-gray-900);
}
```

**Required token pairs (ครบทุกคู่):**

| Base Token | Foreground Token | ใช้เมื่อ |
|---|---|---|
| `--primary` | `--primary-foreground` | Primary buttons, active nav |
| `--secondary` | `--secondary-foreground` | Secondary buttons |
| `--background` | `--foreground` | Page-level surface |
| `--card` | `--card-foreground` | Card/panel surfaces |
| `--popover` | `--popover-foreground` | Dropdowns, tooltips |
| `--muted` | `--muted-foreground` | Subdued backgrounds |
| `--accent` | `--accent-foreground` | Highlighted elements |
| `--destructive` | `--destructive-foreground` | Deny/delete/danger actions |
| `--warning` | `--warning-foreground` | PWFA/deadline warnings |
| `--success` | `--success-foreground` | Approved/completed |
| `--info` | `--info-foreground` | In-progress/informational |
| `--sidebar` | `--sidebar-foreground` | Sidebar navigation |

**กฎ:** ห้ามสร้าง surface token โดยไม่มีคู่ `-foreground` — ถ้าเพิ่ม `--X` ต้องเพิ่ม `--X-foreground` ด้วยเสมอ ทุกคู่ต้องผ่าน contrast ratio 4.5:1

## Tailwind v4 @theme Directive (บังคับ)

Tailwind v4 ใช้ CSS-first configuration ผ่าน `@theme` directive — **ห้ามใช้ `tailwind.config.js` extend approach** ซึ่งไม่ทำงานใน Tailwind v4

```css
/* apps/acmd-web/src/styles/theme.css */
@theme {
  /* Primitive tokens — raw OKLCH values */
  --color-primitive-red-500: oklch(0.577 0.245 27.33);
  --color-primitive-orange-500: oklch(0.646 0.222 41.12);
  --color-primitive-green-500: oklch(0.627 0.194 149.58);
  --color-primitive-blue-500: oklch(0.546 0.245 262.88);
  --color-primitive-gray-50: oklch(0.985 0.002 264.53);
  --color-primitive-gray-900: oklch(0.21 0.006 264.53);
  /* ... more primitives as needed */

  /* Semantic tokens — surface + foreground pairs */
  --color-primary: var(--color-primitive-blue-600);
  --color-primary-foreground: var(--color-primitive-gray-50);
  --color-destructive: var(--color-primitive-red-500);
  --color-destructive-foreground: var(--color-primitive-gray-50);
  --color-warning: var(--color-primitive-orange-500);
  --color-warning-foreground: var(--color-primitive-gray-50);
  --color-success: var(--color-primitive-green-500);
  --color-success-foreground: var(--color-primitive-gray-50);
  /* ... all pairs from Token Pair Convention above */

  /* Spacing, radius, font-size */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}
```

**ข้อดี @theme directive:**
- Tokens กลายเป็น native CSS variables **และ** Tailwind utility classes อัตโนมัติ (เช่น `bg-primary`, `text-destructive-foreground`)
- ไม่ต้อง `tailwind.config.js` — ลด build complexity
- IDE autocomplete ทำงานกับ CSS variables ตรงๆ

**กฎ:**
- ห้ามใช้ `tailwind.config.js` extend/theme — ใช้ `@theme` ใน CSS เท่านั้น
- Dark mode tokens ใช้ `@media (prefers-color-scheme: dark)` ภายนอก `@theme` block ปกติ
- Component specs ต้องอ้าง utility classes ที่ generate จาก `@theme` (เช่น `bg-destructive text-destructive-foreground`)

## Dark Mode
- ทุก token ต้องมี dark variant — ใช้ `prefers-color-scheme` + manual toggle
- ห้ามใช้สีตรงๆ ใน component — ใช้ semantic token เสมอ
- Dark mode map อยู่ใน Layer 2 (Semantic Tokens) — ห้ามสร้างแยก
