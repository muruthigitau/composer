/**
 * Pull Request generation and creation.
 *
 * Kept separate from the commit-plan flow because it has a different lifecycle:
 * PR content is generated from the **committed** `base...head` diff and the
 * real commit list, and creation pushes the head branch before calling the
 * GitHub CLI (with a compare-URL fallback).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ActivityItem, ExtensionToWebviewMessage } from "../types/messages";
import { AIService } from "../services/AIService";
import { GitService } from "../services/GitService";
import { buildAnnotatedDiff, parseUnifiedDiff } from "../services/DiffParser";
import { decodeUriEntities, sanitizePrTitle } from "../services/CommitMessage";
import { buildCompareUrl, buildGhPrArgs } from "../services/PullRequestService";

/** Dependencies the PR flow needs from its host/controller. */
export interface PullRequestFlowDeps {
  git: GitService;
  ai: AIService;
  workspaceName?: string;
  post(message: ExtensionToWebviewMessage): void;
  log(message: string, type?: ActivityItem["type"]): void;
  setLoading(value: boolean): void;
  handleError(error: unknown): void;
  openExternal(url: string): PromiseLike<unknown> | void;
}

export class PullRequestFlow {
  constructor(private readonly deps: PullRequestFlowDeps) {}

  /**
   * Generate the PR title and/or description from the committed
   * `base...head` diff and the real commit list of the pull request.
   *
   * @param titleOnly Generate only the title.
   * @param descOnly Generate only the description.
   * @param baseBranch Base branch selected in the PR modal.
   * @param headBranch Head branch selected in the PR modal.
   */
  public async generateContent(
    titleOnly?: boolean,
    descOnly?: boolean,
    baseBranch?: string,
    headBranch?: string
  ): Promise<void> {
    const { git, ai, post, log, setLoading, handleError, workspaceName } = this.deps;
    try {
      setLoading(true);
      log("Checking that the working tree is clean…", "loading");

      if (!(await git.isWorkingTreeClean())) {
        const status = await git.getStatusCounts();
        throw new Error(
          `Working tree is not clean (${status.staged} staged, ${status.unstaged} unstaged). ` +
            "Commit or stash your changes first — PR content is generated from committed differences only."
        );
      }

      const head = headBranch?.trim() || (await git.getCurrentBranch());
      if (!head) {
        throw new Error(
          "No head branch found. Check out the branch you want to open a pull request for."
        );
      }

      const base = await this.resolveBaseBranch(baseBranch, head);
      log(`Reading committed diff ${base.ref}...${head}…`, "loading");

      const rawDiff = await git.getBranchDiff(base.ref, head);
      if (!rawDiff.trim()) {
        throw new Error(
          `No committed differences found between "${base.name}" and "${head}". Nothing to include in a pull request.`
        );
      }

      const commits = await git.getCommitsBetween(base.ref, head);
      log(`Generating PR title and description from ${commits.length} commit(s)…`, "loading");

      const content = await ai.generatePrContent(
        buildAnnotatedDiff(parseUnifiedDiff(rawDiff)),
        commits,
        { branch: head, baseBranch: base.name, repoName: workspaceName }
      );

      const wantsTitle = Boolean(titleOnly) || (!titleOnly && !descOnly);
      post({
        command: "prContentGenerated",
        title: wantsTitle ? sanitizePrTitle(content.title) : undefined,
        description: descOnly || (!titleOnly && !descOnly) ? content.description : undefined
      });
      log("PR content ready.", "success");
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Push the head branch and create the pull request.
   *
   * Uses the GitHub CLI when available (body passed via a temp file so
   * Markdown is never mangled) and falls back to opening the repository's
   * compare URL in the browser.
   */
  public async create(
    remote: string,
    baseBranch: string,
    headBranch: string,
    title: string,
    body: string
  ): Promise<void> {
    const { git, post, log, setLoading, handleError, openExternal } = this.deps;
    let bodyFile = "";
    try {
      setLoading(true);

      const cleanTitle = sanitizePrTitle(title);
      const cleanBody = decodeUriEntities(body).trim();
      if (!remote) throw new Error("Select a remote to push to.");
      if (!baseBranch || !headBranch) throw new Error("Select both a base and a head branch.");
      if (baseBranch === headBranch) {
        throw new Error("The base and head branches must be different.");
      }

      const currentBranch = await git.getCurrentBranch();
      if (headBranch !== currentBranch && !(await git.hasLocalBranch(headBranch))) {
        throw new Error(
          `"${headBranch}" is not a local branch. Check it out (or push it) before creating the pull request.`
        );
      }

      log(`Pushing ${headBranch} to ${remote}…`, "loading");
      await git.exec(["push", "-u", remote, headBranch]);

      bodyFile = path.join(os.tmpdir(), `commit-composer-pr-${Date.now()}.md`);
      await fs.promises.writeFile(bodyFile, cleanBody || cleanTitle, "utf8");

      let ghError = "";
      try {
        const output = (
          await git.runCommand(
            "gh",
            buildGhPrArgs({ baseBranch, headBranch, title: cleanTitle, bodyFile })
          )
        ).trim();
        const url = output
          .split("\n")
          .map((line) => line.trim())
          .reverse()
          .find((line) => line.startsWith("http"));
        post({
          command: "prCreated",
          url,
          message: url ? `Pull request created: ${url}` : output || "Pull request created."
        });
        log(url ? `Pull request created: ${url}` : "Pull request created.", "success");
        return;
      } catch (error) {
        ghError = error instanceof Error ? error.message : String(error);
        log(`GitHub CLI unavailable: ${ghError}`, "warning");
      }

      const remoteInfo = (await git.getRemotes()).find((entry) => entry.name === remote);
      const compareUrl = remoteInfo
        ? buildCompareUrl(remoteInfo.url, baseBranch, headBranch, cleanTitle, cleanBody)
        : "";
      if (!compareUrl) {
        throw new Error(
          `Could not create the pull request.${ghError ? ` gh failed: ${ghError}` : ""}`
        );
      }

      await openExternal(compareUrl);
      post({
        command: "prCreated",
        url: compareUrl,
        message: "Opened the compare page — finish creating the pull request in your browser."
      });
      log("Opened the compare page for PR creation.", "success");
    } catch (error) {
      handleError(error);
    } finally {
      if (bodyFile) {
        try {
          await fs.promises.rm(bodyFile, { force: true });
        } catch {
          // Best effort temp file cleanup.
        }
      }
      setLoading(false);
    }
  }

  /**
   * Resolve a usable base ref for comparisons, preferring the requested branch
   * and falling back to its remote-tracking ref and the repository default.
   */
  private async resolveBaseBranch(
    requested: string | undefined,
    head: string
  ): Promise<{ ref: string; name: string }> {
    const { git } = this.deps;
    const defaultBranch = await git.getDefaultBranch();
    const candidates = [requested?.trim(), defaultBranch, "main", "master"].filter(
      (value): value is string => Boolean(value)
    );

    for (const candidate of candidates) {
      for (const ref of [candidate, `origin/${candidate}`]) {
        if (ref === head) continue;
        if (await git.refExists(ref)) {
          return { ref, name: candidate };
        }
      }
    }

    const fallback = requested?.trim() || defaultBranch;
    return { ref: fallback, name: fallback };
  }
}

