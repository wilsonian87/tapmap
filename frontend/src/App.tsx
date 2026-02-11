import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { LoginForm } from "./components/LoginForm";
import { ScanForm } from "./components/ScanForm";
import { ScanDetail } from "./components/ScanDetail";
import { getMe, logout, listScans } from "./lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

function Dashboard() {
  const [selectedScan, setSelectedScan] = useState<string | null>(null);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
  });

  const { data: scans, refetch: refetchScans } = useQuery({
    queryKey: ["scans"],
    queryFn: listScans,
    refetchInterval: 5000,
  });

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    window.location.reload();
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: "bg-green-100 text-green-700",
      running: "bg-amber-100 text-amber-700",
      pending: "bg-gray-100 text-gray-600",
      failed: "bg-red-100 text-red-700",
      timeout: "bg-orange-100 text-orange-700",
    };
    return styles[status] || styles.pending;
  };

  // If a scan is selected, show detail view
  if (selectedScan) {
    return (
      <div className="mx-auto max-w-6xl p-6 sm:p-8">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">TapMap</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.username}</span>
            <button
              onClick={handleLogout}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </header>
        <ScanDetail
          scanId={selectedScan}
          onBack={() => setSelectedScan(null)}
        />
      </div>
    );
  }

  // Default: scan list view
  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TapMap</h1>
          <p className="text-sm text-muted-foreground">
            Pharma site interaction discovery
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.username}</span>
          <button
            onClick={handleLogout}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mb-8">
        <ScanForm
          onScanCreated={(id) => {
            setSelectedScan(id);
            refetchScans();
          }}
        />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Scan History</h2>
        {!scans || scans.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              No scans yet. Enter a pharma brand URL above to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Pages</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.scan_id}
                    className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                    onClick={() => setSelectedScan(scan.scan_id)}
                  >
                    <td className="px-4 py-3 font-medium">{scan.domain}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(scan.scan_status)}`}
                      >
                        {scan.scan_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{scan.pages_scanned}</td>
                    <td className="px-4 py-3">
                      {scan.duration_seconds
                        ? `${scan.duration_seconds.toFixed(1)}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(scan.crawl_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    getMe()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!authed) {
    return <LoginForm onAuth={() => setAuthed(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

export default App;
