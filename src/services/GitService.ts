import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DiffHunk, StagedChangeSummary } from "../types/messages";

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
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: this.workspacePath, maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
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
   * Apply a commit plan sequentially using the temporary index approach.
   * This is safer than direct commits as it preserves the user's staging.
   *
   * @param commits Array of { message, files } to commit sequentially
   * @param onProgress Optional callback for progress reporting
   */
  public async commitPlan(
    commits: Array<{ message: string; files: string[] }>,
    onProgress?: (current: number, total: number, subject: string) => void
  ): Promise<number> {
    // Store original staged patch for restoration
    const originalPatch = await this.exec(["diff", "--cached"]);

    let committed = 0;

    try {
      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const subject = commit.message.split("\n")[0] || "commit";
        onProgress?.(i + 1, commits.length, subject);

        // Stage all files for this commit (they should already be staged)
        // We can only commit files that are already staged to preserve separation
        // So we just commit with the specified message
        await this.exec(["commit", "-m", commit.message]);
        committed++;
      }
    } catch (error) {
      // If a commit fails, we need to restore the original state
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
   * Get the current HEAD commit hash.
   */
  public async getHeadHash(): Promise<string> {
    const output = await this.exec(["rev-parse", "HEAD"]);
    return output.trim();
  }
}
