# Commit Composer

> AI-powered Git commit composer for VS Code. Splits your staged changes into logical, reviewable, independently commit-able units.

## Features

- **🧠 AI-Driven Commit Planning** — Stage your changes, hit "Generate Commits", and let AI decompose your diff into logical commits.
- **🎯 Hunk-Level Precision** — Each generated commit contains _only_ the hunks it owns. Shared files are split correctly, so no commit is ever left empty and no change is silently swallowed.
- **🧩 Guaranteed Coverage** — Every staged hunk is assigned to exactly one commit. If the AI misses a file or invents a hunk index, the plan is repaired and you are told what changed.
- **📦 Commit Cards** — Review each proposed commit: subject, body, files, hunks, and AI reasoning.
- **🧹 Clean Commit Messages** — Conventional-commit types, scopes (`feat(api): ...`) and breaking markers are preserved and normalized; duplicated prefixes (`feat: feat: ...`) can never be produced, and bodies are wrapped consistently.
- **✅ Select & Commit** — Commit all generated commits, or only the ones you select.
- **🔄 Regenerate** — Regenerate a single commit message from just that commit's hunks (fast and cheap), or regenerate the whole plan.
- **⚡ Token-Efficient Prompts** — The AI receives a compact, hunk-indexed diff instead of raw `git diff` output.
- **🛡️ Resilient Requests** — Automatic retries for rate limits, 5xx responses, timeouts and dropped connections; empty/JSON-mode responses are re-requested, and oversized diffs are progressively reduced so generation still succeeds.
- **♾️ No Commit Limit** — The AI decides how many atomic commits the changes need; there is no maximum to tune.
- **🔌 Multiple AI Providers** — OpenAI, Google Gemini, Anthropic Claude, DeepSeek, Ollama (local, free), and any OpenAI-compatible endpoint.
- **⚙️ In-App Provider Settings** — Select your provider, enter API keys, choose models, test connections, and save settings without editing JSON. Change anytime before generating commits.
- **🔀 Pull Request Creation** — Push your branch and open a PR directly from the composer with your chosen remote, base, and head branches.
- **✨ AI-Generated PR Title & Description** — Generated from the committed `base...head` diff and the real commit list, so the description matches exactly what the pull request contains.
- **🔗 PR Link** — After creation, get a direct link to open your PR in the browser.

## Usage

1. **Stage your changes** (`git add` or the Source Control view).
2. **Open Commit Composer** — ⚡ icon in the sidebar, or `Cmd+Alt+C` / `Ctrl+Alt+C`.
3. Click **✨ Generate Commits** and review the commit cards.
4. **Commit All** (or commit only selected cards).

## Development

```bash
npm install
npm run build      # webview + extension bundles
npm run watch      # rebuild on change
npm test           # unit + git integration tests (node:test, bundled with esbuild)
npm run update-local
```

Tests cover commit-message normalization, diff parsing, plan normalization
(full hunk coverage) and hunk-precise commit execution against a temporary git
repository.
