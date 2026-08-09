import {
  CommitGroup,
  CommitPlan,
  DraftCommit,
  DraftCommitPlan,
  FileDiff
} from "../types/messages";

/**
 * PlanAdapter translates the internal hunk-based AI plan (`CommitPlan`)
 * into the file-based UI plan (`DraftCommitPlan`) shown by the webview.
 *
 * Each CommitGroup maps files + hunk indices to concrete staged file diffs.
 * We preserve the full diffText for any file a commit touches, which is what
 * the master-detail diff view requires.
 */
export class PlanAdapter {
  /**
   * Convert the AI's hunk-based plan into a UI plan with real file diffs.
   *
   * @param plan          Internal AI plan (hunk-based).
   * @param stagedFiles   Full staged per-file diffs from GitService.
   */
  public static toDraftPlan(plan: CommitPlan, stagedFiles: FileDiff[]): DraftCommitPlan {
    const commits: DraftCommit[] = plan.commits.map((group) =>
      this.commitGroupToDraft(group, stagedFiles)
    );

    return {
      commits,
      summary: this.buildSummary(commits)
    };
  }

  /**
   * Convert a single internal commit group into a draft commit.
   */
  public static commitGroupToDraft(group: CommitGroup, stagedFiles: FileDiff[]): DraftCommit {
    const filesByPath = new Map(stagedFiles.map((f) => [f.path, f]));

    // Collect FileDiff for every file the group touches, preserving order.
    const files: FileDiff[] = [];
    const seen = new Set<string>();

    for (const change of group.changes || []) {
      const file = filesByPath.get(change.file);
      if (file && !seen.has(file.path)) {
        seen.add(file.path);
        files.push(file);
      }
    }

    // The AI (via the prompt) already emits a rich summary paragraph followed
    // by "- " bullet lines. Use it verbatim — no extra "Why/Files" sections.
    const bodyLines = (group.body || []).map(String);
    const overview = bodyLines.join("\n");

    return {
      id: group.id,
      type: group.type,
      subject: group.subject,
      overview,
      files,
      aiOverview: group.overview || undefined
    };
  }

  private static buildSummary(commits: DraftCommit[]): string {
    const totalFiles = commits.reduce((acc, c) => acc + c.files.length, 0);
    const totalAdds = commits.reduce(
      (acc, c) => acc + c.files.reduce((a, f) => a + f.additions, 0),
      0
    );
    const totalDels = commits.reduce(
      (acc, c) => acc + c.files.reduce((a, f) => a + f.deletions, 0),
      0
    );

    return `${commits.length} commit${commits.length === 1 ? "" : "s"} · ` +
      `${totalFiles} file${totalFiles === 1 ? "" : "s"} · ` +
      `+${totalAdds} / -${totalDels}`;
  }
}