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
  return request<{ username: string; user_id: number; is_admin: boolean }>("/auth/me");
}

// Scans
export interface ScanRequest {
  url: string;
  max_pages?: number;
  max_depth?: number;
  rate_limit?: number;
  tag_name?: string;
  tag_keywords?: string[];
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

export interface ScanElement {
  page_url: string;
  page_title: string | null;
  element_type: string;
  action_type: string | null;
  element_text: string | null;
  css_selector: string | null;
  section_context: string | null;
  container_context: string;
  is_above_fold: number;
  target_url: string | null;
  is_external: number;
  pharma_context: string | null;
  notes: string | null;
  page_count?: number;
  page_urls?: string;
}

export interface ScanDetail {
  scan: Record<string, unknown>;
  elements: ScanElement[];
  summary: {
    total_elements: number;
    by_type: Record<string, number>;
    pharma_flagged: number;
    analytics_detected: string[];
    tag_name: string;
  };
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

export function getScan(scanId: string, params?: { dedup?: boolean; hide_types?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.dedup) searchParams.set("dedup", "true");
  if (params?.hide_types) searchParams.set("hide_types", params.hide_types);
  const qs = searchParams.toString();
  return request<ScanDetail>(`/scans/${scanId}${qs ? `?${qs}` : ""}`);
}

// Exports
export function getExportUrl(scanId: string, format: "xlsx" | "csv", dedup?: boolean) {
  const base = `${BASE}/exports/${scanId}/${format}`;
  return dedup ? `${base}?dedup=true` : base;
}

// Admin
export interface AdminSettings {
  id: number;
  max_pages_limit: number;
  max_depth_limit: number;
  rate_limit_floor: number;
  rate_limit_ceiling: number;
  scan_timeout_seconds: number;
  auto_purge_enabled: number;
  auto_purge_days: number;
  last_purge_run: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  created_at: string;
  last_login: string | null;
  scan_count: number;
}

export interface AdminScan {
  scan_id: string;
  domain: string;
  scan_url: string;
  scan_status: string;
  pages_scanned: number;
  total_pages: number | null;
  crawl_date: string;
  duration_seconds: number | null;
  created_by: string;
}

export interface AdminStats {
  total_users: number;
  total_scans: number;
  total_elements: number;
  db_size_bytes: number;
  oldest_scan_date: string | null;
}

export function getAdminSettings() {
  return request<AdminSettings>("/admin/settings");
}

export function updateAdminSettings(data: Omit<AdminSettings, "id" | "last_purge_run" | "updated_at" | "updated_by">) {
  return request<{ message: string }>("/admin/settings", {
    method: "PUT",
    body: JSON.stringify({
      ...data,
      auto_purge_enabled: Boolean(data.auto_purge_enabled),
    }),
  });
}

export function listAllUsers() {
  return request<AdminUser[]>("/admin/users");
}

export function deleteUser(userId: number) {
  return request<{ message: string }>(`/admin/users/${userId}`, { method: "DELETE" });
}

export function listAllScans() {
  return request<AdminScan[]>("/admin/scans");
}

export function deleteScan(scanId: string) {
  return request<{ message: string }>(`/admin/scans/${scanId}`, { method: "DELETE" });
}

export function triggerPurge(days: number) {
  return request<{ message: string }>("/admin/purge", {
    method: "POST",
    body: JSON.stringify({ days }),
  });
}

export function getAdminStats() {
  return request<AdminStats>("/admin/stats");
}
