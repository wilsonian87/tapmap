const BASE = "/api";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  return res.json();
}

// Auth
export function login(username: string, password: string) {
  return request<{ username: string; message: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function register(username: string, password: string) {
  return request<{ username: string; message: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request<{ message: string }>("/auth/logout", { method: "POST" });
}

export function getMe() {
  return request<{ username: string; user_id: number }>("/auth/me");
}

// Scans
export interface ScanRequest {
  url: string;
  max_pages?: number;
  max_depth?: number;
  rate_limit?: number;
}

export interface ScanSummary {
  scan_id: string;
  domain: string;
  scan_url: string;
  scan_status: string;
  pages_scanned: number;
  total_pages: number | null;
  crawl_date: string;
  duration_seconds: number | null;
}

export function createScan(data: ScanRequest) {
  return request<{ scan_id: string; status: string; domain: string }>(
    "/scans",
    { method: "POST", body: JSON.stringify(data) }
  );
}

export function listScans() {
  return request<ScanSummary[]>("/scans");
}

export function getScan(scanId: string) {
  return request<{ scan: Record<string, unknown>; elements: Record<string, unknown>[] }>(
    `/scans/${scanId}`
  );
}
