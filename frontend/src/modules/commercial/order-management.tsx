"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown, MultiDropdown } from "@/components/ui/dropdown";
import {
  Check,
  FaIcon,
  FileText,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { RenderLabWorkspace } from "@/modules/commercial/render-lab";
import {
  EmptyState,
  Field,
  InlineProblem,
  OverlayPanel,
  StatusPill,
  fieldClass,
} from "@/modules/commercial/workbench";

type Tab = "overview" | "inquiries" | "quotations" | "orders" | "payments" | "render";
type Summary = {
  open_inquiries: number;
  active_quotations: number;
  orders_awaiting_release: number;
  unconfirmed_receipts: number;
};
type Inquiry = {
  id: string;
  number: string;
  title: string;
  customer_name: string;
  customer_entity_id: string;
  supplier_entity_ids: string[];
  product_requests: InquiryProductRequest[];
  source: string | null;
  status: string;
  requested_at: string;
  due_at: string | null;
  notes: string | null;
  version: number;
};
type MasterOption = { id: string; uid: string; name: string; kind: string };
type InquiryProductRequest = {
  mode: "catalog" | "manual";
  product_entity_id: string | null;
  manual_description: string;
  quantity: number;
  unit: string;
  target_price: number | null;
  product_name?: string;
  sku?: string;
};
type QuoteLine = {
  sku?: string;
  product_name?: string;
  product_entity_id: string;
  supplier_entity_id: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
};
type QuoteVersion = {
  id: string;
  version_no: number;
  status: string;
  currency: string;
  issue_date: string;
  legal_profile: string;
  customer_snapshot: { name?: string };
  lines: QuoteLine[];
  total: string;
};
type Quotation = { id: string; number: string; inquiry_id: string; latest: QuoteVersion };
type Order = {
  id: string;
  number: string;
  quotation_version_id: string;
  status: string;
  customer_snapshot: { name?: string };
  payment_terms_snapshot: { milestones?: Array<{ id: string; label: string; percentage: string; release_gate: boolean }> };
  currency: string;
  total: string;
  version: number;
  released_at: string | null;
  supplier_entity_ids: string[];
};
type Profile = { id: string; name: string; legal_profile: string; required_evidence_types: string[]; version: number };
type PaymentTerms = { id: string; name: string; version: number; currency: string; payment_method: string; milestones: Array<{ id: string; label: string; percentage: string; release_gate: boolean }> };
type Receipt = { id: string; bank_reference: string; amount: string; allocated_amount: string; unallocated_amount: string; currency: string; value_date: string; receiving_account: string; status: string; version: number };
type Allocation = { id: string; receipt_id: string; sales_order_id: string; milestone_id: string; amount: string; reversal_of_id: string | null; reversed: boolean; reason: string | null; created_at: string };

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "tachometer-alt" },
  { id: "inquiries", label: "Inquiries", icon: "inbox" },
  { id: "quotations", label: "Quotations", icon: "file-alt" },
  { id: "orders", label: "Sales Orders", icon: "clipboard-list" },
  { id: "payments", label: "Payments", icon: "money-check-alt" },
  { id: "render", label: "Order List Render", icon: "file-excel.1" },
];
const TODAY = new Date().toISOString().slice(0, 10);
const NOW_LOCAL = new Date().toISOString().slice(0, 16);
const queryKeys = [
  ["order-management", "summary"],
  ["order-management", "inquiries"],
  ["order-management", "quotations"],
  ["order-management", "orders"],
  ["order-management", "profiles"],
  ["order-management", "payment-terms"],
  ["order-management", "receipts"],
  ["order-management", "allocations"],
  ["order-management", "masters", "products"],
  ["order-management", "masters", "customers"],
  ["order-management", "masters", "suppliers"],
] as const;

function masterOptions(items: MasterOption[]) {
  return items.map((item) => ({ value: item.id, label: `${item.uid} · ${item.name}` }));
}

function money(value: string | number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
}

function idempotent(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  };
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="border-r px-5 py-4 last:border-r-0"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-[-.04em]">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

function TableHeader({ children }: { children: React.ReactNode }) {
  return <th className="border-b bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function useActionMutation({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiFetch(path, idempotent(body)),
    onSuccess: async () => {
      await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      onDone();
    },
  });
}

