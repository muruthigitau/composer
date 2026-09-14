/**
 * Resilient HTTP helper used by every AI provider.
 *
 * Retries a request when the provider:
 *  - is rate limited (HTTP 429) — honouring the server's `retryDelay` when given,
 *  - fails transiently (HTTP 408/5xx, connection errors, timeouts),
 * with exponential backoff and jitter. Every attempt has a hard timeout so a
 * stalled connection can never hang the extension indefinitely.
 *
 * Retries are safe here: all composer requests are read-only completions.
 */

/** Options controlling retry behaviour. */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  timeoutMs: 180000
};

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

/** True for transient server-side failures that are worth retrying. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || (status >= 500 && status < 600);
}

/** True for network/transport failures that never produced a response. */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = `${error.name}: ${error.message}`.toLowerCase();
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

/** Exponential backoff with jitter, capped at `maxDelayMs`. */
function backoffDelay(attempt: number, options: Required<RetryOptions>): number {
  const base = Math.min(options.baseDelayMs * Math.pow(2, attempt), options.maxDelayMs);
  return Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));
}

/**
 * Perform an HTTP request via `fetch`, retrying transient failures.
 *
 * Status-based failures (429 / 5xx) are returned to the caller as the final
 * `Response` so provider-specific error bodies can be surfaced. Transport
 * failures throw once the retries are exhausted.
 *
 * @param url Request URL.
 * @param init Request init (method, headers, body).
 * @param options Retry/timeout overrides.
 * @returns The HTTP response (successful, or the last error response).
 * @throws Error when the request could not be completed at all.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= settings.maxRetries) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(settings.timeoutMs)
      });
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= settings.maxRetries) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Request to ${hostname(url)} failed: ${detail}`);
      }
      const delayMs = backoffDelay(attempt, settings);
      console.warn(
        `[commit-composer] Network error (${lastError instanceof Error ? lastError.message : lastError}). ` +
          `Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${settings.maxRetries})…`
      );
      await sleep(delayMs);
      attempt++;
      continue;
    }

    if (!isRateLimitStatus(response.status) && !isTransientStatus(response.status)) {
      return response;
    }

    // Rate limited or transient server error — capture the body and retry.
    const errorText = await response.text();
    if (attempt >= settings.maxRetries) {
      return new Response(errorText, { status: response.status, headers: response.headers });
    }

    const serverRetrySec = parseRetryDelay(errorText);
    const delayMs =
      serverRetrySec !== undefined
        ? Math.min(serverRetrySec * 1000, settings.maxDelayMs)
        : backoffDelay(attempt, settings);

    console.warn(
      `[commit-composer] Request failed with ${response.status}. ` +
        `Retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${settings.maxRetries})…`
    );

    await sleep(delayMs);
    attempt++;
  }

  // Unreachable: the loop returns or throws on the final attempt.
  throw new Error(
    `Request to ${hostname(url)} failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`
  );
}

/** Hostname of a URL for error messages (never throws). */
function hostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
