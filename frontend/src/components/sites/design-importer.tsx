"use client";

import { FileCode2, LoaderCircle, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Dropdown } from "@/components/ui/dropdown";

export type DesignImportSource =
  | "html"
  | "figma-html"
  | "penpot-html"
  | "grapesjs-project";

export type DesignImportPayload = {
  source_type: DesignImportSource;
  source_name?: string;
  html?: string;
  css?: string;
  project?: Record<string, unknown>;
};

type SitePage = {
  id: string;
  title: string;
  path: string;
};

function parseProjectJson(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Project JSON must be an object.");
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.type === "grapesjs" && candidate.project) {
    const project = candidate.project;
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("GrapesJS envelope has an invalid project field.");
    }
    return project as Record<string, unknown>;
  }
  return candidate;
}

export function DesignImporter({
  page,
  importing,
  onImport,
}: {
  page: SitePage;
  importing?: boolean;
  onImport: (payload: DesignImportPayload) => void;
}) {
  const [sourceType, setSourceType] = useState<DesignImportSource>("figma-html");
  const [sourceName, setSourceName] = useState("");
  const [html, setHtml] = useState("");
  const [css, setCss] = useState("");
  const [projectJson, setProjectJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isProject = sourceType === "grapesjs-project";
  const canImport = useMemo(
    () => (isProject ? projectJson.trim().length > 0 : html.trim().length > 0),
    [html, isProject, projectJson],
  );

  async function handleFile(file: File) {
    setError(null);
    setSourceName(file.name);
    const text = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".json")) {
      try {
        const project = parseProjectJson(text);
        setSourceType("grapesjs-project");
        setProjectJson(JSON.stringify(project, null, 2));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON file.");
      }
      return;
    }
    if (lower.endsWith(".css")) {
      setCss(text);
      return;
    }
    setSourceType(lower.includes("penpot") ? "penpot-html" : "figma-html");
    setHtml(text);
  }

  function submitImport() {
    setError(null);
    try {
      if (isProject) {
        onImport({
          source_type: sourceType,
          source_name: sourceName.trim() || undefined,
          project: parseProjectJson(projectJson),
        });
        return;
      }
      if (!html.trim()) {
        setError("HTML artifact is required for this import type.");
        return;
      }
      onImport({
        source_type: sourceType,
        source_name: sourceName.trim() || undefined,
        html,
        css,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import design.");
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
          <FileCode2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Import design artifact</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            DP4 imports local Figma/Penpot/static exports into the selected page:
            <span className="font-medium text-foreground"> {page.title}</span>{" "}
            <span>{page.path}</span>.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="grid gap-1.5 text-xs font-medium">
            Source
            <div className="rounded-md border">
              <Dropdown
                value={sourceType}
                allowClear={false}
                options={[
                  { value: "figma-html", label: "Figma HTML/export" },
                  { value: "penpot-html", label: "Penpot HTML/export" },
                  { value: "html", label: "Generic HTML/CSS" },
                  { value: "grapesjs-project", label: "GrapesJS project JSON" },
                ]}
                onChange={(value) => {
                  if (value) setSourceType(value as DesignImportSource);
                }}
              />
            </div>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Artifact name
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="landing-export.html"
              className="h-9 rounded-md border px-3 text-sm outline-none focus:border-blue-400"
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground hover:border-blue-300 hover:bg-blue-50/40">
          <Upload className="size-4" />
          Upload .html, .css, or .json export
          <input
            type="file"
            accept=".html,.htm,.css,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {isProject ? (
          <label className="grid gap-1.5 text-xs font-medium">
            GrapesJS project JSON
            <textarea
              value={projectJson}
              onChange={(event) => setProjectJson(event.target.value)}
              placeholder='{"assets":[],"styles":[],"pages":[]}'
              className="min-h-40 rounded-md border px-3 py-2 font-mono text-xs outline-none focus:border-blue-400"
            />
          </label>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium">
              HTML
              <textarea
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                placeholder="<main>...</main>"
                className="min-h-40 rounded-md border px-3 py-2 font-mono text-xs outline-none focus:border-blue-400"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              CSS
              <textarea
                value={css}
                onChange={(event) => setCss(event.target.value)}
                placeholder=".hero { ... }"
                className="min-h-40 rounded-md border px-3 py-2 font-mono text-xs outline-none focus:border-blue-400"
              />
            </label>
          </div>
        )}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Import replaces the current designer source. Existing public bindings stay intact.
          </p>
          <button
            type="button"
            disabled={!canImport || importing}
            onClick={submitImport}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {importing && <LoaderCircle className="size-3.5 animate-spin" />}
            Import to page
          </button>
        </div>
      </div>
    </section>
  );
}