function InquiryForm({ close, products, customers, suppliers }: { close: () => void; products: MasterOption[]; customers: MasterOption[]; suppliers: MasterOption[] }) {
  const [form, setForm] = useState({ number: "", title: "", customer_entity_id: customers[0]?.id ?? "", supplier_entity_ids: [] as string[], source: "Website", requested_at: NOW_LOCAL, notes: "" });
  const [requests, setRequests] = useState<InquiryProductRequest[]>([{ mode: "catalog", product_entity_id: products[0]?.id ?? null, manual_description: "", quantity: 1, unit: "CTN", target_price: null }]);
  const mutation = useActionMutation({ onDone: close });
  const updateRequest = (index: number, patch: Partial<InquiryProductRequest>) => setRequests((current) => current.map((item, row) => row === index ? { ...item, ...patch } : item));
  return <OverlayPanel wide title="New Inquiry / Sourcing Request" description="Customer and supplier references come from master databases. Only a product missing from Products may be provisional." onClose={close}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: "/commercial/order-management/inquiries", body: { ...form, product_requests: requests, requested_at: new Date(form.requested_at).toISOString() } }); }}>
      <div className="grid grid-cols-2 gap-3"><Field label="Inquiry number"><input required className={fieldClass} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}/></Field><Field label="Received at"><input required type="datetime-local" className={fieldClass} value={form.requested_at} onChange={(e) => setForm({ ...form, requested_at: e.target.value })}/></Field></div>
      <Field label="Customer · Customers database"><Dropdown searchable value={form.customer_entity_id} allowClear={false} options={masterOptions(customers)} onChange={(value) => value && setForm({ ...form, customer_entity_id: value })}/></Field>
      <Field label="Preferred suppliers · Suppliers database"><MultiDropdown searchable values={form.supplier_entity_ids} options={masterOptions(suppliers)} placeholder="Select suppliers if known" onChange={(values) => setForm({ ...form, supplier_entity_ids: values })}/></Field>
      <Field label="Request title"><input required className={fieldClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/></Field>
      <Field label="Acquisition source"><Dropdown value={form.source} allowClear={false} options={["Website", "Alibaba", "Hotline", "Email", "Referral", "Existing customer"].map((value) => ({ value, label: value }))} onChange={(value) => value && setForm({ ...form, source: value })}/></Field>
      <div><div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold">Requested products</p><p className="text-[10px] text-muted-foreground">Use Manual / provisional only when the item is not yet in Products.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setRequests([...requests, { mode: "catalog", product_entity_id: products[0]?.id ?? null, manual_description: "", quantity: 1, unit: "CTN", target_price: null }])}><Plus className="size-3"/>Add product</Button></div><div className="grid gap-2">{requests.map((item, index) => <div key={index} className="grid grid-cols-[150px_minmax(220px,1fr)_90px_80px_110px] gap-2 rounded-md border p-2"><Dropdown value={item.mode} allowClear={false} options={[{ value: "catalog", label: "Products database" }, { value: "manual", label: "Manual / provisional" }]} onChange={(value) => value && updateRequest(index, { mode: value as "catalog" | "manual", product_entity_id: value === "catalog" ? (products[0]?.id ?? null) : null, manual_description: "" })}/>{item.mode === "catalog" ? <Dropdown searchable value={item.product_entity_id ?? ""} allowClear={false} options={masterOptions(products)} onChange={(value) => value && updateRequest(index, { product_entity_id: value })}/> : <input required className={fieldClass} placeholder="Describe the missing product" value={item.manual_description} onChange={(event) => updateRequest(index, { manual_description: event.target.value })}/>}<input required aria-label="Quantity" type="number" min="0.0001" step="any" className={fieldClass} value={item.quantity} onChange={(event) => updateRequest(index, { quantity: Number(event.target.value) })}/><input required aria-label="Unit" className={fieldClass} value={item.unit} onChange={(event) => updateRequest(index, { unit: event.target.value })}/><input aria-label="Target price" type="number" min="0" step="any" className={fieldClass} placeholder="Target price" value={item.target_price ?? ""} onChange={(event) => updateRequest(index, { target_price: event.target.value ? Number(event.target.value) : null })}/></div>)}</div></div>
      <Field label="Notes"><textarea className={`${fieldClass} min-h-20 py-2`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></Field>
      <InlineProblem error={mutation.error}/>{!customers.length || !products.length ? <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">Add at least one Customer and Product in their master database before creating a catalog-backed Inquiry.</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={!form.customer_entity_id || requests.some((item) => item.mode === "catalog" && !item.product_entity_id) || mutation.isPending}>Create Inquiry</Button></div>
    </form>
  </OverlayPanel>;
}

function QuotationForm({ inquiries, products, suppliers, close, base }: { inquiries: Inquiry[]; products: MasterOption[]; suppliers: MasterOption[]; close: () => void; base?: Quotation }) {
  const [inquiryId, setInquiryId] = useState(base?.inquiry_id ?? inquiries[0]?.id ?? "");
  const [number, setNumber] = useState(base?.number ?? "");
  const [currency, setCurrency] = useState(base?.latest.currency ?? "USD");
  const [legalProfile, setLegalProfile] = useState(base?.latest.legal_profile ?? "VIHABA");
  const [lines, setLines] = useState<QuoteLine[]>(base?.latest.lines ?? [{ product_entity_id: products[0]?.id ?? "", supplier_entity_id: null, quantity: 1, unit: "CTN", unit_price: 0 }]);
  const mutation = useActionMutation({ onDone: close });
  const updateLine = (index: number, patch: Partial<QuoteLine>) => setLines((current) => current.map((line, row) => row === index ? { ...line, ...patch } : line));
  return <OverlayPanel wide title={base ? `New version of ${base.number}` : "New Quotation"} description={base ? "The issued version remains immutable and this revision starts as a new draft." : "The first immutable quotation version is created from these snapshotted lines."} onClose={close}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const cleanLines = lines.map(({ product_entity_id, supplier_entity_id, quantity, unit, unit_price }) => ({ product_entity_id, supplier_entity_id, quantity, unit, unit_price })); const versionBody = { currency, issue_date: TODAY, legal_profile: legalProfile, lines: cleanLines }; mutation.mutate({ path: base ? `/commercial/order-management/quotations/${base.id}/versions` : "/commercial/order-management/quotations", body: base ? versionBody : { ...versionBody, inquiry_id: inquiryId, number } }); }}>
      <div className="grid grid-cols-2 gap-3"><Field label="Inquiry"><Dropdown searchable value={inquiryId} allowClear={false} options={inquiries.map((item) => ({ value: item.id, label: `${item.number} · ${item.customer_name}` }))} onChange={(value) => value && setInquiryId(value)}/></Field><Field label="Quotation number"><input required className={fieldClass} value={number} onChange={(e) => setNumber(e.target.value)}/></Field><Field label="Currency"><Dropdown value={currency} allowClear={false} options={["USD", "EUR", "VND"].map((value) => ({ value, label: value }))} onChange={(value) => value && setCurrency(value)}/></Field><Field label="Seller legal profile"><Dropdown value={legalProfile} allowClear={false} options={[{ value: "VIHABA", label: "Vihaba (M-Pacific / Vihaba)" }, { value: "DP", label: "DP" }]} onChange={(value) => value && setLegalProfile(value)}/></Field></div>
      <div><div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold">Quotation lines</p><p className="text-[10px] text-muted-foreground">Products are master records; manual product names are not accepted.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, { product_entity_id: products[0]?.id ?? "", supplier_entity_id: null, quantity: 1, unit: "CTN", unit_price: 0 }])}><Plus className="size-3"/>Add line</Button></div><div className="max-h-72 overflow-auto rounded-md border"><table className="w-full min-w-[760px] text-xs"><thead><tr>{["Product · Products database", "Supplier", "Quantity", "Unit", "Unit price", "Amount"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{lines.map((line, index) => <tr key={index} className="border-b last:border-0"><td className="min-w-64 p-1"><Dropdown searchable value={line.product_entity_id} allowClear={false} options={masterOptions(products)} onChange={(value) => value && updateLine(index, { product_entity_id: value })}/></td><td className="min-w-48 p-1"><Dropdown searchable value={line.supplier_entity_id ?? ""} placeholder="Optional supplier" options={masterOptions(suppliers)} onChange={(value) => updateLine(index, { supplier_entity_id: value })}/></td><td className="p-1"><input required type="number" min="0.0001" step="any" className={fieldClass} value={line.quantity} onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}/></td><td className="p-1"><input required className={fieldClass} value={line.unit} onChange={(e) => updateLine(index, { unit: e.target.value })}/></td><td className="p-1"><input required type="number" min="0" step="any" className={fieldClass} value={line.unit_price} onChange={(e) => updateLine(index, { unit_price: Number(e.target.value) })}/></td><td className="px-3 text-right font-medium">{money(line.quantity * line.unit_price, currency)}</td></tr>)}</tbody></table></div></div>
      <InlineProblem error={mutation.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={!inquiryId || lines.some((line) => !line.product_entity_id) || mutation.isPending}>{base ? `Create draft v${base.latest.version_no + 1}` : "Create draft v1"}</Button></div>
    </form>
  </OverlayPanel>;
}

function GovernanceForm({ close }: { close: () => void }) {
  const [profileName, setProfileName] = useState("Vihaba export PO");
  const [evidenceType, setEvidenceType] = useState("customer_po");
  const [termsName, setTermsName] = useState("50% deposit / 50% balance");
  const [deposit, setDeposit] = useState(50);
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setError(null);
    try {
      await apiFetch("/commercial/order-management/requirement-profiles", idempotent({ name: profileName, legal_profile: "VIHABA", transaction_type: "export", required_evidence_types: [evidenceType] }));
      await apiFetch("/commercial/order-management/payment-terms", idempotent({ name: termsName, payment_method: "bank_transfer", currency: "USD", milestones: [{ id: "deposit", label: "Deposit", percentage: deposit, due_rule: "on_acceptance", release_gate: true }, { id: "balance", label: "Balance", percentage: 100 - deposit, due_rule: "before_final_documents", release_gate: false }], allow_partial: true }));
      await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key }))); close();
    } catch (caught) { setError(caught); } finally { setSaving(false); }
  }
  return <OverlayPanel title="Commercial controls" description="Create versioned document requirements and Payment Terms used by Sales Orders." onClose={close}><div className="grid gap-5"><section className="grid gap-3"><h3 className="text-xs font-semibold">Document requirement profile</h3><Field label="Profile name"><input className={fieldClass} value={profileName} onChange={(e) => setProfileName(e.target.value)}/></Field><Field label="Required acceptance evidence"><Dropdown value={evidenceType} allowClear={false} options={[{ value: "customer_po", label: "Customer PO" }, { value: "signed_contract", label: "Signed Sales Contract" }, { value: "accepted_pi", label: "Accepted PI" }, { value: "acceptance_email", label: "Acceptance email" }]} onChange={(value) => value && setEvidenceType(value)}/></Field></section><section className="grid gap-3 border-t pt-4"><h3 className="text-xs font-semibold">Payment Terms</h3><Field label="Terms name"><input className={fieldClass} value={termsName} onChange={(e) => setTermsName(e.target.value)}/></Field><Field label="Procurement release deposit (%)"><input type="number" min="1" max="99" className={fieldClass} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))}/></Field></section><InlineProblem error={error}/><div className="flex justify-end gap-2"><Button variant="outline" onClick={close}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>Save versions</Button></div></div></OverlayPanel>;
}

