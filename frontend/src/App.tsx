import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { LoginForm } from "./components/LoginForm";
import { ScanForm } from "./components/ScanForm";
import { getMe, logout, listScans } from "./lib/api";

const queryClient = new QueryClient();

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
    refetchInterval: 5000, // Poll for scan status updates
  });

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    window.location.reload();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-600";
      case "running": return "text-amber-500";
      case "failed": return "text-destructive";
      case "pending": return "text-muted-foreground";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TapMap</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.username}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          Sign out
        </button>
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
          <p className="text-sm text-muted-foreground">
            No scans yet. Enter a URL above to get started.
          </p>
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
                    <td className={`px-4 py-3 ${statusColor(scan.scan_status)}`}>
                      {scan.scan_status}
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
