"use client";

import type { Editor } from "grapesjs";
import {
  Code2,
  Database,
  LoaderCircle,
  Monitor,
  RotateCcw,
  Save,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultDesignerContent,
  isGrapesContent,
  type GrapesContent,
  type SitePageContent,
} from "@/lib/site-designer";
import { useCollaboration } from "@/lib/collaboration";

type SitePage = {
  id: string;
  title: string;
  path: string;
  content: SitePageContent;
};

type Binding = {
  key: string;
  name: string;
  field_ids: string[];
  page_id: string | null;
};

function bindingBlock(binding: Binding): string {
  return `
    <section class="vhb-data-list" data-vhb-binding="${binding.key}">
      <h2>${binding.name}</h2>
      <div class="vhb-data-list__grid">
        <article>
          <strong>Dynamic record</strong>
          <p>Runtime binding: ${binding.key}</p>
        </article>
        <article>
          <strong>Selected fields</strong>
          <p>${binding.field_ids.length} public fields</p>
        </article>
      </div>
    </section>
  `;
}

function applyProject(editor: Editor, page: SitePage): void {
  const fallback = defaultDesignerContent(page.title);
  const content = isGrapesContent(page.content) ? page.content : fallback;
  try {
    if (
      content.project &&
      Array.isArray((content.project as { pages?: unknown }).pages) &&
      (content.project as { pages?: unknown[] }).pages?.length
    ) {
      editor.loadProjectData(content.project);
      return;
    }
  } catch {
    // Fall through to HTML/CSS source for old or partial project envelopes.
  }
  editor.setComponents(content.html ?? fallback.html ?? "");
  editor.setStyle(content.css ?? fallback.css ?? "");
}

function projectEnvelope(project: Record<string, unknown>, html: string, css: string): GrapesContent {
  return {
    type: "grapesjs",
    version: "dp5-build-source",
    project,
    html,
    css,
    meta: { saved_at: new Date().toISOString() },
  };
}

