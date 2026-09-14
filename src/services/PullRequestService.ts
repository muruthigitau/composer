/**
 * Pull Request helper functions.
 *
 * Pure string/argument construction for the two supported creation paths:
 * the GitHub CLI (`gh pr create`) and the browser compare URL fallback.
 */

/** Arguments for `gh pr create`, in a fixed, testable order. */
export interface GhPrArgsInput {
  baseBranch: string;
  headBranch: string;
  title: string;
  /** Path to a file containing the Markdown body. */
  bodyFile: string;
}

/**
 * Normalize a git remote URL into an https base URL.
 *
 * Handles `https://`, `git@host:owner/repo.git` and `ssh://git@host/owner/repo.git`.
 */
export function normalizeRemoteUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@([^/]+)\//, "https://$1/");
}

/**
 * Build the repository's compare URL used when the GitHub CLI is unavailable.
 *
 * @param remoteUrl Remote URL (any supported format).
 * @param baseBranch Base branch.
 * @param headBranch Head branch.
 * @param title PR title (already sanitized).
 * @param body PR description (already sanitized).
 * @returns An absolute compare URL, or an empty string when the URL is unusable.
 */
export function buildCompareUrl(
  remoteUrl: string,
  baseBranch: string,
  headBranch: string,
  title: string,
  body: string
): string {
  const base = normalizeRemoteUrl(remoteUrl);
  if (!/^https?:\/\//i.test(base)) {
    return "";
  }
  const query = new URLSearchParams({
    expand: "1",
    title,
    body
  });
  return `${base}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?${query.toString()}`;
}

/**
 * Build the argument list for `gh pr create`.
 *
 * The body is passed via `--body-file` so multi-line Markdown with quotes,
 * backticks and `#` characters reaches GitHub verbatim.
 */
export function buildGhPrArgs(input: GhPrArgsInput): string[] {
  return [
    "pr",
    "create",
    "--base",
    input.baseBranch,
    "--head",
    input.headBranch,
    "--title",
    input.title,
    "--body-file",
    input.bodyFile
  ];
}
