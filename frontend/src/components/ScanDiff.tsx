import { useQuery } from "@tanstack/react-query";
import { diffScans } from "../lib/api";
import type { DiffElement } from "../lib/api";
import { useState } from "react";

interface Props {
  scanA: string;
  scanB: string;
  onBack: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  link: "bg-blue-100 text-blue-700",
  button: "bg-purple-100 text-purple-700",
  form: "bg-green-100 text-green-700",
  download: "bg-amber-100 text-amber-700",
  tab: "bg-cyan-100 text-cyan-700",
  accordion: "bg-indigo-100 text-indigo-700",
  menu: "bg-pink-100 text-pink-700",
  unknown: "bg-gray-100 text-gray-700",
};

function toRelativePath(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return fullUrl;
  }
}

type DiffTab = "added" | "removed" | "unchanged";

export function ScanDiff({ scanA, scanB, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<DiffTab>("added");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan-diff", scanA, scanB],
    queryFn: () => diffScans(scanA, scanB),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Computing diff...</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to compute diff: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (!data) return null;

  const { summary, added, removed, unchanged } = data;

  const tabConfig: { key: DiffTab; label: string; count: number; color: string; bgColor: string }[] = [
    { key: "added", label: "Added", count: summary.added_count, color: "text-green-700", bgColor: "bg-green-100" },
    { key: "removed", label: "Removed", count: summary.removed_count, color: "text-red-700", bgColor: "bg-red-100" },
    { key: "unchanged", label: "Unchanged", count: summary.unchanged_count, color: "text-gray-600", bgColor: "bg-gray-100" },
  ];

  const currentElements: DiffElement[] =
    activeTab === "added" ? added :
    activeTab === "removed" ? removed :
    unchanged;

  const rowBg =
    activeTab === "added" ? "bg-green-50/50" :
    activeTab === "removed" ? "bg-red-50/50" :
    "";

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-2 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back
        </button>
        <h2 className="text-xl font-bold">Scan Comparison</h2>
        <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium">Scan A:</span>{" "}
            <span className="font-mono text-xs">{scanA.substring(0, 20)}...</span>
          </div>
          <div>
            <span className="font-medium">Scan B:</span>{" "}
            <span className="font-mono text-xs">{scanB.substring(0, 20)}...</span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {tabConfig.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              if (tab.key === "unchanged") setShowUnchanged(true);
            }}
            className={`rounded-xl border p-3 text-left transition-colors ${
              activeTab === tab.key ? "ring-2 ring-ring" : "hover:border-primary/40"
            }`}
          >
            <span className={`text-xs font-medium uppercase tracking-wider ${tab.color}`}>
              {tab.label}
            </span>
            <p className="text-2xl font-bold">{tab.count}</p>
          </button>
        ))}
      </div>

      {/* Element list */}
      {activeTab === "unchanged" && !showUnchanged ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground mb-3">
            {summary.unchanged_count} unchanged elements hidden
          </p>
          <button
            onClick={() => setShowUnchanged(true)}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
          >
            Show unchanged elements
          </button>
        </div>
      ) : currentElements.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No {activeTab} elements.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Element Text</th>
                <th className="px-3 py-2">Container</th>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Page</th>
              </tr>
            </thead>
            <tbody>
              {currentElements.map((el, i) => (
                <tr key={i} className={`border-b last:border-0 ${rowBg}`}>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[el.element_type] || TYPE_COLORS.unknown}`}>
                      {el.element_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate font-medium">
                    {el.element_text || <span className="text-muted-foreground italic">no text</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{el.container_context}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
                    {el.section_context || "\u2014"}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground" title={el.page_url}>
                    {toRelativePath(el.page_url)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary footer */}
      <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-medium">Total:</span>{" "}
        <span className="text-green-700">+{summary.added_count} added</span>,{" "}
        <span className="text-red-700">-{summary.removed_count} removed</span>,{" "}
        <span>{summary.unchanged_count} unchanged</span>
      </div>
    </div>
  );
}
