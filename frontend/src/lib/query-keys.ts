/** Shared keys prevent the shell and page content from fetching the same data twice. */
export const workspaceQueryKeys = {
  databases: (workspaceId: string | null) =>
    ["databases", workspaceId] as const,
};
