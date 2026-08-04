"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, Loader2, Plus, Trash2, Upload } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { Field, InlineProblem, Job, StatusPill, WorkbenchHeader, fieldClass } from "@/modules/commercial/workbench";

type Line = { sku: string; product_name: string; packing: string; quantity: number; unit: string; unit_price: number };
type Snapshot = { schema_version: "1.0"; order_number: string; issue_date: string; seller_legal_name: string; seller_address: string; customer_name: string; customer_address: string; currency: string; payment_terms: string; incoterm: string; destination: string; lines: Line[]; notes: string };
type UploadResponse = { asset: { id: string }; upload_url: string };
const SELECTED_PRODUCTS_DRAFT_KEY = "vhb:order-list:selected-products";

const line = (index: number): Line => ({ sku: `VHB-${String(index + 1).padStart(3, "0")}`, product_name: index ? "Vietnamese FMCG product" : "Instant coffee 3-in-1", packing: "20 sachets × 24 boxes", quantity: 100 + index * 10, unit: "CTN", unit_price: 18.5 + index });
const initialSnapshot = (): Snapshot => ({ schema_version: "1.0", order_number: `OL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-01`, issue_date: new Date().toISOString().slice(0, 10), seller_legal_name: "VIHABA TRADE AND IMPORT EXPORT COMPANY LIMITED", seller_address: "Hanoi, Vietnam", customer_name: "Ava Trading Company", customer_address: "Customer delivery address", currency: "USD", payment_terms: "30% deposit, 70% before shipment", incoterm: "FOB", destination: "Port of destination", lines: [line(0), line(1), line(2)], notes: "Commercial review sample — replace with approved order data." });

