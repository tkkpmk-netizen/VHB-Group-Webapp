"use client";

import {
  Bell,
  ChevronDown,
  Download,
  KeyRound,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  Workflow,
} from "@/components/ui/fa-icon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Member = components["schemas"]["MemberOut"];
type Role = components["schemas"]["MemberRole"];

const settingsSections = [
  {
    label: "Admin",
    items: [
      { label: "General", icon: Settings },
      { label: "People", icon: Users, active: true },
      { label: "Security & Permissions", icon: ShieldCheck },
      { label: "Audit Logs", icon: Workflow },
    ],
  },
  {
    label: "Features",
    items: [
      { label: "Custom Field Manager", icon: SlidersHorizontal },
      { label: "Automations Manager", icon: Workflow },
    ],
  },
  {
    label: "My Settings",
    items: [
      { label: "Preferences", icon: SlidersHorizontal },
      { label: "Notifications", icon: Bell },
      { label: "Access tokens", icon: KeyRound },
    ],
  },
];

function RoleMenu({
  member,
  onChange,
}: {
  member: Member;
  onChange: (role: Role) => void;
}) {
  const [open, setOpen] = useState(false);
  const locked = member.role === "owner";
  return (
    <div className="relative">
      <button
        type="button"
        disabled={locked}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize hover:bg-muted disabled:cursor-default"
      >
        {member.role}
        {!locked && <ChevronDown className="size-3" />}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close role menu"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-8 z-50 min-w-32 rounded-lg border bg-popover p-1 shadow-lg">
            {(["admin", "editor", "viewer"] as Role[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => {
                  onChange(role);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-2.5 py-2 text-left text-sm capitalize hover:bg-muted"
              >
                {role}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function PeopleSettingsPage() {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [search, setSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => apiFetch<Member[]>("/workspaces/me/members"),
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return members;
    return members.filter(
      (member) =>
        member.email.toLowerCase().includes(needle) ||
        member.full_name?.toLowerCase().includes(needle),
    );
  }, [members, search]);

  const invite = useMutation({
    mutationFn: (email: string) =>
      apiFetch<Member>("/workspaces/me/members", {
        method: "POST",
        body: JSON.stringify({ email, role: "editor" }),
      }),
    onSuccess: () => {
      setInviteEmail("");
      setShowInvite(false);
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-me"] });
    },
  });
  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiFetch<Member>(`/workspaces/me/members/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] }),
  });

  return (
    <AppShell>
      <div className="flex min-h-full">
        <aside className="hidden w-64 shrink-0 border-r bg-[#fbfbfc] p-4 xl:block">
          <h1 className="mb-5 text-base font-semibold">All settings</h1>
          <nav className="space-y-5">
            {settingsSections.map((section) => (
              <div key={section.label}>
                <p className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">
                  {section.label}
                </p>
                {section.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                      item.active
                        ? "bg-[#dcecff] font-medium text-[#1264d7]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 p-5 md:p-8 xl:p-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Manage people</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Control workspace access and roles.
                </p>
              </div>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                <Download className="size-4" /> Export
              </button>
            </div>

            <div className="mb-4 flex flex-col gap-2 rounded-lg border p-2 sm:flex-row">
              <label className="flex min-w-0 flex-1 items-center gap-2 px-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowInvite((value) => !value)}
                className="flex items-center justify-center gap-2 rounded-md bg-[#0b8ff3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#087bd1]"
              >
                <UserPlus className="size-4" /> Invite people
              </button>
            </div>

            {showInvite && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (inviteEmail.trim()) invite.mutate(inviteEmail.trim());
                }}
                className="mb-4 flex gap-2 rounded-lg border bg-[#f8fbff] p-3"
              >
                <input
                  autoFocus
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="Existing user's email"
                  className="h-9 min-w-0 flex-1 rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!inviteEmail.trim() || invite.isPending}
                  className="rounded-md bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            )}

            <div className="mb-2 inline-flex rounded-full bg-[#e8f2ff] px-3 py-1 text-xs font-medium text-[#1264d7]">
              All users ({members.length})
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[minmax(180px,1.4fr)_minmax(200px,1.4fr)_120px] border-b bg-[#fafbfc] px-4 py-2.5 text-xs font-medium text-muted-foreground">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
              </div>
              {isLoading && (
                <p className="p-5 text-sm text-muted-foreground">Loading people…</p>
              )}
              {filtered.map((member) => (
                <div
                  key={member.id}
                  className="grid grid-cols-[minmax(180px,1.4fr)_minmax(200px,1.4fr)_120px] items-center border-b px-4 py-3 last:border-b-0 hover:bg-[#fafcff]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#242424] text-xs font-semibold text-white">
                      {(member.full_name ?? member.email).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {member.full_name ?? "Unnamed user"}
                    </span>
                  </div>
                  <span className="truncate text-sm text-muted-foreground">
                    {member.email}
                  </span>
                  <RoleMenu
                    member={member}
                    onChange={(role) =>
                      updateRole.mutate({ id: member.id, role })
                    }
                  />
                </div>
              ))}
              {!isLoading && !filtered.length && (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No people match this search.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
