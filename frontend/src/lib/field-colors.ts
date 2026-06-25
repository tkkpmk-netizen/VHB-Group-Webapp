/** Notion-style chip color palette for select/multi-select/status options. */

export type ChipColor = {
  id: string;
  label: string;
  bg: string;
  fg: string;
};

export const CHIP_COLORS: ChipColor[] = [
  { id: "default", label: "Default", bg: "#EDEDEC", fg: "#37352F" },
  { id: "gray", label: "Gray", bg: "#E3E2E0", fg: "#32302C" },
  { id: "brown", label: "Brown", bg: "#EEE0DA", fg: "#4A3228" },
  { id: "orange", label: "Orange", bg: "#FADEC9", fg: "#49290E" },
  { id: "yellow", label: "Yellow", bg: "#FDECC8", fg: "#402C1B" },
  { id: "green", label: "Green", bg: "#DBEDDB", fg: "#1C3829" },
  { id: "blue", label: "Blue", bg: "#D3E5EF", fg: "#183347" },
  { id: "purple", label: "Purple", bg: "#E8DEEE", fg: "#412454" },
  { id: "pink", label: "Pink", bg: "#F5E0E9", fg: "#4C2337" },
  { id: "red", label: "Red", bg: "#FFE2DD", fg: "#5D1715" },
];

const BY_ID = new Map(CHIP_COLORS.map((c) => [c.id, c]));

export function chipColor(id?: string): ChipColor {
  return (id && BY_ID.get(id)) || CHIP_COLORS[0];
}

/** Default status groups (Notion/ClickUp style). */
export const STATUS_GROUPS: { id: string; name: string }[] = [
  { id: "not_started", name: "Not Started" },
  { id: "active", name: "Active" },
  { id: "closed", name: "Closed" },
];