export function RenderLabWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rendering, setRendering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const job = useQuery<Job>({ queryKey: ["commercial", "render-job", jobId], queryFn: () => apiFetch(`/jobs/${jobId}`), enabled: Boolean(jobId), refetchInterval: (query) => ["queued", "running", "retrying"].includes(query.state.data?.status ?? "") ? 1500 : false });
  const total = useMemo(() => snapshot.lines.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0), [snapshot.lines]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SELECTED_PRODUCTS_DRAFT_KEY);
    if (!stored) return;
    try {
      const selected = JSON.parse(stored) as Array<Line & { entity_id?: string }>;
      if (!Array.isArray(selected) || selected.length < 2) return;
      window.setTimeout(() => {
        window.sessionStorage.removeItem(SELECTED_PRODUCTS_DRAFT_KEY);
        setSnapshot((current) => ({
          ...current,
          lines: selected.map(({ sku, product_name, packing, quantity, unit, unit_price }) => ({
            sku,
            product_name,
            packing,
            quantity,
            unit,
            unit_price,
          })),
          notes: `Created from ${selected.length} selected products. Complete quantities and approved pricing before rendering.`,
        }));
      }, 0);
    } catch {
      // Ignore malformed transient drafts and keep the normal starter snapshot.
    }
  }, []);

  const update = (key: keyof Snapshot, value: Snapshot[keyof Snapshot]) => setSnapshot((current) => ({ ...current, [key]: value }));
  const updateLine = (index: number, key: keyof Line, value: string | number) => setSnapshot((current) => ({ ...current, lines: current.lines.map((item, row) => row === index ? { ...item, [key]: value } : item) }));

  async function render() {
    setRendering(true); setError(null);
    try {
      const body = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      const upload = await apiFetch<UploadResponse>("/assets/uploads", { method: "POST", body: JSON.stringify({ filename: `${snapshot.order_number}.json`, content_type: "application/json", size_bytes: body.size }) });
      const uploadResponse = await fetch(upload.upload_url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      if (!uploadResponse.ok) throw new Error(`Object upload failed (${uploadResponse.status})`);
      await apiFetch(`/assets/${upload.asset.id}/complete`, { method: "POST" });
      const created = await apiFetch<Job>("/jobs", { method: "POST", body: JSON.stringify({ type: "file.inspect", payload: { asset_id: upload.asset.id, operation: "document.order_list.render" }, idempotency_key: crypto.randomUUID(), progress_total: 2 }) });
      setJobId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["commercial", "jobs"] });
    } catch (caught) { setError(caught); } finally { setRendering(false); }
  }

  async function downloadArtifact(index: number) {
    try { const result = await apiFetch<{ download_url: string }>(`/jobs/${jobId}/artifacts/${index}/download`); window.open(result.download_url, "_blank", "noopener,noreferrer"); } catch (caught) { setError(caught); }
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => { try { const value = JSON.parse(String(reader.result)) as Snapshot; if (!Array.isArray(value.lines) || !value.lines.length) throw new Error("Order List needs at least one line"); setSnapshot(value); setError(null); } catch (caught) { setError(caught); } };
    reader.readAsText(file);
  }

  const artifacts = job.data?.result?.artifacts ?? [];
  return <div className="flex min-h-full flex-col bg-[#f7f8fa] pb-12">
    {embedded ? <div className="flex min-h-14 items-center justify-between border-b bg-background px-5"><div><h2 className="text-sm font-semibold">Order List Render</h2><p className="text-[11px] text-muted-foreground">Generate reviewable XLSX and PDF artifacts from a governed snapshot.</p></div><div className="flex items-center gap-2"><input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importJson(file); }}/><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload className="size-3.5"/>Import JSON</Button><Button size="sm" onClick={() => void render()} disabled={rendering}>{rendering ? <Loader2 className="size-3.5 animate-spin"/> : <FileSpreadsheet className="size-3.5"/>}Render</Button></div></div> : <WorkbenchHeader eyebrow="Order Management" title="Order List Render" description="Create a governed snapshot, render it in the isolated worker, then inspect and download the XLSX/PDF artifacts." actions={<><input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importJson(file); }}/><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload className="size-3.5"/>Import JSON</Button><Button size="sm" onClick={() => void render()} disabled={rendering}>{rendering ? <Loader2 className="size-3.5 animate-spin"/> : <FileSpreadsheet className="size-3.5"/>}Render</Button></>} />}
    <InlineProblem error={error}/>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(540px,1fr)_380px]">
      <section className="min-w-0 overflow-auto border-r bg-background p-5">
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Order number"><input className={fieldClass} value={snapshot.order_number} onChange={(e) => update("order_number", e.target.value)}/></Field><Field label="Issue date"><input type="date" className={fieldClass} value={snapshot.issue_date} onChange={(e) => update("issue_date", e.target.value)}/></Field><Field label="Currency"><input className={fieldClass} maxLength={3} value={snapshot.currency} onChange={(e) => update("currency", e.target.value.toUpperCase())}/></Field><Field label="Seller legal name"><input className={fieldClass} value={snapshot.seller_legal_name} onChange={(e) => update("seller_legal_name", e.target.value)}/></Field><Field label="Customer"><input className={fieldClass} value={snapshot.customer_name} onChange={(e) => update("customer_name", e.target.value)}/></Field><Field label="Incoterm / destination"><div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={snapshot.incoterm} onChange={(e) => update("incoterm", e.target.value)}/><input className={fieldClass} value={snapshot.destination} onChange={(e) => update("destination", e.target.value)}/></div></Field></div>
        <div className="mt-5 flex items-center justify-between"><div><h2 className="text-xs font-semibold">Order lines</h2><p className="text-[10px] text-muted-foreground">{snapshot.lines.length} item lines · values are materialized, never formulas</p></div><Button variant="outline" size="sm" onClick={() => setSnapshot((current) => ({ ...current, lines: [...current.lines, line(current.lines.length)] }))}><Plus className="size-3"/>Add line</Button></div>
        <div className="mt-3 overflow-auto rounded-lg border"><table className="w-full min-w-[820px] border-collapse text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="w-8 px-2 py-2 text-right">#</th><th className="px-2 py-2 text-left">SKU</th><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Packing</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-left">Unit</th><th className="px-2 py-2 text-right">Unit price</th><th className="w-8"/></tr></thead><tbody>{snapshot.lines.map((item, index) => <tr key={`${index}-${item.sku}`} className="border-t"><td className="px-2 py-1.5 text-right text-muted-foreground">{index + 1}</td><td className="p-1"><input className={fieldClass} value={item.sku} onChange={(e) => updateLine(index, "sku", e.target.value)}/></td><td className="p-1"><input className={fieldClass} value={item.product_name} onChange={(e) => updateLine(index, "product_name", e.target.value)}/></td><td className="p-1"><input className={fieldClass} value={item.packing} onChange={(e) => updateLine(index, "packing", e.target.value)}/></td><td className="p-1"><input type="number" className={`${fieldClass} text-right`} value={item.quantity} onChange={(e) => updateLine(index, "quantity", Number(e.target.value))}/></td><td className="p-1"><input className={fieldClass} value={item.unit} onChange={(e) => updateLine(index, "unit", e.target.value)}/></td><td className="p-1"><input type="number" step="0.01" className={`${fieldClass} text-right`} value={item.unit_price} onChange={(e) => updateLine(index, "unit_price", Number(e.target.value))}/></td><td><button type="button" className="flex size-8 items-center justify-center text-muted-foreground hover:text-rose-600" onClick={() => setSnapshot((current) => ({ ...current, lines: current.lines.filter((_, row) => row !== index) }))}><Trash2 className="size-3"/></button></td></tr>)}</tbody></table></div>
      </section>
      <aside className="overflow-auto bg-slate-100/70 p-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-xs font-semibold">Document preview</h2><p className="text-[10px] text-muted-foreground">Approximate A4 preview · authoritative output is generated server-side</p></div>{job.data ? <StatusPill value={job.data.status}/> : null}</div><div className="min-h-[600px] bg-white p-8 shadow-sm ring-1 ring-slate-200"><h2 className="text-center text-lg font-bold text-slate-800">ORDER LIST / BẢNG ĐẶT HÀNG</h2><div className="mt-7 grid grid-cols-2 gap-6 text-[9px]"><div><b>Seller / Người bán</b><p>{snapshot.seller_legal_name}</p><p>{snapshot.seller_address}</p></div><div><b>Order No.</b><p>{snapshot.order_number}</p><p>{snapshot.issue_date} · {snapshot.currency} · {snapshot.incoterm}</p></div><div><b>Customer / Khách hàng</b><p>{snapshot.customer_name}</p><p>{snapshot.customer_address}</p></div><div><b>Destination</b><p>{snapshot.destination}</p></div></div><table className="mt-6 w-full text-[8px]"><thead className="bg-[#1f4e78] text-white"><tr><th className="p-1">No.</th><th className="p-1 text-left">SKU</th><th className="p-1 text-left">Product</th><th className="p-1 text-right">Qty</th><th className="p-1 text-right">Amount</th></tr></thead><tbody>{snapshot.lines.slice(0, 14).map((item, index) => <tr key={index} className="border-b"><td className="p-1 text-center">{index + 1}</td><td className="p-1">{item.sku}</td><td className="p-1">{item.product_name}</td><td className="p-1 text-right">{item.quantity} {item.unit}</td><td className="p-1 text-right">{(item.quantity * item.unit_price).toFixed(2)}</td></tr>)}</tbody><tfoot><tr className="font-bold"><td colSpan={4} className="p-2 text-right">TOTAL {snapshot.currency}</td><td className="p-2 text-right">{total.toFixed(2)}</td></tr></tfoot></table>{snapshot.lines.length > 14 ? <p className="mt-2 text-center text-[8px] text-muted-foreground">+ {snapshot.lines.length - 14} lines on following pages</p> : null}</div>{job.data?.status === "succeeded" ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{artifacts.map((artifact, index) => artifact.content_type.includes("spreadsheet") || artifact.content_type === "application/pdf" ? <Button key={artifact.object_key} variant="outline" size="sm" onClick={() => void downloadArtifact(index)}><Download className="size-3.5"/>Download {artifact.content_type === "application/pdf" ? "PDF" : "XLSX"}</Button> : null)}</div> : null}{job.data?.status === "failed" ? <InlineProblem error={new Error(job.data.error ?? "Render failed")}/> : null}</aside>
    </div>
  </div>;
}
