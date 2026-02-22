/** Lightweight SVG icons for element types — avoids a full icon library dependency. */

const ICON_PATHS: Record<string, string> = {
  // Link: chain/link icon
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  // Button: pointer click
  button: "M4 4l7.07 17 2.51-7.39L21 11.07z",
  // Form: document with lines
  form: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2",
  // Download: arrow down into tray
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  // Tab: panel with top bar
  tab: "M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 8h20",
  // Accordion: chevron down
  accordion: "M6 9l6 6 6-6",
  // Menu: three horizontal lines
  menu: "M3 6h18M3 12h18M3 18h18",
};

export function ElementTypeIcon({ type, className = "" }: { type: string; className?: string }) {
  const path = ICON_PATHS[type];
  if (!path) return null;

  return (
    <svg
      className={`inline-block shrink-0 ${className}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
