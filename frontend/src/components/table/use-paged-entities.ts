"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { mapWithConcurrency } from "@/lib/client-concurrency";
import {
  serverFilterTreeFor,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Entity = components["schemas"]["EntityOut"];
type EntityPage = components["schemas"]["EntityPage"];

type PagedEntityOptions = {
  databaseId: string;
  filterRoot: FilterGroup;
  sorts: SortRule[];
  limit: number;
  dataSourceId: string | null;
  search: string;
  searchFieldId: string | null;
  filterToMatches: boolean;
  groupFieldId?: string | null;
};

type EntityQueryBody = {
  filters?: { field_id: string; operator: string; value?: unknown }[];
  filter_tree?: ReturnType<typeof serverFilterTreeFor>;
  sorts?: { field_id: string; direction: "asc" | "desc" }[];
  search?: string | null;
  search_field_id?: string | null;
};

export async function fetchAllEntityQueryPages(
  databaseId: string,
  query: EntityQueryBody = {},
): Promise<Entity[]> {
  const fetchPage = (page: number) =>
    apiFetch<EntityPage>(`/databases/${databaseId}/entities/query`, {
      method: "POST",
      body: JSON.stringify({ ...query, page, page_size: 200 }),
    });
  const first = await fetchPage(1);
  if (first.pages <= 1) return first.items;
  const rest = await mapWithConcurrency(
    Array.from({ length: first.pages - 1 }, (_, index) => index + 2),
    4,
    (page) => fetchPage(page),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

/** Fetch a complete option set through bounded server pages. */
export async function fetchAllEntities(databaseId: string): Promise<Entity[]> {
  return fetchAllEntityQueryPages(databaseId);
}

export function usePagedEntities({
  databaseId,
  filterRoot,
  sorts,
  limit,
  dataSourceId,
  search,
  searchFieldId,
  filterToMatches,
  groupFieldId = null,
}: PagedEntityOptions) {
  const pageSize = Math.min(Math.max(limit, 1), 200);
  const filterTree = useMemo(
    () => serverFilterTreeFor(filterRoot),
    [filterRoot],
  );
  const query = useInfiniteQuery<EntityPage>({
    queryKey: [
      "entities",
      databaseId,
      "paged-layout",
      pageSize,
      dataSourceId,
      JSON.stringify(filterTree),
      JSON.stringify(sorts),
      groupFieldId,
      filterToMatches ? search.trim() : "",
      filterToMatches ? searchFieldId : null,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<EntityPage>(`/databases/${databaseId}/entities/query`, {
        method: "POST",
        body: JSON.stringify({
          page: pageParam,
          page_size: pageSize,
          filters: dataSourceId
            ? [
                {
                  field_id: "data_source_id",
                  operator: "eq",
                  value: dataSourceId,
                },
              ]
            : [],
          filter_tree: filterTree,
          sorts: sorts.map((sort) => ({
            field_id: sort.fieldId,
            direction: sort.dir,
          })),
          group_by: groupFieldId,
          search: filterToMatches ? search.trim() || null : null,
          search_field_id: filterToMatches ? searchFieldId : null,
        }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.items.filter((entity) => {
        if (seen.has(entity.id)) return false;
        seen.add(entity.id);
        return true;
      }),
    );
  }, [query.data?.pages]);
  const firstPage = query.data?.pages[0];

  return {
    query,
    items: items as Entity[],
    total: firstPage?.total ?? 0,
    groups: firstPage?.groups ?? [],
  };
}
