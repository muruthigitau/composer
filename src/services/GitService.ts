/**
 * Git CLI wrapper for the Commit Composer.
 *
 * Responsibilities:
 *  - read the staged diff and parse it into files/hunks (`DiffParser`),
 *  - report status, branches and remotes,
 *  - create commits that contain **only the selected hunks** of a plan.
 *
 * Hunk-precise commits are implemented with a temporary index
 * (`GIT_INDEX_FILE`): each commit's patch is applied to that index and
 * committed from it. The user's real index is never modified, so any change a
 * commit did not consume stays staged afterwards.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import * as path from "path";
import { FileDiff } from "../types/messages";
import { ParsedFileDiff, parseUnifiedDiff, toFileDiffs } from "./DiffParser";
import {
  CommitExecutionResult,
  HunkCommitRunner,
  PlannedCommit
} from "./HunkCommitRunner";
/** A commit read from `git log`. */
export interface GitCommit {
  subject: string;
  body: string;
}

export class GitService {
  constructor(private workspacePath: string) {}

  /** Execute a git command and return stdout. */
  public exec(args: string[]): Promise<string> {
    return this.runCommand("git", args);
  }

  /**
   * Execute an arbitrary CLI binary within the workspace and return stdout.
   * Also used for the GitHub CLI (`gh`).
   */
  public runCommand(
    bin: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; cwd?: string }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        bin,
        args,
        {
          cwd: options?.cwd || this.workspacePath,
          env: options?.env ? { ...process.env, ...options.env } : process.env,
          maxBuffer: 1024 * 1024 * 200
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = String(stderr || "").trim() || error.message || String(error);
            reject(new Error(detail));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  // ─────────────────────────── staged diff ───────────────────────────

  /**
   * Raw staged diff including binary patches. Used both for parsing and for a
   * content signature that detects real staged changes.
   */
  public async getStagedDiffRaw(): Promise<string> {
    return await this.exec(["diff", "--cached", "--no-color", "--binary"]);
  }

  /**
   * Parse the staged diff into files and hunks.
   *
   * @returns One entry per staged file (empty when nothing is staged).
   */
  public async getParsedStagedDiff(): Promise<ParsedFileDiff[]> {
    return parseUnifiedDiff(await this.getStagedDiffRaw());
  }

  /** Per-file staged diffs shaped for the webview. */
  public async getStagedFileDiffs(): Promise<FileDiff[]> {
    return toFileDiffs(await this.getParsedStagedDiff()) as FileDiff[];
  }

  /** Staged file paths. */
  public async getStagedFiles(): Promise<string[]> {
    const output = await this.exec(["diff", "--cached", "--name-only"]);
    return output.split("\n").filter((line) => line.trim().length > 0);
  }

  /** True when there are no staged and no unstaged changes. */
  public async isWorkingTreeClean(): Promise<boolean> {
    const { staged, unstaged } = await this.getStatusCounts();
    return staged === 0 && unstaged === 0;
  }

  /**
   * Snapshot used by the webview to detect working-directory changes.
   *
   * The signature hashes the staged file list plus the full staged diff, so
   * real content changes are detected — not just changed counts.
   */
  public async getGitSnapshot(): Promise<{
    staged: number;
    unstaged: number;
    filesSignature: string;
    files: ParsedFileDiff[];
  }> {
    const [counts, rawDiff] = await Promise.all([this.getStatusCounts(), this.getStagedDiffRaw()]);
    const files = parseUnifiedDiff(rawDiff);
    const signature = createHash("sha1")
      .update(files.map((file) => file.path).join("\n"))
      .update(rawDiff)
      .digest("hex");

    return {
      staged: counts.staged,
      unstaged: counts.unstaged,
      filesSignature: signature,
      files
    };
  }

  /** Counts of staged/unstaged files from `git status --porcelain`. */
  public async getStatusCounts(): Promise<{ staged: number; unstaged: number }> {
    const output = await this.exec(["status", "--porcelain"]);
    if (!output.trim()) {
      return { staged: 0, unstaged: 0 };
    }

    let staged = 0;
    let unstaged = 0;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const indexStatus = line[0];
      const worktreeStatus = line[1] || " ";

      if (indexStatus !== " " && indexStatus !== "?") staged++;
      if (worktreeStatus !== " " && worktreeStatus !== "?") unstaged++;
      if (indexStatus === "?" && worktreeStatus === "?") unstaged++;
    }

    return { staged, unstaged };
  }

