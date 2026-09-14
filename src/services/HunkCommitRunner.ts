/**
 * Hunk-precise commit execution.
 *
 * A temporary git index (`GIT_INDEX_FILE`) is seeded from `HEAD`; each planned
 * commit's patch — containing only the hunks that commit owns — is applied to
 * that index and committed from it. The user's real index is never touched, so
 * hunks that no commit consumed remain staged afterwards and no commit can
 * silently swallow another commit's changes.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Change } from "../types/messages";
import { ParsedFileDiff, buildFilePatch } from "./DiffParser";

/** A commit to create: full message plus the hunks it owns. */
export interface PlannedCommit {
  message: string;
  changes: Change[];
}

/** Result of a hunk-precise commit run. */
export interface CommitExecutionResult {
  /** Commits actually created. */
  committed: number;
  /** Planned commits that had no applicable hunks and were skipped. */
  skipped: number;
}

/** Git capabilities the runner needs from the repository. */
export interface HunkCommitGit {
  getParsedStagedDiff(): Promise<ParsedFileDiff[]>;
  getRepoRoot(): Promise<string>;
  getGitDir(): Promise<string>;
  runCommand(
    bin: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; cwd?: string }
  ): Promise<string>;
}

export class HunkCommitRunner {
  constructor(private readonly git: HunkCommitGit) {}

  /**
   * Create one commit per planned commit, staging only the hunks each commit
   * owns.
   *
   * @param commits Planned commits (message + file/hunk changes).
   * @param onProgress Optional progress callback.
   * @returns Counts of created and skipped commits.
   */
  public async run(
    commits: PlannedCommit[],
    onProgress?: (current: number, total: number, subject: string) => void
  ): Promise<CommitExecutionResult> {
    const staged = await this.git.getParsedStagedDiff();
    const byPath = new Map(staged.map((file) => [file.path, file]));
    const repoRoot = await this.git.getRepoRoot();
    const indexPath = await this.createTempIndex(repoRoot);
    const patchDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "commit-composer-"));

    let committed = 0;
    let skipped = 0;

    try {
      for (let index = 0; index < commits.length; index++) {
        const commit = commits[index];
        const subject = commit.message.split("\n")[0] || "commit";
        const patches = this.buildPatches(commit, byPath);

        if (patches.length === 0) {
          skipped++;
          onProgress?.(index + 1, commits.length, `${subject} (skipped - no applicable hunks)`);
          continue;
        }

        const patchFile = path.join(patchDir, `commit-${index}.patch`);
        await fs.promises.writeFile(patchFile, patches.join(""), "utf8");

        try {
          await this.applyPatchToIndex(patchFile, indexPath, repoRoot);
          await this.git.runCommand("git", ["commit", "-m", commit.message], {
            env: { GIT_INDEX_FILE: indexPath },
            cwd: repoRoot
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `${detail} ${committed} commit(s) were created before this failure; ` +
              "the remaining hunks are still staged."
          );
        }

        committed++;
        onProgress?.(index + 1, commits.length, subject);
      }
    } finally {
      await this.cleanupTempFiles(indexPath, patchDir);
    }

    return { committed, skipped };
  }

  /** Build the applicable patches for one planned commit. */
  private buildPatches(commit: PlannedCommit, byPath: Map<string, ParsedFileDiff>): string[] {
    const patches: string[] = [];

    for (const change of commit.changes) {
      const file = byPath.get(change.file);
      if (!file) continue;

      // An empty hunk list on a non-binary file means "the whole file" — better
      // than silently skipping a commit that named the file.
      const hunkIndices =
        change.hunks.length === 0 && !file.isBinary
          ? file.hunks.map((hunk) => hunk.index)
          : change.hunks;

      const patch = buildFilePatch(file, hunkIndices);
      if (patch.trim()) {
        patches.push(patch);
      }
    }

    return patches;
  }

  /** Seed a temporary index from HEAD and return its path. */
  private async createTempIndex(repoRoot: string): Promise<string> {
    const gitDir = await this.git.getGitDir();
    const indexPath = path.join(gitDir, `commit-composer-index-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: indexPath };

    try {
      await this.git.runCommand("git", ["read-tree", "HEAD"], { env, cwd: repoRoot });
    } catch {
      // Unborn branch (no commits yet) — start from an empty index.
      await this.git.runCommand("git", ["read-tree", "--empty"], { env, cwd: repoRoot });
    }
    return indexPath;
  }

  /** Apply a patch to the temporary index, retrying with a 3-way merge. */
  private async applyPatchToIndex(
    patchFile: string,
    indexPath: string,
    repoRoot: string
  ): Promise<void> {
    const options = { env: { GIT_INDEX_FILE: indexPath }, cwd: repoRoot };

    try {
      await this.git.runCommand(
        "git",
        ["apply", "--cached", "--whitespace=nowarn", patchFile],
        options
      );
    } catch (error) {
      try {
        await this.git.runCommand(
          "git",
          ["apply", "--cached", "--3way", "--whitespace=nowarn", patchFile],
          options
        );
      } catch {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not stage the selected hunks for this commit. No commit was created for it. ${message}`
        );
      }
    }
  }

  /** Best-effort removal of the temporary index and patch files. */
  private async cleanupTempFiles(indexPath: string, patchDir: string): Promise<void> {
    for (const target of [indexPath, `${indexPath}.lock`]) {
      try {
        await fs.promises.rm(target, { force: true });
      } catch {
        // Ignore: temp index cleanup is best effort.
      }
    }
    try {
      await fs.promises.rm(patchDir, { recursive: true, force: true });
    } catch {
      // Ignore: patch directory cleanup is best effort.
    }
  }
}

