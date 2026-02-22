import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getScan, getScanProgress, getExportUrl, startClassification, getClassificationStatus, manualClassify } from "../lib/api";
import type { ScanElement } from "../lib/api";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Fuse from "fuse.js";
import { DrillDownOverlay } from "./DrillDownOverlay";
import { ElementTypeIcon } from "./ElementTypeIcon";

interface Props {
  scanId: string;
  onBack: () => void;
}

/** Convert a full URL to a relative path (e.g. "/" for homepage, "/about" for subpages). */
function toRelativePath(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return fullUrl;
  }
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
  custom: "Custom Tag",
};

const PHARMA_TAG_COLORS: Record<string, string> = {
  isi: "bg-amber-100 text-amber-700",
  adverse_event: "bg-red-100 text-red-700",
  patient_enrollment: "bg-green-100 text-green-700",
  hcp_gate: "bg-purple-100 text-purple-700",
  fair_balance: "bg-blue-100 text-blue-700",
  custom: "bg-amber-100 text-amber-700",
};

/** Parse "category:keyword" pharma_context into parts. */
function parsePharmaContext(ctx: string | null): { category: string; keyword: string | null } | null {
  if (!ctx) return null;
  const idx = ctx.indexOf(":");
  if (idx === -1) return { category: ctx, keyword: null };
  return { category: ctx.substring(0, idx), keyword: ctx.substring(idx + 1) };
}

type SortKey = "element_type" | "element_text" | "action_type" | "section_context" | "page_url" | "pharma_context";
type SortDir = "asc" | "desc";
type GroupBy = "flat" | "page" | "type";

/** Read filter state from URL search params */
function readFiltersFromUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    activeTypes: p.get("types")?.split(",").filter(Boolean) ?? null,
    activeContainers: p.get("containers")?.split(",").filter(Boolean) ?? null,
    pharmaOnly: p.get("pharma") === "1",
    searchText: p.get("q") ?? "",
    dedup: p.get("dedup") === "1",
    hideTypes: p.get("hide")?.split(",").filter(Boolean) ?? [],
    excludeTypes: p.get("xtype")?.split(",").filter(Boolean) ?? [],
    excludeActions: p.get("xaction")?.split(",").filter(Boolean) ?? [],
    groupBy: (p.get("group") as GroupBy) || "flat",
    sortBy: (p.get("sort") as SortKey) || null,
    sortDir: (p.get("dir") as SortDir) || "asc",
  };
}

