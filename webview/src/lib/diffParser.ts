export interface DiffLine {
  text: string;
  type: "add" | "del" | "hunk" | "context" | "header";
}

/**
 * Parse raw unified diff text into colored line segments.
 */
export function parseDiffLines(diffText: string): DiffLine[] {
  const lines = diffText.split("\n").map((t) => t.replace(/\r$/, ""));
  const result: DiffLine[] = [];

  for (const raw of lines) {
    // File/section metadata lines keep their full text (no marker).
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file")
    ) {
      result.push({ text: raw, type: "header" });
      continue;
    }
    if (raw.startsWith("@@")) {
      result.push({ text: raw, type: "hunk" });
      continue;
    }
    if (raw.startsWith("\\ ")) {
      // "\ No newline at end of file"
      result.push({ text: raw, type: "context" });
      continue;
    }

    // Content lines: strip the leading marker so we only show it in the
    // signature gutter (avoids doubled +/− prefixes).
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      result.push({ text, type: "add" });
    } else if (marker === "-") {
      result.push({ text, type: "del" });
    } else {
      result.push({ text, type: "context" });
    }
  }

  return result;
}