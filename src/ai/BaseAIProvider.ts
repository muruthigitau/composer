/**
 * Shared implementation for every AI provider.
 *
 * Concrete providers only implement {@link BaseAIProvider.complete}; the three
 * high-level operations, prompt construction, JSON extraction and output
 * normalization are implemented here once.
 */

import {
  AIProvider,
  CommitMessageContext,
  CommitMessageDraft,
  CompletionRequest,
  PrCommit,
  PrContent,
  RepositoryContext
} from "./AIProvider";
import {
  MESSAGE_SYSTEM_PROMPT,
  STRICT_SYSTEM_SUFFIX,
  SYSTEM_PROMPT,
  buildMessagePrompt,
  buildPrPrompt,
  buildUserPrompt
} from "./prompts";
import { CommitPlan } from "../types/messages";
import { decodeUriEntities, normalizeType, parseSubject } from "../services/CommitMessage";
import { shrinkAnnotatedDiff } from "../services/DiffParser";
import { extractCommitGroups, extractJsonObjectWithKeys, extractPlan } from "./planJson";

export abstract class BaseAIProvider implements AIProvider {
  /**
   * Perform a single completion request with the provider's API.
   *
   * @param request System/user prompts and response preferences.
   * @returns The raw text response.
   */
  protected abstract complete(request: CompletionRequest): Promise<string>;

  /** {@inheritdoc AIProvider.generateCommitPlan} */
  async generateCommitPlan(context: RepositoryContext): Promise<CommitPlan> {
    // Attempt 1: full annotated diff, strict JSON.
    // Attempt 2: reduced diff (smaller context) — models truncate less.
    // Attempt 3: reduced diff with the JSON-lines format, which small or
    //            reasoning-heavy models can emit far more reliably.
    const attempts: Array<{ maxChars: number; json: boolean; jsonl: boolean; strict: boolean }> = [
      { maxChars: 0, json: true, jsonl: false, strict: false },
      { maxChars: 60_000, json: true, jsonl: false, strict: true },
      { maxChars: 24_000, json: false, jsonl: true, strict: true }
    ];

    let lastError: unknown;
    for (const [index, attempt] of attempts.entries()) {
      const diff =
        attempt.maxChars > 0 ? shrinkAnnotatedDiff(context.diff, attempt.maxChars) : context.diff;

      try {
        const raw = await this.complete({
          system: attempt.strict ? STRICT_SYSTEM_SUFFIX : SYSTEM_PROMPT,
          user: buildUserPrompt(diff, {
            instructions: context.instructions,
            sampleMessage: context.sampleMessage,
            branch: context.branch,
            repoName: context.repoName,
            reduced: diff !== context.diff,
            jsonl: attempt.jsonl
          }),
          json: attempt.json,
          maxTokens: 8192
        });
        return this.parsePlan(raw);
      } catch (error) {
        lastError = error;
        console.warn(
          `[commit-composer] Commit plan attempt ${index + 1}/${attempts.length} failed: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `The commit plan could not be generated after ${attempts.length} attempts. ${detail} ` +
        "Try a different model, or stage fewer files at a time."
    );
  }

  /** {@inheritdoc AIProvider.generateCommitMessage} */
  async generateCommitMessage(context: CommitMessageContext): Promise<CommitMessageDraft> {
    const raw = await this.complete({
      system: MESSAGE_SYSTEM_PROMPT,
      user: buildMessagePrompt(context),
      json: true,
      maxTokens: 2048
    });
    return this.parseCommitMessage(raw, context.type);
  }

  /** {@inheritdoc AIProvider.generatePrContent} */
  async generatePrContent(
    diff: string,
    commits: PrCommit[],
    context?: { branch?: string; baseBranch?: string; repoName?: string }
  ): Promise<PrContent> {
    const raw = await this.complete({
      user: buildPrPrompt(diff, commits, context),
      json: true,
      maxTokens: 8192
    });
    return this.parsePrJson(raw);
  }

  // ─────────────────────────── parsing helpers ───────────────────────────

  /** Parse and normalize a commit plan response. */
  protected parsePlan(rawResponse: string): CommitPlan {
    const { found, commits: groups } = extractPlan(rawResponse);
    if (!found) {
      const preview = String(rawResponse ?? "").replace(/\s+/g, " ").slice(0, 300);
      throw new Error(
        "The AI response contained no usable commit plan. " +
          `Expected JSON objects with "type"/"subject"/"changes". Response began with: ${preview}`
      );
    }

    const commits = groups.map((commit, index) => {
      const parsedSubject = parseSubject(commit.subject || "");
      return {
        id: String(commit.id || index + 1),
        type: normalizeType(commit.type || parsedSubject.type || "chore"),
        scope: commit.scope ? String(commit.scope) : parsedSubject.scope,
        breaking: commit.breaking || parsedSubject.breaking || undefined,
        subject: parsedSubject.subject || "update staged changes",
        body: (commit.body || []).map(String).filter((line) => line.trim()),
        changes: (commit.changes || []).map((change) => ({
          file: String(change?.file || ""),
          hunks: Array.isArray(change?.hunks) ? change.hunks.map(Number) : []
        })),
        reasoning: commit.reasoning || undefined,
        overview: commit.overview ? String(commit.overview) : undefined
      };
    });

    return { commits };
  }

  /** Parse a single-commit message response. */
  protected parseCommitMessage(rawResponse: string, fallbackType: string): CommitMessageDraft {
    const draft = extractCommitGroups(rawResponse)[0];
    if (!draft) {
      const preview = String(rawResponse ?? "").replace(/\s+/g, " ").slice(0, 300);
      throw new Error(
        `The AI response contained no usable commit message. Response began with: ${preview}`
      );
    }

    const parsedSubject = parseSubject(draft.subject || "");
    const body = (draft.body || []).map(String).filter((line) => line.trim());

    return {
      type: normalizeType(draft.type || parsedSubject.type || fallbackType),
      scope: parsedSubject.scope,
      breaking: parsedSubject.breaking,
      subject: parsedSubject.subject || "update staged changes",
      body: body.length > 0 ? body : ["Update staged changes."],
      overview: draft.overview
    };
  }

  /**
   * Parse the PR title/description response.
   *
   * Percent-encoded characters (`%23`) and literal `\n` escapes that some
   * models emit are decoded so the Markdown renders correctly.
   */
  protected parsePrJson(rawResponse: string): PrContent {
    const parsed = extractJsonObjectWithKeys(rawResponse, ["title", "description"]);
    if (!parsed) {
      const preview = String(rawResponse ?? "").replace(/\s+/g, " ").slice(0, 300);
      throw new Error(
        `The AI response contained no usable pull request content. Response began with: ${preview}`
      );
    }

    return {
      title: this.sanitizePrText(String(parsed.title || "").trim()),
      description: this.sanitizePrText(String(parsed.description || "").trim())
    };
  }

  /** Decode percent-encoded entities and literal escape sequences. */
  protected sanitizePrText(text: string): string {
    return decodeUriEntities(
      text.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'")
    );
  }
}

