"use client";

import {
  Database as DatabaseIcon,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  GripVertical,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@/components/ui/fa-icon";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { DashboardDesigner } from "@/components/dashboards/dashboard-designer";
import { AppShell } from "@/components/layout/app-shell";
import { FaIcon } from "@/components/ui/fa-icon";
import {
  CompactMenu,
  ResourceDialog,
  startDatabaseDrag,
  startPlacementDrag,
  type Db,
  type FolderType,
  type ResourceDialogState,
  type Space,
  type SpaceDatabase,
  useSpaceDatabaseOrganizer,
} from "@/components/spaces/resource-manager";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { DEFAULT_ICONS } from "@/lib/icon-system";
import { ResourceAccess } from "@/components/access/resource-access";
import { DatabaseView } from "@/components/table/database-view";

type Dashboard = components["schemas"]["DashboardOut"];
type Layout = components["schemas"]["LayoutOut"];

function PageSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading">
      <div className="h-5 w-44 animate-pulse rounded bg-muted" />
      <div className="h-9 w-full animate-pulse rounded-md bg-muted/70" />
      <div className="h-56 w-full animate-pulse rounded-xl bg-muted/50" />
    </div>
  );
}

function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-[60px] items-center gap-4 border-b bg-card px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h1>
        <p className="mt-0.5 max-w-3xl truncate text-[11px] leading-4 text-muted-foreground max-sm:hidden">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}

function DatabaseRow({
  database,
  onDialog,
}: {
  database: Db;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      draggable
      onDragStart={(event) => startDatabaseDrag(event, database.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextPoint({ x: event.clientX, y: event.clientY });
      }}
      className="group grid h-10 grid-cols-[24px_minmax(0,1fr)_72px] items-center border-b px-3 text-xs last:border-0 hover:bg-muted/70"
    >
      <GripVertical className="size-3.5 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-60 group-focus-within:opacity-60" />
      <Link
        href={`/databases/${database.id}`}
        title={database.name}
        className="flex min-w-0 items-center gap-2 rounded py-1.5 font-medium focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FaIcon
          name={database.icon || DEFAULT_ICONS.database}
          className="size-3.5 shrink-0"
          style={{ color: database.icon_color || "var(--icon-database)" }}
        />
        <span className="truncate">{database.name}</span>
      </Link>
      <div className="flex items-center justify-end gap-0.5">
        <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <ResourceAccess resourceType="database" resourceId={database.id} resourceLabel={database.name} compact />
        </span>
        <CompactMenu
        label={`Manage ${database.name}`}
        trigger={<MoreHorizontal className="size-3.5" />}
        triggerClassName="flex size-7 items-center justify-center rounded opacity-0 hover:bg-muted group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        contextPoint={contextPoint}
        items={[
          {
            label: "Add to Space",
            icon: <Plus className="size-3.5" />,
            onSelect: () => onDialog({ type: "place-database", database }),
          },
          {
            label: "Rename",
            icon: <Pencil className="size-3.5" />,
            onSelect: () => onDialog({ type: "rename-database", database }),
          },
          {
            label: "Duplicate database",
            icon: <Copy className="size-3.5" />,
            onSelect: () => onDialog({ type: "duplicate-database", database }),
          },
          {
            label: "Delete database",
            icon: <Trash2 className="size-3.5" />,
            destructive: true,
            onSelect: () => onDialog({ type: "delete-database", database }),
          },
        ]}
        />
      </div>
    </div>
  );
}

