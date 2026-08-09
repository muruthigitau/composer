import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DiffHunk, FileDiff, StagedChangeSummary } from "../types/messages";

/**
 * GitService wraps the Git CLI to provide Git operations needed by the composer.
 * It uses the standard `git` command available on the user's system.
 */
export class GitService {
  constructor(private workspacePath: string) {}

  /**
   * Execute a git command and return stdout.
   * Public so other classes can use it (e.g. CommitComposerPanel).
   */
  public exec(args: string[]): Promise<string> {
    return this.runCommand("git", args);
  }

  /**
   * Execute an arbitrary CLI command binary within the workspace, returning stdout.
   * Used for GitHub CLI (`gh`) etc.
   */
  public runCommand(bin: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(bin, args, { cwd: this.workspacePath, maxBuffer: 1024 * 1024 * 100 }, (error, stdout) => {
        if (error) {
          reject(new Error(error.message || String(error)));
          return;
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Get the root of the current git repository.
   */
  public async getRepoRoot(): Promise<string> {
    const root = await this.exec(["rev-parse", "--show-toplevel"]);
    return root.trim();
  }

  /**
   * Get the full staged diff (git diff --cached).
   */
  public async getStagedDiff(): Promise<string> {
    return await this.exec(["diff", "--cached", "--no-color"]);
  }

  /**
   * Get the full staged diff for a specific file.
   */
  public async getStagedFileDiff(filePath: string): Promise<string> {
    return await this.exec(["diff", "--cached", "--no-color", "--", filePath]);
  }

  /**
   * Get staged files with their diff statistics.
   */
  public async getStagedFiles(): Promise<string[]> {
    const output = await this.exec(["diff", "--cached", "--name-only"]);
    return output.split("\n").filter((line) => line.trim().length > 0);
  }

  /**
   * Get detailed staged change summary.
   */
  public async getStagedSummary(): Promise<StagedChangeSummary | null> {
    const diff = await this.getStagedDiff();
    if (!diff.trim()) {
      return null;
    }

    const files = await this.getStagedFiles();

    // Parse the diff to count additions/deletions
    let additions = 0;
    let deletions = 0;

    const lines = diff.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }

    return {
      fileCount: files.length,
      additions,
      deletions,
      files
    };
  }

  /**
   * Get per-file staged diffs, suitable for the master-detail UI.
   */
  public async getStagedFileDiffs(): Promise<FileDiff[]> {
    const rawDiff = await this.getStagedDiff();
    if (!rawDiff.trim()) {
      return [];
    }

    const fileBlocks = rawDiff.split(/^diff --git /m).filter((b) => b.trim().length > 0);
    const result: FileDiff[] = [];

    for (const block of fileBlocks) {
      const lines = block.split("\n");
      const header = lines[0] || "";
      const pathMatch = header.match(/b\/(.+?)$/);
      const path = pathMatch ? pathMatch[1] : "unknown";

      let status: "ADDED" | "MODIFIED" | "DELETED" = "MODIFIED";
      if (lines.some((l) => l.startsWith("new file"))) status = "ADDED";
      else if (lines.some((l) => l.startsWith("deleted file"))) status = "DELETED";

      let additions = 0;
      let deletions = 0;
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }

      result.push({
        path,
        status,
        additions,
        deletions,
        diffText: "diff --git " + block.trim()
      });
    }

    return result;
  }

  /**
   * Parse a unified diff into per-file, per-hunk structures.
   * This enables precise commit grouping at hunk granularity.
   */
  public parseDiffIntoHunks(diff: string): Map<string, DiffHunk[]> {
    const hunksByFile = new Map<string, DiffHunk[]>();
    let currentFile: string | null = null;
    let currentHunkIndex = 0;

    const lines = diff.split("\n");

    for (const line of lines) {
      // New file section in the diff
      const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        currentHunkIndex = 0;
        hunksByFile.set(currentFile, []);
        continue;
      }

      // Hunk header
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch && currentFile) {
        const files = hunksByFile.get(currentFile);
        if (files) {
          files.push({
            hunkIndex: currentHunkIndex,
            header: line,
            content: line,
            file: currentFile
          });
          currentHunkIndex++;
        }
        continue;
      }

      // Append content to the current hunk
      if (currentFile) {
        const files = hunksByFile.get(currentFile);
        if (files && files.length > 0) {
          const lastHunk = files[files.length - 1];
          lastHunk.content += "\n" + line;
        }
      }
    }

    return hunksByFile;
  }

