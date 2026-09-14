/**
 * Commit-plan lifecycle: staged diff loading, AI plan generation, single-commit
 * message regeneration and hunk-precise commit execution.
 *
 * Kept separate from {@link ComposerController} (message routing, provider
 * configuration) so each module has a single responsibility and stays small.
 *
 * Flow summary:
 *  - `generate`: read the staged diff once, send the AI a compact hunk-indexed
 *    diff, repair the returned plan so it fully covers the staged hunks, then
 *    hand the UI a plan that references real files and hunks.
 *  - `regenerate`: rewrite one commit message from only that commit's hunks
 *    (small request) instead of regenerating the whole plan.
 *  - `execute`: create each commit with only its own hunks and report anything
 *    that is left staged.
 */

import {
  ActivityItem,
  Change,
  DraftCommit,
  DraftCommitPlan,
  ExtensionToWebviewMessage
} from "../types/messages";
import { AIService } from "../services/AIService";
import { GitService } from "../services/GitService";
import { PlannedCommit } from "../services/HunkCommitRunner";
import { PlanAdapter } from "../services/PlanAdapter";
import { ParsedFileDiff, buildAnnotatedDiff, resolvePath } from "../services/DiffParser";
import { normalizePlan } from "../services/PlanNormalizer";
import { formatCommitMessage } from "../services/CommitMessage";

/** Dependencies the plan flow needs from its controller/host. */
export interface CommitPlanFlowDeps {
  git: GitService;
  ai: AIService;
  workspaceName?: string;
  post(message: ExtensionToWebviewMessage): void;
  log(message: string, type?: ActivityItem["type"]): void;
  setLoading(value: boolean): void;
  handleError(error: unknown): void;
  showInformationMessage(message: string): void;
  showWarningMessage(message: string): void;
}

export class CommitPlanFlow {
  private lastPlan?: DraftCommitPlan;

  constructor(private readonly deps: CommitPlanFlowDeps) {}

  /** Load the staged per-file diffs and send them to the webview. */
  public async loadStaged(): Promise<void> {
    const { git, post, handleError } = this.deps;
    try {
      post({ command: "setStagedOverview", files: await git.getStagedFileDiffs() });
    } catch (error) {
      handleError(error);
    }
  }

  /**
   * Report the current staged/unstaged counts plus a content signature so the
   * webview can warn when the working directory changed.
   */
  public async reloadChanges(): Promise<void> {
    const { git, post } = this.deps;
    try {
      const snapshot = await git.getGitSnapshot();
      post({ command: "changesDetected", staged: snapshot.staged, unstaged: snapshot.unstaged });
      post({
        command: "gitSnapshot",
        snapshot: {
          staged: snapshot.staged,
          unstaged: snapshot.unstaged,
          filesSignature: snapshot.filesSignature,
          loadedCount: snapshot.files.length
        }
      });
    } catch {
      // Non-fatal: status polling must never surface errors.
    }
  }

