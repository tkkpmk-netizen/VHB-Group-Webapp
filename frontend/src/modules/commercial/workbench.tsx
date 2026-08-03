"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Check, ChevronDown, FaIcon, Loader2, RefreshCw, X } from "@/components/ui/fa-icon";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api/client";

export type Job = {
  id: string;
  type: string;
  status: string;
  progress_current: number;
  progress_total: number | null;
  progress_message: string | null;
  error: string | null;
  result: { artifacts?: Array<{ content_type: string; size_bytes: number; object_key: string }> } | null;
  created_at: string;
};

type AuditEvent = { id: string; action: string; resource_type: string; resource_id: string | null; created_at: string };

export function WorkbenchHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="flex min-h-[78px] items-center justify-between gap-4 border-b bg-background px-5 py-3">
    <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-[.08em] text-muted-foreground">{eyebrow}</p><h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-.02em]">{title}</h1><p className="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{description}</p></div>
    <div className="flex shrink-0 items-center gap-2">{actions}</div>
  </header>;
}

export function StatusPill({ value }: { value: string }) {
  const tone = value.includes("fail") || value.includes("reject") || value.includes("conflict") ? "bg-rose-50 text-rose-700 ring-rose-200" : value.includes("pending") || value.includes("review") || value.includes("oral") || value.includes("queue") ? "bg-amber-50 text-amber-700 ring-amber-200" : value.includes("active") || value.includes("verified") || value.includes("approved") || value.includes("succeed") || value.includes("promoted") ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-600 ring-slate-200";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ring-inset ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export function EmptyState({ icon = "inbox", title, body }: { icon?: string; title: string; body: string }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-8 text-center"><span className="flex size-10 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground"><FaIcon name={icon} className="size-4" /></span><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p></div>;
}

export function InlineProblem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const conflict = apiError?.problem?.conflict;
  return <div role="alert" className="m-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-3.5 text-rose-600"/><div className="min-w-0 flex-1"><p className="font-semibold">{apiError?.status === 409 ? "This record changed while you were editing" : "Action could not be completed"}</p><p className="mt-1 text-rose-800/80">{error instanceof Error ? error.message : "Unknown error"}</p>{conflict ? <p className="mt-1">Server version: {String(conflict.current_version)} · Refresh and compare: {conflict.changed_fields.map((field) => field.path).join(", ")}</p> : null}</div>{onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}</div></div>;
}

export function OverlayPanel({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className={`max-h-[88vh] w-full overflow-auto rounded-xl border bg-background shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}><header className="sticky top-0 z-10 flex items-start justify-between border-b bg-background px-5 py-4"><div><h2 className="text-sm font-semibold">{title}</h2>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</div><button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-md hover:bg-muted"><X className="size-3.5"/></button></header><div className="p-5">{children}</div></section></div>;
}

export const fieldClass = "h-9 w-full rounded-md border bg-background px-3 text-xs outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
export const areaClass = "min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-foreground">{label}</span>{children}{hint ? <span className="mt-1 block text-[10px] text-muted-foreground">{hint}</span> : null}</label>;
}

export function AuditHistory({ compact = false }: { compact?: boolean }) {
  const query = useQuery<AuditEvent[]>({ queryKey: ["commercial", "audit"], queryFn: () => apiFetch("/audit-events?limit=30"), refetchInterval: 15000 });
  return <div className={compact ? "" : "border-t"}><div className="flex items-center justify-between px-4 py-3"><h3 className="text-xs font-semibold">Audit history</h3><button type="button" onClick={() => void query.refetch()} className="text-muted-foreground hover:text-foreground"><RefreshCw className="size-3"/></button></div><div className="max-h-52 overflow-auto border-t">{query.data?.length ? query.data.map((event) => <div key={event.id} className="flex gap-2 border-b px-4 py-2.5 text-[11px] last:border-0"><span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-sky-500"/><div className="min-w-0"><p className="truncate font-medium">{event.action.replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-muted-foreground">{event.resource_type} · {new Date(event.created_at).toLocaleString()}</p></div></div>) : <p className="px-4 py-8 text-center text-xs text-muted-foreground">No commercial changes recorded yet.</p>}</div></div>;
}

export function JobTray() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const jobs = useQuery<Job[]>({ queryKey: ["commercial", "jobs"], queryFn: () => apiFetch("/jobs?limit=20"), refetchInterval: 2500 });
  const visible = jobs.data?.filter((job) => job.type === "file.inspect" || job.type.startsWith("commercial.")) ?? [];
  const active = visible.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length;
  const retry = async (id: string) => { await apiFetch(`/jobs/${id}/retry`, { method: "POST" }); await queryClient.invalidateQueries({ queryKey: ["commercial", "jobs"] }); };
  return <aside className="fixed bottom-0 right-4 z-[90] w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-t-xl border bg-background shadow-[0_-10px_35px_rgba(15,23,42,.12)]"><button type="button" onClick={() => setOpen(!open)} className="flex h-11 w-full items-center justify-between px-4 text-xs font-semibold"><span className="flex items-center gap-2">{active ? <Loader2 className="size-3.5 animate-spin"/> : <Check className="size-3.5 text-emerald-600"/>}Background jobs {active ? `· ${active} active` : "· idle"}</span><ChevronDown className={`size-3 transition ${open ? "rotate-180" : ""}`}/></button>{open ? <div className="max-h-72 overflow-auto border-t">{visible.length ? visible.map((job) => <div key={job.id} className="border-b px-4 py-3 last:border-0"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{job.type === "file.inspect" ? "Order List render" : job.type}</p><StatusPill value={job.status}/></div><p className="mt-1 truncate text-[10px] text-muted-foreground">{job.progress_message ?? job.error ?? job.id}</p>{job.progress_total ? <div className="mt-2 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-sky-500" style={{ width: `${Math.min(100, job.progress_current / job.progress_total * 100)}%` }}/></div> : null}{["failed", "cancelled"].includes(job.status) ? <button type="button" onClick={() => void retry(job.id)} className="mt-2 text-[10px] font-semibold text-sky-700">Retry job</button> : null}</div>) : <p className="px-4 py-8 text-center text-xs text-muted-foreground">No jobs yet. Render an Order List to create one.</p>}</div> : null}</aside>;
}
