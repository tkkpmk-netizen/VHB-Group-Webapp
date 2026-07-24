"use client";

import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  Unlink,
  X,
} from "@/components/ui/fa-icon";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dropdown } from "@/components/ui/dropdown";
import { FaIcon } from "@/components/ui/fa-icon";
import { IconPicker } from "@/components/ui/icon-picker";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { DEFAULT_ICONS } from "@/lib/icon-system";

export type Db = components["schemas"]["DatabaseOut"];
export type Space = components["schemas"]["SpaceOut"];
export type FolderType = components["schemas"]["FolderOut"];
export type SpaceDatabase = components["schemas"]["SpaceDatabaseOut"];
type SpaceDatabaseOrderItem = components["schemas"]["SpaceDatabaseOrderItem"];

export const DATABASE_DRAG_TYPE = "application/x-vhb-database";
export const PLACEMENT_DRAG_TYPE = "application/x-vhb-space-database";

type PlacementDragData = {
  placementId: string;
  databaseId: string;
  spaceId: string;
};

let activeResourceDrag:
  | { kind: "database"; databaseId: string }
  | ({ kind: "placement" } & PlacementDragData)
  | null = null;

export type ResourceDialogState =
  | { type: "create-space" }
  | { type: "create-folder"; spaceId?: string; parentId?: string | null }
  | { type: "create-database"; spaceId?: string; folderId?: string | null }
  | { type: "place-database"; database: Db; spaceId?: string; folderId?: string | null }
  | { type: "move-placement"; placement: SpaceDatabase }
  | { type: "remove-placement"; placement: SpaceDatabase }
  | { type: "toggle-placement-favorite"; placement: SpaceDatabase }
  | { type: "rename-space"; space: Space }
  | { type: "rename-folder"; folder: FolderType }
  | { type: "rename-database"; database: Db }
  | { type: "duplicate-database"; database: Db }
  | { type: "delete-database"; database: Db }
  | { type: "delete-space"; space: Space }
  | { type: "delete-folder"; folder: FolderType };

export function startDatabaseDrag(event: DragEvent<HTMLElement>, database: Db | string) {
  const databaseId = typeof database === "string" ? database : database.id;
  activeResourceDrag = { kind: "database", databaseId };
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(DATABASE_DRAG_TYPE, databaseId);
  event.dataTransfer.setData("text/plain", databaseId);
}