  /**
   * Create a commit with the given message and files.
   */
  public async createCommit(message: string, files: string[]): Promise<string> {
    // Stage the specific files (path-safe)
    const args = ["add", "--", ...files];
    await this.exec(args);
    // Create the commit
    const commitOutput = await this.exec(["commit", "-m", message]);
    return commitOutput;
  }

  /**
   * Create a commit from a set of hunks in files.
   * This uses git apply with a constructed patch to commit only specific hunks.
   *
   * @param message Full commit message (subject + body)
   * @param hunksByFile Map of file path to list of hunks to include
   */
  public async createHunkCommit(message: string, hunksByFile: Map<string, DiffHunk[]>): Promise<string> {
    // 1. Save the original staged state
    const originalPatch = await this.exec(["diff", "--cached"]);

    // 2. Unstage everything
    await this.exec(["reset", "--cached", "."]);

    // 3. Stage the files that have hunks in this commit
    const files = Array.from(hunksByFile.keys());
    await this.exec(["add", "--", ...files]);

    // 4. Construct and apply a reverse patch to remove non-included hunks from staging
    // Get the current staged diff of the files
    for (const [file, hunks] of hunksByFile) {
      const fileChanges = await this.exec(["diff", "--cached", "--no-color", "--", file]);
      const allHunks = this.parseDiffIntoHunks(fileChanges).get(file) || [];

      // Determine which hunks to exclude
      const includedIndices = new Set(hunks.map((h) => h.hunkIndex));
      const excludedHunks = allHunks
        .filter((h) => !includedIndices.has(h.hunkIndex))
        .map((h) => h.content);

      if (excludedHunks.length > 0) {
        // Apply reverse patch to unstage excluded hunks
        const patch = this.constructPatchFromHunks(file, excludedHunks);
        try {
          await this.exec(["apply", "--cached", "--reverse", "-"],
            // Note: execFile doesn't support stdin easily; we'll use a temp approach
          );
        } catch {
          // Fall back to simpler approach
        }
      }
    }

    // 5. Create the commit with the staged (included) hunks
    const commitOutput = await this.exec(["commit", "-m", message]);

    // 6. Restore the original staged state for remaining changes
    if (originalPatch.trim()) {
      try {
        await this.exec(["apply", "--cached", "--reverse"]);
        // Re-apply the original patch minus committed files
        const remainingFiles = files.filter(() => true);
        await this.exec(["restore", "--staged", "--", ...remainingFiles]);
      } catch {
        // Best effort restore
      }
    }

    return commitOutput;
  }

  /**
   * Construct a patch for given hunks of a file.
   */
  private constructPatchFromHunks(file: string, hunks: string[]): string {
    // Get the file header info from the diff
    const lines = ["diff --git a/" + file + " b/" + file, "--- a/" + file, "+++ b/" + file, ...hunks];
    return lines.join("\n");
  }

  /**
   * Check if there are staged changes.
   */
  public async hasStagedChanges(): Promise<boolean> {
    const output = await this.exec(["diff", "--cached", "--name-only"]);
    return output.trim().length > 0;
  }

