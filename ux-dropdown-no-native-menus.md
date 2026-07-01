---
name: ux-dropdown-no-native-menus
description: "Standing UX rule — custom dropdowns everywhere (no native OS menus), no layout-pushing panels"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7861b3d5-9956-4ad2-80e6-6761527b20a4
---

User UX standard for the VHB Super App (stated 2026-06-25), applies to ALL future UI:

1. **Never use native OS controls for choices.** No native `<select>` / OS dropdowns anywhere. Every choice/picker (select cells, status, priority, field-type picker, number-format, currency, date-format, etc.) must use a **custom styled dropdown** component (rendered via portal popover).
2. **Multi-select must be a dropdown** too — show selected as chips in the cell, open a popover to toggle options. Do NOT render all options inline/expanded (user said that's "chưa khoa học").
3. **No panels that push the database/content down into a new section.** Row/column selection toolbars and the "new field/column" form must be **floating menus/popovers (overlay)**, not in-flow blocks that shove the table down.

**Why:** consistent, polished, app-like UX (Notion-style); OS menus look out of place and layout-shifting panels are jarring.
**How to apply:** use the shared `frontend/src/components/ui/dropdown.tsx` (`Dropdown` / `MultiDropdown`) for all choices; render floating bars/popovers with `createPortal` + fixed coords (same pattern as `column-menu.tsx`). See [[build-progress-m1]].
