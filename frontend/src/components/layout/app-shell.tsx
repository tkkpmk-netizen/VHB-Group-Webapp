"use client";

import {
  Database,
  FolderTree,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  Users,
} from "@/components/ui/fa-icon";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  ApiError,
  clearWorkspaceSelection,
  getWorkspaceId,
  selectWorkspace,
} from "@/lib/api/client";
import { clearToken, getToken } from "@/lib/auth";
import type { components } from "@/lib/api/schema";
import { PRODUCT_MODULES } from "@/modules/registry";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { LiveDragPreview } from "@/components/ui/live-drag-preview";
import {
  ResourceCreateMenu,
  ResourceDialog,
  ResourceTree,
  readPlacementDrag,
  type ResourceDialogState,
  type SpaceDatabase,
} from "@/components/spaces/resource-manager";

type Membership = components["schemas"]["MembershipOut"];
type Workspace = components["schemas"]["WorkspaceOut"];
type Space = components["schemas"]["SpaceOut"];
type FolderType = components["schemas"]["FolderOut"];
type Db = components["schemas"]["DatabaseOut"];
type User = components["schemas"]["UserOut"];

function AppRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[var(--app-rail-width)] shrink-0 flex-col items-center bg-[linear-gradient(180deg,var(--app-rail-start),var(--app-rail-end))] py-1.5 text-white lg:flex">
      <Link
        href="/"
        aria-label="VHB home"
        className="mb-1.5 flex size-10 items-center justify-center rounded-md hover:bg-[var(--app-rail-hover)]"
      >
        <Image
          src="/brand/vhb-mark-white.png"
          alt=""
          width={1353}
          height={1162}
          className="h-[27px] w-auto"
          priority
        />
      </Link>
      <nav aria-label="Global navigation" className="flex w-full flex-1 flex-col gap-0.5 px-1">
        {PRODUCT_MODULES.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className="group flex h-[48px] flex-col items-center justify-center gap-0.5 rounded-md text-[9px] font-medium text-white/85 hover:bg-[var(--app-rail-hover)] hover:text-white"
            >
              <span
                className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                  active
                    ? "bg-[var(--app-rail-active)] text-[var(--app-rail-active-foreground)] shadow-sm"
                    : "text-white group-hover:bg-white/10"
                }`}
              >
                <item.icon className="size-[17px]" strokeWidth={1.8} />
              </span>
              <span className="w-full truncate px-0.5 text-center leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <Link
        href="/settings/people"
        className="flex h-[48px] w-[44px] flex-col items-center justify-center gap-0.5 rounded-md text-[9px] font-medium text-white/85 hover:bg-[var(--app-rail-hover)] hover:text-white"
      >
        <Users className="size-[17px]" strokeWidth={1.8} />
        Invite
      </Link>
    </aside>
  );
}

function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  user,
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelect: (id: string) => void;
  user?: User;
}) {
  const [open, setOpen] = useState(false);
  const active = workspaces.find((workspace) => workspace.id === activeId);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-full bg-[#242424] text-[10px] font-bold text-white ring-1 ring-black/10 hover:ring-2 hover:ring-[var(--ring)]"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Switch workspace. Current workspace: ${active?.name ?? "none"}`}
        title={active?.name ?? "Select workspace"}
      >
        {(user?.full_name ?? user?.email ?? "VHB")
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.slice(0, 1))
          .join("")
          .toUpperCase()}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close workspace menu"
            className="fixed inset-0 z-[80] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="vhb-popover-shadow absolute right-0 top-10 z-[90] w-[248px] rounded-lg border bg-popover p-1"
          >
            <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold text-muted-foreground">
              Switch workspace
            </p>
            <div className="mb-1 flex items-center gap-2 border-b px-2 pb-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-[#242424] text-[9px] font-bold text-white">
                {(user?.full_name ?? user?.email ?? "VHB").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{user?.full_name ?? "VHB user"}</p>
                <p className="truncate text-[10px] text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(workspace.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="truncate">{workspace.name}</span>
                <span className="ml-3 text-[9px] uppercase text-muted-foreground">
                  {workspace.role}
                </span>
              </button>
            ))}
            {workspaces.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No workspace access. Ask an administrator to invite you.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function ContextSidebar({
  spaces,
  folders,
  databases,
  placementsBySpace,
  onClose,
  moduleLabel,
  isDatabase,
  workspaceName,
  onDialog,
  onNavigate,
}: {
  spaces: Space[];
  folders: FolderType[];
  databases: Db[];
  placementsBySpace: Record<string, SpaceDatabase[]>;
  onClose: () => void;
  moduleLabel: string;
  isDatabase: boolean;
  workspaceName?: string;
  onDialog: (state: ResourceDialogState) => void;
  onNavigate: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <aside
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) onNavigate();
      }}
      className="fixed bottom-0 left-0 top-[var(--app-topbar-height)] z-[60] flex w-[min(18rem,calc(100vw-2rem))] flex-col border-r border-sidebar-border bg-sidebar shadow-xl lg:static lg:z-auto lg:h-full lg:w-[var(--context-sidebar-width)] lg:shadow-none"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 rounded-b-lg border-b border-sidebar-border bg-card px-2 shadow-sm">
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
          {isDatabase ? "Spaces" : moduleLabel}
        </h2>
        {isDatabase && (
          <button
            type="button"
            title="Search databases"
            aria-label="Search databases"
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Search className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="size-3.5" />
        </button>
        {isDatabase && <ResourceCreateMenu onSelect={onDialog} />}
      </div>

      <nav aria-label="Mobile global navigation" className="grid grid-cols-4 gap-1 border-y px-2 py-2 lg:hidden">
        {PRODUCT_MODULES.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={onClose}
            className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <item.icon className="size-4" />
            <span className="w-full truncate text-center">{item.label}</span>
          </Link>
        ))}
      </nav>

      {isDatabase && searchOpen && (
        <div className="px-2 pb-2">
          <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2 text-muted-foreground shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-3.5" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search databases"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </label>
        </div>
      )}

      {isDatabase ? (
        <ResourceTree
          spaces={spaces}
          folders={folders}
          placementsBySpace={placementsBySpace}
          favoritePlacements={Object.values(placementsBySpace)
            .flat()
            .filter((placement) => (placement.settings as { favorite?: boolean }).favorite)}
          search={search}
          onDialog={onDialog}
        />
      ) : (
        <nav aria-label={`${moduleLabel} navigation`} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
          {PRODUCT_MODULES.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      {isDatabase && <div className="border-t border-sidebar-border p-2">
        <Link
          href="/databases?view=all"
          onDragOver={(event) => {
            event.preventDefault();
            event.currentTarget.dataset.dragOver = "true";
          }}
          onDragLeave={(event) => delete event.currentTarget.dataset.dragOver}
          onDrop={(event) => {
            event.preventDefault();
            delete event.currentTarget.dataset.dragOver;
            const placement = readPlacementDrag(event);
            if (placement) {
              void apiFetch(`/space-databases/${placement.placementId}`, {
                method: "DELETE",
              }).then(() =>
                queryClient.invalidateQueries({ queryKey: ["space-databases"] }),
              );
            }
          }}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[drag-over=true]:bg-accent data-[drag-over=true]:text-accent-foreground"
        >
          <Database className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">All Database</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">{databases.length}</span>
        </Link>
        <Link
          href="/databases?view=management"
          className="mt-0.5 flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <FolderTree className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">Space Management</span>
        </Link>
      </div>}
      <span className="sr-only">{workspaceName}</span>
    </aside>
  );
}

function Topbar({
  workspaces,
  activeId,
  onSelectWorkspace,
  onOpenSidebar,
  sidebarOpen,
  user,
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelectWorkspace: (id: string) => void;
  onOpenSidebar: () => void;
  sidebarOpen: boolean;
  user?: User;
}) {
  const router = useRouter();
  return (
    <header className="flex h-[var(--app-topbar-height)] shrink-0 items-center border-b bg-card">
      <div
        className={`flex h-full min-w-0 items-center gap-1 border-r px-1.5 transition-[width] lg:shrink-0 ${
          sidebarOpen ? "w-[12rem] lg:w-[var(--context-sidebar-width)]" : "w-auto lg:w-11"
        }`}
      >
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-4" />
        </button>
      </div>
      <div className="relative flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onOpenSidebar}
            title="Open sidebar"
            className="absolute left-2 hidden rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground lg:block"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
        <button
          type="button"
          disabled
          title="Global search is not available yet"
          className="hidden h-6 w-full max-w-[320px] items-center gap-2 rounded-full border border-input bg-background px-2.5 text-muted-foreground shadow-sm md:flex"
        >
          <Search className="size-3.5" />
          <span className="truncate text-[11px]">Search</span>
          <kbd className="ml-auto text-[9px]">⌘ J</kbd>
        </button>
        <div className="absolute right-2 flex items-center gap-0.5">
          <button
            type="button"
            disabled
            title="AI assistant is not available yet"
            className="rounded p-1 text-muted-foreground"
          >
            <Sparkles className="size-4 text-[#7252d8]" />
          </button>
          <NotificationBell />
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeId}
            onSelect={onSelectWorkspace}
            user={user}
          />
          <button
            type="button"
            title="Log out"
            onClick={async () => {
              try {
                await apiFetch<void>("/auth/logout", { method: "POST" });
              } finally {
                clearToken();
                router.push("/login");
              }
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [resourceDialog, setResourceDialog] = useState<ResourceDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => getWorkspaceId(),
  );

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const { data: workspaces = [], error } = useQuery<Membership[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const memberships = await apiFetch<Membership[]>("/workspaces");
      if (!getWorkspaceId() && memberships.length) {
        selectWorkspace(memberships[0].id);
      }
      return memberships;
    },
    retry: false,
  });

  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? null;

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      clearWorkspaceSelection();
      router.replace("/login");
    }
  }, [error, router]);

  const enabled = Boolean(selectedWorkspaceId);
  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace-me", selectedWorkspaceId],
    queryFn: () => apiFetch<Workspace>("/workspaces/me"),
    enabled,
  });
  const { data: user } = useQuery<User>({
    queryKey: ["auth-me"],
    queryFn: () => apiFetch<User>("/auth/me"),
  });
  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ["spaces", selectedWorkspaceId],
    queryFn: () => apiFetch<Space[]>("/spaces"),
    enabled,
  });
  const { data: databases = [] } = useQuery<Db[]>({
    queryKey: ["databases", selectedWorkspaceId],
    queryFn: () => apiFetch<Db[]>("/databases"),
    enabled,
  });
  const { data: foldersBySpace = {} } = useQuery<Record<string, FolderType[]>>({
    queryKey: ["folders", selectedWorkspaceId, spaces.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          spaces.map(async (space) => [
            space.id,
            await apiFetch<FolderType[]>(`/spaces/${space.id}/folders`),
          ]),
        ),
      ),
    enabled: enabled && spaces.length > 0,
  });
  const folders = useMemo(
    () => Object.values(foldersBySpace).flat(),
    [foldersBySpace],
  );
  const { data: placementsBySpace = {} } = useQuery<
    Record<string, SpaceDatabase[]>
  >({
    queryKey: ["space-databases", selectedWorkspaceId, spaces.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          spaces.map(async (space) => [
            space.id,
            await apiFetch<SpaceDatabase[]>(`/spaces/${space.id}/databases`),
          ]),
        ),
      ),
    enabled: enabled && spaces.length > 0,
  });
  const activeModule = PRODUCT_MODULES.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const isDatabase = pathname.startsWith("/databases");

  function changeWorkspace(id: string) {
    selectWorkspace(id);
    setActiveWorkspaceId(id);
    queryClient.clear();
    router.push("/");
  }

  function openSidebar() {
    setSidebarOpen(true);
    setMobileOpen(true);
  }

  function closeSidebar() {
    setSidebarOpen(false);
    setMobileOpen(false);
  }

  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-background"
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <LiveDragPreview />
      <AppRail />
      <div className={`${mobileOpen ? "block" : "hidden"} ${sidebarOpen ? "lg:block" : "lg:hidden"}`}>
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-50 bg-black/25 lg:hidden"
          />
        )}
        <ContextSidebar
          spaces={spaces}
          folders={folders}
          databases={databases}
          placementsBySpace={placementsBySpace}
          onClose={closeSidebar}
          moduleLabel={activeModule?.label ?? "Home"}
          isDatabase={isDatabase}
          workspaceName={workspace?.name}
          onDialog={setResourceDialog}
          onNavigate={() => setMobileOpen(false)}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          workspaces={workspaces}
          activeId={selectedWorkspaceId}
          onSelectWorkspace={changeWorkspace}
          onOpenSidebar={openSidebar}
          sidebarOpen={sidebarOpen}
          user={user}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
          <div className="sr-only">{workspace?.name}</div>
          {children}
        </main>
      </div>
      {resourceDialog && (
        <ResourceDialog
          key={resourceDialog.type}
          state={resourceDialog}
          spaces={spaces}
          folders={folders}
          placementsBySpace={placementsBySpace}
          onClose={() => setResourceDialog(null)}
        />
      )}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-[200] w-48 rounded-lg border bg-popover p-1 shadow-xl"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 208), top: Math.min(contextMenu.y, window.innerHeight - 116) }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => setContextMenu(null)} className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted">Open item menu</button>
          <button type="button" role="menuitem" onClick={() => { navigator.clipboard?.writeText(window.location.href); setContextMenu(null); }} className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted">Copy link</button>
          <button type="button" role="menuitem" onClick={() => setContextMenu(null)} className="flex w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">Cancel</button>
        </div>
      )}
    </div>
  );
}