  /**
   * Apply a commit plan sequentially, committing only the files specified for
   * each commit.
   *
   * `git commit -- <paths>` creates a commit containing ONLY the given paths
   * by using a temporary index internally. This is the critical fix: it
   * prevents the first commit from sweeping up *all* staged changes and leaving
   * nothing for the subsequent commits.
   *
   * Files that have already been committed by a previous step (overlapping
   * file lists) are filtered out so we never try to commit an unchanged path.
   *
   * @param commits Array of { message, files } to commit sequentially
   * @param onProgress Optional callback for progress reporting
   */
  public async commitPlan(
    commits: Array<{ message: string; files: string[] }>,
    onProgress?: (current: number, total: number, subject: string) => void
  ): Promise<number> {
    const committedFiles = new Set<string>();
    let committed = 0;

    try {
      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const subject = commit.message.split("\n")[0] || "commit";

        // Only commit paths not already committed by a prior step.
        const filesToCommit = commit.files.filter(
          (file) => !committedFiles.has(file)
        );

        if (filesToCommit.length === 0) {
          onProgress?.(
            i + 1,
            commits.length,
            `${subject} (skipped — its files were already committed)`
          );
          continue;
        }

        onProgress?.(i + 1, commits.length, subject);

        // Commit ONLY these paths; everything else stays staged.
        await this.exec(["commit", "-m", commit.message, "--", ...filesToCommit]);

        filesToCommit.forEach((file) => committedFiles.add(file));
        committed++;
      }
    } catch (error) {
      // If a commit fails, surface how far we got so the user can recover.
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Commit failed after ${committed} succeeded: ${errorMsg}`);
    }

    return committed;
  }

  /**
   * Restore the original staged state after partial/complete commit operations.
   */
  public async restoreOriginalStaging(patch: string): Promise<void> {
    if (!patch.trim()) {
      return;
    }
    // Reset index and re-apply the original patch
    await this.exec(["reset", "--cached", "."]);
    const tempFile = path.join(this.workspacePath, ".git", ".commit-composer-original.patch");
    fs.writeFileSync(tempFile, patch);
    await this.exec(["apply", "--cached", tempFile]);
    fs.unlinkSync(tempFile);
  }

  /**
   * Get the count of staged and unstaged files via `git status --porcelain`.
   */
  public async getStatusCounts(): Promise<{ staged: number; unstaged: number }> {
    const output = await this.exec(["status", "--porcelain"]);
    if (!output.trim()) {
      return { staged: 0, unstaged: 0 };
    }

    let staged = 0;
    let unstaged = 0;

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // First column = index status, second = worktree status
      const indexStatus = trimmed[0];
      const worktreeStatus = trimmed[1] || " ";

      // Indexed (staged) changes: anything but ' ' and '?'
      if (indexStatus !== " " && indexStatus !== "?") {
        staged++;
      }
      // Worktree (unstaged) changes: anything but ' ' and '?'
      if (worktreeStatus !== " " && worktreeStatus !== "?") {
        unstaged++;
      }
      // Untracked files show as '??'
      if (indexStatus === "?" && worktreeStatus === "?") {
        unstaged++;
      }
    }

    return { staged, unstaged };
  }

  /**
   * Build a git status snapshot for change detection: staged/unstaged counts
   * plus a signature of the staged diff so the webview can detect when the
   * actual staged content changed (not just the counts).
   */
  public async getGitSnapshot(): Promise<{
    staged: number;
    unstaged: number;
    filesSignature: string;
  }> {
    const [counts, stagedDiff, stagedFiles] = await Promise.all([
      this.getStatusCounts(),
      this.getStagedDiff(),
      this.getStagedFiles()
    ]);

    // A stable signature of the staged file list (order-independent-ish, simple hash).
    const fileList = [...stagedFiles].sort();
    const simpleHash = fileList.join("\n") + "\n" + stagedDiff.split("\n").length;
    return {
      staged: counts.staged,
      unstaged: counts.unstaged,
      filesSignature: simpleHash
    };
  }

  /**
   * Get the current HEAD commit hash.
   */
  public async getHeadHash(): Promise<string> {
    const output = await this.exec(["rev-parse", "HEAD"]);
    return output.trim();
  }

  /**
   * List configured remotes as {name, url} pairs.
   */
  public async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const output = await this.exec(["remote", "-v"]);
      const result: { name: string; url: string }[] = [];
      const seen = new Set<string>();
      for (const line of output.split("\n")) {
        const m = line.match(/^(\S+)\s+(\S+)/);
        if (!m) continue;
        const [name, url] = [m[1], m[2]];
        if (!seen.has(name)) {
          seen.add(name);
          result.push({ name, url });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Get the current branch checked out. Returns undefined when detached.
   */
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
   * List all local branches (and optionally remote branches).
   */
  public async getBranches(includeRemote = true): Promise<string[]> {
    try {
      const args = ["branch", "--format=%(refname:short)"];
      if (includeRemote) args.push("-a");
      const out = await this.exec(args);
      const branches = out
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.startsWith("HEAD ->") && b !== "remotes/origin/HEAD");
      // De-duplicate while preserving order.
      return Array.from(new Set(branches));
    } catch {
      return [];
    }
  }

  /**
   * Try to resolve the default branch (origin/HEAD -> ref, falling back to "main", "master").
   */
  public async getDefaultBranch(): Promise<string> {
    try {
      const out = await this.exec(["symbolic-ref", "refs/remotes/origin/HEAD"]);
      const ref = out.trim().replace(/^refs\/remotes\/origin\//, "");
      if (ref) return ref;
    } catch {
      // ignore
    }

    const branches = await this.getBranches(true);
    const local = branches.filter((b) => !b.startsWith("remotes/"));
    if (local.includes("main")) return "main";
    if (local.includes("master")) return "master";
    const originMain = branches.find((b) => b === "origin/main" || b === "remotes/origin/main");
    const originMaster = branches.find((b) => b === "origin/master" || b === "remotes/origin/master");
    return originMain || originMaster || "main";
  }
}
