import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient, ApiError, NetworkError } from "./api";

function makeResponse(init: { ok: boolean; status?: number; body?: string }): Response {
  return {
    ok: init.ok,
    status: init.status ?? 200,
    statusText: "",
    json: async () => (init.body ? JSON.parse(init.body) : {}),
    text: async () => init.body ?? "",
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("rejects with NetworkError when fetch rejects", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw cause;
      }),
    );

    await expect(apiClient("/today")).rejects.toBeInstanceOf(NetworkError);
    await expect(apiClient("/today")).rejects.toMatchObject({
      message: "Could not reach the server.",
      cause,
    });
  });

  it("rejects with ApiError, not NetworkError, when the server answers 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse({ ok: false, status: 401, body: JSON.stringify({ message: "nope" }) })),
    );

    const rejection = apiClient("/today");
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.not.toBeInstanceOf(NetworkError);
    await expect(rejection).rejects.toMatchObject({ status: 401, message: "nope" });
  });

  it("resolves the parsed body on 200 with a JSON payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse({ ok: true, status: 200, body: JSON.stringify({ hello: "world" }) })),
    );

    await expect(apiClient("/today")).resolves.toEqual({ hello: "world" });
  });

  it("resolves null on 200 with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResponse({ ok: true, status: 200, body: "" })));

    await expect(apiClient("/today")).resolves.toBeNull();
  });
});