export function startPlacementDrag(event: DragEvent<HTMLElement>, placement: SpaceDatabase) {
  const payload: PlacementDragData = {
    placementId: placement.id,
    databaseId: placement.database_id,
    spaceId: placement.space_id,
  };
  activeResourceDrag = { kind: "placement", ...payload };
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(PLACEMENT_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.setData(DATABASE_DRAG_TYPE, placement.database_id);
  event.dataTransfer.setData("text/plain", placement.database_id);
}

export function readPlacementDrag(event: DragEvent<HTMLElement>): PlacementDragData | null {
  const raw = event.dataTransfer.getData(PLACEMENT_DRAG_TYPE);
  if (!raw) return activeResourceDrag?.kind === "placement" ? activeResourceDrag : null;
  try {
    return JSON.parse(raw) as PlacementDragData;
  } catch {
    return null;
  }
}

function sortPlacements(items: SpaceDatabase[]) {
  return [...items].sort(
    (a, b) => a.order - b.order || a.database.name.localeCompare(b.database.name),
  );
}

export function useSpaceDatabaseOrganizer(
  spaceId: string,
  placements: SpaceDatabase[],
) {
  const queryClient = useQueryClient();
  const [localPlacements, setLocalPlacements] = useState<{
    base: SpaceDatabase[];
    value: SpaceDatabase[];
  }>({ base: placements, value: placements });
  const displayPlacements =
    localPlacements.base === placements ? localPlacements.value : placements;
  const lastLiveMove = useRef("");
  const reorder = useMutation({
    mutationFn: (items: SpaceDatabaseOrderItem[]) =>
      apiFetch<void>(`/spaces/${spaceId}/databases/reorder`, {
        method: "POST",
        body: JSON.stringify({ items }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["space-databases"] }),
  });
  const add = useMutation({
    mutationFn: ({ databaseId, folderId }: { databaseId: string; folderId: string | null }) =>
      apiFetch<SpaceDatabase>(`/spaces/${spaceId}/databases`, {
        method: "POST",
        body: JSON.stringify({ database_id: databaseId, folder_id: folderId }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["space-databases"] }),
  });

  function movePlacement(
    placementId: string,
    folderId: string | null,
    beforeId?: string,
  ) {
    const placement = displayPlacements.find((item) => item.id === placementId);
    if (!placement) return;
    const sourceFolderId = placement.folder_id;
    const target = sortPlacements(
      displayPlacements.filter((item) => item.folder_id === folderId && item.id !== placementId),
    );
    const beforeIndex = beforeId ? target.findIndex((item) => item.id === beforeId) : -1;
    target.splice(beforeIndex >= 0 ? beforeIndex : target.length, 0, {
      ...placement,
      folder_id: folderId,
    });
    const items: SpaceDatabaseOrderItem[] = target.map((item, order) => ({
      id: item.id,
      folder_id: folderId,
      order,
    }));
    if (sourceFolderId !== folderId) {
      items.push(
        ...sortPlacements(
          displayPlacements.filter(
            (item) => item.folder_id === sourceFolderId && item.id !== placementId,
          ),
        ).map((item, order) => ({ id: item.id, folder_id: sourceFolderId, order })),
      );
    }
    setLocalPlacements({
      base: placements,
      value: displayPlacements.map((item) => {
        const changed = items.find((candidate) => candidate.id === item.id);
        return changed
          ? {
              ...item,
              folder_id: changed.folder_id === undefined ? item.folder_id : changed.folder_id,
              order: changed.order,
            }
          : item;
      }),
    });
    reorder.mutate(items);
  }

  function liveInto(event: DragEvent<HTMLElement>, folderId: string | null, beforeId?: string) {
    event.preventDefault();
    const draggedPlacement = readPlacementDrag(event);
    if (draggedPlacement?.spaceId === spaceId) {
      const signature = `${draggedPlacement.placementId}:${folderId ?? "root"}:${beforeId ?? "end"}`;
      if (lastLiveMove.current !== signature) {
        lastLiveMove.current = signature;
        movePlacement(draggedPlacement.placementId, folderId, beforeId);
      }
      return;
    }
    const databaseId =
      draggedPlacement?.databaseId ||
      (activeResourceDrag?.kind === "database" ? activeResourceDrag.databaseId : "") ||
      event.dataTransfer.getData(DATABASE_DRAG_TYPE);
    const signature = `add:${databaseId}:${folderId ?? "root"}`;
    if (
      databaseId &&
      lastLiveMove.current !== signature &&
      !displayPlacements.some((item) => item.database_id === databaseId)
    ) {
      lastLiveMove.current = signature;
      add.mutate({ databaseId, folderId });
    }
  }

  function dropInto(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.preventDefault();
    const draggedPlacement = readPlacementDrag(event);
    if (draggedPlacement?.spaceId === spaceId) {
      movePlacement(draggedPlacement.placementId, folderId);
      return;
    }
    const databaseId =
      draggedPlacement?.databaseId ?? event.dataTransfer.getData(DATABASE_DRAG_TYPE);
    if (databaseId && !placements.some((item) => item.database_id === databaseId)) {
      add.mutate({ databaseId, folderId });
    }
  }

  return {
    addDatabase: (databaseId: string, folderId: string | null) =>
      add.mutate({ databaseId, folderId }),
    dropInto,
    liveInto,
    movePlacement,
    placements: displayPlacements,
    isPending: reorder.isPending || add.isPending,
  };
}

type MenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
};

export function CompactMenu({
  label,
  trigger,
  items,
  triggerClassName = "",
  contextPoint,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  triggerClassName?: string;
  contextPoint?: { x: number; y: number } | null;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!contextPoint) return;
    setPosition({
      top: Math.max(8, Math.min(contextPoint.y, window.innerHeight - 260)),
      left: Math.max(8, Math.min(contextPoint.x, window.innerWidth - 198)),
    });
    setOpen(true);
  }, [contextPoint]);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)),
      });
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-[80] cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="vhb-popover-shadow fixed z-[90] w-[190px] origin-top-right rounded-lg border bg-popover p-1"
              style={position}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${
                    item.destructive ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </motion.div>
          </>,
          document.body,
        )}
    </>
  );
}

