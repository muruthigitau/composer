/**
 * Conventional-commit message normalization.
 *
 * AI models frequently return subjects that already include a type prefix
 * (e.g. `feat: feat(theme): dark mode`), an inconsistent case, a trailing
 * period or a `## Heading`. This module is the single place that turns raw
 * model output (or user edits) into a clean subject, a valid type and a
 * properly wrapped commit message, so a duplicated `feat: feat:` prefix can
 * never be produced anywhere in the extension.
 */

/** Conventional commit types accepted by the composer. */
export const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "style",
  "test",
  "chore",
  "perf",
  "ci",
  "build",
  "revert"
] as const;

/** A supported conventional commit type. */
export type ConventionalType = (typeof CONVENTIONAL_TYPES)[number];

/** Longest allowed subject (description) length. */
const MAX_SUBJECT_LENGTH = 68;

/** Longest allowed commit header (`type(scope)!: subject`). */
const MAX_HEADER_LENGTH = 72;

/** Result of parsing a raw conventional-commit subject. */
export interface ParsedSubject {
  /** Type found in the raw subject, when it was a valid conventional type. */
  type?: ConventionalType;
  /** Optional scope found in the raw subject. */
  scope?: string;
  /** Whether the raw subject marked the commit as breaking. */
  breaking: boolean;
  /** The description with every leading type prefix removed. */
  subject: string;
}

const TYPE_PREFIX =
  /^([A-Za-z]+)\s*(?:\(([^()]*)\)\s*)?(!)?\s*[:\u2013\u2014-]\s*([\s\S]*)$/;
const BARE_SCOPE_PREFIX = /^([A-Za-z]+)\s*\(([^()]*)\)\s*([\s\S]*)$/;

/**
 * Normalize a raw type string to a supported conventional type.
 *
 * @param type Raw type from the AI or UI (any case, possibly with scope).
 * @returns A valid conventional type; `chore` when nothing usable was supplied.
 */
export function normalizeType(type: string): ConventionalType {
  const lower = (type || "")
    .trim()
    .toLowerCase()
    .replace(/\(.*$/, "")
    .replace(/[^a-z]/g, "");
  return (CONVENTIONAL_TYPES as readonly string[]).includes(lower)
    ? (lower as ConventionalType)
    : "chore";
}

/** Collapse whitespace and strip markdown emphasis from a subject fragment. */
function tidySubject(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[.,;:]$/, "")
    .trim();
}

/** Truncate a subject at a word boundary without leaving dangling punctuation. */
function truncateSubject(value: string, maxLength = MAX_SUBJECT_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }
  const cut = value.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  const shortened = (boundary > maxLength * 0.5 ? cut.slice(0, boundary) : cut).replace(
    /[\s,;:.-]+$/,
    ""
  );
  return shortened || cut.trim();
}

/**
 * Strip every leading conventional-commit prefix from a raw subject.
 *
 * Handles `feat: x`, `feat(scope): x`, `feat!: x`, `feat(scope)!: x`,
 * `feat - x`, `Feat(x) - x` and repeated prefixes such as
 * `feat: feat(theme): x`.
 *
 * @param rawSubject Raw subject line from the AI or the UI.
 */
