# Commit Composer

> AI-powered Git commit composer for VS Code. Splits your staged changes into logical, reviewable, independently commit-able units.

## Features

- **🧠 AI-Driven Commit Planning** — Stage your changes, hit "Generate Commits", and let AI decompose your diff into logical commits.
- **🎯 Hunk-Level Precision** — Each generated commit maps to specific files _and_ specific diff hunks, not just whole files.
- **📦 Commit Cards** — Review each proposed commit: subject, body, files, hunks, and AI reasoning.
- **✅ Select & Commit** — Commit all generated commits, or only the ones you select.
- **🔄 Regenerate** — Don't like the grouping? Regenerate with one click.
- **🔌 Multiple AI Providers** — OpenAI, Google Gemini, Anthropic Claude, DeepSeek, Ollama (local, free), and any OpenAI-compatible endpoint.
- **⚙️ In-App Provider Settings** — Select your provider, enter API keys, choose models, test connections, and save settings without editing JSON. Change anytime before generating commits.
- **🔀 Pull Request Creation** — Push your branch and open a PR directly from the composer with your chosen remote, base, and head branches.
- **✨ AI-Generated PR Title & Description** — Auto-generate the PR title and Markdown description from committed branch differences.
- **🔗 PR Link** — After creation, get a direct link to open your PR in the browser.

## Usage

1. **Stage your changes** (`git add` or the Source Control view).
2. **Open Commit Composer** — ⚡ icon in the sidebar, or `Cmd+Alt+C` / `Ctrl+Alt+C`.
3. Click **✨ Generate Commits** and review the commit cards.
4. **Commit All** (or commit only selected cards).
