"use client";

import { Check, ChevronDown, RotateCcw, Search, Share2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Member = components["schemas"]["MemberOut"];
type ResourceRole = "manager" | "editor" | "viewer";
type ResourceType = "database" | "document" | "dashboard";
type Grant = {
  id: string;
  workspace_id: string;
  resource_type: ResourceType;
  resource_id: string;
  user_id: string;
  role: ResourceRole;
};

export function ResourceAccess({
  resourceType,
  resourceId,
  resourceLabel,
}: {
  resourceType: ResourceType;
  resourceId: string;
  resourceLabel: string;
}) {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuUser, setMenuUser] = useState<string | null>(null);
  const queryKey = ["resource-grants", resourceType, resourceId];
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => apiFetch<Member[]>("/workspaces/me/members"),
    enabled: open,
  });
  const grantsQuery = useQuery<Grant[]>({
    queryKey,
    queryFn: () =>
      apiFetch<Grant[]>(`/resource-grants/${resourceType}/${resourceId}`),
    enabled: open,
    retry: false,
  });
  const grants = useMemo(() => grantsQuery.data ?? [], [grantsQuery.data]);
  const grantByUser = useMemo(
    () => Object.fromEntries(grants.map((grant) => [grant.user_id, grant])),
    [grants],
  );
  const visible = members.filter((member) => {
    const needle = search.trim().toLowerCase();
    return (
      !needle ||
      member.email.toLowerCase().includes(needle) ||
      member.full_name?.toLowerCase().includes(needle)
    );
  });
  const saveGrant = useMutation<
    Grant | void,
    Error,
    { userId: string; role: ResourceRole | null }
  >({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: ResourceRole | null;
    }) =>
      role
        ? apiFetch<Grant>(
            `/resource-grants/${resourceType}/${resourceId}`,
            {
              method: "PUT",
              body: JSON.stringify({ user_id: userId, role }),
            },
          )
        : apiFetch<void>(
            `/resource-grants/${resourceType}/${resourceId}/${userId}`,
            { method: "DELETE" },
          ),
    onSuccess: () => {
      setMenuUser(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <Share2 className="size-3.5" /> Share
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/25 px-4 pt-[12vh]"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="Close access dialog"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${resourceLabel} access`}
            className="relative z-10 w-full max-w-lg rounded-xl border bg-card shadow-2xl"
          >
            <header className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">{resourceLabel} access</h2>
                <p className="text-xs text-muted-foreground">
                  Resource roles override each member&apos;s workspace role.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="p-4">
              {grantsQuery.isError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Only resource managers can change access.
                </div>
              ) : (
                <>
                  <label className="mb-3 flex items-center gap-2 rounded-md border px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Find workspace member"
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </label>
                  <div className="max-h-80 divide-y overflow-y-auto">
                    {visible.map((member) => {
                      const resourceRole = grantByUser[member.id]?.role;
                      const effective = resourceRole ?? member.role;
                      return (
                        <div
                          key={member.id}
                          className="flex items-center gap-3 py-3"
                        >
                          <span className="flex size-8 items-center justify-center rounded-full bg-[#242424] text-xs font-semibold text-white">
                            {(member.full_name ?? member.email)
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {member.full_name ?? member.email}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {resourceRole
                                ? `${resourceLabel} override · ${member.email}`
                                : `Workspace ${member.role} · ${member.email}`}
                            </p>
                          </div>
                          <div className="relative">
                            <button
                              type="button"
                              disabled={
                                member.role === "owner" ||
                                saveGrant.isPending
                              }
                              onClick={() =>
                                setMenuUser((value) =>
                                  value === member.id ? null : member.id,
                                )
                              }
                              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs capitalize hover:bg-muted disabled:border-transparent"
                            >
                              {effective} <ChevronDown className="size-3" />
                            </button>
                            {menuUser === member.id && (
                              <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border bg-popover p-1 shadow-lg">
                                {resourceRole && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      saveGrant.mutate({
                                        userId: member.id,
                                        role: null,
                                      })
                                    }
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                                  >
                                    <RotateCcw className="size-3.5" />
                                    Workspace default
                                  </button>
                                )}
                                {(
                                  [
                                    "manager",
                                    "editor",
                                    "viewer",
                                  ] as ResourceRole[]
                                ).map((role) => (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() =>
                                      saveGrant.mutate({
                                        userId: member.id,
                                        role,
                                      })
                                    }
                                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm capitalize hover:bg-muted"
                                  >
                                    {role}
                                    {resourceRole === role && (
                                      <Check className="size-3.5" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
