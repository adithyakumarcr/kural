// Requests to the cell backend. Every call goes through request(), which adds the session header.
export interface ApiOptions { baseUrl: string; session: string }

export class ApiClient {
  constructor(private opts: ApiOptions) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, { ...init, headers: { ...init.headers, "X-Session": this.opts.session } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json() as Promise<T>;
  }

  sendChat(text: string) { return this.request<{ reply: string }>("/chat", { method: "POST", body: JSON.stringify({ text }) }); }
  uploadProgram(jobId: string, program: string) { return this.request<{ ok: boolean }>(`/jobs/${jobId}/program`, { method: "PUT", body: program }); }
}
