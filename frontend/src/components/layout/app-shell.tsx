"use client";

import {
  Check,
  FaIcon,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from "@/components/ui/fa-icon";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiFetch,
  ApiError,
  clearWorkspaceSelection,
  getWorkspaceId,
  selectWorkspace,
} from "@/lib/api/client";
import { clearToken, getToken } from "@/lib/auth";
import type { components } from "@/lib/api/schema";
import {
  PRODUCT_MODULES,
  type ProductModule,
  type RemoteContextNavigationPayload,
} from "@/modules/registry";
import { NotificationBell } from "@/components/notifications/notification-bell";

type Membership = components["schemas"]["MembershipOut"];
type Workspace = components["schemas"]["WorkspaceOut"];
type User = components["schemas"]["UserOut"];

function userInitials(user?: User) {
  return (user?.full_name ?? user?.email ?? "VHB")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join("")
    .toUpperCase();
}

function AccountMenu({
  workspaces,
  activeId,
  onSelect,
  user,
  variant = "rail",
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelect: (id: string) => void;
  user?: User;
  variant?: "rail" | "sidebar";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const active = workspaces.find((workspace) => workspace.id === activeId);
  const initials = userInitials(user);

  async function logout() {
    try {
      await apiFetch<void>("/auth/logout", { method: "POST" });
    } finally {
      clearToken();
      router.push("/login");
    }
  }

  return (
    <div className={variant === "rail" ? "relative" : "relative w-full"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Open user menu. Current workspace: ${active?.name ?? "none"}`}
        title={user?.full_name ?? user?.email ?? "Account"}
        className={
          variant === "rail"
            ? "group flex h-[48px] w-[44px] flex-col items-center justify-center gap-0.5 rounded-md text-[9px] font-medium text-white/85 hover:bg-[var(--app-rail-hover)] hover:text-white"
            : "flex h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
        }
      >
        <span
          className={
            variant === "rail"
              ? "flex size-7 items-center justify-center rounded-full bg-white text-[9px] font-bold text-[#0b5caf] shadow-sm ring-1 ring-white/35 transition-transform group-hover:scale-[1.04]"
              : "flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0b5caf] text-[9px] font-bold text-white"
          }
        >
          {initials}
        </span>
        {variant === "rail" ? (
          <span className="w-full truncate px-0.5 text-center leading-none">
            Account
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {user?.full_name ?? "VHB user"}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {active?.name ?? user?.email ?? "Account"}
            </span>
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close user menu"
            className="fixed inset-0 z-[80] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className={`vhb-popover-shadow fixed z-[90] w-[272px] rounded-lg border bg-popover p-1 ${
              variant === "rail"
                ? "bottom-2 left-[calc(var(--app-rail-width)+0.5rem)]"
                : "bottom-12 left-2 max-w-[calc(100vw-1rem)]"
            }`}
          >
            <div className="flex items-center gap-2 border-b px-2 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0b5caf] text-[10px] font-bold text-white">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {user?.full_name ?? "VHB user"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user?.email}
                </p>
              </div>
              <NotificationBell placement="account" />
            </div>

            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold text-muted-foreground">
              Workspace
            </p>
            <div className="max-h-40 overflow-y-auto">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect(workspace.id);
                    setOpen(false);
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {workspace.name}
                  </span>
                  <span className="text-[9px] uppercase text-muted-foreground">
                    {workspace.role}
                  </span>
                  <Check
                    className={`size-3 text-primary ${
                      workspace.id === activeId ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              ))}
              {workspaces.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No workspace access.
                </p>
              )}
            </div>

            <div className="mt-1 border-t pt-1">
              <Link
                href="/settings/people"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
              >
                <Users className="size-3.5 text-muted-foreground" />
                Invite people
              </Link>
              <Link
                href="/settings/account"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
              >
                <Settings className="size-3.5 text-muted-foreground" />
                Account settings
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-destructive hover:bg-destructive/10"
              >
                <LogOut className="size-3.5" />
                Log out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AppRail({
  workspaces,
  activeId,
  onSelectWorkspace,
  user,
  modules,
}: {
  workspaces: Membership[];
  activeId: string | null;
  onSelectWorkspace: (id: string) => void;
  user?: User;
  modules: ProductModule[];
}) {
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
      <nav
        aria-label="Global navigation"
        className="flex min-h-0 w-full flex-1 flex-col gap-0.5 overflow-y-auto px-1"
      >
        {modules.map((item) => {
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
              className="group flex h-[48px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-[8px] font-medium text-white/85 hover:bg-[var(--app-rail-hover)] hover:text-white"
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
              <span className="w-full whitespace-nowrap px-0.5 text-center leading-none">
                {item.railLabel ?? item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <AccountMenu
        workspaces={workspaces}
        activeId={activeId}
        onSelect={onSelectWorkspace}
        user={user}
      />
    </aside>
  );
}

function RemoteContextNavigation({
  module,
  payload,
  isPending,
  error,
  onRetry,
}: {
  module: ProductModule;
  payload?: RemoteContextNavigationPayload;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const pathname = usePathname();
  const descriptor = module.contextNavigation;
  if (descriptor.kind !== "remote") return null;

  if (isPending) {
    return (
      <div aria-label="Loading navigation" className="space-y-2 px-3 py-3">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-8 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-2 mt-2 rounded-md border border-destructive/20 bg-destructive/5 p-3">
        <p className="text-xs font-medium">Navigation is unavailable.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 h-8 rounded-md border bg-card px-2 text-xs font-medium hover:bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!payload?.enabled || payload.destinations.length === 0) {
    return (
      <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
        This module is not available in the selected workspace.
      </p>
    );
  }

  return (
    <>
      <nav
        aria-label={`${module.label} navigation`}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1"
      >
        {payload.destinations
          .toSorted((left, right) => left.order - right.order)
          .map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-xs ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <FaIcon name={item.icon} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {descriptor.resolveLabel(item.label_key)}
                </span>
                {item.badge_count !== null ? (
                  <span
                    aria-label={`${item.badge_count} pending`}
                    className="min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground"
                  >
                    {item.badge_count}
                  </span>
                ) : null}
              </Link>
            );
          })}
      </nav>
      <p className="border-t border-sidebar-border px-3 py-2 text-[10px] text-muted-foreground">
        Updated {new Date(payload.as_of).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </>
  );
}

function ContextSidebar({
  onClose,
  activeModule,
  globalModules,
  remoteContext,
  remotePending,
  remoteError,
  onRetryRemote,
  workspaceName,
  onNavigate,
  mobileAccount,
}: {
  onClose: () => void;
  activeModule?: ProductModule;
  globalModules: ProductModule[];
  remoteContext?: RemoteContextNavigationPayload;
  remotePending: boolean;
  remoteError: unknown;
  onRetryRemote: () => void;
  workspaceName?: string;
  onNavigate: () => void;
  mobileAccount?: React.ReactNode;
}) {
  const navigation = activeModule?.contextNavigation ?? {
    kind: "global-links" as const,
  };
  return (
    <aside
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) onNavigate();
      }}
      className="fixed inset-y-0 left-0 z-[60] flex w-[min(18rem,calc(100vw-2rem))] flex-col border-r border-sidebar-border bg-sidebar shadow-xl lg:static lg:z-auto lg:h-full lg:w-[var(--context-sidebar-width)] lg:shadow-none"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 rounded-br-lg border-b border-sidebar-border bg-card px-2 shadow-sm">
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
          {activeModule?.label ?? "Home"}
        </h2>
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PanelLeftClose className="size-3.5" />
        </button>
      </div>

      <nav aria-label="Mobile global navigation" className="grid grid-cols-4 gap-1 border-y px-2 py-2 lg:hidden">
        {globalModules.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={onClose}
            className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <item.icon className="size-4" />
            <span className="w-full truncate text-center">
              {item.railLabel ?? item.label}
            </span>
          </Link>
        ))}
      </nav>

      {navigation.kind === "remote" && activeModule ? (
        <RemoteContextNavigation
          module={activeModule}
          payload={remoteContext}
          isPending={remotePending}
          error={remoteError}
          onRetry={onRetryRemote}
        />
      ) : (
        <nav
          aria-label={`${activeModule?.label ?? "Application"} navigation`}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1"
        >
          {globalModules.map((item) => (
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
      {mobileAccount && (
        <div className="border-t border-sidebar-border p-2 lg:hidden">
          {mobileAccount}
        </div>
      )}
      <span className="sr-only">{workspaceName}</span>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const activeModule = PRODUCT_MODULES.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const contextSidebarEnabled = activeModule?.contextNavigation.kind !== "none";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
        setActiveWorkspaceId(memberships[0].id);
      }
      return memberships;
    },
    retry: false,
  });

  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? null;
  const remoteModules = PRODUCT_MODULES.filter(
    (module) => module.contextNavigation.kind === "remote",
  );
  const remoteContextQueries = useQueries({
    queries: remoteModules.map((module) => ({
      queryKey: [
        module.contextNavigation.kind === "remote"
          ? module.contextNavigation.queryKey
          : module.id,
        selectedWorkspaceId,
      ],
      queryFn: () => {
        if (module.contextNavigation.kind !== "remote") {
          throw new Error("Remote context descriptor expected");
        }
        return apiFetch<RemoteContextNavigationPayload>(
          module.contextNavigation.endpoint,
        );
      },
      enabled: Boolean(selectedWorkspaceId),
    })),
  });
  const remoteContextByModule = new Map(
    remoteModules.map((module, index) => [
      module.id,
      remoteContextQueries[index],
    ]),
  );
  const availableModules = PRODUCT_MODULES.filter((module) => {
    if (module.contextNavigation.kind !== "remote") return true;
    return remoteContextByModule.get(module.id)?.data?.enabled === true;
  });
  const activeRemoteContext = activeModule
    ? remoteContextByModule.get(activeModule.id)
    : undefined;

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
      <AppRail
        workspaces={workspaces}
        activeId={selectedWorkspaceId}
        onSelectWorkspace={changeWorkspace}
        user={user}
        modules={availableModules}
      />
      {contextSidebarEnabled && <div className={`${mobileOpen ? "block" : "hidden"} ${sidebarOpen ? "lg:block" : "lg:hidden"}`}>
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-50 bg-black/25 lg:hidden"
          />
        )}
        <ContextSidebar
          onClose={closeSidebar}
          activeModule={activeModule}
          globalModules={availableModules}
          remoteContext={activeRemoteContext?.data}
          remotePending={activeRemoteContext?.isPending ?? false}
          remoteError={activeRemoteContext?.error}
          onRetryRemote={() => {
            void activeRemoteContext?.refetch();
          }}
          workspaceName={workspace?.name}
          onNavigate={() => setMobileOpen(false)}
          mobileAccount={
            <AccountMenu
              workspaces={workspaces}
              activeId={selectedWorkspaceId}
              onSelect={changeWorkspace}
              user={user}
              variant="sidebar"
            />
          }
        />
      </div>}
      {contextSidebarEnabled && !mobileOpen && (
        <button
          type="button"
          onClick={openSidebar}
          aria-label="Open navigation"
          title="Open navigation"
          className="fixed left-2 top-2 z-40 flex size-7 items-center justify-center rounded-md border bg-card/95 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-3.5" />
        </button>
      )}
      {contextSidebarEnabled && !sidebarOpen && (
        <button
          type="button"
          onClick={openSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="fixed left-[calc(var(--app-rail-width)+0.375rem)] top-1.5 z-40 hidden size-7 items-center justify-center rounded-md border bg-card/95 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground lg:flex"
        >
          <PanelLeftOpen className="size-3.5" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
          <div className="sr-only">{workspace?.name}</div>
          {children}
        </main>
      </div>
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