function EvidenceForm({ quote, close }: { quote: Quotation; close: () => void }) {
  const [type, setType] = useState("customer_po");
  const [subject, setSubject] = useState("");
  const [sender, setSender] = useState("");
  const mutation = useActionMutation({ onDone: close });
  return <OverlayPanel title="Capture acceptance evidence" description="This creates immutable evidence linked to the accepted quotation version." onClose={close}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: "/commercial/order-management/evidence", body: { record_type: "quotation_version", record_id: quote.latest.id, evidence_type: type, source_key: `manual-${crypto.randomUUID()}`, subject, sender, occurred_at: new Date().toISOString(), metadata: { quotation_number: quote.number } } }); }}><Field label="Evidence type"><Dropdown value={type} allowClear={false} options={[{ value: "customer_po", label: "Customer PO" }, { value: "signed_contract", label: "Signed Sales Contract" }, { value: "accepted_pi", label: "Accepted PI" }, { value: "acceptance_email", label: "Acceptance email" }]} onChange={(value) => value && setType(value)}/></Field><Field label="Email / document subject"><input required className={fieldClass} value={subject} onChange={(e) => setSubject(e.target.value)}/></Field><Field label="Sender"><input className={fieldClass} type="email" value={sender} onChange={(e) => setSender(e.target.value)}/></Field><InlineProblem error={mutation.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit">Capture evidence</Button></div></form></OverlayPanel>;
}

