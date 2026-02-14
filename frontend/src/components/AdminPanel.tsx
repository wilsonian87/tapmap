import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAdminSettings,
  updateAdminSettings,
  listAllUsers,
  deleteUser,
  listAllScans,
  deleteScan,
  triggerPurge,
  getAdminStats,
  type AdminSettings,
} from "../lib/api";
import { DrillDownOverlay } from "./DrillDownOverlay";

type Tab = "settings" | "users" | "data";

interface Props {
  onBack: () => void;
}

export function AdminPanel({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("settings");

  const tabs: { key: Tab; label: string }[] = [
    { key: "settings", label: "Settings" },
    { key: "users", label: "Users" },
    { key: "data", label: "Data" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold tracking-tight">Admin Panel</h1>
      </div>

      <div className="mb-6 flex gap-1 rounded-lg border bg-muted/50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "settings" && <SettingsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "data" && <DataTab />}
    </div>
  );
}

// --- Settings Tab ---

function SettingsTab() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: getAdminSettings,
  });

  const [form, setForm] = useState<Partial<AdminSettings>>({});
  const merged = { ...settings, ...form };

  const mutation = useMutation({
    mutationFn: () =>
      updateAdminSettings({
        max_pages_limit: merged.max_pages_limit!,
        max_depth_limit: merged.max_depth_limit!,
        rate_limit_floor: merged.rate_limit_floor!,
        rate_limit_ceiling: merged.rate_limit_ceiling!,
        scan_timeout_seconds: merged.scan_timeout_seconds!,
        auto_purge_enabled: merged.auto_purge_enabled!,
        auto_purge_days: merged.auto_purge_days!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      setForm({});
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading settings...</p>;
  if (!settings) return <p className="text-destructive">Failed to load settings.</p>;

  const set = (key: keyof AdminSettings, value: number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const hasChanges = Object.keys(form).length > 0;

  return (
    <div className="rounded-xl border bg-card p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
          Scan Limits
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max Pages Limit" value={merged.max_pages_limit!} onChange={(v) => set("max_pages_limit", v)} min={1} max={10000} />
          <Field label="Max Depth Limit" value={merged.max_depth_limit!} onChange={(v) => set("max_depth_limit", v)} min={1} max={100} />
          <Field label="Rate Limit Floor (req/s)" value={merged.rate_limit_floor!} onChange={(v) => set("rate_limit_floor", v)} min={0.1} max={10} step={0.1} />
          <Field label="Rate Limit Ceiling (req/s)" value={merged.rate_limit_ceiling!} onChange={(v) => set("rate_limit_ceiling", v)} min={0.1} max={10} step={0.1} />
          <Field label="Scan Timeout (seconds)" value={merged.scan_timeout_seconds!} onChange={(v) => set("scan_timeout_seconds", v)} min={60} max={7200} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider text-muted-foreground">
          Auto-Purge
        </h3>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(merged.auto_purge_enabled)}
              onChange={(e) => set("auto_purge_enabled", e.target.checked ? 1 : 0)}
              className="rounded"
            />
            Enable auto-purge
          </label>
          {Boolean(merged.auto_purge_enabled) && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete scans older than</span>
              <input
                type="number"
                value={merged.auto_purge_days!}
                onChange={(e) => set("auto_purge_days", Number(e.target.value))}
                min={1}
                max={3650}
                className="w-20 rounded-lg border bg-background px-2 py-1 text-sm outline-none ring-ring focus:ring-2"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          )}
        </div>
        {settings.last_purge_run && (
          <p className="text-xs text-muted-foreground">
            Last purge: {new Date(settings.last_purge_run).toLocaleString()}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={!hasChanges || mutation.isPending}
          className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving..." : "Save Settings"}
        </button>
        {mutation.isSuccess && <span className="text-sm text-green-600">Saved</span>}
        {mutation.isError && (
          <span className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Save failed"}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
      />
    </div>
  );
}

// --- Users Tab ---

function UsersTab() {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; username: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAllUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setConfirmDelete(null);
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading users...</p>;

  return (
    <>
      <div className="rounded-xl border bg-card">
        {!users || users.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">No users found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Scans</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">{u.scan_count}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmDelete({ id: u.id, username: u.username })}
                      className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <DrillDownOverlay
          title="Confirm Delete"
          onClose={() => setConfirmDelete(null)}
        >
          <p className="mb-4 text-sm">
            Delete user <strong>{confirmDelete.username}</strong>? Their scans will be preserved but orphaned.
          </p>
          {deleteMutation.isError && (
            <p className="mb-3 text-sm text-destructive">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </DrillDownOverlay>
      )}
    </>
  );
}

// --- Data Tab ---

function DataTab() {
  const queryClient = useQueryClient();
  const [confirmDeleteScan, setConfirmDeleteScan] = useState<string | null>(null);
  const [purgeDays, setPurgeDays] = useState(90);

  const { data: scans, isLoading: scansLoading } = useQuery({
    queryKey: ["admin-scans"],
    queryFn: listAllScans,
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: getAdminStats,
  });

  const deleteMutation = useMutation({
    mutationFn: (scanId: string) => deleteScan(scanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-scans"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setConfirmDeleteScan(null);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: () => triggerPurge(purgeDays),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-scans"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusBadge = (s: string) => {
    const styles: Record<string, string> = {
      completed: "bg-green-100 text-green-700",
      running: "bg-amber-100 text-amber-700",
      pending: "bg-gray-100 text-gray-600",
      failed: "bg-red-100 text-red-700",
      timeout: "bg-orange-100 text-orange-700",
    };
    return styles[s] || styles.pending;
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Users" value={stats.total_users} />
          <StatCard label="Scans" value={stats.total_scans} />
          <StatCard label="Elements" value={stats.total_elements.toLocaleString()} />
          <StatCard label="DB Size" value={formatBytes(stats.db_size_bytes)} />
        </div>
      )}

      {/* Manual purge */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider text-muted-foreground">
          Manual Purge
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm">Delete scans older than</span>
          <input
            type="number"
            value={purgeDays}
            onChange={(e) => setPurgeDays(Number(e.target.value))}
            min={1}
            max={3650}
            className="w-20 rounded-lg border bg-background px-2 py-1.5 text-sm outline-none ring-ring focus:ring-2"
          />
          <span className="text-sm">days</span>
          <button
            onClick={() => purgeMutation.mutate()}
            disabled={purgeMutation.isPending}
            className="rounded-lg bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {purgeMutation.isPending ? "Purging..." : "Purge"}
          </button>
        </div>
        {purgeMutation.isSuccess && (
          <p className="mt-2 text-sm text-green-600">
            {(purgeMutation.data as { message: string }).message}
          </p>
        )}
        {purgeMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {purgeMutation.error instanceof Error ? purgeMutation.error.message : "Purge failed"}
          </p>
        )}
      </div>

      {/* All scans */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            All Scans
          </h3>
        </div>
        {scansLoading ? (
          <p className="p-6 text-center text-muted-foreground">Loading scans...</p>
        ) : !scans || scans.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">No scans found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.scan_id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium max-w-[180px] truncate">{s.domain}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.created_by}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(s.scan_status)}`}>
                      {s.scan_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(s.crawl_date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmDeleteScan(s.scan_id)}
                      className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDeleteScan && (
        <DrillDownOverlay
          title="Confirm Delete"
          onClose={() => setConfirmDeleteScan(null)}
        >
          <p className="mb-4 text-sm">
            Delete this scan and all its elements? This cannot be undone.
          </p>
          {deleteMutation.isError && (
            <p className="mb-3 text-sm text-destructive">
              {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => deleteMutation.mutate(confirmDeleteScan)}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDeleteScan(null)}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </DrillDownOverlay>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
