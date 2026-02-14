import { useState } from "react";
import { createScan } from "../lib/api";

interface Props {
  onScanCreated: (scanId: string) => void;
}

export function ScanForm({ onScanCreated }: Props) {
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [maxDepth, setMaxDepth] = useState(5);
  const [rateLimit, setRateLimit] = useState(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCustomTag, setShowCustomTag] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagKeywords, setTagKeywords] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Auto-prepend https:// if no scheme provided
    let normalizedUrl = url.trim();
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
      setUrl(normalizedUrl);
    }

    try {
      const keywords = tagKeywords
        .split("\n")
        .map((k) => k.trim())
        .filter(Boolean);
      const result = await createScan({
        url: normalizedUrl,
        max_pages: maxPages,
        max_depth: maxDepth,
        rate_limit: rateLimit,
        ...(showCustomTag && tagName ? { tag_name: tagName } : {}),
        ...(showCustomTag && keywords.length > 0 ? { tag_keywords: keywords } : {}),
      });
      onScanCreated(result.scan_id);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">New Scan</h2>

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Website URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="www.example-pharma.com"
          required
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      <div className="mb-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          Advanced settings
        </button>
        <span className="text-border">|</span>
        <button
          type="button"
          onClick={() => setShowCustomTag(!showCustomTag)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className={`h-3 w-3 transition-transform ${showCustomTag ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          Custom tag
        </button>
      </div>

      {showAdvanced && (
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Max Pages
            </label>
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              min={1}
              max={1000}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Max Depth
            </label>
            <input
              type="number"
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              min={1}
              max={20}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Rate (req/s)
            </label>
            <input
              type="number"
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              min={0.5}
              max={5}
              step={0.5}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>
        </div>
      )}

      {showCustomTag && (
        <div className="mb-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tag Name
            </label>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="e.g. Compliance, Marketing, Legal"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Keywords (one per line)
            </label>
            <textarea
              value={tagKeywords}
              onChange={(e) => setTagKeywords(e.target.value)}
              placeholder={"cookie policy\nprivacy notice\nterms of use"}
              rows={3}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Replaces default Pharma tagging. Leave empty for Pharma defaults.
            </p>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Starting scan..." : "Start Scan"}
      </button>
    </form>
  );
}
