"use client";

import {
  LayoutDashboard,
  Database,
  CheckSquare,
  Settings,
  Search,
  Bell,
  LogOut,
  PanelLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api/client";
import { clearToken, getToken } from "@/lib/auth";
import type { components } from "@/lib/api/schema";

type Workspace = components["schemas"]["WorkspaceOut"];

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/", enabled: true },
  { label: "Databases", icon: Database, href: "/databases", enabled: true },
  { label: "Tasks", icon: CheckSquare, href: "/tasks", enabled: false },
  { label: "Settings", icon: Settings, href: "/settings", enabled: false },
];

function Sidebar({ workspaceName }: { workspaceName?: string }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
          V
        </div>
        <span className="truncate text-lg font-bold">
          {workspaceName ?? "VHB Super App"}
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-4 py-2">
        {navItems.map((item) => {
          if (!item.enabled) {
            return (
              <span
                key={item.label}
                title="Sắp có"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground/50"
              >
                <item.icon className="size-5" />
                {item.label}
                <span className="ml-auto text-xs">Sắp có</span>
              </span>
            );
          }
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-muted"
              }`}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const router = useRouter();
  function logout() {
    clearToken();
    router.push("/login");
  }
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          title="Ẩn/hiện sidebar"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        >
          <PanelLeft className="size-5" />
        </button>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground">
          <Search className="size-4" />
          <span className="text-sm">Search…</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Bell className="size-5 text-muted-foreground" />
        <div className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          VH
        </div>
        <button
          onClick={logout}
          title="Đăng xuất"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <LogOut className="size-4" />
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Route guard: no token → straight to login.
  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Validate session + fetch current workspace.
  const { data: workspace, error } = useQuery<Workspace>({
    queryKey: ["workspace-me"],
    queryFn: () => apiFetch<Workspace>("/workspaces/me"),
    retry: false,
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      router.replace("/login");
    }
  }, [error, router]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!collapsed && <Sidebar workspaceName={workspace?.name} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
