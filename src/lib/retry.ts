// Exponential-backoff retry for Google API calls. Google recommends this for
// 403 rateLimitExceeded / userRateLimitExceeded, and we also retry 429 and 5xx.
// Non-retryable errors propagate immediately.

const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

export async function withBackoff<T>(
  fn: () => Promise<T>,
  { retries = 4, baseMs = 400 }: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      // Full jitter keeps parallel streams from retrying in lockstep.
      const delay = baseMs * 2 ** attempt + Math.random() * baseMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function isRetryable(err: any): boolean {
  const code = err?.code ?? err?.response?.status;
  if (code === 429 || (typeof code === "number" && code >= 500 && code < 600)) {
    return true;
  }
  if (code === 403) {
    const errors = err?.errors ?? err?.response?.data?.error?.errors ?? [];
    return errors.some((e: any) => RETRYABLE_REASONS.has(e?.reason));
  }
  return false;
}
