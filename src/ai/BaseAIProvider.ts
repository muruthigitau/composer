import { PrContent } from "./AIProvider";
import { CommitPlan } from "../types/messages";

/**
 * Shared JSON parsing and normalization logic for AI providers.
 */
export abstract class BaseAIProvider {
  /**
   * Parse and validate the AI response into a CommitPlan.
   * Handles markdown code fences, JSON syntax errors, and normalization.
   */
  protected parsePlan(rawResponse: string): CommitPlan {
    // Trim and extract JSON if wrapped in code fences
    let clean = rawResponse.trim();

    // Handle potential preamble text before JSON
    const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      clean = fenceMatch[1].trim();
    }

    // If no code fence, try to extract the JSON object from the response
    if (!clean.startsWith("{")) {
      const jsonStart = clean.indexOf("{");
      const jsonEnd = clean.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        clean = clean.substring(jsonStart, jsonEnd + 1);
      }
    }

    try {
      const parsed = JSON.parse(clean) as CommitPlan;

      // Validate structure
      if (!parsed || !Array.isArray(parsed.commits)) {
        throw new Error("AI response missing 'commits' array");
      }

      // Normalize and validate each commit
      parsed.commits = parsed.commits.map((commit, index) => ({
        id: commit.id || String(index + 1),
        type: this.normalizeType(commit.type),
        subject: commit.subject || "Untitled commit",
        body: Array.isArray(commit.body) ? commit.body.map(String) : [],
        changes: Array.isArray(commit.changes)
          ? commit.changes.map((change: any) => ({
              file: change.file || "",
              hunks: Array.isArray(change.hunks) ? change.hunks.map(Number) : []
            }))
          : [],
        reasoning: commit.reasoning || undefined,
        overview: commit.overview || undefined
      }));

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse AI response as JSON: ${error.message}\nRaw: ${clean.substring(0, 500)}`
        );
      }
      throw error;
    }
  }

  /**
   * Parse the AI response into a PR title/description JSON object.
   */
  protected parsePrJson(rawResponse: string): PrContent {
    let clean = rawResponse.trim();
    const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) clean = fenceMatch[1].trim();

    if (!clean.startsWith("{")) {
      const s = clean.indexOf("{");
      const e = clean.lastIndexOf("}");
      if (s !== -1 && e !== -1 && e > s) clean = clean.substring(s, e + 1);
    }

    try {
      const parsed = JSON.parse(clean) as PrContent;
      return {
        title: String(parsed.title || "").trim(),
        description: String(parsed.description || "").trim()
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse PR content as JSON: ${error.message}\nRaw: ${clean.substring(0, 500)}`);
      }
      throw error;
    }
  }

  protected normalizeType(type: string): string {
    const validTypes = [
      "feat",
      "fix",
      "refactor",
      "docs",
      "style",
      "test",
      "chore",
      "perf",
      "ci",
      "build",
      "revert"
    ];
    const lower = (type || "").trim().toLowerCase();
    return validTypes.includes(lower) ? lower : "chore";
  }
}