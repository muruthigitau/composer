import { CommitPlan } from "../types/messages";

/**
 * Context about the repository passed to the AI provider.
 */
export interface RepositoryContext {
  /** The full staged diff. */
  diff: string;
  /** Current branch name, if available. */
  branch?: string;
  /** Repository name (from folder name). */
  repoName?: string;
  /** Maximum number of commits to generate. */
  maxCommits: number;
}

/**
 * AIProvider is the abstraction for generating commit plans.
 * Providers must return a valid CommitPlan, not just commit messages.
 */
export interface AIProvider {
  /**
   * Generate a structured commit plan from the staged diff.
   * The plan must map specific hunks/files to specific commits.
   */
  generateCommitPlan(context: RepositoryContext): Promise<CommitPlan>;
}