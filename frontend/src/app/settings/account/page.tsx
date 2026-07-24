"use client";

import { Link2, Mail, Unlink } from "@/components/ui/fa-icon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";

type Identity = { id: string; provider: string; email: string };
type Preferences = { in_app_enabled: boolean; email_enabled: boolean };

export default function AccountSettingsPage() {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const { data: identities = [] } = useQuery<Identity[]>({
    queryKey: ["identities"],
    queryFn: () => apiFetch<Identity[]>("/auth/identities"),
  });
  const { data: preferences } = useQuery<Preferences>({
    queryKey: ["notification-preferences", workspaceId],
    queryFn: () =>
      apiFetch<Preferences>("/notifications/preferences"),
  });
  const google = identities.find((identity) => identity.provider === "google");
  const linkGoogle = useMutation({
    mutationFn: (credential: string) =>
      apiFetch<Identity>("/auth/google/link", {
        method: "POST",
        body: JSON.stringify({ credential }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["identities"] }),
  });
  const unlinkGoogle = useMutation({
    mutationFn: () =>
      apiFetch("/auth/identities/google", { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["identities"] }),
  });
  const savePreferences = useMutation({
    mutationFn: (next: Preferences) =>
      apiFetch<Preferences>("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(next),
      }),
    onSuccess: (next) =>
      queryClient.setQueryData(
        ["notification-preferences", workspaceId],
        next,
      ),
  });

  return (
    <AppShell>
      <div className="min-h-full">
        <header className="border-b px-6 py-5">
          <h1 className="text-lg font-semibold">Account settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign-in methods and notification delivery.
          </p>
        </header>
        <main className="mx-auto max-w-3xl space-y-5 p-6">
          <section className="rounded-xl border bg-card">
            <header className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Connected accounts</h2>
            </header>
            <div className="flex items-center gap-4 p-5">
              <span className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Link2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Google</p>
                <p className="truncate text-xs text-muted-foreground">
                  {google?.email ?? "Not connected"}
                </p>
              </div>
              {google ? (
                <button
                  type="button"
                  onClick={() => unlinkGoogle.mutate()}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs hover:bg-muted"
                >
                  <Unlink className="size-3.5" /> Disconnect
                </button>
              ) : (
                <GoogleSignIn
                  text="signin_with"
                  onCredential={(credential) => linkGoogle.mutate(credential)}
                />
              )}
            </div>
          </section>
          <section className="rounded-xl border bg-card">
            <header className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Notifications</h2>
            </header>
            <div className="divide-y">
              {preferences &&
                [
                  {
                    key: "in_app_enabled" as const,
                    label: "In-app notifications",
                    description: "Show updates in the notification bell.",
                  },
                  {
                    key: "email_enabled" as const,
                    label: "Email notifications",
                    description: "Send notification emails through configured SMTP.",
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center gap-4 px-5 py-4"
                  >
                    <Mail className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={preferences[item.key]}
                      onChange={(event) =>
                        savePreferences.mutate({
                          ...preferences,
                          [item.key]: event.target.checked,
                        })
                      }
                      className="size-4 accent-primary"
                    />
                  </label>
                ))}
            </div>
          </section>
        </main>
      </div>
    </AppShell>
  );
}
