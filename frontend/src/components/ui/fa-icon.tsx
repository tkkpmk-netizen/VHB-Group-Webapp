"use client";

import type { CSSProperties, HTMLAttributes } from "react";

export type FaIconName = string;

export type FaIconProps = Omit<HTMLAttributes<HTMLSpanElement>, "color"> & {
  name: FaIconName;
  size?: number | string;
  color?: string;
  title?: string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
};

export type LucideIcon = (props: Omit<FaIconProps, "name">) => React.JSX.Element;

const SAFE_ICON_NAME = /^[a-z0-9.-]+$/;

export function FaIcon({
  name,
  size,
  color,
  title,
  className = "",
  style,
  strokeWidth,
  absoluteStrokeWidth,
  ...props
}: FaIconProps) {
  // Accepted for compatibility with the replaced stroke-icon API. Solid
  // Font Awesome glyphs do not use either value.
  void strokeWidth;
  void absoluteStrokeWidth;
  const safeName = SAFE_ICON_NAME.test(name) ? name : "circle";
  const dimension = size == null ? undefined : typeof size === "number" ? `${size}px` : size;
  const mask = `url(/icons/fa5-solid/${safeName}.svg)`;
  const mergedStyle: CSSProperties = {
    width: dimension,
    height: dimension,
    color,
    backgroundColor: "currentColor",
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    ...style,
  };

  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
      role={title ? "img" : undefined}
      style={mergedStyle}
      title={title}
      {...props}
    />
  );
}

function component(name: string): LucideIcon {
  const Icon = (props: Omit<FaIconProps, "name">) => <FaIcon name={name} {...props} />;
  Icon.displayName = `Fa5Solid(${name})`;
  return Icon;
}

export const AlertCircle = component("exclamation-circle");
export const ArrowDownAZ = component("sort-alpha-down");
export const ArrowLeftToLine = component("arrow-left");
export const ArrowRight = component("arrow-right");
export const ArrowRightToLine = component("arrow-right");
export const ArrowUpAZ = component("sort-alpha-up");
export const ArrowUpDown = component("sort");
export const BarChart3 = component("chart-bar.1");
export const Bell = component("bell.1");
export const Bookmark = component("bookmark.1");
export const Calendar = component("calendar-alt.1");
export const CalendarClock = component("calendar-week");
export const Check = component("check");
export const CheckCheck = component("check-double");
export const ChevronDown = component("chevron-down");
export const ChevronLeft = component("chevron-left");
export const ChevronRight = component("chevron-right");
export const Cloud = component("cloud");
export const Code2 = component("code");
export const Columns3 = component("columns");
export const Copy = component("copy.1");
export const Database = component("database");
export const Download = component("download");
export const ExternalLink = component("external-link-alt");
export const Eye = component("eye.1");
export const EyeOff = component("eye-slash.1");
export const File = component("file.1");
export const FileCode2 = component("file-code.1");
export const FileSpreadsheet = component("file-excel.1");
export const FileText = component("file-alt");
export const Folder = component("folder.1");
export const FolderPlus = component("folder-plus");
export const FolderTree = component("sitemap");
export const GanttChart = component("stream");
export const GitBranch = component("code-branch");
export const Globe2 = component("globe");
export const GripVertical = component("grip-vertical");
export const Group = component("layer-group");
export const Home = component("home");
export const Image = component("image");
export const KeyRound = component("key");
export const LayoutDashboard = component("tachometer-alt");
export const LayoutGrid = component("th-large");
export const Link2 = component("link");
export const List = component("th-list");
export const ListFilter = component("filter");
export const ListOrdered = component("list-ol");
export const Loader2 = component("circle-notch");
export const LoaderCircle = component("circle-notch");
export const LocateFixed = component("crosshairs");
export const LogOut = component("sign-out-alt");
export const Mail = component("envelope");
export const Menu = component("bars");
export const Monitor = component("desktop");
export const MoreHorizontal = component("ellipsis-h");
export const PanelLeftClose = component("angle-double-left");
export const PanelLeftOpen = component("angle-double-right");
export const Paperclip = component("paperclip");
export const Pencil = component("edit.1");
export const Pin = component("thumbtack");
export const Plus = component("plus");
export const RefreshCw = component("sync-alt");
export const Rocket = component("rocket");
export const RotateCcw = component("undo");
export const Save = component("save.1");
export const Search = component("search");
export const Settings = component("cog");
export const Share2 = component("share-alt");
export const ShieldCheck = component("shield-alt");
export const Sigma = component("calculator");
export const SlidersHorizontal = component("sliders-h");
export const Smartphone = component("mobile-alt");
export const Sparkles = component("magic");
export const Star = component("star.1");
export const Table = component("table");
export const Table2 = Table;
export const Tablet = component("tablet-alt");
export const Trash2 = component("trash-alt.1");
export const Unlink = component("unlink");
export const Upload = component("upload");
export const UserPlus = component("user-plus");
export const Users = component("users");
export const Workflow = component("project-diagram");
export const WrapText = component("align-left");
export const X = component("times");