export function ResourceCreateMenu({
  onSelect,
  compact = false,
}: {
  onSelect: (state: ResourceDialogState) => void;
  compact?: boolean;
}) {
  return (
    <CompactMenu
      label="Create resource"
      trigger={
        <>
          <Plus className="size-3.5" />
          {!compact && <span>Create</span>}
        </>
      }
      triggerClassName={
        compact
          ? "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          : "flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground shadow-sm hover:bg-[#087fd4]"
      }
      items={[
        {
          label: "New Space",
          icon: <Plus className="size-3.5" />,
          onSelect: () => onSelect({ type: "create-space" }),
        },
        {
          label: "New Folder",
          icon: <FolderPlus className="size-3.5" />,
          onSelect: () => onSelect({ type: "create-folder" }),
        },
        {
          label: "New Database",
          icon: <Database className="size-3.5" />,
          onSelect: () => onSelect({ type: "create-database" }),
        },
      ]}
    />
  );
}

function PlacementNode({
  placement,
  onDialog,
  onDropBefore,
}: {
  placement: SpaceDatabase;
  onDialog: (state: ResourceDialogState) => void;
  onDropBefore: (event: DragEvent<HTMLElement>, placementId: string) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const active =
    pathname === `/databases/${placement.database_id}` &&
    searchParams.get("placement") === placement.id;
  return (
    <div
      draggable
      onDragStart={(event) => startPlacementDrag(event, placement)}
      onDragEnter={(event) => {
        event.stopPropagation();
        onDropBefore(event, placement.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextPoint({ x: event.clientX, y: event.clientY });
      }}
      className={`group/database relative flex h-[30px] items-center rounded-md pl-1 text-xs transition-colors hover:bg-muted hover:text-foreground ${
        active ? "bg-[var(--surface-selected)] font-medium text-[#1264d7]" : "text-muted-foreground"
      }`}
    >
      <GripVertical className="mr-0.5 size-3 shrink-0 cursor-grab opacity-0 group-hover/database:opacity-60 group-focus-within/database:opacity-60" />
      <Link
        href={`/databases/${placement.database_id}?placement=${placement.id}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FaIcon
          name={placement.database.icon || DEFAULT_ICONS.database}
          className="vhb-tree-icon shrink-0"
          style={{ color: placement.database.icon_color || "var(--icon-database)" }}
        />
        <span className="truncate">{placement.database.name}</span>
      </Link>
      <CompactMenu
        label={`Manage ${placement.database.name}`}
        trigger={<MoreHorizontal className="size-3" />}
        triggerClassName="mr-1 flex size-5 items-center justify-center rounded opacity-0 hover:bg-background group-hover/database:opacity-100 group-focus-within/database:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        contextPoint={contextPoint}
        items={[
          {
            label: "Rename database",
            icon: <Pencil className="size-3.5" />,
            onSelect: () =>
              onDialog({ type: "rename-database", database: placement.database }),
          },
          {
            label: (placement.settings as { favorite?: boolean }).favorite ? "Remove from Favorites" : "Add to Favorites",
            icon: <Star className="size-3.5" />,
            onSelect: () => onDialog({ type: "toggle-placement-favorite", placement }),
          },
          {
            label: "Move in Space",
            icon: <Folder className="size-3.5" />,
            onSelect: () => onDialog({ type: "move-placement", placement }),
          },
          {
            label: "Remove from Space",
            icon: <Unlink className="size-3.5" />,
            destructive: true,
            onSelect: () => onDialog({ type: "remove-placement", placement }),
          },
        ]}
      />
    </div>
  );
}

function FolderNode({
  folder,
  folders,
  placements,
  expanded,
  setExpanded,
  onDialog,
  organizer,
}: {
  folder: FolderType;
  folders: FolderType[];
  placements: SpaceDatabase[];
  expanded: Record<string, boolean>;
  setExpanded: (id: string, value: boolean) => void;
  onDialog: (state: ResourceDialogState) => void;
  organizer: ReturnType<typeof useSpaceDatabaseOrganizer>;
}) {
  const open = expanded[folder.id] ?? true;
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const children = folders.filter((item) => item.parent_id === folder.id);
  const folderPlacements = sortPlacements(
    organizer.placements.filter((placement) => placement.folder_id === folder.id),
  );
  return (
    <div>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          event.currentTarget.dataset.dragOver = "true";
          organizer.liveInto(event, folder.id);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => delete event.currentTarget.dataset.dragOver}
        onDrop={(event) => {
          delete event.currentTarget.dataset.dragOver;
          event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextPoint({ x: event.clientX, y: event.clientY });
        }}
        className="group/folder flex h-[30px] items-center rounded-md pl-1 text-xs transition-colors hover:bg-muted data-[drag-over=true]:bg-accent data-[drag-over=true]:text-accent-foreground"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          onClick={() => setExpanded(folder.id, !open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            {open ? <ChevronDown className="vhb-tree-chevron" /> : <ChevronRight className="vhb-tree-chevron" />}
          </span>
          <FaIcon
            name={folder.icon || DEFAULT_ICONS.folder}
            className="vhb-tree-icon shrink-0"
            style={{ color: folder.icon_color || "var(--icon-folder)" }}
          />
          <span className="truncate" title={folder.name}>{folder.name}</span>
          {!!folderPlacements.length && (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {folderPlacements.length}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={`Create database in ${folder.name}`}
          onClick={() =>
            onDialog({
              type: "create-database",
              spaceId: folder.space_id,
              folderId: folder.id,
            })
          }
          className="flex size-5 items-center justify-center rounded opacity-0 hover:bg-background group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Plus className="size-3" />
        </button>
        <CompactMenu
          label={`Manage ${folder.name}`}
          trigger={<MoreHorizontal className="size-3" />}
          triggerClassName="mr-1 flex size-5 items-center justify-center rounded opacity-0 hover:bg-background group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
          contextPoint={contextPoint}
          items={[
            {
              label: "New subfolder",
              icon: <FolderPlus className="size-3.5" />,
              onSelect: () =>
                onDialog({
                  type: "create-folder",
                  spaceId: folder.space_id,
                  parentId: folder.id,
                }),
            },
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onSelect: () => onDialog({ type: "rename-folder", folder }),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              destructive: true,
              onSelect: () => onDialog({ type: "delete-folder", folder }),
            },
          ]}
        />
      </div>
      {open && (
        <div className="ml-[10px] border-l border-sidebar-border pl-1">
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              folders={folders}
              placements={placements}
              expanded={expanded}
              setExpanded={setExpanded}
              onDialog={onDialog}
              organizer={organizer}
            />
          ))}
          {folderPlacements.map((placement) => (
            <PlacementNode
              key={placement.id}
              placement={placement}
              onDialog={onDialog}
              onDropBefore={(event, beforeId) => {
                event.preventDefault();
                organizer.liveInto(event, folder.id, beforeId);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpaceTree({
  space,
  folders,
  placements,
  expanded,
  setExpanded,
  onDialog,
}: {
  space: Space;
  folders: FolderType[];
  placements: SpaceDatabase[];
  expanded: Record<string, boolean>;
  setExpanded: (id: string, value: boolean) => void;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const searchParams = useSearchParams();
  const organizer = useSpaceDatabaseOrganizer(space.id, placements);
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const open = expanded[space.id] ?? true;
  const active = searchParams.get("space") === space.id;
  const rootFolders = folders.filter((folder) => folder.parent_id === null);
  const rootPlacements = sortPlacements(
    organizer.placements.filter((placement) => placement.folder_id === null),
  );
  return (
    <div className="mb-1">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          event.currentTarget.dataset.dragOver = "true";
          organizer.liveInto(event, null);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => delete event.currentTarget.dataset.dragOver}
        onDrop={(event) => {
          delete event.currentTarget.dataset.dragOver;
          event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextPoint({ x: event.clientX, y: event.clientY });
        }}
        className={`group/space flex h-[30px] items-center rounded-md text-xs font-medium transition-colors hover:bg-muted data-[drag-over=true]:bg-accent ${
          active ? "bg-[var(--surface-selected)] text-[#1264d7]" : ""
        }`}
      >
        <button
          type="button"
          aria-label={open ? `Collapse ${space.name}` : `Expand ${space.name}`}
          aria-expanded={open}
          onClick={() => setExpanded(space.id, !open)}
          className="ml-0.5 flex size-5 items-center justify-center rounded hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDown className="vhb-tree-chevron" /> : <ChevronRight className="vhb-tree-chevron" />}
        </button>
        <Link
          href={`/databases?space=${space.id}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FaIcon
            name={space.icon || DEFAULT_ICONS.space}
            className="vhb-tree-icon shrink-0"
            style={{ color: space.color ?? "var(--icon-space)" }}
          />
          <span className="truncate" title={space.name}>{space.name}</span>
        </Link>
        <button
          type="button"
          aria-label={`Create folder in ${space.name}`}
          onClick={() => onDialog({ type: "create-folder", spaceId: space.id })}
          className="flex size-5 items-center justify-center rounded opacity-0 hover:bg-background group-hover/space:opacity-100 group-focus-within/space:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Plus className="size-3" />
        </button>
        <CompactMenu
          label={`Manage ${space.name}`}
          trigger={<MoreHorizontal className="size-3" />}
          triggerClassName="mr-1 flex size-5 items-center justify-center rounded opacity-0 hover:bg-background group-hover/space:opacity-100 group-focus-within/space:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
          contextPoint={contextPoint}
          items={[
            {
              label: "New folder",
              icon: <FolderPlus className="size-3.5" />,
              onSelect: () => onDialog({ type: "create-folder", spaceId: space.id }),
            },
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onSelect: () => onDialog({ type: "rename-space", space }),
            },
            {
              label: "Delete",
              icon: <Trash2 className="size-3.5" />,
              destructive: true,
              onSelect: () => onDialog({ type: "delete-space", space }),
            },
          ]}
        />
      </div>
      {open && (
        <div className="ml-[10px] border-l border-sidebar-border pl-1">
          {rootFolders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              folders={folders}
              placements={placements}
              expanded={expanded}
              setExpanded={setExpanded}
              onDialog={onDialog}
              organizer={organizer}
            />
          ))}
          {rootPlacements.map((placement) => (
            <PlacementNode
              key={placement.id}
              placement={placement}
              onDialog={onDialog}
              onDropBefore={(event, beforeId) => {
                event.preventDefault();
                organizer.liveInto(event, null, beforeId);
              }}
            />
          ))}
          {!rootFolders.length && !rootPlacements.length && (
            <button
              type="button"
              onClick={() => onDialog({ type: "create-folder", spaceId: space.id })}
              className="ml-6 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" /> New folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ResourceTree({
  spaces,
  folders,
  placementsBySpace,
  favoritePlacements = [],
  search = "",
  onDialog,
}: {
  spaces: Space[];
  folders: FolderType[];
  placementsBySpace: Record<string, SpaceDatabase[]>;
  favoritePlacements?: SpaceDatabase[];
  search?: string;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const [expanded, setExpandedState] = useState<Record<string, boolean>>({});
  const needle = search.trim().toLowerCase();
  const visibleSpaces = spaces.filter((space) => {
    if (!needle || space.name.toLowerCase().includes(needle)) return true;
    return (
      folders.some(
        (folder) =>
          folder.space_id === space.id && folder.name.toLowerCase().includes(needle),
      ) ||
      (placementsBySpace[space.id] ?? []).some((placement) =>
        placement.database.name.toLowerCase().includes(needle),
      )
    );
  });

  return (
    <div data-context-tree="true" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {favoritePlacements.length ? (
        <div className="mb-2 border-b border-sidebar-border pb-2">
          <div className="flex h-7 items-center gap-1.5 px-1.5 text-[11px] font-semibold text-muted-foreground">
            <Star className="size-3 fill-current text-[#f0a12a]" /> Favorites
          </div>
          {favoritePlacements
            .filter((placement) => !needle || placement.database.name.toLowerCase().includes(needle))
            .map((placement) => (
              <Link
                key={placement.id}
                href={`/databases/${placement.database_id}?placement=${placement.id}`}
                title={`Favorite view of ${placement.database.name}`}
                className="group flex h-[30px] items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FaIcon
                  name={placement.database.icon || DEFAULT_ICONS.database}
                  className="vhb-tree-icon shrink-0"
                  style={{ color: placement.database.icon_color || "var(--icon-database)" }}
                />
                <span className="min-w-0 flex-1 truncate">{placement.database.name}</span>
                <Star className="size-3 fill-current text-[#f0a12a] opacity-70" />
              </Link>
            ))}
        </div>
      ) : null}
      <div className="mb-1 flex h-7 items-center justify-between px-1.5">
        <span className="text-[11px] font-semibold text-muted-foreground">Spaces</span>
        <ResourceCreateMenu onSelect={onDialog} compact />
      </div>
      {visibleSpaces.map((space) => (
        <SpaceTree
          key={space.id}
          space={space}
          folders={folders.filter((folder) => folder.space_id === space.id)}
          placements={placementsBySpace[space.id] ?? []}
          expanded={expanded}
          setExpanded={(id, value) =>
            setExpandedState((current) => ({ ...current, [id]: value }))
          }
          onDialog={onDialog}
        />
      ))}
      {!visibleSpaces.length && (
        <button
          type="button"
          onClick={() => onDialog({ type: "create-space" })}
          className="flex w-full items-center gap-2 rounded-md px-2 py-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" /> Create your first Space
        </button>
      )}
    </div>
  );
}

function dialogMeta(state: ResourceDialogState) {
  switch (state.type) {
    case "create-space":
      return { title: "Create a Space", submit: "Create Space", name: "" };
    case "create-folder":
      return { title: "Create a Folder", submit: "Create Folder", name: "" };
    case "create-database":
      return { title: "Create a Database", submit: "Create Database", name: "" };
    case "place-database":
      return { title: `Add ${state.database.name}`, submit: "Add to Space", name: "" };
    case "move-placement":
      return {
        title: `Move ${state.placement.database.name}`,
        submit: "Move",
        name: "",
      };
    case "remove-placement":
      return {
        title: `Remove ${state.placement.database.name}?`,
        submit: "Remove",
        name: "",
      };
    case "toggle-placement-favorite":
      return {
        title: (state.placement.settings as { favorite?: boolean }).favorite
          ? "Remove favorite view?"
          : "Favorite this Space view?",
        submit: (state.placement.settings as { favorite?: boolean }).favorite ? "Remove" : "Favorite",
        name: "",
      };
    case "rename-space":
      return { title: "Rename Space", submit: "Save", name: state.space.name };
    case "rename-folder":
      return { title: "Rename Folder", submit: "Save", name: state.folder.name };
    case "rename-database":
      return { title: "Rename Database", submit: "Save", name: state.database.name };
    case "duplicate-database":
      return { title: `Duplicate ${state.database.name}?`, submit: "Duplicate", name: "" };
    case "delete-database":
      return { title: `Delete ${state.database.name}?`, submit: "Delete", name: "" };
    case "delete-space":
      return { title: `Delete ${state.space.name}?`, submit: "Delete", name: "" };
    case "delete-folder":
      return { title: `Delete ${state.folder.name}?`, submit: "Delete", name: "" };
  }
}

export function ResourceDialog({
  state,
  spaces,
  folders,
  placementsBySpace = {},
  onClose,
}: {
  state: ResourceDialogState;
  spaces: Space[];
  folders: FolderType[];
  placementsBySpace?: Record<string, SpaceDatabase[]>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const meta = dialogMeta(state);
  const [name, setName] = useState(meta.name);
  const initialIcon =
    state.type === "rename-space"
      ? state.space.icon || DEFAULT_ICONS.space
      : state.type === "rename-folder"
        ? state.folder.icon || DEFAULT_ICONS.folder
        : state.type === "rename-database"
          ? state.database.icon || DEFAULT_ICONS.database
          : state.type === "create-space"
            ? DEFAULT_ICONS.space
            : state.type === "create-folder"
              ? DEFAULT_ICONS.folder
              : DEFAULT_ICONS.database;
  const [icon, setIcon] = useState(initialIcon);
  const initialIconColor =
    state.type === "rename-space"
      ? state.space.color || "#7b68ee"
      : state.type === "rename-folder"
        ? state.folder.icon_color || "#f0a12a"
        : state.type === "rename-database"
          ? state.database.icon_color || "#1264d7"
          : state.type === "create-space"
            ? "#7b68ee"
            : state.type === "create-folder"
              ? "#f0a12a"
              : "#1264d7";
  const [iconColor, setIconColor] = useState(initialIconColor);
  const initialSpaceId =
    state.type === "create-folder"
      ? (state.spaceId ?? spaces[0]?.id ?? "")
      : state.type === "place-database"
        ? (state.spaceId ?? spaces[0]?.id ?? "")
        : state.type === "move-placement"
          ? state.placement.space_id
          : "";
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [parentId, setParentId] = useState(
    state.type === "create-folder" ? (state.parentId ?? "__root__") : "__root__",
  );
  const initialFolderId =
    state.type === "create-database"
      ? (state.folderId ?? "__root__")
      : state.type === "place-database"
        ? (state.folderId ?? "__root__")
        : state.type === "move-placement"
          ? (state.placement.folder_id ?? "__root__")
          : "__root__";
  const [folderId, setFolderId] = useState(initialFolderId);
  const [error, setError] = useState("");
  const isDestructive =
    state.type === "delete-space" ||
    state.type === "delete-folder" ||
    state.type === "delete-database" ||
    state.type === "remove-placement";
  const hasNameField = [
    "create-space",
    "create-folder",
    "create-database",
    "rename-space",
    "rename-folder",
    "rename-database",
  ].includes(state.type);

  const mutation = useMutation({
    mutationFn: async () => {
      switch (state.type) {
        case "create-space":
          return apiFetch("/spaces", {
            method: "POST",
            body: JSON.stringify({ name: name.trim(), icon, color: iconColor }),
          });
        case "create-folder":
          return apiFetch(`/spaces/${spaceId}/folders`, {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              icon,
              icon_color: iconColor,
              parent_id: parentId === "__root__" ? null : parentId,
            }),
          });
        case "create-database": {
          const database = await apiFetch<Db>("/databases", {
            method: "POST",
            body: JSON.stringify({ name: name.trim(), icon, icon_color: iconColor }),
          });
          if (state.spaceId) {
            await apiFetch(`/spaces/${state.spaceId}/databases`, {
              method: "POST",
              body: JSON.stringify({
                database_id: database.id,
                folder_id: state.folderId ?? null,
              }),
            });
          }
          return database;
        }
        case "place-database": {
          const existing = (placementsBySpace[spaceId] ?? []).find(
            (placement) => placement.database_id === state.database.id,
          );
          if (existing) {
            return apiFetch(`/space-databases/${existing.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                folder_id: folderId === "__root__" ? null : folderId,
              }),
            });
          }
          return apiFetch(`/spaces/${spaceId}/databases`, {
            method: "POST",
            body: JSON.stringify({
              database_id: state.database.id,
              folder_id: folderId === "__root__" ? null : folderId,
            }),
          });
        }
        case "move-placement":
          return apiFetch(`/space-databases/${state.placement.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              folder_id: folderId === "__root__" ? null : folderId,
            }),
          });
        case "remove-placement":
          return apiFetch(`/space-databases/${state.placement.id}`, { method: "DELETE" });
        case "toggle-placement-favorite":
          return apiFetch(`/space-databases/${state.placement.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              settings: {
                ...state.placement.settings,
                favorite: !(state.placement.settings as { favorite?: boolean }).favorite,
              },
            }),
          });
        case "rename-space":
          return apiFetch(`/spaces/${state.space.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim(), icon, color: iconColor }),
          });
        case "rename-folder":
          return apiFetch(`/folders/${state.folder.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim(), icon, icon_color: iconColor }),
          });
        case "rename-database":
          return apiFetch(`/databases/${state.database.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim(), icon, icon_color: iconColor }),
          });
        case "duplicate-database":
          return apiFetch(`/databases/${state.database.id}/duplicate`, { method: "POST" });
        case "delete-database":
          return apiFetch(`/databases/${state.database.id}`, { method: "DELETE" });
        case "delete-space":
          return apiFetch(`/spaces/${state.space.id}`, { method: "DELETE" });
        case "delete-folder":
          return apiFetch(`/folders/${state.folder.id}`, { method: "DELETE" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["databases"] });
      queryClient.invalidateQueries({ queryKey: ["space-databases"] });
      queryClient.invalidateQueries({ queryKey: ["space-dashboard"] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Action failed"),
  });

  const activeSpaceId =
    state.type === "move-placement" ? state.placement.space_id : spaceId;
  const folderOptions = folders
    .filter((folder) => folder.space_id === activeSpaceId)
    .map((folder) => ({ value: folder.id, label: folder.name }));
  const parentOptions = folders
    .filter((folder) => folder.space_id === spaceId)
    .map((folder) => ({ value: folder.id, label: folder.name }));
  const needsLocation = state.type === "place-database" || state.type === "move-placement";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if ((!hasNameField || name.trim()) && !mutation.isPending) mutation.mutate();
        }}
        className="vhb-popover-shadow relative z-10 w-full max-w-[552px] rounded-xl border bg-card"
      >
        <div className="relative border-b px-5 py-4 pr-14">
          <h2 id="resource-dialog-title" className="text-base font-semibold">{meta.title}</h2>
          {state.type === "create-space" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Every Space starts with its own default dashboard.
            </p>
          )}
          {state.type === "remove-placement" && (
            <p className="mt-1 text-xs text-muted-foreground">
              The database remains available in All Database and in its other Spaces.
            </p>
          )}
          {state.type === "delete-space" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Its dashboard, folders and placements are removed. Databases remain in All Database.
            </p>
          )}
          {state.type === "delete-database" && (
            <p className="mt-1 text-xs text-muted-foreground">
              This permanently removes its fields, entities, layouts and every Space placement.
            </p>
          )}
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="absolute right-4 top-3.5 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {hasNameField && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Name</span>
              <span className="flex items-center gap-2">
                <IconPicker
                  value={icon}
                  onChange={setIcon}
                  onColorChange={setIconColor}
                  label={`Choose icon for ${name || meta.title}`}
                  color={iconColor}
                />
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={state.type === "create-space" ? "Marketing, Operations, HR" : "Name"}
                  className="h-10 min-w-0 flex-1 rounded-md border border-input px-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 sm:text-sm"
                />
              </span>
            </label>
          )}
          {state.type === "create-folder" && (
            <>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">Space</span>
                <div className="min-h-10 rounded-md border border-input py-0.5">
                  <Dropdown
                    value={spaceId}
                    onChange={(value) => {
                      setSpaceId(value ?? "");
                      setParentId("__root__");
                    }}
                    allowClear={false}
                    options={spaces.map((space) => ({ value: space.id, label: space.name }))}
                    placeholder="Choose a Space"
                  />
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">Parent folder</span>
                <div className="min-h-10 rounded-md border border-input py-0.5">
                  <Dropdown
                    value={parentId}
                    onChange={(value) => setParentId(value ?? "__root__")}
                    allowClear={false}
                    options={[{ value: "__root__", label: "Space root" }, ...parentOptions]}
                  />
                </div>
              </label>
            </>
          )}
          {state.type === "place-database" && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Space</span>
              <div className="min-h-10 rounded-md border border-input py-0.5">
                <Dropdown
                  value={spaceId}
                  onChange={(value) => {
                    setSpaceId(value ?? "");
                    setFolderId("__root__");
                  }}
                  allowClear={false}
                  options={spaces.map((space) => ({ value: space.id, label: space.name }))}
                  placeholder="Choose a Space"
                />
              </div>
            </label>
          )}
          {needsLocation && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Folder</span>
              <div className="min-h-10 rounded-md border border-input py-0.5">
                <Dropdown
                  value={folderId}
                  onChange={(value) => setFolderId(value ?? "__root__")}
                  allowClear={false}
                  options={[{ value: "__root__", label: "Space root" }, ...folderOptions]}
                />
              </div>
            </label>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              mutation.isPending ||
              (hasNameField && !name.trim()) ||
              (state.type === "create-folder" && !spaceId) ||
              (state.type === "place-database" && !spaceId)
            }
            className={`h-9 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isDestructive ? "bg-destructive hover:bg-red-600" : "bg-primary hover:bg-[#087fd4]"
            }`}
          >
            {mutation.isPending ? "Working..." : meta.submit}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
