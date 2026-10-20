import { describe, it, expect, vi } from "vitest";
import { ApiClient } from "../src/api/client";

describe("ApiClient", () => {
  it("sends the session header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: "hi" }) });
    vi.stubGlobal("fetch", fetchMock);
    await new ApiClient({ baseUrl: "http://cell", session: "s1" }).sendChat("hello");
    expect(fetchMock.mock.calls[0][1].headers["X-Session"]).toBe("s1");
  });
});
