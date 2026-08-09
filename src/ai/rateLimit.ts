/**
 * Retry a fetch call with exponential backoff when the provider returns a
 * rate-limit / quota error (HTTP 429 or 429-family error payloads).
 *
 * Many providers include a `retryDelay` field in the error body; we parse
 * what we can and fall back to exponential backoff.
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract a suggested retry delay (seconds) from an error body when present. */
function parseRetryDelay(errorBodyText: string): number | undefined {
  try {
    const data = JSON.parse(errorBodyText) as {
      error?: { details?: Array<{ retryDelay?: string; "@type"?: string }> };
    };
    for (const detail of data?.error?.details || []) {
      if (detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && detail.retryDelay) {
        // Format is "45.194883651s" -> 45.2s
        const match = detail.retryDelay.match(/^([\d.]+)s$/);
        if (match) {
          const secs = parseFloat(match[1]);
          if (!isNaN(secs) && secs > 0) return secs;
        }
      }
    }
  } catch {
    // Not JSON — ignore.
  }
  return undefined;
}

/** True when the HTTP status code means "rate limited / quota exceeded". */
export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}

/**
 * Perform an HTTP request via fetch, retrying on rate-limit errors with
 * exponential backoff. Returns the fetch Response when it eventually succeeds.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetch(url, init);

    if (!isRateLimitStatus(response.status)) {
      return response;
    }

    // 429 (rate limited / quota exceeded) — we should retry.
    const errorText = await response.text();
    const serverRetrySec = parseRetryDelay(errorText);

    if (attempt >= maxRetries) {
      // Last attempt: return the 429 response so callers see the real error.
      return new Response(errorText, { status: response.status, headers: response.headers });
    }

    const delayMs =
      serverRetrySec !== undefined
        ? Math.min(serverRetrySec * 1000, maxDelayMs)
        : Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

    console.warn(
      `[commit-composer] Rate limited (${response.status}). Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`
    );

    await sleep(delayMs);
    attempt++;
  }
}