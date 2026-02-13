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

    try {
      const keywords = tagKeywords
        .split("\n")
        .map((k) => k.trim())
        .filter(Boolean);
      const result = await createScan({
        url,
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
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example-pharma.com"
          required
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mb-4 text-sm text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? "Hide" : "Show"} advanced settings
      </button>

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

      <button
        type="button"
        onClick={() => setShowCustomTag(!showCustomTag)}
        className="mb-4 text-sm text-muted-foreground hover:text-foreground"
      >
        {showCustomTag ? "Hide" : "Show"} custom tag
      </button>

      {showCustomTag && (
        <div className="mb-4 rounded-lg border bg-muted/30 p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Replace default Pharma tagging with custom keywords. Leave empty to use Pharma defaults.
          </p>
          <div className="mb-3">
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
              rows={4}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
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
