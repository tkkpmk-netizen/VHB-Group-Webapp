# VHB Super App Design System

> Generated with UI/UX Pro Max and curated against the approved ClickUp-style
> VHB product shell. Page overrides in `pages/` take precedence.

## Product profile

- Product: internal B2B productivity and database workspace
- Style: Flat Design + Minimalism + restrained Micro-interactions
- Variance: 3/10
- Motion: 5/10
- Density: 9/10
- Baseline: light mode, desktop-first productivity with responsive mobile access

## Visual language

- Font: Geist for headings and body; Geist Mono for technical identifiers.
- Primary: VHB action blue `#0C8CE9`; navigation gradient `#0D63BD` → `#084D9F`.
- Canvas/surfaces: white and `#F9F9F9`; borders `#E8EAED`.
- Text: `#202020` primary, `#646464` secondary, `#838383` tertiary.
- Radius: 6px default, 8–12px only for container hierarchy and overlays.
- Shadows: reserved for floating menus/dialogs; hierarchy in work areas uses
  borders and surface contrast.
- Icons: Font Awesome Free 5.15.3 Solid SVG only, rendered through the shared
  `FaIcon` component; no emoji as product icons.

## Density and layout

- Use the 4px/8px spacing system; dense surfaces favor 8–12px gaps/padding.
- App rail: 52px; top bar: 40px; context sidebar: 256px.
- Tree rows: 30px; data rows: 32–36px; page controls: 32–40px desktop.
- Main pages may use compact bordered sections, but avoid a card around every
  row or action.
- Breakpoints to verify: 375px, 768px, 1024px, 1440px.
- Never create page-level horizontal scroll. Data tables may own a bounded
  horizontal scrolling region.

## Interaction

- Transitions: 160ms for feedback and 220ms for structural changes, using the
  shared ease-in/ease-out curve.
- Animate transform/opacity only; no decorative scroll choreography.
- Hover can reveal secondary icons, but every required action must remain
  reachable by keyboard/touch through a visible button or overflow menu.
- Drag-and-drop requires a menu/dialog equivalent and real-time target feedback.
  The source remains in its toolbar/tree and is highlighted for the entire drag.
- Focus rings are always visible; icon-only controls require accessible names.
- Menus, dropdowns, and dialogs overlay content rather than resizing data views.
- Respect `prefers-reduced-motion`.

## Navigation contract

- Global Navigation selects product modules.
- Context Sidebar owns Space/Folder/Database hierarchy.
- Space links open the Space default Dashboard.
- Folder buttons only expand/collapse the tree; they never navigate.
- `All Database` is the canonical inventory.
- `Space Management` follows it and contains the right-side Database bar.
- Per-user Favorite Databases are pinned above Spaces; they do not create a
  placement. Every Space opens its editable default `Overview` Dashboard.
- URL deep links preserve key destinations and do not reset the tree/work area
  unexpectedly.

## Accessibility and feedback

- WCAG AA: normal text contrast at least 4.5:1.
- Keyboard tab order follows visual order; no keyboard traps.
- Mobile body/input text stays at least 16px where iOS zoom would otherwise be
  triggered.
- Async actions disable their trigger and show progress; errors appear next to
  the failed action with a recovery path.
- Destructive actions are separated, clearly labeled, and confirmed.
- Empty states explain the next useful action.

## Anti-patterns

- No oversized marketing typography inside product work areas.
- No gradients except the VHB app rail/brand assets.
- No glassmorphism, neumorphism, heavy blur, or decorative shadows.
- No native `<select>`; use shared `Dropdown`/`MultiDropdown`.
- No hover-only functionality, invisible focus, color-only meaning, or
  layout-shifting hover transforms.