export function parseSubject(rawSubject: string): ParsedSubject {
  let value = (rawSubject || "")
    .replace(/```[a-z]*|```/gi, "")
    .replace(/^[#*\-\s]+/, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!value) {
    return { breaking: false, subject: "" };
  }

  let type: ConventionalType | undefined;
  let scope: string | undefined;
  let breaking = false;

  for (let guard = 0; guard < 4; guard++) {
    const match = value.match(TYPE_PREFIX);
    const bareMatch = match ? null : value.match(BARE_SCOPE_PREFIX);
    const candidate = match ? match[1] : bareMatch ? bareMatch[1] : "";
    const isKnownType = (CONVENTIONAL_TYPES as readonly string[]).includes(
      candidate.toLowerCase()
    );

    if (isKnownType) {
      type = type ?? (candidate.toLowerCase() as ConventionalType);
      const foundScope = (match ? match[2] : bareMatch?.[2]) || undefined;
      scope = scope ?? (foundScope ? tidySubject(foundScope) : undefined);
      breaking = breaking || Boolean(match?.[3]);
      value = tidySubject((match ? match[4] : bareMatch?.[3]) || "");
    } else if (match && candidate.length > 0 && !type) {
      // Unknown leading token (e.g. "update: thing"): keep the word as part of
      // the subject but drop the separator.
      value = tidySubject(`${candidate} ${match[4] || ""}`);
      break;
    } else {
      value = tidySubject(value);
      break;
    }

    if (!value) {
      break;
    }
  }

  return { type, scope, breaking, subject: truncateSubject(tidySubject(value)) };
}

/**
 * Build a valid conventional-commit header line.
 *
 * @param type Type to use; invalid values fall back to `chore`.
 * @param rawSubject Subject that may already contain a type prefix.
 * @param options Optional scope/breaking overrides and max header length.
 */
export function buildSubjectLine(
  type: string,
  rawSubject: string,
  options?: { scope?: string; breaking?: boolean; maxHeaderLength?: number }
): string {
  const parsed = parseSubject(rawSubject);
  const resolvedType = normalizeType(type || parsed.type || "chore");
  const scope = tidySubject(options?.scope ?? parsed.scope ?? "");
  const breaking = options?.breaking ?? parsed.breaking;
  const prefix = `${resolvedType}${scope ? `(${scope})` : ""}${breaking ? "!" : ""}: `;
  const maxSubject = (options?.maxHeaderLength ?? MAX_HEADER_LENGTH) - prefix.length;
  const subject = truncateSubject(parsed.subject, Math.max(20, maxSubject)) || "update code";
  return `${prefix}${subject}`;
}

/** Normalize a single body line into either a bullet or a prose line. */
function normalizeBodyLine(line: string): string {
  const trimmed = line.replace(/\s+$/, "").trim();
  if (!trimmed) {
    return "";
  }
  const bullet = trimmed.match(/^(?:[-*\u2022]|\d+\.)\s+(.*)$/);
  if (bullet) {
    return `- ${tidySubject(bullet[1])}`;
  }
  // Prose keeps its sentence punctuation; only markdown noise is removed.
  return trimmed.replace(/\s+/g, " ").replace(/[*_`]/g, "").trim();
}

/** Wrap a prose paragraph at a word boundary. */
function wrapParagraph(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = "";
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current) {
    lines.push(current);
  }
  return lines.join("\n");
}

/**
 * Build the commit body from AI-supplied lines.
 *
 * The first non-bullet line is treated as the summary paragraph; every
 * remaining bullet becomes its own line. Markdown headings and a leading line
 * that merely repeats the subject are dropped.
 *
 * @param header The commit header line, used to drop duplicated content.
 * @param body Raw body lines.
 */
export function formatCommitBody(header: string, body: string | string[] | undefined): string {
  const rawLines = Array.isArray(body) ? body : String(body ?? "").split("\n");
  const cleaned = rawLines.map(normalizeBodyLine).filter((line) => line.length > 0);

  const summaryIndex = cleaned.findIndex((line) => !line.startsWith("- "));
  if (summaryIndex === -1) {
    return cleaned.join("\n");
  }

  const paragraph = cleaned[summaryIndex];
  const rest = cleaned.filter((_, i) => i !== summaryIndex);
  // A paragraph that merely repeats the header is redundant when other
  // content remains, so drop it in that case only.
  const keepParagraph = !(rest.length > 0 && header.toLowerCase().includes(paragraph.toLowerCase()));

  const parts: string[] = [];
  if (keepParagraph) {
    parts.push(wrapParagraph(paragraph, 100));
  }
  if (rest.length > 0) {
    parts.push(rest.join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Produce the final, ready-to-commit message.
 *
 * @param input Type, subject (may contain a prefix) and body lines.
 * @returns `type(scope)!: subject` plus a blank line and the formatted body.
 */
export function formatCommitMessage(input: {
  type: string;
  subject: string;
  body?: string | string[];
  scope?: string;
  breaking?: boolean;
}): string {
  const header = buildSubjectLine(input.type, input.subject, {
    scope: input.scope,
    breaking: input.breaking
  });
  const body = formatCommitBody(header, input.body);
  return body ? `${header}\n\n${body}` : header;
}

/**
 * Sanitize an AI-generated PR title into a single-line title.
 *
 * Removes markdown headings, code fences, percent-encoded characters and
 * duplicated conventional prefixes, then caps the length.
 *
 * @param rawTitle Raw model output.
 * @param maxLength Maximum title length (defaults to 72).
 */
export function sanitizePrTitle(rawTitle: string, maxLength = 72): string {
  const value = decodeUriEntities(String(rawTitle ?? ""))
    .replace(/```[a-z]*|```/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^["']+|["']+$/g, "")
    .replace(/^#+\s*/, "");

  const parsed = parseSubject(value);
  if (parsed.type) {
    return buildSubjectLine(parsed.type, value, {
      scope: parsed.scope,
      breaking: parsed.breaking,
      maxHeaderLength: maxLength
    });
  }

  return truncateSubject(tidySubject(value), maxLength) || "Update project files";
}

/**
 * Decode percent-encoded sequences that models occasionally emit instead of
 * raw Markdown characters (most commonly `%23` instead of `#`).
 */
export function decodeUriEntities(text: string): string {
  const known: Record<string, string> = {
    "%23": "#",
    "%20": " ",
    "%2D": "-",
    "%28": "(",
    "%29": ")",
    "%2E": ".",
    "%2C": ",",
    "%3A": ":"
  };
  let out = String(text ?? "");
  for (const [encoded, decoded] of Object.entries(known)) {
    out = out.split(encoded).join(decoded);
  }
  return out;
}

