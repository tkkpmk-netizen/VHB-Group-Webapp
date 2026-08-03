/**
 * Centralized API client for the FastAPI backend.
 * Base URL comes from NEXT_PUBLIC_API_URL (defaults to local dev backend).
 */

import { clearToken, getToken } from "../auth";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const WORKSPACE_KEY = "vhb_workspace_id";

export function getWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_KEY);
}

export function selectWorkspace(workspaceId: string): void {
  window.localStorage.setItem(WORKSPACE_KEY, workspaceId);
}

export function clearWorkspaceSelection(): void {
  window.localStorage.removeItem(WORKSPACE_KEY);
}

export type ConflictPayload = {
  code: "VERSION_CONFLICT";
  expected_version: string | number;
  current_version: string | number;
  changed_fields: Array<{
    path: string;
    current_value?: unknown;
    snapshot_ref?: string;
  }>;
  rebase_actions: Array<"refresh" | "compare" | "rebase" | "retry">;
  request_id: string;
};

export type ProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string | Array<{ msg?: string }>;
  code?: string;
  conflict?: ConflictPayload;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public problem?: ProblemDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function extractApiError(
  res: Response,
  path: string,
): Promise<{ message: string; problem?: ProblemDetails }> {
  const fallback = `Request to ${path} failed (${res.status})`;
  try {
    const problem = (await res.json()) as ProblemDetails;
    const detail = problem.detail;
    if (typeof detail === "string" && detail) {
      return { message: detail, problem };
    }
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (typeof d?.msg === "string" ? d.msg : null))
        .filter(Boolean);
      if (msgs.length) return { message: msgs.join("; "), problem };
    }
    if (typeof problem.title === "string" && problem.title) {
      return { message: problem.title, problem };
    }
    return { message: fallback, problem };
  } catch {
    // Non-JSON body — keep the generic message.
  }
  return { message: fallback };
}

/** Surface FastAPI detail while retaining typed Problem Details in apiFetch. */
export async function extractErrorMessage(
  res: Response,
  path: string,
): Promise<string> {
  return (await extractApiError(res, path)).message;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = getToken();
  const workspaceId = getWorkspaceId();
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-ID": workspaceId } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      // Sessions are Redis-backed. A Redis restart invalidates existing JWTs,
      // so remove the whole client-side session instead of retrying stale state.
      clearToken();
      clearWorkspaceSelection();
    }
    const extracted = await extractApiError(res, path);
    throw new ApiError(res.status, extracted.message, extracted.problem);
  }

  // 204 No Content (e.g. DELETE) or empty body → nothing to parse.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
