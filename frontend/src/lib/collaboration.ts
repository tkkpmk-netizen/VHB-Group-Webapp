"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, getWorkspaceId } from "@/lib/api/client";
import { getToken } from "@/lib/auth";

export type CollaborationResourceType = "document" | "site_page";

export type Collaborator = {
  session_id: string;
  user_id: string;
  name: string;
  email: string;
};

export type CollaborationEvent = {
  type: string;
  resource_type?: CollaborationResourceType;
  resource_id?: string;
  user?: Collaborator;
  users?: Collaborator[];
  data?: Record<string, unknown>;
};

function websocketBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, "ws");
}

export function useCollaboration({
  resourceType,
  resourceId,
}: {
  resourceType: CollaborationResourceType;
  resourceId: string;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [lastEvent, setLastEvent] = useState<CollaborationEvent | null>(null);
  const roomKey = useMemo(
    () => `${resourceType}:${resourceId}`,
    [resourceId, resourceType],
  );

  useEffect(() => {
    const token = getToken();
    const workspaceId = getWorkspaceId();
    if (!token || !workspaceId || !resourceId) return;
    const url = new URL(
      `${websocketBaseUrl()}/collaboration/ws/${resourceType}/${resourceId}`,
    );
    url.searchParams.set("token", token);
    url.searchParams.set("workspace_id", workspaceId);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      setCollaborators([]);
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as CollaborationEvent;
        if (payload.type === "presence.snapshot" && Array.isArray(payload.users)) {
          setCollaborators(payload.users as Collaborator[]);
          return;
        }
        if (payload.type === "presence.joined" && payload.user) {
          setCollaborators((current) => {
            if (current.some((user) => user.session_id === payload.user?.session_id)) {
              return current;
            }
            return [...current, payload.user as Collaborator];
          });
          setLastEvent(payload);
          return;
        }
        if (payload.type === "presence.left" && payload.user) {
          setCollaborators((current) =>
            current.filter((user) => user.session_id !== payload.user?.session_id),
          );
          setLastEvent(payload);
          return;
        }
        setLastEvent(payload);
      } catch {
        // Ignore malformed realtime payloads; autosave remains the source of truth.
      }
    };
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [resourceId, resourceType, roomKey]);

  const sendEvent = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, data }));
    },
    [],
  );

  return {
    connected,
    collaborators,
    lastEvent,
    sendEvent,
  };
}
