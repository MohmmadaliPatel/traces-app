/**
 * Run async work over `items` with at most `limit` concurrent executions.
 * Results array index matches `items` order.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const n = Math.min(Math.max(1, limit), items.length)
  const results: R[] = new Array(items.length)
  let next = 0

  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      const item = items[i]!
      results[i] = await fn(item, i)
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