  /**
   * Generate a commit plan for the staged changes.
   *
   * @param instructions Optional free-form guidance from the user.
   * @param sampleMessage Optional style reference message.
   */
  public async generate(instructions?: string, sampleMessage?: string): Promise<void> {
    const { git, ai, post, log, setLoading, handleError, workspaceName } = this.deps;
    try {
      setLoading(true);
      log("Reading staged Git changes…", "loading");

      const stagedFiles = await git.getParsedStagedDiff();
      if (stagedFiles.length === 0) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      const hunkCount = stagedFiles.reduce((total, file) => total + file.hunks.length, 0);
      log(
        `Calling ${ai.getProviderConfig().label} with ${stagedFiles.length} file(s) / ${hunkCount} hunk(s)…`,
        "loading"
      );

      const proposed = await ai.generatePlan(buildAnnotatedDiff(stagedFiles), {
        branch: await this.getBranch(),
        repoName: workspaceName,
        instructions,
        sampleMessage
      });

      const normalized = normalizePlan(proposed, stagedFiles);
      const draftPlan = PlanAdapter.toDraftPlan(normalized.plan, stagedFiles);
      this.lastPlan = draftPlan;

      normalized.warnings.forEach((warning) => log(warning, "warning"));
      post({ command: "planGenerated", plan: draftPlan, warnings: normalized.warnings });

      const coverage = `${normalized.coveredHunks}/${normalized.totalHunks}`;
      if (normalized.totalHunks > 0 && normalized.coveredHunks < normalized.totalHunks) {
        log(
          `Plan ready: ${draftPlan.commits.length} commit(s) but only ${coverage} hunks are covered — reload the staged changes and regenerate.`,
          "warning"
        );
      } else {
        log(
          `Plan ready: ${draftPlan.commits.length} commit(s) covering ${coverage} hunks.`,
          "success"
        );
      }
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Regenerate the message of a single commit from only its own hunks.
   *
   * Falls back to a full regeneration when the commit is unknown or when its
   * hunks are no longer present in the staged diff.
   */
  public async regenerate(commitId: string, instructions?: string): Promise<void> {
    const { git, ai, post, log, setLoading, handleError, workspaceName } = this.deps;
    try {
      setLoading(true);

      const stagedFiles = await git.getParsedStagedDiff();
      if (stagedFiles.length === 0) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      const commit = this.lastPlan?.commits.find((candidate) => candidate.id === commitId);
      const diff = commit ? this.buildCommitDiff(commit, stagedFiles) : "";
      if (!commit || !diff.trim()) {
        await this.generate(instructions);
        return;
      }

      log(`Regenerating the message for "${commit.subject}"…`, "loading");
      const draft = await ai.generateCommitMessage({
        diff,
        files: commit.files.map((file) => file.path),
        type: commit.type,
        subject: commit.subject,
        branch: await this.getBranch(),
        repoName: workspaceName,
        instructions
      });

      const updated: DraftCommit = {
        ...commit,
        type: draft.type,
        subject: draft.subject,
        overview: (draft.body || []).join("\n") || commit.overview,
        aiOverview: draft.overview || commit.aiOverview
      };

      if (this.lastPlan) {
        this.lastPlan = {
          ...this.lastPlan,
          commits: this.lastPlan.commits.map((candidate) =>
            candidate.id === commitId ? updated : candidate
          )
        };
      }

      post({ command: "singleRegenerated", commit: updated });
      log("Commit message regenerated.", "success");
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  /** Build an annotated diff containing only the hunks a draft commit owns. */
  private buildCommitDiff(commit: DraftCommit, stagedFiles: ParsedFileDiff[]): string {
    const subset: ParsedFileDiff[] = [];

    for (const change of commit.changes || []) {
      const file = stagedFiles.find((candidate) => candidate.path === change.file);
      if (!file) continue;

      if (file.isBinary) {
        subset.push(file);
        continue;
      }

      const hunks = file.hunks.filter((hunk) => change.hunks.includes(hunk.index));
      if (hunks.length === 0) continue;

      const lines = hunks.flatMap((hunk) => hunk.lines);
      subset.push({
        ...file,
        hunks,
        additions: lines.filter((line) => line.startsWith("+")).length,
        deletions: lines.filter((line) => line.startsWith("-")).length
      });
    }

    return buildAnnotatedDiff(subset);
  }

  /**
   * Create the planned commits, each containing only its own hunks.
   *
   * The draft plan is re-validated against the *current* staged diff so a stale
   * plan cannot commit the wrong content.
   */
  public async execute(plan: DraftCommitPlan): Promise<void> {
    const { git, post, log, setLoading, handleError, showInformationMessage, showWarningMessage } =
      this.deps;
    try {
      if (!plan?.commits?.length) {
        throw new Error("No draft commits to execute.");
      }

      setLoading(true);
      const stagedFiles = await git.getParsedStagedDiff();
      if (stagedFiles.length === 0) {
        throw new Error("No staged changes found. Stage some changes first.");
      }

      const planned: PlannedCommit[] = [];
      for (const commit of plan.commits) {
        const changes = this.resolveChanges(commit, stagedFiles);
        if (changes.length === 0) {
          log(`Skipping "${commit.subject}": no matching staged hunks.`, "warning");
          continue;
        }
        planned.push({
          message: formatCommitMessage({
            type: commit.type,
            subject: commit.subject,
            scope: commit.scope,
            breaking: commit.breaking,
            body: commit.overview
          }),
          changes
        });
      }

      if (planned.length === 0) {
        throw new Error(
          "None of the draft commits match the current staged changes. Reload and regenerate."
        );
      }

      log(`Creating ${planned.length} commit(s) with their own hunks…`, "loading");
      const result = await git.commitHunkPlan(planned, (current, total, subject) => {
        log(`Commit ${current}/${total}: ${subject}`, "loading");
      });

      this.lastPlan = undefined;
      log(`Created ${result.committed} commit(s).`, "success");

      const remaining = await git.getStagedFiles();
      if (remaining.length > 0) {
        const message =
          `Created ${result.committed} commit(s); ${remaining.length} file(s) still have staged ` +
          "changes that the plan did not cover.";
        log(message, "warning");
        showWarningMessage(`Commit Composer: ${message}`);
      } else {
        showInformationMessage(
          `Commit Composer: created ${result.committed} commit${result.committed === 1 ? "" : "s"}.`
        );
      }

      post({ command: "setLoading", value: false });
      await this.loadStaged();
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Map a draft commit's changes onto the current staged diff, dropping hunks
   * that no longer exist (stale plan) and re-resolving file paths.
   */
  private resolveChanges(commit: DraftCommit, stagedFiles: ParsedFileDiff[]): Change[] {
    const candidates = stagedFiles.map((file) => file.path);
    const byPath = new Map(stagedFiles.map((file) => [file.path, file]));
    const resolved: Change[] = [];

    for (const change of commit.changes || []) {
      const path = resolvePath(change.file, candidates);
      const file = path ? byPath.get(path) : undefined;
      if (!path || !file) continue;

      if (file.isBinary) {
        resolved.push({ file: path, hunks: [] });
        continue;
      }

      const hunks = change.hunks.filter((index) => index >= 0 && index < file.hunks.length);
      if (hunks.length > 0) {
        resolved.push({ file: path, hunks: [...new Set(hunks)].sort((a, b) => a - b) });
      } else if (change.hunks.length === 0 && file.hunks.length > 0) {
        // No hunk information: treat the file as a whole.
        resolved.push({ file: path, hunks: file.hunks.map((hunk) => hunk.index) });
      }
    }

    return resolved;
  }

  /** Current branch name, or undefined when it cannot be read. */
  private async getBranch(): Promise<string | undefined> {
    try {
      return await this.deps.git.getCurrentBranch();
    } catch {
      return undefined;
    }
  }
}
