/**
 * Translation between the internal hunk-based AI plan (`CommitPlan`) and the
 * file-based UI plan (`DraftCommitPlan`) rendered by the webview.
 *
 * Each draft commit keeps the exact `changes` (file + hunk indices) it owns so
 * the UI can preview precisely what will be committed and the executor can
 * stage only those hunks.
 */

import {
  Change,
  CommitGroup,
  CommitPlan,
  DraftCommit,
  DraftCommitPlan,
  FileDiff
} from "../types/messages";
import { ParsedFileDiff, toFileDiffs } from "./DiffParser";

export class PlanAdapter {
  /**
   * Convert the normalized hunk-based plan into a UI plan with real file diffs.
   *
   * @param plan Normalized AI plan (hunk-based).
   * @param stagedFiles Parsed staged diff from GitService.
   */
  public static toDraftPlan(plan: CommitPlan, stagedFiles: ParsedFileDiff[]): DraftCommitPlan {
    const fileDiffs = toFileDiffs(stagedFiles);
    const byPath = new Map(fileDiffs.map((file) => [file.path, file]));
    const commits = plan.commits.map((group) => this.commitGroupToDraft(group, byPath));

    return {
      commits,
      summary: this.buildSummary(commits)
    };
  }

  /**
   * Convert a single internal commit group into a draft commit.
   */
  public static commitGroupToDraft(
    group: CommitGroup,
    filesByPath: Map<string, FileDiff>
  ): DraftCommit {
    const files: FileDiff[] = [];
    const changes: Change[] = [];
    const seen = new Set<string>();

    for (const change of group.changes || []) {
      const file = filesByPath.get(change.file);
      if (!file) {
        continue;
      }
      changes.push({ file: change.file, hunks: [...change.hunks] });
      if (!seen.has(file.path)) {
        seen.add(file.path);
        files.push(file);
      }
    }

    // The prompt asks for a summary paragraph followed by "- " bullets; keep it
    // verbatim so the commit body is exactly what the reviewer sees.
    const overview = (group.body || []).map(String).join("\n");

    return {
      id: group.id,
      type: group.type,
      scope: group.scope,
      breaking: group.breaking,
      subject: group.subject,
      overview,
      files,
      changes,
      aiOverview: group.overview || undefined
    };
  }

  /** One-line summary displayed above the commit timeline. */
  private static buildSummary(commits: DraftCommit[]): string {
    const totalFiles = new Set(commits.flatMap((commit) => commit.files.map((file) => file.path)))
      .size;
    const totalAdds = commits.reduce(
      (acc, commit) => acc + commit.files.reduce((sum, file) => sum + file.additions, 0),
      0
    );
    const totalDels = commits.reduce(
      (acc, commit) => acc + commit.files.reduce((sum, file) => sum + file.deletions, 0),
      0
    );
    const totalHunks = commits.reduce(
      (acc, commit) => acc + commit.changes.reduce((sum, change) => sum + change.hunks.length, 0),
      0
    );

    const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    return (
      `${plural(commits.length, "commit")} · ${plural(totalFiles, "file")} · ` +
      `${plural(totalHunks, "hunk")} · +${totalAdds} / -${totalDels}`
    );
  }
}
