# Responsive Strategy — VOLLOS AccommodateAI

> Moved from SKILL.md to free space. SKILL.md references this file.

## Breakpoints
| Name | Width | Target |
|---|---|---|
| `sm` | ≥640px | Mobile landscape |
| `md` | ≥768px | Tablet |
| `lg` | ≥1024px | Desktop |
| `xl` | ≥1280px | Wide desktop |

## Layout Rules
- **Mobile (< 768px):** Sidebar → bottom nav or hamburger, DataTable → card list, 1 column layout
- **Tablet (768-1023px):** Collapsible sidebar, 2 column layout, DataTable with horizontal scroll
- **Desktop (≥1024px):** Full sidebar, 3 column dashboard, full DataTable

## Component Responsive Behavior
| Component | Mobile | Tablet | Desktop |
|---|---|---|---|
| Sidebar | Drawer (hamburger) | Collapsed icons | Full expanded |
| DataTable | Card list view | Scrollable table | Full table + filters |
| Dashboard | Single column stack | 2-col grid | 3-col grid + sidebar |
| Dialog | Full screen sheet | Centered modal | Centered modal |
| Form | Single column | Single column | 2-column for long forms |
