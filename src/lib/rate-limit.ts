export interface RateLimiterOptions { max: number; windowMs: number; }
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterMs: number; }
export function createRateLimiter({ max, windowMs }: RateLimiterOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  function check(key: string, now: number): RateLimitResult {
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, remaining: max - 1, retryAfterMs: 0 }; }
    if (b.count < max) { b.count += 1; return { allowed: true, remaining: max - b.count, retryAfterMs: 0 }; }
    return { allowed: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  function sweep(now: number): void { for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k); }
  return { check, sweep, size: () => buckets.size };
}
