import type { components } from "@/lib/api/schema";

type FieldOut = components["schemas"]["FieldOut"];
type LayoutOut = components["schemas"]["LayoutOut"];

export const DEFAULT_ICONS = {
  space: "layer-group",
  folder: "folder.1",
  database: "database",
  document: "file-alt",
  entity: "cube",
} as const;

export const LAYOUT_ICONS: Record<LayoutOut["type"], string> = {
  table: "table",
  board: "columns",
  list: "th-list",
  calendar: "calendar-alt.1",
  gallery: "images.1",
  gantt: "stream",
};

const FIELD_ICONS: Partial<Record<FieldOut["type"], string>> = {
  text: "font",
  long_text: "align-left",
  number: "hashtag",
  select: "tag",
  multi_select: "tags",
  date: "calendar-day",
  checkbox: "check-square.1",
  url: "link",
  email: "envelope",
  phone: "phone",
  people: "user-friends",
  files: "paperclip",
  formula: "calculator",
  relation: "project-diagram",
  rollup: "layer-group",
  created_time: "clock.1",
  last_edited_time: "history",
  created_by: "user-plus",
  last_edited_by: "user-edit",
  rating: "star.1",
  status: "tasks",
  progress: "tasks",
  priority: "flag",
  country: "flag.1",
  unique_id: "fingerprint",
};

export function iconForLayout(layout: Pick<LayoutOut, "type" | "icon">) {
  return layout.icon || LAYOUT_ICONS[layout.type];
}

export function iconForField(field: Pick<FieldOut, "type" | "icon">) {
  return field.icon || FIELD_ICONS[field.type] || "font";
}

export function defaultIconForFieldType(type: FieldOut["type"]) {
  return FIELD_ICONS[type] || "font";
}
