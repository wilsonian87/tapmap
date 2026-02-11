import { useQuery } from "@tanstack/react-query";
import { getScan, getExportUrl } from "../lib/api";
import type { ScanElement } from "../lib/api";
import { useState } from "react";

interface Props {
  scanId: string;
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

const PHARMA_LABELS: Record<string, string> = {
  isi: "ISI / Safety",
  adverse_event: "Adverse Event",
  patient_enrollment: "Patient Enrollment",
  hcp_gate: "HCP Gate",
  fair_balance: "Fair Balance",
};

export function ScanDetail({ scanId, onBack }: Props) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [containerFilter, setContainerFilter] = useState<string | null>(null);
  const [pharmaOnly, setPharmaOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const PAGE_SIZE = 200;

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => getScan(scanId),
    refetchInterval: (query) => {
      const status = query.state.data?.scan?.scan_status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
        <Spinner /> Loading scan...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to load scan: {error.message}
      </div>
    );
  }

  if (!data) return null;

  const { scan, elements, summary } = data;
  const isRunning = scan.scan_status === "running" || scan.scan_status === "pending";

  // Apply filters
  let filtered = elements;
  if (typeFilter) filtered = filtered.filter((e) => e.element_type === typeFilter);
  if (containerFilter) filtered = filtered.filter((e) => e.container_context === containerFilter);
  if (pharmaOnly) filtered = filtered.filter((e) => e.pharma_context);
  if (searchText) {
    const q = searchText.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        (e.element_text || "").toLowerCase().includes(q) ||
        (e.page_url || "").toLowerCase().includes(q) ||
        (e.section_context || "").toLowerCase().includes(q)
    );
  }

  // Get unique values for filters
  const types = Object.keys(summary.by_type);
  const containers = [...new Set(elements.map((e) => e.container_context))].sort();

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <button
            onClick={onBack}
            className="mb-2 text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to scans
          </button>
          <h2 className="text-xl font-bold truncate max-w-md">{String(scan.domain)}</h2>
          <p className="text-sm text-muted-foreground truncate max-w-md">{String(scan.scan_url)}</p>
        </div>
        {!isRunning && elements.length > 0 && (
          <div className="flex gap-2">
            <a
              href={getExportUrl(scanId, "xlsx")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Export XLSX
            </a>
            <a
              href={getExportUrl(scanId, "csv")}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Export CSV
            </a>
          </div>
        )}
      </div>

      {/* Progress bar for running scans */}
      {isRunning && (
        <div className="mb-6 rounded-xl border bg-card p-6">
          <div className="flex items-center gap-3 mb-3">
            <Spinner />
            <span className="font-medium">Scan in progress...</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pages Scanned
              </span>
              <p className="text-2xl font-bold">{String(scan.pages_scanned || 0)}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Elements Found
              </span>
              <p className="text-2xl font-bold">{summary.total_elements}</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary metrics */}
      {!isRunning && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Pages" value={String(scan.pages_scanned || 0)} />
          <MetricCard label="Elements" value={String(summary.total_elements)} />
          <MetricCard label="Pharma Flagged" value={String(summary.pharma_flagged)} accent />
          <MetricCard
            label="Duration"
            value={scan.duration_seconds ? `${Number(scan.duration_seconds).toFixed(1)}s` : "—"}
          />
        </div>
      )}

      {/* Failed / timeout scan banner */}
      {!isRunning && (scan.scan_status === "failed" || scan.scan_status === "timeout") && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">
            Scan {scan.scan_status === "timeout" ? "timed out" : "failed"}
          </p>
          {scan.notes ? (
            <p className="mt-1 text-sm text-muted-foreground">{String(scan.notes)}</p>
          ) : null}
        </div>
      )}

      {/* Empty state for 0 elements */}
      {!isRunning && scan.scan_status === "completed" && summary.total_elements === 0 && (
        <div className="mb-6 rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No interactive elements found on this site. This may indicate anti-bot protection or a very minimal page.
          </p>
        </div>
      )}

      {/* Type breakdown chips */}
      {!isRunning && summary.total_elements > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {types.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === type
                  ? "ring-2 ring-ring ring-offset-1"
                  : ""
              } ${TYPE_COLORS[type] || TYPE_COLORS.unknown}`}
            >
              {type} ({summary.by_type[type]})
            </button>
          ))}
          {summary.pharma_flagged > 0 && (
            <button
              onClick={() => setPharmaOnly(!pharmaOnly)}
              className={`rounded-full px-3 py-1 text-xs font-medium bg-amber-100 text-amber-700 transition-colors ${
                pharmaOnly ? "ring-2 ring-ring ring-offset-1" : ""
              }`}
            >
              pharma ({summary.pharma_flagged})
            </button>
          )}
        </div>
      )}

      {/* Filters row */}
      {!isRunning && summary.total_elements > 0 && (
        <div className="mb-4 flex gap-3">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search elements..."
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <select
            value={containerFilter || ""}
            onChange={(e) => setContainerFilter(e.target.value || null)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          >
            <option value="">All containers</option>
            {containers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {/* Results count */}
      {!isRunning && summary.total_elements > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Showing {filtered.length} of {elements.length} elements
        </p>
      )}

      {/* Element table */}
      {!isRunning && filtered.length > 0 && (() => {
        const displayElements = showAll ? filtered : filtered.slice(0, PAGE_SIZE);
        const hasMore = filtered.length > PAGE_SIZE;
        return (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Element Text</th>
                    <th className="px-4 py-3">Container</th>
                    <th className="px-4 py-3">Section</th>
                    <th className="px-4 py-3">Page</th>
                    <th className="px-4 py-3">Pharma</th>
                  </tr>
                </thead>
                <tbody>
                  {displayElements.map((el, i) => (
                    <ElementRow key={i} element={el} />
                  ))}
                </tbody>
              </table>
            </div>
            {hasMore && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-3 w-full rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                Show all {filtered.length} elements ({filtered.length - PAGE_SIZE} more)
              </button>
            )}
          </>
        );
      })()}

      {/* Scan info footer */}
      {!isRunning && (
        <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <span className="font-medium">Scan ID:</span> {scanId}
            </div>
            <div>
              <span className="font-medium">Quality:</span> {String(scan.scan_quality || "—")}
            </div>
            <div>
              <span className="font-medium">Consent:</span>{" "}
              {scan.consent_detected
                ? `${scan.consent_framework} / ${scan.consent_action}`
                : "None detected"}
            </div>
            <div>
              <span className="font-medium">robots.txt:</span>{" "}
              {scan.robots_txt_found ? "Found, respected" : "Not found"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ElementRow({ element: el }: { element: ScanElement }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-2.5">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              TYPE_COLORS[el.element_type] || TYPE_COLORS.unknown
            }`}
          >
            {el.element_type}
          </span>
        </td>
        <td className="px-4 py-2.5 max-w-xs truncate font-medium">
          {el.element_text || <span className="text-muted-foreground italic">no text</span>}
        </td>
        <td className="px-4 py-2.5 text-muted-foreground">{el.container_context}</td>
        <td className="px-4 py-2.5 max-w-[200px] truncate text-muted-foreground">
          {el.section_context || "—"}
        </td>
        <td className="px-4 py-2.5 max-w-[200px] truncate text-muted-foreground">
          {el.page_title || el.page_url}
        </td>
        <td className="px-4 py-2.5">
          {el.pharma_context && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {PHARMA_LABELS[el.pharma_context] || el.pharma_context}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="font-medium text-muted-foreground">CSS Selector:</span>
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">
                  {el.css_selector || "—"}
                </code>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Page URL:</span>
                <span className="ml-1 break-all">{el.page_url}</span>
              </div>
              {el.target_url && (
                <div>
                  <span className="font-medium text-muted-foreground">Target URL:</span>
                  <span className="ml-1 break-all">{el.target_url}</span>
                  {el.is_external ? (
                    <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                      external
                    </span>
                  ) : null}
                </div>
              )}
              <div>
                <span className="font-medium text-muted-foreground">Above Fold:</span>
                <span className="ml-1">{el.is_above_fold ? "Yes" : "No"}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className={`text-2xl font-bold ${accent ? "text-amber-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-primary"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
