import { useQuery } from "@tanstack/react-query";
import { getScan, getExportUrl } from "../lib/api";
import type { ScanElement } from "../lib/api";
import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import { DrillDownOverlay } from "./DrillDownOverlay";

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

type SortKey = "element_type" | "element_text" | "container_context" | "section_context" | "page_url" | "pharma_context";
type SortDir = "asc" | "desc";

export function ScanDetail({ scanId, onBack }: Props) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [containerFilter, setContainerFilter] = useState<string | null>(null);
  const [pharmaOnly, setPharmaOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [dedupEnabled, setDedupEnabled] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pagesDrillDown, setPagesDrillDown] = useState(false);
  const [tagDrillDown, setTagDrillDown] = useState(false);
  const PAGE_SIZE = 200;

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan", scanId, dedupEnabled],
    queryFn: () => getScan(scanId, dedupEnabled ? { dedup: true } : undefined),
    refetchInterval: (query) => {
      const status = query.state.data?.scan?.scan_status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  // Fuse.js index for fuzzy search
  const fuse = useMemo(() => {
    if (!data?.elements) return null;
    return new Fuse(data.elements, {
      keys: ["element_text", "page_url", "section_context", "page_title"],
      threshold: 0.3,
      ignoreLocation: true,
    });
  }, [data?.elements]);

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
  if (searchText && fuse) {
    const fuseResults = fuse.search(searchText);
    const resultSet = new Set(fuseResults.map((r) => r.item));
    filtered = filtered.filter((e) => resultSet.has(e));
  }

  // Apply sort
  if (sortBy) {
    filtered = [...filtered].sort((a, b) => {
      const aVal = String(a[sortBy] || "");
      const bVal = String(b[sortBy] || "");
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  // Get unique values for filters
  const types = Object.keys(summary.by_type);
  const containers = [...new Set(elements.map((e) => e.container_context))].sort();

  // Drill-down data
  const pageBreakdown = useMemo(() => {
    const map: Record<string, { title: string | null; count: number }> = {};
    for (const el of elements) {
      if (!map[el.page_url]) map[el.page_url] = { title: el.page_title, count: 0 };
      map[el.page_url].count++;
    }
    return Object.entries(map)
      .map(([url, { title, count }]) => ({ url, title, count }))
      .sort((a, b) => b.count - a.count);
  }, [elements]);

  const tagBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const el of elements) {
      if (el.pharma_context) {
        const label = PHARMA_LABELS[el.pharma_context] || el.pharma_context;
        map[label] = (map[label] || 0) + 1;
      }
    }
    return Object.entries(map)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count);
  }, [elements]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const SortArrow = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return null;
    return <span className="ml-0.5">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>;
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="mb-2 text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to scans
          </button>
          <h2 className="text-xl font-bold truncate">{String(scan.domain)}</h2>
          <p className="text-sm text-muted-foreground truncate">{String(scan.scan_url)}</p>
        </div>
        {!isRunning && elements.length > 0 && (
          <div className="flex gap-2 shrink-0">
            <a
              href={getExportUrl(scanId, "xlsx", dedupEnabled)}
              className="rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Export XLSX
            </a>
            <a
              href={getExportUrl(scanId, "csv", dedupEnabled)}
              className="rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-muted"
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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Pages"
            value={String(scan.pages_scanned || 0)}
            onClick={() => setPagesDrillDown(true)}
          />
          <MetricCard label="Elements" value={String(summary.total_elements)} />
          <MetricCard
            label={`${summary.tag_name} Flagged`}
            value={String(summary.pharma_flagged)}
            accent
            onClick={summary.pharma_flagged > 0 ? () => setTagDrillDown(true) : undefined}
          />
          <MetricCard
            label="Duration"
            value={scan.duration_seconds ? `${Number(scan.duration_seconds).toFixed(1)}s` : "\u2014"}
          />
        </div>
      )}

      {/* Analytics badges */}
      {!isRunning && summary.analytics_detected && summary.analytics_detected.length > 0 && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Analytics:
          </span>
          {summary.analytics_detected.map((fw) => (
            <span
              key={fw}
              className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
            >
              {fw}
            </span>
          ))}
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
        <div className="mb-3 flex flex-wrap gap-1.5">
          {types.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
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
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 transition-colors ${
                pharmaOnly ? "ring-2 ring-ring ring-offset-1" : ""
              }`}
            >
              {summary.tag_name.toLowerCase()} ({summary.pharma_flagged})
            </button>
          )}
        </div>
      )}

      {/* Dedup presets */}
      {!isRunning && summary.total_elements > 0 && (
        <div className="mb-3 flex gap-1.5">
          <button
            onClick={() => {
              setDedupEnabled(!dedupEnabled);
              setContainerFilter(null);
              setShowAll(false);
            }}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              dedupEnabled && !containerFilter
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
          >
            Deduplicate
          </button>
          <button
            onClick={() => {
              setDedupEnabled(true);
              setContainerFilter(null);
              setTypeFilter(null);
              setPharmaOnly(false);
              setShowAll(false);
            }}
            className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            Dedupe Globals
          </button>
          <button
            onClick={() => {
              setDedupEnabled(false);
              setTypeFilter(null);
              setContainerFilter(null);
              setPharmaOnly(false);
              setSearchText("");
              setShowAll(false);
              setSortBy(null);
            }}
            className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            Full Detail
          </button>
        </div>
      )}

      {/* Filters row */}
      {!isRunning && summary.total_elements > 0 && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search elements..."
            className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-[13px] outline-none ring-ring focus:ring-2"
          />
          <select
            value={containerFilter || ""}
            onChange={(e) => setContainerFilter(e.target.value || null)}
            className="rounded-lg border bg-background px-3 py-1.5 text-[13px] outline-none ring-ring focus:ring-2"
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
        <p className="mb-2 text-xs text-muted-foreground">
          Showing {filtered.length} of {elements.length} elements
          {dedupEnabled && " (deduplicated)"}
        </p>
      )}

      {/* Element table */}
      {!isRunning && filtered.length > 0 && (() => {
        const displayElements = showAll ? filtered : filtered.slice(0, PAGE_SIZE);
        const hasMore = filtered.length > PAGE_SIZE;
        return (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("element_type")}>
                      Type<SortArrow col="element_type" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("element_text")}>
                      Element Text<SortArrow col="element_text" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("container_context")}>
                      Container<SortArrow col="container_context" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("section_context")}>
                      Section<SortArrow col="section_context" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("page_url")}>
                      Page<SortArrow col="page_url" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("pharma_context")}>
                      {summary.tag_name}<SortArrow col="pharma_context" />
                    </th>
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
                className="mt-2 w-full rounded-lg border px-4 py-1.5 text-[13px] text-muted-foreground hover:bg-muted"
              >
                Show all {filtered.length} elements ({filtered.length - PAGE_SIZE} more)
              </button>
            )}
          </>
        );
      })()}

      {/* Scan info footer */}
      {!isRunning && (
        <div className="mt-5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <span className="font-medium">Scan ID:</span> {scanId}
            </div>
            <div>
              <span className="font-medium">Quality:</span> {String(scan.scan_quality || "\u2014")}
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

      {/* Pages drill-down overlay */}
      {pagesDrillDown && (
        <DrillDownOverlay title="Pages Crawled" onClose={() => setPagesDrillDown(false)}>
          <div className="space-y-1.5">
            {pageBreakdown.map((p) => (
              <div key={p.url} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate min-w-0 text-muted-foreground" title={p.url}>
                  {p.title || p.url}
                </span>
                <span className="shrink-0 font-medium">{p.count} elements</span>
              </div>
            ))}
          </div>
        </DrillDownOverlay>
      )}

      {/* Tag drill-down overlay */}
      {tagDrillDown && (
        <DrillDownOverlay title={`${summary.tag_name} Breakdown`} onClose={() => setTagDrillDown(false)}>
          <div className="space-y-2">
            {tagBreakdown.map((t) => (
              <div key={t.keyword} className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {t.keyword}
                </span>
                <span className="text-[13px] font-medium">{t.count} elements</span>
              </div>
            ))}
            {tagBreakdown.length === 0 && (
              <p className="text-sm text-muted-foreground">No tagged elements found.</p>
            )}
          </div>
        </DrillDownOverlay>
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
        <td className="px-3 py-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              TYPE_COLORS[el.element_type] || TYPE_COLORS.unknown
            }`}
          >
            {el.element_type}
          </span>
        </td>
        <td className="px-3 py-2 max-w-xs truncate font-medium">
          {el.element_text || <span className="text-muted-foreground italic">no text</span>}
          {el.page_count && el.page_count > 1 && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {el.page_count} pages
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-muted-foreground">{el.container_context}</td>
        <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
          {el.section_context || "\u2014"}
        </td>
        <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
          {el.page_title || el.page_url}
        </td>
        <td className="px-3 py-2">
          {el.pharma_context && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {PHARMA_LABELS[el.pharma_context] || el.pharma_context}
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={6} className="px-3 py-2.5">
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="font-medium text-muted-foreground">CSS Selector:</span>
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">
                  {el.css_selector || "\u2014"}
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
              {el.page_urls && (
                <div className="col-span-2">
                  <span className="font-medium text-muted-foreground">Seen on pages:</span>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {el.page_urls.split(",").map((url, i) => (
                      <li key={i} className="break-all">{url}</li>
                    ))}
                  </ul>
                </div>
              )}
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
  onClick,
}: {
  label: string;
  value: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-3 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
      onClick={onClick}
    >
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
