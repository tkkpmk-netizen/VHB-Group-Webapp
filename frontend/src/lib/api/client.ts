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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Surface FastAPI's `detail` (string or validation-error list) to the UI. */
export async function extractErrorMessage(
  res: Response,
  path: string,
): Promise<string> {
  const fallback = `Request to ${path} failed (${res.status})`;
  try {
    const detail = (await res.json())?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (typeof d?.msg === "string" ? d.msg : null))
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
  } catch {
    // Non-JSON body — keep the generic message.
  }
  return fallback;
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
    throw new ApiError(res.status, await extractErrorMessage(res, path));
  }

  // 204 No Content (e.g. DELETE) or empty body → nothing to parse.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