  // ─────────────────────────── branches / commits ───────────────────────────

  /** Root of the current git repository. */
  public async getRepoRoot(): Promise<string> {
    const root = await this.exec(["rev-parse", "--show-toplevel"]);
    return root.trim();
  }

  /** Git directory path, used by the hunk commit runner for its temp index. */
  public async getGitDir(): Promise<string> {
    const dir = await this.exec(["rev-parse", "--git-dir"]);
    const trimmed = dir.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.join(this.workspacePath, trimmed);
  }

  /**
   * Diff between two branches at their merge base (`base...head`), i.e. exactly
   * what a Pull Request would contain.
   */
  public async getBranchDiff(baseBranch: string, headBranch: string): Promise<string> {
    return await this.exec(["diff", `${baseBranch}...${headBranch}`, "--no-color"]);
  }

  /**
   * Read the commits a branch introduces above its base.
   *
   * @param baseBranch Base branch/ref.
   * @param headBranch Head branch/ref.
   * @param limit Maximum number of commits to return (newest first).
   */
  public async getCommitsBetween(
    baseBranch: string,
    headBranch: string,
    limit = 50
  ): Promise<GitCommit[]> {
    const output = await this.exec([
      "log",
      "--no-merges",
      `--max-count=${limit}`,
      "--format=%s%x1f%b%x1e",
      `${baseBranch}..${headBranch}`
    ]);

    return output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [subject, ...rest] = record.split("\x1f");
        return { subject: (subject || "").trim(), body: rest.join("\x1f").trim() };
      });
  }

  /** True when a local branch ref exists. */
  public async hasLocalBranch(branch: string): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** True when a ref resolves to a commit. */
  public async refExists(ref: string): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Current branch name, or undefined when HEAD is detached. */
  public async getCurrentBranch(): Promise<string | undefined> {
    try {
      const out = await this.exec(["branch", "--show-current"]);
      const trimmed = out.trim();
      return trimmed || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * List local branches and (optionally) remote-tracking branches.
   *
   * The current branch is placed first so pickers default sensibly.
   */
  public async getBranches(includeRemote = true): Promise<string[]> {
    try {
      const args = ["branch", "--format=%(refname:short)"];
      if (includeRemote) args.push("-a");
      const out = await this.exec(args);
      const current = await this.getCurrentBranch();

      const branches = out
        .split("\n")
        .map((branch) => branch.trim())
        .filter((branch) => branch.length > 0 && !branch.includes("HEAD ->") && !branch.endsWith("/HEAD"))
        .map((branch) => branch.replace(/^remotes\//, ""));

      return Array.from(new Set(branches)).sort((a, b) => {
        if (a === current) return -1;
        if (b === current) return 1;
        const aRemote = a.includes("/") ? 1 : 0;
        const bRemote = b.includes("/") ? 1 : 0;
        return aRemote - bRemote || a.localeCompare(b);
      });
    } catch {
      return [];
    }
  }

  /** Resolve the default branch (`origin/HEAD`, then main/master). */
  public async getDefaultBranch(): Promise<string> {
    try {
      const out = await this.exec(["symbolic-ref", "refs/remotes/origin/HEAD"]);
      const ref = out.trim().replace(/^refs\/remotes\/origin\//, "");
      if (ref) return ref;
    } catch {
      // No origin/HEAD — fall through to heuristics.
    }

    const branches = await this.getBranches(true);
    for (const candidate of ["main", "master"]) {
      if (branches.includes(candidate) || branches.includes(`origin/${candidate}`)) {
        return candidate;
      }
    }
    return "main";
  }

  /** Configured remotes as {name, url} pairs. */
  public async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const output = await this.exec(["remote", "-v"]);
      const result: { name: string; url: string }[] = [];
      const seen = new Set<string>();
      for (const line of output.split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)/);
        if (!match) continue;
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          result.push({ name: match[1], url: match[2] });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  // ─────────────────────────── commit execution ───────────────────────────

  /**
   * Create one commit per planned commit, staging only the hunks each commit
   * owns (delegates to {@link HunkCommitRunner}).
   */
  public async commitHunkPlan(
    commits: PlannedCommit[],
    onProgress?: (current: number, total: number, subject: string) => void
  ): Promise<CommitExecutionResult> {
    return new HunkCommitRunner(this).run(commits, onProgress);
  }
}

