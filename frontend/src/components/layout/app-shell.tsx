"use client";

import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  ApiError,
  getWorkspaceId,
  selectWorkspace,
} from "@/lib/api/client";
import { clearToken, getToken } from "@/lib/auth";
import type { components } from "@/lib/api/schema";
import { PRODUCT_MODULES } from "@/modules/registry";
import { NotificationBell } from "@/components/notifications/notification-bell";

type Membership = components["schemas"]["MembershipOut"];
type Workspace = components["schemas"]["WorkspaceOut"];
type Space = components["schemas"]["SpaceOut"];
type FolderType = components["schemas"]["FolderOut"];
type Db = components["schemas"]["DatabaseOut"];

function AppRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[58px] shrink-0 flex-col items-center bg-[#1f5aa6] py-2 text-white lg:flex">
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-white text-sm font-black text-[#1f5aa6]">
        V
      </div>
      <nav className="flex w-full flex-1 flex-col gap-1 px-1.5">
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
              className={`flex h-[54px] flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold transition ${
                active ? "bg-white text-[#1f5aa6]" : "hover:bg-white/10"
              }`}
            >
              <item.icon className="size-[18px]" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <Link
        href="/settings/people"
        className="flex h-[54px] flex-col items-center justify-center gap-1 text-[10px] font-semibold"
      >
        <Users className="size-[18px]" />
        Invite
      </Link>
    </aside>
  );
}

function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = workspaces.find((workspace) => workspace.id === activeId);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-black/[0.04]"
        aria-expanded={open}
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#00a99d] text-xs font-bold text-white">
          {(active?.name ?? "V").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {active?.name ?? "Select workspace"}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close workspace menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 right-0 top-10 z-50 rounded-lg border bg-popover p-1 shadow-lg">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => {
                  onSelect(workspace.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="truncate">{workspace.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {workspace.role}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResourceTree({
  spaces,
  folders,
  databases,
}: {
  spaces: Space[];
  folders: FolderType[];
  databases: Db[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Spaces
        </span>
        <Link
          href="/databases"
          title="Create database"
          className="rounded p-1 hover:bg-muted"
        >
          <Plus className="size-4" />
        </Link>
      </div>
      {spaces.map((space) => {
        const open = expanded[space.id] ?? true;
        const spaceFolders = folders.filter(
          (folder) => folder.space_id === space.id,
        );
        const folderIds = new Set(spaceFolders.map((folder) => folder.id));
        const rootDatabases = databases.filter(
          (database) =>
            database.folder_id === null || !folderIds.has(database.folder_id),
        );
        return (
          <div key={space.id} className="mb-1">
            <button
              type="button"
              onClick={() =>
                setExpanded((value) => ({ ...value, [space.id]: !open }))
              }
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted"
            >
              {open ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span>{space.icon ?? "🗂️"}</span>
              <span className="truncate">{space.name}</span>
            </button>
            {open && (
              <div className="ml-3 border-l pl-2">
                {spaceFolders.map((folder) => (
                  <div key={folder.id}>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                      <Folder className="size-3.5" />
                      <span className="truncate">{folder.name}</span>
                    </div>
                    {databases
                      .filter((database) => database.folder_id === folder.id)
                      .map((database) => (
                        <DatabaseLink key={database.id} database={database} />
                      ))}
                  </div>
                ))}
                {rootDatabases.map((database) => (
                  <DatabaseLink key={database.id} database={database} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!spaces.length && (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          No spaces in this workspace.
        </p>
      )}
    </div>
  );
}

function DatabaseLink({ database }: { database: Db }) {
  const pathname = usePathname();
  const active = pathname === `/databases/${database.id}`;
  return (
    <Link
      href={`/databases/${database.id}`}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        active
          ? "bg-[#e8f1ff] font-medium text-[#1264d7]"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Database className="size-3.5" />
      <span className="truncate">{database.name}</span>
    </Link>
  );
}

function ContextSidebar({
  workspaces,
  activeId,
  onSelectWorkspace,
  spaces,
  folders,
  databases,
  onClose,
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelectWorkspace: (id: string) => void;
  spaces: Space[];
  folders: FolderType[];
  databases: Db[];
  onClose: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r bg-sidebar shadow-xl lg:static lg:w-[260px] lg:shadow-none">
      <div className="border-b p-2">
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeId={activeId}
          onSelect={onSelectWorkspace}
        />
      </div>
      <div className="p-2">
        <Link
          href="/databases"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-[#0b8ff3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#087bd1]"
        >
          <Plus className="size-4" /> Create
        </Link>
      </div>
      <div className="px-2 pb-2">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
        >
          <LayoutDashboard className="size-4 text-violet-600" />
          Overview
        </Link>
      </div>
      <ResourceTree
        spaces={spaces}
        folders={folders}
        databases={databases}
      />
      <div className="border-t p-2">
        <Link
          href="/settings/people"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
        >
          <Settings className="size-4" /> Workspace settings
        </Link>
      </div>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={onClose}
        className="absolute right-2 top-2 rounded p-1 hover:bg-muted lg:hidden"
      >
        <PanelLeftClose className="size-4" />
      </button>
    </aside>
  );
}

function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const router = useRouter();
  return (
    <header className="flex h-[42px] shrink-0 items-center gap-3 border-b bg-card px-3">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="rounded p-1 hover:bg-muted lg:hidden"
      >
        <Menu className="size-4" />
      </button>
      <div className="mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-full border bg-background px-3 text-muted-foreground">
        <Search className="size-3.5" />
        <span className="text-xs">Search anything…</span>
        <kbd className="ml-auto text-[10px]">⌘ K</kbd>
      </div>
      <button type="button" title="AI assistant" className="rounded p-1.5 hover:bg-muted">
        <Sparkles className="size-4 text-violet-600" />
      </button>
      <NotificationBell />
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
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <LogOut className="size-4" />
      </button>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
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
      router.replace("/login");
    }
  }, [error, router]);

  const enabled = Boolean(selectedWorkspaceId);
  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace-me", selectedWorkspaceId],
    queryFn: () => apiFetch<Workspace>("/workspaces/me"),
    enabled,
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

  function changeWorkspace(id: string) {
    selectWorkspace(id);
    setActiveWorkspaceId(id);
    queryClient.clear();
    router.push("/");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppRail />
      <div className="relative flex min-w-0 flex-1">
        <div
          className={`${mobileOpen ? "block" : "hidden"} lg:block`}
        >
          {mobileOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/25 lg:hidden"
            />
          )}
          <ContextSidebar
            workspaces={workspaces}
            activeId={selectedWorkspaceId}
            onSelectWorkspace={changeWorkspace}
            spaces={spaces}
            folders={folders}
            databases={databases}
            onClose={() => setMobileOpen(false)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenSidebar={() => setMobileOpen(true)} />
          <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-card">
            <div className="sr-only">{workspace?.name}</div>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