/** Sync filter state to URL search params (replace, no navigation) */
function syncFiltersToUrl(state: {
  activeTypes: string[] | null;
  activeContainers: string[] | null;
  pharmaOnly: boolean;
  searchText: string;
  dedup: boolean;
  hideTypes: string[];
  excludeTypes: string[];
  excludeActions: string[];
  groupBy: GroupBy;
  sortBy: SortKey | null;
  sortDir: SortDir;
}) {
  const p = new URLSearchParams(window.location.search);
  const setOrDel = (key: string, val: string | null) => {
    if (val) p.set(key, val); else p.delete(key);
  };
  setOrDel("types", state.activeTypes?.join(",") || null);
  setOrDel("containers", state.activeContainers?.join(",") || null);
  setOrDel("pharma", state.pharmaOnly ? "1" : null);
  setOrDel("q", state.searchText || null);
  setOrDel("dedup", state.dedup ? "1" : null);
  setOrDel("hide", state.hideTypes.length ? state.hideTypes.join(",") : null);
  setOrDel("xtype", state.excludeTypes.length ? state.excludeTypes.join(",") : null);
  setOrDel("xaction", state.excludeActions.length ? state.excludeActions.join(",") : null);
  setOrDel("group", state.groupBy !== "flat" ? state.groupBy : null);
  setOrDel("sort", state.sortBy || null);
  setOrDel("dir", state.sortDir !== "asc" ? state.sortDir : null);
  const qs = p.toString();
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

export function ScanDetail({ scanId, onBack }: Props) {
  // Initialize from URL params
  const initFilters = useMemo(readFiltersFromUrl, []);
  const [activeTypes, setActiveTypes] = useState<string[] | null>(initFilters.activeTypes);
  const [activeContainers, setActiveContainers] = useState<string[] | null>(initFilters.activeContainers);
  const [pharmaOnly, setPharmaOnly] = useState(initFilters.pharmaOnly);
  const [searchText, setSearchText] = useState(initFilters.searchText);
  const [dedupEnabled, setDedupEnabled] = useState(initFilters.dedup);
  const [sortBy, setSortBy] = useState<SortKey | null>(initFilters.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initFilters.sortDir);
  const [hideTypes, setHideTypes] = useState<string[]>(initFilters.hideTypes);
  const [excludeTypes, setExcludeTypes] = useState<string[]>(initFilters.excludeTypes);
  const [excludeActions, setExcludeActions] = useState<string[]>(initFilters.excludeActions);
  const [groupBy, setGroupBy] = useState<GroupBy>(initFilters.groupBy);
  const [pageSize, setPageSize] = useState(100);
  const [currentPage, setCurrentPage] = useState(0);
  const [pagesDrillDown, setPagesDrillDown] = useState(false);
  const [tagDrillDown, setTagDrillDown] = useState(false);
  const [elementsDrillDown, setElementsDrillDown] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["scan", scanId, dedupEnabled, hideTypes.join(",")],
    queryFn: () => getScan(scanId, {
      ...(dedupEnabled && { dedup: true }),
      ...(hideTypes.length > 0 && { hide_types: hideTypes.join(",") }),
    }),
    refetchInterval: (query) => {
      const status = query.state.data?.scan?.scan_status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  const { data: classifyStatus } = useQuery({
    queryKey: ["classify-status", scanId],
    queryFn: () => getClassificationStatus(scanId),
    refetchInterval: (query) => {
      const status = query.state.data;
      if (classifying && status && !status.is_running && status.classified > 0) {
        // Classification just finished — trigger refresh
        setTimeout(() => {
          setClassifying(false);
          queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
        }, 0);
        return false;
      }
      return classifying ? 2000 : false;
    },
    enabled: !isLoading,
  });

  const handleClassify = useCallback(async () => {
    try {
      setClassifying(true);
      await startClassification(scanId);
    } catch {
      setClassifying(false);
    }
  }, [scanId]);

  // Live progress polling (separate from the heavy scan detail query)
  const scanStatus = data?.scan?.scan_status;
  const isRunningForProgress = scanStatus === "running" || scanStatus === "pending";
  const { data: progress } = useQuery({
    queryKey: ["scan-progress", scanId],
    queryFn: () => getScanProgress(scanId),
    refetchInterval: isRunningForProgress ? 1500 : false,
    enabled: isRunningForProgress,
  });

  // Client-side elapsed timer for smooth second-by-second updates
  const [elapsed, setElapsed] = useState(0);
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    if (!isRunningForProgress) return;
    mountTimeRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - mountTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunningForProgress]);

  // Sync filter state to URL params
  useEffect(() => {
    syncFiltersToUrl({
      activeTypes, activeContainers, pharmaOnly, searchText,
      dedup: dedupEnabled, hideTypes, excludeTypes, excludeActions, groupBy, sortBy, sortDir,
    });
  }, [activeTypes, activeContainers, pharmaOnly, searchText, dedupEnabled, hideTypes, excludeTypes, excludeActions, groupBy, sortBy, sortDir]);

  // Fuse.js index for fuzzy search
  const fuse = useMemo(() => {
    if (!data?.elements) return null;
    return new Fuse(data.elements, {
      keys: ["element_text", "page_url", "section_context", "page_title"],
      threshold: 0.3,
      ignoreLocation: true,
    });
  }, [data?.elements]);

  // Drill-down data (must be before early returns to satisfy React rules of hooks)
  const pageBreakdown = useMemo(() => {
    if (!data?.elements) return [];
    const map: Record<string, { title: string | null; count: number }> = {};
    for (const el of data.elements) {
      if (!map[el.page_url]) map[el.page_url] = { title: el.page_title, count: 0 };
      map[el.page_url].count++;
    }
    return Object.entries(map)
      .map(([url, { title, count }]) => ({ url, title, count }))
      .sort((a, b) => b.count - a.count);
  }, [data?.elements]);

  const tagBreakdown = useMemo(() => {
    if (!data?.elements) return [];
    const catMap: Record<string, { count: number; keywords: Record<string, number> }> = {};
    for (const el of data.elements) {
      if (el.pharma_context) {
        const parsed = parsePharmaContext(el.pharma_context);
        if (!parsed) continue;
        const catLabel = PHARMA_LABELS[parsed.category] || parsed.category;
        if (!catMap[catLabel]) catMap[catLabel] = { count: 0, keywords: {} };
        catMap[catLabel].count++;
        if (parsed.keyword) {
          catMap[catLabel].keywords[parsed.keyword] = (catMap[catLabel].keywords[parsed.keyword] || 0) + 1;
        }
      }
    }
    return Object.entries(catMap)
      .map(([category, { count, keywords }]) => ({
        category,
        count,
        keywords: Object.entries(keywords)
          .map(([kw, c]) => ({ keyword: kw, count: c }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data?.elements]);

  const containerBreakdown = useMemo(() => {
    if (!data?.elements) return [];
    const map: Record<string, number> = {};
    for (const el of data.elements) {
      const c = el.container_context || "unknown";
      map[c] = (map[c] || 0) + 1;
    }
    return Object.entries(map)
      .map(([container, count]) => ({ container, count }))
      .sort((a, b) => b.count - a.count);
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

  const { scan, elements, summary: rawSummary } = data;
  const summary = {
    ...rawSummary,
    tag_name: rawSummary.tag_name || "Pharma",
    analytics_detected: rawSummary.analytics_detected || [],
  };
  const isRunning = scan.scan_status === "running" || scan.scan_status === "pending";
  const hasAnyTier = elements.some((e) => e.value_tier);

  // Apply filters
  let filtered = elements;
  if (activeTypes && activeTypes.length > 0) {
    const typeSet = new Set(activeTypes);
    filtered = filtered.filter((e) => typeSet.has(e.element_type));
  }
  if (activeContainers && activeContainers.length > 0) {
    const containerSet = new Set(activeContainers);
    filtered = filtered.filter((e) => containerSet.has(e.container_context));
  }
  if (excludeTypes.length > 0) {
    const exSet = new Set(excludeTypes);
    filtered = filtered.filter((e) => !exSet.has(e.element_type));
  }
  if (excludeActions.length > 0) {
    const exSet = new Set(excludeActions);
    filtered = filtered.filter((e) => !exSet.has(e.action_type || ""));
  }
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
  const actionTypes = [...new Set(elements.map((e) => e.action_type).filter(Boolean))].sort() as string[];

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
            {!classifying && (!classifyStatus || classifyStatus.classified < classifyStatus.total) && (
              <button
                onClick={handleClassify}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-700 hover:bg-amber-100"
              >
                Classify with AI
              </button>
            )}
            {classifying && classifyStatus && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-700">
                <Spinner />
                <span>{classifyStatus.progress}%</span>
              </div>
            )}
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

      {/* Live progress card for running scans */}
      {isRunning && (() => {
        const pagesScanned = progress?.pages_scanned ?? 0;
        const elementsFound = progress?.total_elements ?? 0;
        const maxPages = progress?.config_max_pages ?? (Number(scan.config_max_pages) || 200);
        const progressPct = Math.min(100, Math.round((pagesScanned / maxPages) * 100));
        const currentUrl = progress?.current_url;
        const phase = !progress || progress.status === "pending"
          ? "Pending"
          : pagesScanned === 0
            ? "Starting..."
            : "Crawling";
        const displayElapsed = progress?.elapsed_seconds != null
          ? Math.max(Math.round(progress.elapsed_seconds), elapsed)
          : elapsed;
        const mins = Math.floor(displayElapsed / 60);
        const secs = displayElapsed % 60;
        const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        // Truncate URL to domain + path
        let shortUrl = "";
        if (currentUrl) {
          try {
            const u = new URL(currentUrl);
            shortUrl = u.pathname.length > 40
              ? u.hostname + u.pathname.slice(0, 37) + "..."
              : u.hostname + u.pathname;
          } catch { shortUrl = currentUrl.slice(0, 50); }
        }

        return (
          <div className="mb-6 rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Spinner />
                <span className="font-medium">{phase}</span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">{elapsedStr}</span>
            </div>

            {/* Progress bar */}
            <div className="mb-4 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${Math.max(progressPct, pagesScanned > 0 ? 2 : 0)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Pages Scanned
                </span>
                <p className="text-2xl font-bold tabular-nums">{pagesScanned}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Elements Found
                </span>
                <p className="text-2xl font-bold tabular-nums">{elementsFound}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Limit
                </span>
                <p className="text-2xl font-bold tabular-nums text-muted-foreground">{maxPages}</p>
              </div>
            </div>

            {shortUrl && (
              <p className="mt-3 truncate text-xs text-muted-foreground font-mono">
                {shortUrl}
              </p>
            )}
          </div>
        );
      })()}

      {/* Summary metrics */}
      {!isRunning && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Pages"
            value={String(scan.pages_scanned || 0)}
            onClick={() => setPagesDrillDown(true)}
          />
          <MetricCard
            label="Elements"
            value={String(summary.total_elements)}
            onClick={summary.total_elements > 0 ? () => setElementsDrillDown(true) : undefined}
          />
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

      {/* Toolbar: type chips + presets on one row, search/container/view on second row */}
      {!isRunning && summary.total_elements > 0 && (
        <div className="mb-4 space-y-2">
          {/* Row 1: Type filter chips + quick presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {types.map((type) => {
              const isActive = !activeTypes || activeTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => {
                    if (!activeTypes) {
                      setActiveTypes([type]);
                    } else if (activeTypes.includes(type)) {
                      const next = activeTypes.filter((t) => t !== type);
                      setActiveTypes(next.length ? next : null);
                    } else {
                      setActiveTypes([...activeTypes, type]);
                    }
                    setCurrentPage(0);
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
                    isActive ? "" : "opacity-30"
                  } ${TYPE_COLORS[type] || TYPE_COLORS.unknown}`}
                >
                  <ElementTypeIcon type={type} />
                  {type} ({summary.by_type[type]})
                </button>
              );
            })}
            {summary.pharma_flagged > 0 && (
              <button
                onClick={() => { setPharmaOnly(!pharmaOnly); setCurrentPage(0); }}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 transition-colors ${
                  pharmaOnly ? "ring-2 ring-ring ring-offset-1" : ""
                }`}
              >
                {summary.tag_name.toLowerCase()} ({summary.pharma_flagged})
              </button>
            )}
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              onClick={() => {
                setDedupEnabled(!dedupEnabled);
                setActiveContainers(null);
                setCurrentPage(0);
              }}
              className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                dedupEnabled ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              Dedup
            </button>
            <button
              onClick={() => setHideTypes(hideTypes.includes("link") ? [] : ["link"])}
              className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                hideTypes.includes("link") ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              Hide Links
            </button>
            <button
              onClick={() => {
                setDedupEnabled(false);
                setActiveTypes(null);
                setActiveContainers(null);
                setPharmaOnly(false);
                setSearchText("");
                setHideTypes([]);
                setExcludeTypes([]);
                setExcludeActions([]);
                setCurrentPage(0);
                setSortBy(null);
                setGroupBy("flat");
              }}
              className="rounded-lg border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Reset
            </button>
          </div>

          {/* Row 2: Search + exclude filters + group-by toggle */}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setCurrentPage(0); }}
              placeholder="Search elements..."
              className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-[13px] outline-none ring-ring focus:ring-2"
            />
            <ExcludeMultiSelect
              label="Exclude Type"
              options={types}
              selected={excludeTypes}
              onChange={(v) => { setExcludeTypes(v); setCurrentPage(0); }}
            />
            <ExcludeMultiSelect
              label="Exclude Action"
              options={actionTypes}
              selected={excludeActions}
              onChange={(v) => { setExcludeActions(v); setCurrentPage(0); }}
            />
            <div className="flex rounded-lg border overflow-hidden">
              {(["flat", "page", "type"] as GroupBy[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setGroupBy(mode)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    groupBy === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {mode === "flat" ? "Table" : mode === "page" ? "By Page" : "By Type"}
                </button>
              ))}
            </div>
          </div>

          {/* Results count */}
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {elements.length} elements
            {dedupEnabled && " (deduplicated)"}
          </p>
        </div>
      )}

      {/* Element display: flat table or grouped views */}
      {!isRunning && filtered.length > 0 && groupBy === "flat" && (() => {
        const totalPages = pageSize === 0 ? 1 : Math.ceil(filtered.length / pageSize);
        const safePage = Math.min(currentPage, totalPages - 1);
        const paginatedElements = pageSize === 0
          ? filtered
          : filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

        return (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("element_type")}>
                      Type<SortArrow col="element_type" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("element_text")}>
                      Element Text<SortArrow col="element_text" />
                    </th>
                    <th className="px-3 py-2 cursor-pointer select-none" onClick={() => handleSort("action_type")}>
                      Action<SortArrow col="action_type" />
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
                    {hasAnyTier && (
                      <th className="px-3 py-2">Value</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginatedElements.map((el, i) => (
                    <ElementRow key={el.id ?? i} element={el} showTier={hasAnyTier} scanId={scanId} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                {[50, 100, 200, 0].map((size) => (
                  <button
                    key={size}
                    onClick={() => { setPageSize(size); setCurrentPage(0); }}
                    className={`rounded px-2 py-0.5 transition-colors ${
                      pageSize === size ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                  >
                    {size === 0 ? "All" : size}
                  </button>
                ))}
              </div>
              {pageSize > 0 && totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                    className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-30"
                  >
                    &larr; Prev
                  </button>
                  <span className="tabular-nums">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages - 1, safePage + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-30"
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Group by Page */}
      {!isRunning && filtered.length > 0 && groupBy === "page" && (
        <GroupByPageView elements={filtered} hasAnyTier={hasAnyTier} scanId={scanId} />
      )}

      {/* Group by Type */}
      {!isRunning && filtered.length > 0 && groupBy === "type" && (
        <GroupByTypeView elements={filtered} hasAnyTier={hasAnyTier} scanId={scanId} />
      )}

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
                <div className="truncate min-w-0" title={p.url}>
                  <span className="font-medium">{toRelativePath(p.url)}</span>
                  {p.title && (
                    <span className="ml-1.5 text-muted-foreground">{p.title}</span>
                  )}
                </div>
                <span className="shrink-0 font-medium">{p.count} elements</span>
              </div>
            ))}
          </div>
        </DrillDownOverlay>
      )}

      {/* Tag drill-down overlay */}
      {tagDrillDown && (
        <DrillDownOverlay title={`${summary.tag_name} Breakdown`} onClose={() => setTagDrillDown(false)}>
          <div className="space-y-3">
            {tagBreakdown.map((t) => {
              const catKey = Object.entries(PHARMA_LABELS).find(([, v]) => v === t.category)?.[0] || "custom";
              const colorClass = PHARMA_TAG_COLORS[catKey] || "bg-amber-100 text-amber-700";
              return (
                <div key={t.category}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
                      {t.category}
                    </span>
                    <span className="text-[13px] font-medium">{t.count} elements</span>
                  </div>
                  {t.keywords.length > 0 && (
                    <div className="ml-4 space-y-0.5">
                      {t.keywords.map((kw) => (
                        <div key={kw.keyword} className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="italic">{kw.keyword}</span>
                          <span>{kw.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {tagBreakdown.length === 0 && (
              <p className="text-sm text-muted-foreground">No tagged elements found.</p>
            )}
          </div>
        </DrillDownOverlay>
      )}

      {/* Elements drill-down overlay */}
      {elementsDrillDown && (
        <DrillDownOverlay title="Elements Breakdown" onClose={() => setElementsDrillDown(false)}>
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">By Type</h4>
              <div className="space-y-1.5">
                {types.map((type) => (
                  <div key={type} className="flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[type] || TYPE_COLORS.unknown}`}>
                      {type}
                    </span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${(summary.by_type[type] / summary.total_elements) * 100}%` }}
                        />
                      </div>
                      <span className="text-[13px] font-medium shrink-0 w-12 text-right">{summary.by_type[type]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">By Container</h4>
              <div className="space-y-1.5">
                {containerBreakdown.map((c) => (
                  <div key={c.container} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium min-w-[80px]">{c.container}</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/40"
                          style={{ width: `${(c.count / summary.total_elements) * 100}%` }}
                        />
                      </div>
                      <span className="text-[13px] font-medium shrink-0 w-12 text-right">{c.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DrillDownOverlay>
      )}
    </div>
  );
}

function ExcludeMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-lg border px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
          selected.length > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-background hover:bg-muted"
        }`}
      >
        {selected.length > 0 ? `${label} (${selected.length})` : label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border bg-card shadow-lg p-1.5 min-w-[150px]">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => {
                  onChange(
                    selected.includes(opt)
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt]
                  );
                }}
                className="rounded"
              />
              {opt}
            </label>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted text-center"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupByPageView({ elements, hasAnyTier, scanId }: { elements: ScanElement[]; hasAnyTier: boolean; scanId: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, { title: string | null; elements: ScanElement[] }>();
    for (const el of elements) {
      if (!map.has(el.page_url)) map.set(el.page_url, { title: el.page_title, elements: [] });
      map.get(el.page_url)!.elements.push(el);
    }
    return [...map.entries()].sort((a, b) => b[1].elements.length - a[1].elements.length);
  }, [elements]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (url: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {groups.map(([url, { title, elements: els }]) => (
        <div key={url} className="rounded-xl border bg-card overflow-hidden">
          <button
            onClick={() => toggle(url)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
          >
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium">{toRelativePath(url)}</span>
              {title && <span className="ml-2 text-xs text-muted-foreground">{title}</span>}
            </div>
            <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {els.length}
            </span>
          </button>
          {!collapsed.has(url) && (
            <div className="border-t">
              <table className="w-full text-[13px]">
                <tbody>
                  {els.map((el, i) => (
                    <ElementRow key={i} element={el} showTier={hasAnyTier} scanId={scanId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GroupByTypeView({ elements, hasAnyTier, scanId }: { elements: ScanElement[]; hasAnyTier: boolean; scanId: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, ScanElement[]>();
    for (const el of elements) {
      const t = el.element_type || "unknown";
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(el);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [elements]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {groups.map(([type, els]) => (
        <div key={type} className="rounded-xl border bg-card overflow-hidden">
          <button
            onClick={() => toggle(type)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
          >
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[type] || TYPE_COLORS.unknown}`}>
              {type}
            </span>
            <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {els.length}
            </span>
          </button>
          {!collapsed.has(type) && (
            <div className="border-t">
              <table className="w-full text-[13px]">
                <tbody>
                  {els.map((el, i) => (
                    <ElementRow key={i} element={el} showTier={hasAnyTier} scanId={scanId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ElementRow({ element: el, showTier, scanId }: { element: ScanElement; showTier: boolean; scanId: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const tierColors: Record<string, string> = {
    HVA: "bg-green-100 text-green-700",
    MVA: "bg-amber-100 text-amber-700",
    LVA: "bg-gray-100 text-gray-600",
  };

  const handleTierChange = async (newTier: string) => {
    try {
      await manualClassify(scanId, el.id, newTier);
      queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    } catch {
      // silently fail — user can retry
    }
  };

  const colSpan = showTier ? 7 : 6;

  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-3 py-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              TYPE_COLORS[el.element_type] || TYPE_COLORS.unknown
            }`}
          >
            <ElementTypeIcon type={el.element_type} />
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
        <td className="px-3 py-2 text-muted-foreground">{el.action_type || "\u2014"}</td>
        <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground">
          {el.section_context || "\u2014"}
        </td>
        <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground" title={el.page_title || el.page_url}>
          {toRelativePath(el.page_url)}
        </td>
        <td className="px-3 py-2">
          {el.pharma_context && (() => {
            const parsed = parsePharmaContext(el.pharma_context);
            if (!parsed) return null;
            const colorClass = PHARMA_TAG_COLORS[parsed.category] || "bg-amber-100 text-amber-700";
            const label = PHARMA_LABELS[parsed.category] || parsed.category;
            return (
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                {label}
              </span>
            );
          })()}
        </td>
        {showTier && (
          <td className="px-3 py-2">
            {el.value_tier && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tierColors[el.value_tier] || "bg-gray-100 text-gray-600"}`}>
                {el.value_tier}
              </span>
            )}
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={colSpan} className="px-3 py-2.5">
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="font-medium text-muted-foreground">CSS Selector:</span>
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">
                  {el.css_selector || "\u2014"}
                </code>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Page:</span>
                <span className="ml-1 break-all" title={el.page_url}>{toRelativePath(el.page_url)}</span>
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
              {el.pharma_context && (() => {
                const parsed = parsePharmaContext(el.pharma_context);
                if (!parsed?.keyword) return null;
                return (
                  <div>
                    <span className="font-medium text-muted-foreground">Matched Keyword:</span>
                    <span className="ml-1 italic">{parsed.keyword}</span>
                  </div>
                );
              })()}
              {el.value_reason && (
                <div className="col-span-2">
                  <span className="font-medium text-muted-foreground">AI Reason:</span>
                  <span className="ml-1">{el.value_reason}</span>
                </div>
              )}
              {showTier && (
                <div>
                  <span className="font-medium text-muted-foreground">Value Tier:</span>
                  <select
                    value={el.value_tier || ""}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (e.target.value) handleTierChange(e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 rounded border bg-background px-1.5 py-0.5 text-xs"
                  >
                    <option value="">Unclassified</option>
                    <option value="HVA">HVA</option>
                    <option value="MVA">MVA</option>
                    <option value="LVA">LVA</option>
                  </select>
                </div>
              )}
              {el.page_urls && (
                <div className="col-span-2">
                  <span className="font-medium text-muted-foreground">Seen on pages:</span>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {el.page_urls.split(",").map((url, i) => (
                      <li key={i} className="break-all" title={url}>{toRelativePath(url)}</li>
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
  // Count-up animation for numeric values
  const numericValue = parseInt(value, 10);
  const isNumeric = !isNaN(numericValue) && String(numericValue) === value;
  const [displayVal, setDisplayVal] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isNumeric || hasAnimated.current || numericValue === 0) {
      setDisplayVal(numericValue);
      return;
    }
    hasAnimated.current = true;
    const duration = 600;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayVal(Math.round(eased * numericValue));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [numericValue, isNumeric]);

  return (
    <div
      className={`rounded-xl border bg-card p-3 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
      onClick={onClick}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-amber-600" : ""}`}>
        {isNumeric ? displayVal : value}
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
