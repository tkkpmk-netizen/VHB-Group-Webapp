function stableIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** Shared keys prevent the shell and page content from fetching the same data twice. */
export const workspaceQueryKeys = {
  spaces: (workspaceId: string | null) =>
    ["spaces", workspaceId] as const,
  databases: (workspaceId: string | null) =>
    ["databases", workspaceId] as const,
  folders: (workspaceId: string | null, spaceIds: readonly string[]) =>
    ["folders", workspaceId, stableIds(spaceIds)] as const,
  placements: (workspaceId: string | null, spaceIds: readonly string[]) =>
    ["space-databases", workspaceId, stableIds(spaceIds)] as const,
};
