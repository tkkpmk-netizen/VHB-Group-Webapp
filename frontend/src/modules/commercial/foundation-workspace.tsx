"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  FaIcon,
  RefreshCw,
  ShieldCheck,
} from "@/components/ui/fa-icon";
import {
  useCommercialBootstrap,
  useSelectedWorkspaceId,
} from "@/modules/commercial/api";
import {
  commercialHelpEnglish,
  commercialHelpVietnamese,
  commercialText,
} from "@/modules/commercial/i18n";
import {
  readCommercialCheckpoint,
  resolveCommercialLanding,
  saveCommercialCheckpoint,
} from "@/modules/commercial/navigation-state";
import { resolveCommercialFoundationState } from "@/modules/commercial/state";
import { MigrationQualityWorkspace } from "@/modules/commercial/migration-quality/workspace";
import { CatalogWorkspace } from "@/modules/commercial/catalog-pricing-workspace";
import { RenderLabWorkspace } from "@/modules/commercial/render-lab";
import { JobTray } from "@/modules/commercial/workbench";

type CommercialSection = keyof typeof commercialHelpEnglish;

const SECTION_COPY: Record<
  CommercialSection,
  { titleKey: string; bodyKey: string }
> = {
  quality: {
    titleKey: "empty.quality.title",
    bodyKey: "empty.quality.body",
  },
  products: {
    titleKey: "empty.products.title",
    bodyKey: "empty.products.body",
  },
  customers: {
    titleKey: "empty.customers.title",
    bodyKey: "empty.customers.body",
  },
  pricing: {
    titleKey: "empty.pricing.title",
    bodyKey: "empty.pricing.body",
  },
  render: {
    titleKey: "empty.render.title",
    bodyKey: "empty.render.body",
  },
};

export function CommercialLanding() {
  const router = useRouter();
  const workspaceId = useSelectedWorkspaceId();
  const bootstrapQuery = useCommercialBootstrap(workspaceId);

  useEffect(() => {
    if (!workspaceId || !bootstrapQuery.data?.enabled) return;
    const allowedHrefs = bootstrapQuery.data.destinations.map(
      (destination) => destination.href,
    );
    const checkpoint = readCommercialCheckpoint(
      window.sessionStorage,
      workspaceId,
      allowedHrefs,
    );
    const target = resolveCommercialLanding(bootstrapQuery.data, checkpoint);
    if (target) router.replace(target, { scroll: false });
  }, [bootstrapQuery.data, router, workspaceId]);

  if (bootstrapQuery.error) {
    return (
      <CommercialMessage
        title={commercialText("state.failed")}
        body="The authorized workspace bootstrap did not complete."
        action={
          <button
            type="button"
            onClick={() => void bootstrapQuery.refetch()}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="size-3.5" />
            {commercialText("action.retry")}
          </button>
        }
      />
    );
  }

  if (bootstrapQuery.data && !bootstrapQuery.data.enabled) {
    return (
      <CommercialMessage
        title={commercialText("state.noAccess")}
        body="Contact a workspace owner if you believe this module should be enabled."
      />
    );
  }

  return <CommercialLoading />;
}

export function CommercialFoundationWorkspace({
  section,
}: {
  section: string;
}) {
  const workspaceId = useSelectedWorkspaceId();
  const bootstrapQuery = useCommercialBootstrap(workspaceId);
  const state = resolveCommercialFoundationState({
    isPending: bootstrapQuery.isPending,
    error: bootstrapQuery.error,
    bootstrap: bootstrapQuery.data,
    section,
  });

  useEffect(() => {
    if (
      state.kind !== "ready" ||
      !workspaceId ||
      typeof window === "undefined"
    ) {
      return;
    }
    saveCommercialCheckpoint(window.sessionStorage, {
      workspaceId,
      href: state.destination.href,
      savedAt: Date.now(),
    });
  }, [state, workspaceId]);

  if (state.kind === "loading") return <CommercialLoading />;
  if (state.kind === "no-access") {
    return (
      <CommercialMessage
        title={commercialText("state.noAccess")}
        body="This route is unavailable or is not authorized for the selected workspace."
      />
    );
  }
  if (state.kind === "failed") {
    return (
      <CommercialMessage
        title={commercialText("state.failed")}
        body={
          state.retryable
            ? "The request can be retried without losing navigation context."
            : "Check access with the workspace owner."
        }
        action={
          state.retryable ? (
            <button
              type="button"
              onClick={() => void bootstrapQuery.refetch()}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              <RefreshCw className="size-3.5" />
              {commercialText("action.retry")}
            </button>
          ) : undefined
        }
      />
    );
  }

  const sectionId = state.destination.id as CommercialSection;
  if (sectionId === "quality") return <><MigrationQualityWorkspace /><JobTray /></>;
  if (sectionId === "products" || sectionId === "customers" || sectionId === "pricing") {
    return <><CatalogWorkspace kind={sectionId} /><JobTray /></>;
  }
  if (sectionId === "render") return <><RenderLabWorkspace /><JobTray /></>;
  const copy = SECTION_COPY[section as CommercialSection];
  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="border-b bg-card py-4 pl-16 pr-5 sm:px-7">
        <div className="mx-auto flex w-full max-w-5xl items-start gap-3">
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <FaIcon name={state.destination.icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {commercialText("module.title")}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-[-0.015em]">
              {commercialText(state.destination.label_key)}
            </h1>
          </div>
          <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
            <Check className="size-3 text-emerald-600" />
            Workspace isolated
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-6 sm:px-7">
        <div className="flex min-w-0 items-start gap-3 overflow-hidden rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950">
          <ShieldCheck className="mt-0.5 size-4 text-sky-700" />
          <div className="min-w-0">
            <p className="text-xs font-semibold">Governed workspace ready</p>
            <p className="mt-0.5 break-words text-xs leading-5 text-sky-900/80">
              Navigation, workspace authorization, deep-link restoration, and
              freshness context are active. Operational records appear only
              after their governed source is published.
            </p>
          </div>
        </div>

        <section className="flex flex-1 items-center justify-center py-12">
          <div className="w-full min-w-0 max-w-lg text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm">
              <FaIcon name={state.destination.icon} className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">
              {commercialText(copy.titleKey)}
            </h2>
            <p className="mx-auto mt-2 max-w-md break-words text-sm leading-6 text-muted-foreground">
              {commercialText(copy.bodyKey)}
            </p>
            <details className="mx-auto mt-6 w-full max-w-md rounded-md border bg-card text-left">
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
                {commercialText("action.openHelp")}
              </summary>
              <div className="border-t px-4 py-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  {commercialHelpVietnamese[sectionId]}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground/80">
                  {commercialHelpEnglish[sectionId]}
                </p>
              </div>
            </details>
          </div>
        </section>

        <footer className="flex flex-col gap-1 border-t pt-3 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="break-all">
            Capability {state.destination.capability}
          </span>
          <span>
            Data as of{" "}
            {new Date(state.bootstrap.as_of).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </footer>
      </div>
    </div>
  );
}

function CommercialLoading() {
  return (
    <div
      aria-label={commercialText("state.loading")}
      className="flex min-h-full flex-col"
    >
      <div className="h-[73px] animate-pulse border-b bg-card motion-reduce:animate-none" />
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-5 py-6 sm:px-7">
        <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="mx-auto mt-24 h-36 max-w-md animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function CommercialMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
        {action}
      </div>
    </div>
  );
}
