/**
 * Wrap the native fetch with an AbortController-driven timeout so a slow or
 * hung upstream (Hetzner, Scaleway, DNS-level failure) can't freeze a wizard
 * request indefinitely. Default 15s covers every legit API call; anything
 * longer than that is a network problem worth surfacing.
 */
export async function fetchWithTimeout(url, opts = {}, timeoutMs = 15_000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    }
    catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
        }
        throw err;
    }
    finally {
        clearTimeout(t);
    }
}
