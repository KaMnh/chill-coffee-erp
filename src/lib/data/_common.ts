export function unwrapJson<T>(data: unknown, fallback: T): T {
  if (!data) return fallback;
  return data as T;
}

/**
 * Convert a Supabase PostgrestError (plain object) into a proper Error
 * instance with a human-readable message. PostgrestError không extend Error,
 * nên `error.toString()` ra "[object Object]" trên Next.js error overlay.
 * Dùng helper này ở mọi data layer để có message rõ ràng.
 */
export function toAppError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    );
    if (parts.length) return new Error(parts.join(" — "));
  }
  return new Error(fallback);
}