function AllDatabaseView({
  databases,
  loading,
  onDialog,
}: {
  databases: Db[];
  loading: boolean;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const filtered = databases.filter((database) =>
    database.name.toLowerCase().includes(needle),
  );
  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="All Database"
        description="The canonical inventory for this workspace. A database can be placed in multiple Spaces without being duplicated."
        action={
          <button
            type="button"
            onClick={() => onDialog({ type: "create-database" })}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-white shadow-sm hover:bg-[#087fd4] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" /> New database
          </button>
        }
      />
      <div className="mx-auto w-full max-w-[1440px] p-3 lg:p-4">
        <div className="mb-3 flex items-center gap-3">
          <label className="flex h-8 w-full max-w-[320px] items-center gap-2 rounded-md border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-3.5" />
            <span className="sr-only">Search databases</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search databases"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-xs"
            />
          </label>
          <p className="ml-auto hidden text-[11px] text-muted-foreground md:block">
            Canonical databases are independent of Space hierarchy.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid h-8 grid-cols-[24px_minmax(0,1fr)_72px] items-center border-b bg-muted/45 px-3 text-[11px] font-medium text-muted-foreground">
            <span />
            <span>Database name</span>
            <span />
          </div>
          {loading && <p className="p-5 text-xs text-muted-foreground">Loading databases…</p>}
          {filtered.map((database) => (
            <DatabaseRow key={database.id} database={database} onDialog={onDialog} />
          ))}
          {!loading && !filtered.length && (
            <button
              type="button"
              onClick={() => onDialog({ type: "create-database" })}
              className="flex w-full items-center justify-center gap-2 p-12 text-xs text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" /> Create the first database
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlacementLine({
  placement,
  depth = 2,
  location,
  organizer,
  onDialog,
}: {
  placement: SpaceDatabase;
  depth?: number;
  location?: string;
  organizer: ReturnType<typeof useSpaceDatabaseOrganizer>;
  onDialog: (state: ResourceDialogState) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => startPlacementDrag(event, placement)}
      onDragEnter={(event) => {
        event.stopPropagation();
        organizer.liveInto(event, placement.folder_id, placement.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="group grid h-8 grid-cols-[minmax(240px,1fr)_88px_minmax(140px,.7fr)_36px] items-center border-b bg-card text-[11px] text-muted-foreground transition-[transform,background-color] duration-200 ease-out last:border-b-0 hover:bg-muted/65 hover:text-foreground max-md:grid-cols-[minmax(190px,1fr)_72px_36px]"
    >
      <Link
        href={`/databases/${placement.database_id}?placement=${placement.id}`}
        title={placement.database.name}
        className="flex min-w-0 items-center gap-1.5 py-1 focus-visible:ring-2 focus-visible:ring-ring"
        style={{ paddingLeft: `${Math.min(depth, 8) * 18 + 8}px` }}
      >
        <GripVertical className="size-3 shrink-0 cursor-grab opacity-0 group-hover:opacity-60" />
        <FaIcon
          name={placement.database.icon || DEFAULT_ICONS.database}
          className="size-3.5 shrink-0 text-[var(--icon-database)]"
        />
        <span className="truncate font-medium">{placement.database.name}</span>
      </Link>
      <span>Database</span>
      <span className="truncate max-md:hidden" title={location}>{location ?? "Space root"}</span>
      <button
        type="button"
        aria-label={`Move ${placement.database.name}`}
        onClick={() => onDialog({ type: "move-placement", placement })}
        className="flex size-6 items-center justify-center rounded opacity-0 hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  );
}

function FolderFile({
  folder,
  folders,
  placements,
  depth = 1,
  path,
  organizer,
  onDialog,
}: {
  folder: FolderType;
  folders: FolderType[];
  placements: SpaceDatabase[];
  depth?: number;
  path: string;
  organizer: ReturnType<typeof useSpaceDatabaseOrganizer>;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const [open, setOpen] = useState(true);
  const folderPlacements = organizer.placements
    .filter((placement) => placement.folder_id === folder.id)
    .sort((a, b) => a.order - b.order);
  const children = folders.filter((candidate) => candidate.parent_id === folder.id);
  const currentPath = `${path} / ${folder.name}`;
  return (
    <>
      <motion.div
        layout
        onDragEnter={(event) => {
          event.stopPropagation();
          event.currentTarget.dataset.dragOver = "true";
          organizer.liveInto(event, folder.id);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => delete event.currentTarget.dataset.dragOver}
        onDrop={(event) => {
          event.preventDefault();
          delete event.currentTarget.dataset.dragOver;
        }}
        transition={{ layout: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        className="group/folder grid h-8 grid-cols-[minmax(240px,1fr)_88px_minmax(140px,.7fr)_36px] items-center border-b bg-card text-[11px] hover:bg-muted/65 data-[drag-over=true]:bg-accent max-md:grid-cols-[minmax(190px,1fr)_72px_36px]"
      >
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={{ paddingLeft: `${Math.min(depth, 8) * 18 + 8}px` }}
        >
          <button
            type="button"
            aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            onClick={() => setOpen((value) => !value)}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <FaIcon
            name={folder.icon || DEFAULT_ICONS.folder}
            className="size-3.5 shrink-0 text-[var(--icon-folder)]"
          />
          <span className="truncate font-medium" title={folder.name}>{folder.name}</span>
          <span className="text-[10px] text-muted-foreground">{children.length + folderPlacements.length}</span>
        </div>
        <span className="text-muted-foreground">Folder</span>
        <span className="truncate text-muted-foreground max-md:hidden" title={path}>{path}</span>
        <CompactMenu
          label={`Manage ${folder.name}`}
          trigger={<MoreHorizontal className="size-3.5" />}
          triggerClassName="flex size-6 items-center justify-center rounded opacity-0 hover:bg-muted group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
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
          ]}
        />
      </motion.div>
      {open ? (
        <>
          {children.map((child) => (
            <FolderFile
              key={child.id}
              folder={child}
              folders={folders}
              placements={placements}
              depth={depth + 1}
              path={currentPath}
              organizer={organizer}
              onDialog={onDialog}
            />
          ))}
          {folderPlacements.map((placement) => (
            <PlacementLine
              key={placement.id}
              placement={placement}
              depth={depth + 1}
              location={currentPath}
              organizer={organizer}
              onDialog={onDialog}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

function SpaceFile({
  space,
  folders,
  placements,
  onDialog,
}: {
  space: Space;
  folders: FolderType[];
  placements: SpaceDatabase[];
  onDialog: (state: ResourceDialogState) => void;
}) {
  const organizer = useSpaceDatabaseOrganizer(space.id, placements);
  const [open, setOpen] = useState(true);
  const rootPlacements = organizer.placements
    .filter((placement) => placement.folder_id === null)
    .sort((a, b) => a.order - b.order);
  const rootFolders = folders.filter((folder) => folder.parent_id === null);
  return (
    <>
      <motion.div
        layout
        onDragEnter={(event) => {
          event.preventDefault();
          event.currentTarget.dataset.dragOver = "true";
          organizer.liveInto(event, null);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => delete event.currentTarget.dataset.dragOver}
        onDrop={(event) => {
          event.preventDefault();
          delete event.currentTarget.dataset.dragOver;
        }}
        transition={{ layout: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        className="group/space grid h-9 grid-cols-[minmax(240px,1fr)_88px_minmax(140px,.7fr)_36px] items-center border-b bg-[var(--surface-subtle)] text-xs data-[drag-over=true]:bg-accent max-md:grid-cols-[minmax(190px,1fr)_72px_36px]"
      >
        <div className="flex min-w-0 items-center gap-1.5 pl-2">
          <button
            type="button"
            aria-label={open ? `Collapse ${space.name}` : `Expand ${space.name}`}
            onClick={() => setOpen((value) => !value)}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <FaIcon
            name={space.icon || DEFAULT_ICONS.space}
            className="size-3.5 shrink-0"
            style={{ color: space.color ?? "var(--icon-space)" }}
          />
          <Link href={`/databases?space=${space.id}`} className="min-w-0 truncate rounded font-semibold hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {space.name}
          </Link>
          <span className="text-[10px] text-muted-foreground">{folders.length + placements.length}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">Space</span>
        <span className="truncate text-[11px] text-muted-foreground max-md:hidden">Workspace root</span>
        <CompactMenu
          label={`Manage ${space.name}`}
          trigger={<MoreHorizontal className="size-3.5" />}
          triggerClassName="flex size-7 items-center justify-center rounded opacity-0 hover:bg-muted group-hover/space:opacity-100 group-focus-within/space:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
          items={[
            {
              label: "Rename",
              icon: <Pencil className="size-3.5" />,
              onSelect: () => onDialog({ type: "rename-space", space }),
            },
            {
              label: "Delete",
              icon: <Folder className="size-3.5" />,
              destructive: true,
              onSelect: () => onDialog({ type: "delete-space", space }),
            },
          ]}
        />
      </motion.div>
      {open ? <>
        {rootFolders.map((folder) => (
          <FolderFile
            key={folder.id}
            folder={folder}
            folders={folders}
            placements={placements}
            path={space.name}
            organizer={organizer}
            onDialog={onDialog}
          />
        ))}
        {rootPlacements.map((placement) => (
          <PlacementLine
            key={placement.id}
            placement={placement}
            location={space.name}
            organizer={organizer}
            onDialog={onDialog}
          />
        ))}
        {!rootFolders.length && !rootPlacements.length && (
          <button
            type="button"
            onClick={() => onDialog({ type: "create-folder", spaceId: space.id })}
            className="flex h-8 w-full items-center gap-2 border-b bg-card pl-12 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderPlus className="size-3.5" /> Create first folder
          </button>
        )}
      </> : null}
    </>
  );
}

function DatabaseBar({
  databases,
  spaces,
  placementsBySpace,
  onDialog,
}: {
  databases: Db[];
  spaces: Space[];
  placementsBySpace: Record<string, SpaceDatabase[]>;
  onDialog: (state: ResourceDialogState) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = databases.filter((database) =>
    database.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <aside className="w-full shrink-0 border-t bg-card lg:sticky lg:top-0 lg:h-[calc(100dvh-var(--app-topbar-height))] lg:w-64 lg:border-l lg:border-t-0">
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <DatabaseIcon className="size-4 text-[#1264d7]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold">Database bar</h2>
          <p className="text-[10px] text-muted-foreground">Drag into a Space or Folder</p>
        </div>
        <button
          type="button"
          aria-label="Create database"
          onClick={() => onDialog({ type: "create-database" })}
          className="flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="p-2">
        <label className="flex h-8 items-center gap-2 rounded-md border px-2 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-3.5" />
          <span className="sr-only">Search database bar</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search databases"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none sm:text-xs"
          />
        </label>
      </div>
      <div className="max-h-[320px] overflow-y-auto px-2 pb-3 lg:max-h-[calc(100%-7rem)]">
        {filtered.map((database) => {
          const count = spaces.filter((space) =>
            (placementsBySpace[space.id] ?? []).some(
              (placement) => placement.database_id === database.id,
            ),
          ).length;
          return (
            <div
              key={database.id}
              draggable
              onDragStart={(event) => startDatabaseDrag(event, database)}
              className="group flex h-9 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-muted"
            >
              <GripVertical className="size-3 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-60" />
              <FaIcon
                name={database.icon || DEFAULT_ICONS.database}
                className="size-3.5 shrink-0 text-[var(--icon-database)]"
              />
              <span className="min-w-0 flex-1 truncate">{database.name}</span>
              {!!count && <span className="text-[10px] text-muted-foreground">{count}</span>}
              <button
                type="button"
                aria-label={`Add ${database.name} to a Space`}
                onClick={() => onDialog({ type: "place-database", database })}
                className="flex size-7 items-center justify-center rounded opacity-0 hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function SpaceManagementView({
  spaces,
  folders,
  databases,
  placementsBySpace,
  loading,
  onDialog,
}: {
  spaces: Space[];
  folders: FolderType[];
  databases: Db[];
  placementsBySpace: Record<string, SpaceDatabase[]>;
  loading: boolean;
  onDialog: (state: ResourceDialogState) => void;
}) {
  return (
    <div className="flex min-h-full flex-col bg-background lg:flex-row">
      <div className="min-w-0 flex-1">
        <PageHeader
          title="Space Management"
          description="Manage Spaces and folders as a file structure. Drag a database from the right bar into any Space or Folder; existing placements in other Spaces are preserved."
          action={
            <button
              type="button"
              onClick={() => onDialog({ type: "create-space" })}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-white shadow-sm hover:bg-[#087fd4] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" /> New Space
            </button>
          }
        />
        <div className="p-3 lg:p-4">
          {loading && <PageSkeleton />}
          {!loading && spaces.length ? (
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="grid h-8 grid-cols-[minmax(240px,1fr)_88px_minmax(140px,.7fr)_36px] items-center border-b bg-muted/55 px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground max-md:grid-cols-[minmax(190px,1fr)_72px_36px]">
                <span>Name</span>
                <span>Type</span>
                <span className="max-md:hidden">Location</span>
                <span />
              </div>
              {spaces.map((space) => (
                <SpaceFile
                  key={space.id}
                  space={space}
                  folders={folders.filter((folder) => folder.space_id === space.id)}
                  placements={placementsBySpace[space.id] ?? []}
                  onDialog={onDialog}
                />
              ))}
            </div>
          ) : null}
          {!loading && !spaces.length && (
            <button
              type="button"
              onClick={() => onDialog({ type: "create-space" })}
              className="flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-5" /> Create your first Space
            </button>
          )}
        </div>
      </div>
      <DatabaseBar
        databases={databases}
        spaces={spaces}
        placementsBySpace={placementsBySpace}
        onDialog={onDialog}
      />
    </div>
  );
}

function SpaceDashboardView({ space, placements }: { space: Space; placements: SpaceDatabase[] }) {
  const { data: dashboard, isLoading, isError } = useQuery<Dashboard>({
    queryKey: ["space-dashboard", space.id],
    queryFn: () => apiFetch<Dashboard>(`/spaces/${space.id}/dashboard`),
  });
  if (isLoading) return <PageSkeleton />;
  if (isError || !dashboard) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center">
        <LayoutDashboard className="size-6 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Dashboard unavailable</h1>
        <p className="text-xs text-muted-foreground">
          The default dashboard for {space.name} could not be loaded.
        </p>
      </div>
    );
  }
  return <SpaceDashboardWithPinnedLayouts space={space} dashboard={dashboard} placements={placements} />;
}

function SpaceDashboardWithPinnedLayouts({
  space,
  dashboard,
  placements,
}: {
  space: Space;
  dashboard: Dashboard;
  placements: SpaceDatabase[];
}) {
  const [selectedPinnedLayoutId, setSelectedPinnedLayoutId] = useState<string | null>(null);
  const { data: layoutsByPlacement = {} } = useQuery<Record<string, Layout[]>>({
    queryKey: ["space-pinned-layouts", space.id, placements.map((placement) => placement.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          placements.map(async (placement) => [
            placement.id,
            await apiFetch<Layout[]>(`/databases/${placement.database_id}/layouts?placement_id=${placement.id}`),
          ]),
        ),
      ),
    enabled: placements.length > 0,
  });
  const pinned = placements.flatMap((placement) =>
    (layoutsByPlacement[placement.id] ?? [])
      .filter((layout) => (layout.config as { pinned_to_space?: boolean } | null)?.pinned_to_space)
      .map((layout) => ({ placement, layout })),
  );
  const selectedPinned = pinned.find(({ layout }) => layout.id === selectedPinnedLayoutId);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-4">
        <button
          type="button"
          onClick={() => setSelectedPinnedLayoutId(null)}
          className={`flex h-full items-center gap-1.5 border-b-2 px-2 text-xs font-semibold ${!selectedPinned ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <LayoutDashboard className="size-3.5 text-[var(--icon-space)]" /> Overview
        </button>
        {pinned.map(({ placement, layout }) => (
          <button
            type="button"
            key={layout.id}
            onClick={() => setSelectedPinnedLayoutId(layout.id)}
            className={`flex h-full items-center gap-1.5 border-b-2 px-2 text-xs hover:text-foreground ${selectedPinned?.layout.id === layout.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:border-muted-foreground/30"}`}
            title={`Open ${layout.name} in ${placement.database.name}`}
          >
            <FaIcon name={layout.icon || "table"} className="size-3" style={{ color: layout.icon_color || "var(--icon-database)" }} />
            <span className="max-w-40 truncate">{layout.name}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {selectedPinned ? <DatabaseView
          databaseId={selectedPinned.placement.database_id}
          placementId={selectedPinned.placement.id}
          initialLayoutId={selectedPinned.layout.id}
        /> : <DashboardDesigner
          dashboardId={dashboard.id}
          spaceId={space.id}
          spaceName={space.name}
          spaceIcon={space.icon}
          spaceColor={space.color}
          hideContextHeader
        />}
      </div>
    </div>
  );
}

function DatabasesContent() {
  const workspaceId = getWorkspaceId();
  const searchParams = useSearchParams();
  const selectedSpaceId = searchParams.get("space");
  const view = searchParams.get("view") ?? "management";
  const [dialog, setDialog] = useState<ResourceDialogState | null>(null);
  const { data: spaces = [], isLoading: spacesLoading } = useQuery<Space[]>({
    queryKey: ["spaces", workspaceId],
    queryFn: () => apiFetch<Space[]>("/spaces"),
  });
  const { data: databases = [], isLoading: databasesLoading } = useQuery<Db[]>({
    queryKey: ["databases", workspaceId],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const { data: foldersBySpace = {} } = useQuery<Record<string, FolderType[]>>({
    queryKey: ["folders", workspaceId, spaces.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          spaces.map(async (space) => [
            space.id,
            await apiFetch<FolderType[]>(`/spaces/${space.id}/folders`),
          ]),
        ),
      ),
    enabled: spaces.length > 0,
  });
  const { data: placementsBySpace = {} } = useQuery<
    Record<string, SpaceDatabase[]>
  >({
    queryKey: ["space-databases", workspaceId, spaces.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          spaces.map(async (space) => [
            space.id,
            await apiFetch<SpaceDatabase[]>(`/spaces/${space.id}/databases`),
          ]),
        ),
      ),
    enabled: spaces.length > 0,
  });
  const folders = useMemo(() => Object.values(foldersBySpace).flat(), [foldersBySpace]);
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId);
  const loading = spacesLoading || databasesLoading;

  let content: React.ReactNode;
  if (selectedSpaceId && selectedSpace) {
    content = <SpaceDashboardView space={selectedSpace} placements={placementsBySpace[selectedSpace.id] ?? []} />;
  } else if (view === "all") {
    content = (
      <AllDatabaseView
        databases={databases}
        loading={loading}
        onDialog={setDialog}
      />
    );
  } else {
    content = (
      <SpaceManagementView
        spaces={spaces}
        folders={folders}
        databases={databases}
        placementsBySpace={placementsBySpace}
        loading={loading}
        onDialog={setDialog}
      />
    );
  }

  return (
    <>
      {content}
      {dialog && (
        <ResourceDialog
          key={`${dialog.type}-${"database" in dialog ? dialog.database.id : "placement" in dialog ? dialog.placement.id : "new"}`}
          state={dialog}
          spaces={spaces}
          folders={folders}
          placementsBySpace={placementsBySpace}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

export default function DatabasesPage() {
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <DatabasesContent />
      </Suspense>
    </AppShell>
  );
}
