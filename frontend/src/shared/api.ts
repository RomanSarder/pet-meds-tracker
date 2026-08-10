export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * The request never produced a response: offline, DNS failure, connection reset,
 * request aborted. Distinct from `ApiError`, which means the server DID answer.
 * The distinction is load-bearing for the session guard: a 401 is the server
 * revoking the session; a NetworkError is an ABSENCE of information and must
 * never revoke anything.
 */
export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
  }
}

export async function apiClient<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(typeof options?.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new NetworkError("Could not reach the server.", err);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? body.error ?? res.statusText, body);
  }
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}
