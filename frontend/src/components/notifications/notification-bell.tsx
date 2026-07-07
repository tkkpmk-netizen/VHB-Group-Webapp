"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";

type Notification = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [open, setOpen] = useState(false);
  const { data: unread = { count: 0 } } = useQuery<{ count: number }>({
    queryKey: ["notification-unread", workspaceId],
    queryFn: () => apiFetch<{ count: number }>("/notifications/unread-count"),
    enabled: Boolean(workspaceId),
    refetchInterval: 15_000,
  });
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["notifications", workspaceId],
    queryFn: () => apiFetch<Notification[]>("/notifications"),
    enabled: open,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
    queryClient.invalidateQueries({
      queryKey: ["notification-unread", workspaceId],
    });
  };
  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () =>
      apiFetch("/notifications/read-all", { method: "POST" }),
    onSuccess: refresh,
  });

  return (
    <div className="relative">
      <button
        type="button"
        title="Notifications"
        aria-label={`${unread.count} unread notifications`}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded p-1.5 hover:bg-muted"
      >
        <Bell className="size-4" />
        {unread.count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread.count > 99 ? "99+" : unread.count}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <section className="absolute right-0 top-9 z-50 w-96 overflow-hidden rounded-xl border bg-popover shadow-xl">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              <button
                type="button"
                disabled={!unread.count}
                onClick={() => markAll.mutate()}
                className="flex items-center gap-1 text-xs text-primary disabled:opacity-40"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            </header>
            <div className="max-h-96 overflow-y-auto">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    if (!notification.read_at) markRead.mutate(notification.id);
                  }}
                  className={`block w-full border-b px-4 py-3 text-left last:border-0 hover:bg-muted/50 ${
                    notification.read_at ? "" : "bg-blue-50/60"
                  }`}
                >
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {notification.body}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {new Date(notification.created_at).toLocaleString()}
                  </p>
                </button>
              ))}
              {!notifications.length && (
                <p className="p-10 text-center text-xs text-muted-foreground">
                  No notifications.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
