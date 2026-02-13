"""CSV export fallback."""

import io
import csv

COLUMNS = [
    ("Page URL", "page_url"),
    ("Page Title", "page_title"),
    ("Element Type", "element_type"),
    ("Action Type", "action_type"),
    ("Element Text", "element_text"),
    ("CSS Selector", "css_selector"),
    ("Section Context", "section_context"),
    ("Container", "container_context"),
    ("Above Fold", "is_above_fold"),
    ("Target URL", "target_url"),
    ("External", "is_external"),
    ("Pharma Context", "pharma_context"),
    ("Value Tier", "value_tier"),
    ("Value Reason", "value_reason"),
    ("Owner", "owner"),
    ("Measurement Status", "measurement_status"),
]


def generate_csv(elements: list[dict], tag_name: str = "Pharma", dedup: bool = False) -> str:
    """Generate CSV string from extracted elements."""
    output = io.StringIO()
    writer = csv.writer(output)

    # Build columns with dynamic tag label
    columns = [
        (tag_name + " Context" if field == "pharma_context" else header, field)
        for header, field in COLUMNS
    ]
    if dedup:
        columns.insert(1, ("Page Count", "page_count"))

    # Header
    writer.writerow([header for header, _ in columns])

    # Data
    for element in elements:
        row = []
        for _, field in columns:
            value = element.get(field)
            if field == "is_above_fold":
                value = "Yes" if value else "No"
            elif field == "is_external":
                value = "Yes" if value else "No"
            row.append(value or "")
        writer.writerow(row)

    return output.getvalue()