export function WebDesigner({
  page,
  bindings,
  saving,
  onSave,
}: {
  page: SitePage;
  bindings: Binding[];
  saving?: boolean;
  onSave: (content: GrapesContent) => void;
}) {
  const editorEl = useRef<HTMLDivElement | null>(null);
  const blocksEl = useRef<HTMLDivElement | null>(null);
  const stylesEl = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const collaboration = useCollaboration({
    resourceType: "site_page",
    resourceId: page.id,
  });
  const bindingKey = useMemo(
    () => bindings.map((binding) => `${binding.key}:${binding.field_ids.length}`).join("|"),
    [bindings],
  );

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      if (!editorEl.current || !blocksEl.current || !stylesEl.current) return;
      const grapes = await import("grapesjs");
      if (cancelled || !editorEl.current || !blocksEl.current || !stylesEl.current) {
        return;
      }
      const editor = grapes.default.init({
        container: editorEl.current,
        height: "100%",
        width: "auto",
        storageManager: false,
        fromElement: false,
        panels: { defaults: [] },
        blockManager: { appendTo: blocksEl.current },
        styleManager: {
          appendTo: stylesEl.current,
          sectors: [
            {
              name: "Layout",
              open: true,
              properties: ["display", "width", "min-height", "padding", "margin"],
            },
            {
              name: "Typography",
              open: true,
              properties: [
                "font-family",
                "font-size",
                "font-weight",
                "line-height",
                "color",
                "text-align",
              ],
            },
            {
              name: "Decoration",
              open: true,
              properties: [
                "background-color",
                "border-radius",
                "box-shadow",
                "border",
              ],
            },
          ],
        },
        deviceManager: {
          devices: [
            { name: "Desktop", width: "" },
            { name: "Tablet", width: "768px" },
            { name: "Mobile", width: "390px" },
          ],
        },
        canvas: {
          styles: [
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap",
          ],
        },
      });

      editor.BlockManager.add("vhb-hero", {
        label: "Hero",
        category: "VHB",
        content:
          '<section class="hero"><h1>Grow your export business</h1><p>Replace this copy and connect it to your data.</p><a class="button" href="#">Get started</a></section>',
      });
      editor.BlockManager.add("vhb-section", {
        label: "Section",
        category: "VHB",
        content:
          '<section style="padding:48px;background:#fff;border-radius:18px"><h2>New section</h2><p>Add your content here.</p></section>',
      });
      editor.BlockManager.add("vhb-text", {
        label: "Text",
        category: "Basic",
        content: "<p>Editable text block</p>",
      });
      editor.BlockManager.add("vhb-button", {
        label: "Button",
        category: "Basic",
        content: '<a class="button" href="#">Button</a>',
      });
      editor.BlockManager.add("vhb-image", {
        label: "Image",
        category: "Basic",
        content:
          '<img src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80" style="max-width:100%;border-radius:18px" />',
      });
      for (const binding of bindings) {
        editor.BlockManager.add(`vhb-binding-${binding.key}`, {
          label: `Data · ${binding.key}`,
          category: "Data",
          content: bindingBlock(binding),
        });
      }

      editorRef.current = editor;
      applyProject(editor, page);
      setReady(true);
    }

    void mount();
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [page, bindings, bindingKey]);

  function saveProject() {
    const editor = editorRef.current;
    if (!editor) return;
    collaboration.sendEvent("design.changed", {
      page_id: page.id,
      path: page.path,
      action: "save",
    });
    onSave(
      projectEnvelope(
        editor.getProjectData() as Record<string, unknown>,
        editor.getHtml(),
        editor.getCss() ?? "",
      ),
    );
  }

  function resetCanvas() {
    const editor = editorRef.current;
    if (!editor) return;
    const fallback = defaultDesignerContent(page.title);
    editor.setComponents(fallback.html ?? "");
    editor.setStyle(fallback.css ?? "");
    collaboration.sendEvent("design.changed", {
      page_id: page.id,
      path: page.path,
      action: "reset",
    });
  }

  function setDevice(name: "Desktop" | "Tablet" | "Mobile") {
    editorRef.current?.setDevice(name);
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex min-h-12 items-center gap-2 border-b px-3">
        <Code2 className="size-4 text-blue-600" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">Web Designer</h2>
          <p className="truncate text-xs text-muted-foreground">
            GrapesJS project source · {page.title} · {page.path}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${
              collaboration.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            }`}
          />
          {collaboration.collaborators.length} online
        </div>
        {collaboration.collaborators.slice(0, 3).map((user) => (
          <span
            key={user.session_id}
            title={user.email}
            className="grid size-7 place-items-center rounded-full bg-purple-50 text-[10px] font-semibold text-purple-700"
          >
            {user.name.slice(0, 2).toUpperCase()}
          </span>
        ))}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDevice("Desktop")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Desktop"
          >
            <Monitor className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDevice("Tablet")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Tablet"
          >
            <Tablet className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setDevice("Mobile")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Mobile"
          >
            <Smartphone className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={resetCanvas}
          className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
        <button
          type="button"
          disabled={!ready || saving}
          onClick={saveProject}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </button>
      </header>
      <div className="grid h-[720px] min-h-0 grid-cols-[220px_minmax(0,1fr)_260px] bg-[#f0f2f5]">
        <aside className="min-h-0 overflow-y-auto border-r bg-background">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Blocks
          </div>
          <div ref={blocksEl} className="web-designer-blocks p-2" />
          {bindings.length > 0 && (
            <div className="border-t p-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1 font-semibold text-foreground">
                <Database className="size-3.5" /> Data bindings
              </div>
              Drag a Data block into the canvas. DP5 will turn these markers into
              runtime-rendered records.
            </div>
          )}
        </aside>
        <div className="relative min-h-0">
          {!ready && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/75 text-sm text-muted-foreground">
              <LoaderCircle className="mr-2 size-5 animate-spin" /> Loading designer…
            </div>
          )}
          <div ref={editorEl} className="h-full" />
        </div>
        <aside className="min-h-0 overflow-y-auto border-l bg-background">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Style
          </div>
          <div ref={stylesEl} className="web-designer-styles p-2" />
        </aside>
      </div>
    </section>
  );
}
