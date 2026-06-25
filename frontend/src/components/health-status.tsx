"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Health = components["schemas"]["HealthResponse"];

export function HealthStatus() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health"),
  });

  const dotColor = isError
    ? "bg-destructive"
    : data?.status === "ok"
      ? "bg-emerald-500"
      : "bg-muted-foreground";

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className={`size-2.5 rounded-full ${dotColor}`} />
      <div className="text-sm">
        <p className="font-medium">Backend API</p>
        <p className="text-muted-foreground">
          {isLoading
            ? "Đang kiểm tra…"
            : isError
              ? "Không kết nối được"
              : `${data?.service} · v${data?.version} · ${data?.status}`}
        </p>
      </div>
    </div>
  );
}
