"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  // Show scrollbars only while actively scrolling: tag the scrolled element with
  // `.is-scrolling` (CSS fades the thumb in), then drop it ~800ms after it stops.
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
    const onScroll = (e: Event) => {
      const el =
        e.target instanceof Document ? e.target.documentElement : e.target;
      if (!(el instanceof Element)) return;
      el.classList.add("is-scrolling");
      const prev = timers.get(el);
      if (prev) clearTimeout(prev);
      timers.set(
        el,
        setTimeout(() => el.classList.remove("is-scrolling"), 800),
      );
    };
    window.addEventListener("scroll", onScroll, true); // capture: all containers
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
