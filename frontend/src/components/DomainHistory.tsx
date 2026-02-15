import { useQuery } from "@tanstack/react-query";
import { getDomainScans } from "../lib/api";
import type { DomainScanHistory } from "../lib/api";
import { useState } from "react";

interface Props {
  domain: string;
  onBack: () => void;
  onSelectScan: (scanId: string) => void;
  onCompare: (scanA: string, scanB: string) => void;
}

export function DomainHistory({ domain, onBack, onSelectScan, onCompare }: Props) {
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const { data: scans, isLoading, error } = useQuery({
    queryKey: ["domain-scans", domain],
    queryFn: () => getDomainScans(domain),
  });

  const toggleCompare = (scanId: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(scanId)) return prev.filter((id) => id !== scanId);
      if (prev.length >= 2) return [prev[1], scanId];
      return [...prev, scanId];
    });
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

  const trendArrow = (current: number, previous: number | null) => {
    if (previous === null) return null;
    if (current > previous) return <span className="text-green-600 text-xs ml-1" title={`+${current - previous}`}>&#9650;</span>;
    if (current < previous) return <span className="text-red-600 text-xs ml-1" title={`${current - previous}`}>&#9660;</span>;
    return <span className="text-muted-foreground text-xs ml-1">&#9644;</span>;
  };

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading domain history...</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to load domain history: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!scans || scans.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No scans found for {domain}.
      </div>
    );
  }

  // Scans are ordered DESC — reversed copy for trend comparison (oldest first)
  const chronological = [...scans].reverse();

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-2 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to scans
        </button>
        <h2 className="text-xl font-bold">{domain}</h2>
        <p className="text-sm text-muted-foreground">{scans.length} scan{scans.length !== 1 ? "s" : ""}</p>
      </div>

      {compareSelection.length === 2 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border bg-primary/5 p-3">
          <span className="text-sm font-medium">Compare selected scans</span>
          <button
            onClick={() => onCompare(compareSelection[0], compareSelection[1])}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            View Diff
          </button>
          <button
            onClick={() => setCompareSelection([])}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Clear
          </button>
        </div>
      )}

      <div className="rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 w-8">
                <span title="Select two scans to compare">Diff</span>
              </th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Pages</th>
              <th className="px-3 py-2">Elements</th>
              <th className="px-3 py-2">Pharma Flagged</th>
              <th className="px-3 py-2">Duration</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((scan) => {
              const chronoIdx = chronological.findIndex((s) => s.scan_id === scan.scan_id);
              const prev: DomainScanHistory | null = chronoIdx > 0 ? chronological[chronoIdx - 1] : null;

              return (
                <tr
                  key={scan.scan_id}
                  className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                  onClick={() => onSelectScan(scan.scan_id)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={compareSelection.includes(scan.scan_id)}
                      onChange={() => toggleCompare(scan.scan_id)}
                      disabled={scan.scan_status !== "completed"}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {new Date(scan.crawl_date).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(scan.scan_status)}`}>
                      {scan.scan_status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {scan.pages_scanned}
                    {trendArrow(scan.pages_scanned, prev?.pages_scanned ?? null)}
                  </td>
                  <td className="px-3 py-2">
                    {scan.element_count}
                    {trendArrow(scan.element_count, prev?.element_count ?? null)}
                  </td>
                  <td className="px-3 py-2">
                    {scan.pharma_count}
                    {trendArrow(scan.pharma_count, prev?.pharma_count ?? null)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {scan.duration_seconds ? `${Number(scan.duration_seconds).toFixed(1)}s` : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