function OrderForm({ quotes, profiles, terms, suppliers, close }: { quotes: Quotation[]; profiles: Profile[]; terms: PaymentTerms[]; suppliers: MasterOption[]; close: () => void }) {
  const accepted = quotes.filter((quote) => quote.latest.status === "accepted");
  const [quoteId, setQuoteId] = useState(accepted[0]?.latest.id ?? "");
  const selected = accepted.find((quote) => quote.latest.id === quoteId);
  const matchingProfiles = profiles.filter((profile) => profile.legal_profile === selected?.latest.legal_profile);
  const [profileId, setProfileId] = useState(matchingProfiles[0]?.id ?? profiles[0]?.id ?? "");
  const [termsId, setTermsId] = useState(terms[0]?.id ?? "");
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [number, setNumber] = useState("");
  const mutation = useActionMutation({ onDone: close });
  return <OverlayPanel title="Create Sales Order" description="Customer and products are inherited from the accepted quotation; suppliers must come from Suppliers." onClose={close}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: "/commercial/order-management/orders", body: { number, quotation_version_id: quoteId, requirement_profile_id: profileId, payment_terms_id: termsId, supplier_entity_ids: supplierIds } }); }}><Field label="Accepted quotation"><Dropdown searchable value={quoteId} allowClear={false} options={accepted.map((quote) => ({ value: quote.latest.id, label: `${quote.number} · ${quote.latest.customer_snapshot.name ?? "Customer"}` }))} onChange={(value) => value && setQuoteId(value)}/></Field>{selected ? <div className="rounded-md border bg-slate-50 p-3 text-xs"><p className="font-medium">{selected.latest.customer_snapshot.name}</p><p className="mt-1 text-muted-foreground">{selected.latest.lines.map((line) => `${line.sku ?? "Product"} · ${line.product_name ?? "Master record"}`).join(", ")}</p></div> : null}<Field label="Suppliers · Suppliers database"><MultiDropdown searchable values={supplierIds} options={masterOptions(suppliers)} placeholder="Select at least one supplier" onChange={setSupplierIds}/></Field><Field label="Sales Order number"><input required className={fieldClass} value={number} onChange={(event) => setNumber(event.target.value)}/></Field><Field label="Document requirement profile"><Dropdown value={profileId} allowClear={false} options={profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · v${profile.version}` }))} onChange={(value) => value && setProfileId(value)}/></Field><Field label="Payment Terms"><Dropdown value={termsId} allowClear={false} options={terms.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} onChange={(value) => value && setTermsId(value)}/></Field><InlineProblem error={mutation.error}/>{!accepted.length ? <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">No accepted quotation is available.</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={!quoteId || !profileId || !termsId || !supplierIds.length || mutation.isPending}>Create Sales Order</Button></div></form></OverlayPanel>;
}

function ReceiptForm({ close }: { close: () => void }) {
  const [form, setForm] = useState({ bank_reference: "", amount: 0, currency: "USD", value_date: TODAY, receiving_account: "Vihaba USD" });
  const mutation = useActionMutation({ onDone: close });
  return <OverlayPanel title="Record payment receipt" description="A bank slip is evidence; this receipt remains pending until credited funds are confirmed." onClose={close}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: "/commercial/order-management/receipts", body: form }); }}><Field label="Bank reference"><input required className={fieldClass} value={form.bank_reference} onChange={(e) => setForm({ ...form, bank_reference: e.target.value })}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Amount"><input required type="number" min="0.01" step="any" className={fieldClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}/></Field><Field label="Currency"><Dropdown value={form.currency} allowClear={false} options={["USD", "EUR", "VND"].map((value) => ({ value, label: value }))} onChange={(value) => value && setForm({ ...form, currency: value })}/></Field><Field label="Value date"><input required type="date" className={fieldClass} value={form.value_date} onChange={(e) => setForm({ ...form, value_date: e.target.value })}/></Field><Field label="Receiving account"><input required className={fieldClass} value={form.receiving_account} onChange={(e) => setForm({ ...form, receiving_account: e.target.value })}/></Field></div><InlineProblem error={mutation.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit">Record receipt</Button></div></form></OverlayPanel>;
}

function AllocationForm({ receipt, orders, close }: { receipt: Receipt; orders: Order[]; close: () => void }) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const order = orders.find((item) => item.id === orderId);
  const milestones = order?.payment_terms_snapshot.milestones ?? [];
  const [milestoneId, setMilestoneId] = useState(milestones[0]?.id ?? "deposit");
  const [amount, setAmount] = useState(Number(receipt.unallocated_amount));
  const mutation = useActionMutation({ onDone: close });
  return <OverlayPanel title="Allocate confirmed funds" description={`${receipt.bank_reference} · ${money(receipt.unallocated_amount, receipt.currency)} unallocated`} onClose={close}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: "/commercial/order-management/allocations", body: { receipt_id: receipt.id, sales_order_id: orderId, milestone_id: milestoneId, amount } }); }}><Field label="Sales Order"><Dropdown searchable value={orderId} allowClear={false} options={orders.filter((item) => item.currency === receipt.currency).map((item) => ({ value: item.id, label: `${item.number} · ${item.customer_snapshot.name ?? "Customer"}` }))} onChange={(value) => value && setOrderId(value)}/></Field><Field label="Payment milestone"><Dropdown value={milestoneId} allowClear={false} options={milestones.map((item) => ({ value: item.id, label: `${item.label} · ${item.percentage}%` }))} onChange={(value) => value && setMilestoneId(value)}/></Field><Field label={`Amount (${receipt.currency})`}><input type="number" min="0.01" max={receipt.unallocated_amount} step="any" className={fieldClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))}/></Field><InlineProblem error={mutation.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={!orderId || !milestoneId}>Allocate funds</Button></div></form></OverlayPanel>;
}

function ReversalForm({ allocation, close }: { allocation: Allocation; close: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useActionMutation({ onDone: close });
  return <OverlayPanel title="Reverse payment allocation" description="The original allocation remains immutable. A compensating negative allocation will be added." onClose={close}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate({ path: `/commercial/order-management/allocations/${allocation.id}/reverse`, body: { reason } }); }}><Field label="Original amount"><input disabled className={fieldClass} value={allocation.amount}/></Field><Field label="Mandatory reason"><textarea required className={`${fieldClass} min-h-24 py-2`} value={reason} onChange={(event) => setReason(event.target.value)}/></Field><InlineProblem error={mutation.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" variant="destructive" disabled={!reason.trim() || mutation.isPending}>Create reversal</Button></div></form></OverlayPanel>;
}

export function OrderManagementWorkspace({ initialTab = "overview" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [modal, setModal] = useState<string | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [selectedAllocation, setSelectedAllocation] = useState<Allocation | null>(null);
  const queryClient = useQueryClient();
  const summary = useQuery<Summary>({ queryKey: queryKeys[0], queryFn: () => apiFetch("/commercial/order-management/summary") });
  const inquiries = useQuery<Inquiry[]>({ queryKey: queryKeys[1], queryFn: () => apiFetch("/commercial/order-management/inquiries") });
  const quotations = useQuery<Quotation[]>({ queryKey: queryKeys[2], queryFn: () => apiFetch("/commercial/order-management/quotations") });
  const orders = useQuery<Order[]>({ queryKey: queryKeys[3], queryFn: () => apiFetch("/commercial/order-management/orders") });
  const profiles = useQuery<Profile[]>({ queryKey: queryKeys[4], queryFn: () => apiFetch("/commercial/order-management/requirement-profiles") });
  const terms = useQuery<PaymentTerms[]>({ queryKey: queryKeys[5], queryFn: () => apiFetch("/commercial/order-management/payment-terms") });
  const receipts = useQuery<Receipt[]>({ queryKey: queryKeys[6], queryFn: () => apiFetch("/commercial/order-management/receipts") });
  const allocations = useQuery<Allocation[]>({ queryKey: queryKeys[7], queryFn: () => apiFetch("/commercial/order-management/allocations") });
  const products = useQuery<MasterOption[]>({ queryKey: queryKeys[8], queryFn: () => apiFetch("/commercial/order-management/master-options/products?limit=20000") });
  const customers = useQuery<MasterOption[]>({ queryKey: queryKeys[9], queryFn: () => apiFetch("/commercial/order-management/master-options/customers?limit=500") });
  const suppliers = useQuery<MasterOption[]>({ queryKey: queryKeys[10], queryFn: () => apiFetch("/commercial/order-management/master-options/suppliers?limit=500") });
  const action = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => apiFetch(path, idempotent(body)), onSuccess: () => Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key }))) });
  const dataError = summary.error ?? inquiries.error ?? quotations.error ?? orders.error ?? receipts.error ?? allocations.error ?? products.error ?? customers.error ?? suppliers.error;
  const overview = summary.data ?? { open_inquiries: 0, active_quotations: 0, orders_awaiting_release: 0, unconfirmed_receipts: 0 };
  const totalPipeline = useMemo(() => (quotations.data ?? []).filter((quote) => quote.latest.status !== "rejected").reduce((sum, quote) => sum + Number(quote.latest.total), 0), [quotations.data]);
  const refresh = () => Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
  const primaryAction = tab === "inquiries" ? <Button size="sm" onClick={() => setModal("inquiry")}><Plus className="size-3"/>New Inquiry</Button> : tab === "quotations" ? <Button size="sm" onClick={() => setModal("quotation")}><Plus className="size-3"/>New Quotation</Button> : tab === "orders" ? <Button size="sm" onClick={() => setModal("order")}><Plus className="size-3"/>Create Sales Order</Button> : tab === "payments" ? <Button size="sm" onClick={() => setModal("receipt")}><Plus className="size-3"/>Record receipt</Button> : null;

  return <div className="flex min-h-full flex-col bg-[#f7f8fa]">
    <header className="border-b bg-background"><div className="flex min-h-[78px] flex-col items-stretch justify-between gap-3 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[.08em] text-muted-foreground">Commercial operations</p><h1 className="mt-0.5 text-lg font-semibold tracking-[-.02em]">Order Management</h1><p className="mt-0.5 text-xs text-muted-foreground">Shared workspace for Sales, Purchasing, Documentation and management.</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setModal("governance")}><ShieldCheck className="size-3.5"/>Controls</Button><Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="size-3.5"/>Refresh</Button>{primaryAction}</div></div><nav className="flex h-10 items-end gap-1 overflow-x-auto px-5">{tabs.map((item) => <button type="button" key={item.id} onClick={() => setTab(item.id)} className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-medium transition ${tab === item.id ? "border-[#1264d7] text-[#1264d7]" : "border-transparent text-muted-foreground hover:text-foreground"}`}><FaIcon name={item.icon} className="size-3"/>{item.label}</button>)}</nav></header>
    <InlineProblem error={dataError ?? action.error}/>
    {tab === "overview" ? <main className="p-5"><section className="grid grid-cols-2 overflow-hidden rounded-lg border bg-background lg:grid-cols-4"><Metric label="Open inquiries" value={overview.open_inquiries} detail="Sales and sourcing queue"/><Metric label="Active quotations" value={overview.active_quotations} detail={money(totalPipeline, "USD") + " visible pipeline"}/><Metric label="Awaiting release" value={overview.orders_awaiting_release} detail="Documents and payment gates"/><Metric label="Unconfirmed receipts" value={overview.unconfirmed_receipts} detail="Bank slip is not credited funds"/></section><section className="mt-5 grid gap-4 lg:grid-cols-3"><button type="button" onClick={() => setTab("inquiries")} className="rounded-lg border bg-background p-5 text-left hover:border-sky-300"><Mail className="size-5 text-sky-600"/><h2 className="mt-4 text-sm font-semibold">Intake & Inquiry</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Record the commercial request, source and ownership before pricing work starts.</p></button><button type="button" onClick={() => setTab("quotations")} className="rounded-lg border bg-background p-5 text-left hover:border-sky-300"><FileText className="size-5 text-sky-600"/><h2 className="mt-4 text-sm font-semibold">Quotation versions</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Approve, issue and capture acceptance without overwriting sent versions.</p></button><button type="button" onClick={() => setTab("orders")} className="rounded-lg border bg-background p-5 text-left hover:border-sky-300"><Check className="size-5 text-emerald-600"/><h2 className="mt-4 text-sm font-semibold">Commercial release</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Convert accepted quotations into governed Sales Orders and release confirmed work.</p></button></section></main> : null}
    {tab === "inquiries" ? <main className="p-5"><div className="overflow-hidden rounded-lg border bg-background">{inquiries.data?.length ? <table className="w-full text-xs"><thead><tr>{["Inquiry", "Customer", "Source", "Received", "Status"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{inquiries.data.map((item) => <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50"><td className="px-3 py-3"><p className="font-semibold">{item.number}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{item.title}</p></td><td className="px-3 py-3">{item.customer_name}</td><td className="px-3 py-3">{item.source ?? "—"}</td><td className="px-3 py-3 text-muted-foreground">{new Date(item.requested_at).toLocaleDateString()}</td><td className="px-3 py-3"><StatusPill value={item.status}/></td></tr>)}</tbody></table> : <EmptyState icon="inbox" title="No Inquiries yet" body="Create the first manual Inquiry / Sourcing Request to start the commercial workflow."/>}</div></main> : null}
    {tab === "quotations" ? <main className="p-5"><div className="overflow-hidden rounded-lg border bg-background">{quotations.data?.length ? <table className="w-full text-xs"><thead><tr>{["Quotation", "Customer", "Version", "Total", "Status", "Actions"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{quotations.data.map((quote) => { const next = quote.latest.status === "draft" ? "internally_approved" : quote.latest.status === "internally_approved" ? "sent" : quote.latest.status === "sent" ? "accepted" : null; return <tr key={quote.id} className="border-b last:border-0"><td className="px-3 py-3 font-semibold">{quote.number}</td><td className="px-3 py-3">{quote.latest.customer_snapshot.name ?? "—"}</td><td className="px-3 py-3">v{quote.latest.version_no}</td><td className="px-3 py-3 font-medium">{money(quote.latest.total, quote.latest.currency)}</td><td className="px-3 py-3"><StatusPill value={quote.latest.status}/></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{next ? <Button size="sm" variant="outline" onClick={() => action.mutate({ path: `/commercial/order-management/quotation-versions/${quote.latest.id}/transition`, body: { status: next } })}>{next === "internally_approved" ? "Approve" : next === "sent" ? "Mark sent" : "Accept"}</Button> : null}{["internally_approved", "sent", "rejected"].includes(quote.latest.status) ? <Button size="sm" variant="outline" onClick={() => { setSelectedQuote(quote); setModal("revision"); }}>New version</Button> : null}{quote.latest.status === "accepted" ? <Button size="sm" variant="outline" onClick={() => { setSelectedQuote(quote); setModal("evidence"); }}><Mail className="size-3"/>Evidence</Button> : null}</div></td></tr>; })}</tbody></table> : <EmptyState icon="file-alt" title="No Quotations yet" body="Create a quotation from an Inquiry. Each issued revision remains immutable."/>}</div></main> : null}
    {tab === "orders" ? <main className="p-5"><div className="overflow-hidden rounded-lg border bg-background">{orders.data?.length ? <table className="w-full text-xs"><thead><tr>{["Sales Order", "Customer", "Total", "Payment gate", "Status", "Actions"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{orders.data.map((order) => <tr key={order.id} className="border-b last:border-0"><td className="px-3 py-3 font-semibold">{order.number}</td><td className="px-3 py-3">{order.customer_snapshot.name ?? "—"}</td><td className="px-3 py-3 font-medium">{money(order.total, order.currency)}</td><td className="px-3 py-3 text-muted-foreground">{order.payment_terms_snapshot.milestones?.filter((item) => item.release_gate).map((item) => `${item.label} ${item.percentage}%`).join(", ")}</td><td className="px-3 py-3"><StatusPill value={order.status}/></td><td className="px-3 py-3">{order.status === "awaiting_commercial_release" ? <Button size="sm" variant="outline" onClick={() => action.mutate({ path: `/commercial/order-management/orders/${order.id}/release`, body: { expected_version: order.version } })}>Release</Button> : <span className="text-[11px] text-muted-foreground">Released {order.released_at ? new Date(order.released_at).toLocaleDateString() : ""}</span>}</td></tr>)}</tbody></table> : <EmptyState icon="clipboard-list" title="No Sales Orders yet" body="Accepted quotation + required legal evidence + approved Payment Terms are required."/>}</div></main> : null}
    {tab === "payments" ? <main className="p-5"><div className="overflow-hidden rounded-lg border bg-background">{receipts.data?.length ? <table className="w-full text-xs"><thead><tr>{["Bank reference", "Value date", "Amount", "Allocated", "Status", "Actions"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{receipts.data.map((receipt) => <tr key={receipt.id} className="border-b last:border-0"><td className="px-3 py-3"><p className="font-semibold">{receipt.bank_reference}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{receipt.receiving_account}</p></td><td className="px-3 py-3">{new Date(receipt.value_date).toLocaleDateString()}</td><td className="px-3 py-3 font-medium">{money(receipt.amount, receipt.currency)}</td><td className="px-3 py-3">{money(receipt.allocated_amount, receipt.currency)}<p className="text-[10px] text-muted-foreground">{money(receipt.unallocated_amount, receipt.currency)} left</p></td><td className="px-3 py-3"><StatusPill value={receipt.status}/></td><td className="px-3 py-3">{receipt.status === "pending_confirmation" ? <Button size="sm" variant="outline" onClick={() => action.mutate({ path: `/commercial/order-management/receipts/${receipt.id}/confirm`, body: { expected_version: receipt.version } })}>Confirm credited</Button> : Number(receipt.unallocated_amount) > 0 ? <Button size="sm" variant="outline" onClick={() => { setSelectedReceipt(receipt); setModal("allocation"); }}>Allocate</Button> : <span className="text-[11px] text-muted-foreground">Fully allocated</span>}</td></tr>)}</tbody></table> : <EmptyState icon="money-check-alt" title="No payment receipts yet" body="Record incoming funds, confirm the credited event, then allocate them to order milestones."/>}</div>{allocations.data?.length ? <section className="mt-5 overflow-hidden rounded-lg border bg-background"><div className="border-b px-4 py-3"><h2 className="text-xs font-semibold">Allocation & reversal history</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Append-only commercial evidence. Reversals never overwrite the original allocation.</p></div><table className="w-full text-xs"><thead><tr>{["Order", "Milestone", "Amount", "Recorded", "State", "Actions"].map((label) => <TableHeader key={label}>{label}</TableHeader>)}</tr></thead><tbody>{allocations.data.map((allocation) => { const order = orders.data?.find((item) => item.id === allocation.sales_order_id); return <tr key={allocation.id} className="border-b last:border-0"><td className="px-3 py-3 font-medium">{order?.number ?? allocation.sales_order_id.slice(0, 8)}</td><td className="px-3 py-3">{allocation.milestone_id}</td><td className={`px-3 py-3 font-medium ${Number(allocation.amount) < 0 ? "text-rose-600" : ""}`}>{money(allocation.amount, order?.currency ?? "USD")}</td><td className="px-3 py-3 text-muted-foreground">{new Date(allocation.created_at).toLocaleString()}</td><td className="px-3 py-3"><StatusPill value={allocation.reversal_of_id ? "reversal" : allocation.reversed ? "reversed" : "allocated"}/></td><td className="px-3 py-3">{!allocation.reversal_of_id && !allocation.reversed ? <Button size="sm" variant="outline" onClick={() => { setSelectedAllocation(allocation); setModal("reversal"); }}>Reverse</Button> : <span className="text-[11px] text-muted-foreground">{allocation.reason ?? "Immutable history"}</span>}</td></tr>; })}</tbody></table></section> : null}</main> : null}
    {tab === "render" ? <main className="min-h-0 flex-1"><RenderLabWorkspace embedded /></main> : null}
    {modal === "inquiry" ? <InquiryForm products={products.data ?? []} customers={customers.data ?? []} suppliers={suppliers.data ?? []} close={() => setModal(null)}/> : null}
    {modal === "quotation" ? <QuotationForm inquiries={inquiries.data ?? []} products={products.data ?? []} suppliers={suppliers.data ?? []} close={() => setModal(null)}/> : null}
    {modal === "revision" && selectedQuote ? <QuotationForm base={selectedQuote} inquiries={inquiries.data ?? []} products={products.data ?? []} suppliers={suppliers.data ?? []} close={() => setModal(null)}/> : null}
    {modal === "governance" ? <GovernanceForm close={() => setModal(null)}/> : null}
    {modal === "evidence" && selectedQuote ? <EvidenceForm quote={selectedQuote} close={() => setModal(null)}/> : null}
    {modal === "order" ? <OrderForm quotes={quotations.data ?? []} profiles={profiles.data ?? []} terms={terms.data ?? []} suppliers={suppliers.data ?? []} close={() => setModal(null)}/> : null}
    {modal === "receipt" ? <ReceiptForm close={() => setModal(null)}/> : null}
    {modal === "allocation" && selectedReceipt ? <AllocationForm receipt={selectedReceipt} orders={orders.data ?? []} close={() => setModal(null)}/> : null}
    {modal === "reversal" && selectedAllocation ? <ReversalForm allocation={selectedAllocation} close={() => setModal(null)}/> : null}
  </div>;
}
