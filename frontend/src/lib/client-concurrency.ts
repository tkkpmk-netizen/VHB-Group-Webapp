/**
 * Run browser-side work with bounded concurrency while preserving result
 * order. This avoids flooding the API when a complete database is assembled
 * from many paginated responses.
 */
export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (items.length === 0) return [];

  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  const results = new Array<Output>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}
