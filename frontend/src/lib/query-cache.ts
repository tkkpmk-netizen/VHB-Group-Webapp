import { QueryClient } from "@tanstack/react-query";

const MINUTE = 60_000;

/**
 * Keep reusable API data in the browser tab's RAM. Mutations still invalidate
 * their query prefixes, so the API remains the source of truth.
 */
export function createAppQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * MINUTE,
        gcTime: 15 * MINUTE,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
        structuralSharing: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  // Workspace structure changes relatively rarely and is explicitly
  // invalidated after creates, moves, renames, and deletes.
  for (const key of [
    "spaces",
    "databases",
    "folders",
    "space-databases",
    "fields",
    "layouts",
    "data-sources",
  ]) {
    client.setQueryDefaults([key], {
      staleTime: 10 * MINUTE,
      gcTime: 60 * MINUTE,
    });
  }

  // Record pages are larger and more volatile, so keep a tighter RAM bound.
  client.setQueryDefaults(["entities"], {
    staleTime: 2 * MINUTE,
    gcTime: 15 * MINUTE,
  });
  client.setQueryDefaults(["entities-search"], {
    staleTime: MINUTE,
    gcTime: 10 * MINUTE,
  });
  client.setQueryDefaults(["widget-data"], {
    staleTime: 2 * MINUTE,
    gcTime: 10 * MINUTE,
  });

  return client;
}
