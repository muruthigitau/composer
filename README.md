# Commit Composer

> AI-powered Git commit composer for VS Code. Splits your staged changes into logical, reviewable, independently commit-able units.

## Features

- **🧠 AI-Driven Commit Planning** — Stage your changes, hit "Generate Commits", and let AI decompose your diff into logical commits.
- **🎯 Hunk-Level Precision** — Each generated commit maps to specific files *and* specific diff hunks, not just whole files.
- **📦 Commit Cards** — Review each proposed commit: subject, body, files, hunks, and AI reasoning.
- **✅ Select & Commit** — Commit all generated commits, or only the ones you select.
- **🔄 Regenerate** — Don't like the grouping? Regenerate with one click.
- **🔌 Multiple AI Providers** — Ollama (local, free), OpenAI, and any OpenAI-compatible endpoint.

## Architecture

```
                    VS Code
                       │
                       ▼
              ┌─────────────────┐
              │ Commit Composer │
              │  Sidebar View   │
              └────────┬────────┘
                       │ messages
                       ▼
              ┌─────────────────┐
              │ Composer Engine │
              └────────┬────────┘
                       │
             ┌─────────┴──────────┐
             ▼                    ▼
       ┌─────────────┐      ┌──────────────┐
       │ Git Service │      │ AI Provider  │
       └──────┬──────┘      └──────┬───────┘
              │                    │
              ▼                    ▼
        git diff --cached       OpenAI
        git commit              Ollama
        git status              Custom endpoints
```

## Installation

### From VSIX

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension commit-composer-0.0.1.vsix
```

### From Source (Development)

```bash
# Install root dependencies
npm install

# Install webview dependencies
cd webview && npm install && cd ..

# Build everything
npm run build

# Press F5 in VS Code to launch Extension Development Host
```

## Usage

1. **Stage your changes** in the Source Control view (or `git add <files>`).
2. **Open Commit Composer** via:
   - **Activity Bar**: Click the ⚡ Commit Composer icon in the sidebar
   - **Command Palette**: `> Commit Composer: Open` (editor tab) or `> Commit Composer: Focus View` (sidebar)
   - **Source Control title bar**: ⚡ button
   - **Shortcut**: `Cmd+Alt+C` / `Ctrl+Alt+C` to focus the sidebar view
3. Click **✨ Generate Commits**.
4. AI analyzes your staged diff and produces **reviewable commit cards**.
5. Review each commit:
   - Expand a card to see body, files, and hunk assignments.
   - Select/deselect commits via checkboxes.
6. **Commit All** (or **Commit Selected**) executes the commits sequentially.

## Sidebar View

The extension contributes a **webview view** to the Activity Bar (`commitComposerContainer`) that runs the same React composer UI as the editor tab. This gives you a persistent side panel for quick commit composition without opening a tab.

- **Lazy Loading**: The view is resolved when opened/expanded
- **State Retention**: Retains state when collapsed/hidden
- **Width-Adjusted**: The React UI handles narrow sidebar widths gracefully

## Commands

| Command                          | Description                              |
|----------------------------------|------------------------------------------|
| `Commit Composer: Open`          | Opens the composer as an editor tab      |
| `Commit Composer: Focus View`    | Focuses the sidebar composer view        |
| `commitComposerView.focus` (built-in) | Focuses the sidebar view from code |

## Configuration

| Setting                          | Description                                        | Default            |
|----------------------------------|----------------------------------------------------|--------------------|
| `commitComposer.provider`        | AI provider (`ollama`, `openai`, `custom`)         | `ollama`           |
| `commitComposer.model`           | Model name                                         | `qwen2.5-coder`    |
| `commitComposer.baseUrl`         | OpenAI-compatible base URL                         | *(empty)*          |
| `commitComposer.apiKey`          | API key (or `OPENAI_API_KEY` env var)              | *(empty)*          |
| `commitComposer.maxCommits`      | Max commits AI should produce                      | `6`                |

### Example — Local with Ollama

```json
{
  "commitComposer.provider": "ollama",
  "commitComposer.model": "qwen2.5-coder"
}
```

### Example — OpenAI

```json
{
  "commitComposer.provider": "openai",
  "commitComposer.model": "gpt-4o",
  "commitComposer.apiKey": "sk-..."
}
```

### Example — Custom OpenAI-compatible endpoint

```json
{
  "commitComposer.provider": "custom",
  "commitComposer.baseUrl": "https://my-ai-gateway.example.com/v1",
  "commitComposer.model": "my-model"
}
```

## AI Prompt

The system prompt instructs the AI to **group diff hunks**, not just files:

- A file may belong to multiple commits.
- Every staged hunk must belong to exactly one commit.
- No invented changes — work only from the actual diff.
- Documentation, tests, refactors, and config changes are separated.
- Returns structured JSON with commit type, subject, body, hunks, files, and reasoning.

## How Committing Works

The extension uses safe sequential commits:

1. Saves the original staged state.
2. Commits each generated commit one at a time using `git add <files>` then `git commit -m "<message>"`.
3. If a commit fails partway, the original staging is restored where possible.

> **Note:** Hunk-level commit execution (committing only specific hunks within a file) is under development. Currently, commits are grouped at the file level.

## Project Structure

```
commit-composer/
│
├── src/
│   ├── extension.ts                     # Extension activation
│   ├── CommitComposerPanel.ts           # Editor-tab webview panel
│   ├── CommitComposerViewProvider.ts    # Sidebar webview view provider
│   ├── ai/
│   │   ├── AIProvider.ts                # Provider interface
│   │   ├── OllamaProvider.ts            # Local Ollama provider
│   │   ├── OpenAIProvider.ts            # OpenAI + compatible endpoints
│   │   └── prompts.ts                   # System/user prompts
│   ├── services/
│   │   ├── GitService.ts                # Git CLI wrapper + diff parsing
│   │   └── AIService.ts                 # Provider factory
│   └── types/
│       └── messages.ts                  # Shared message types
│
└── webview/
    ├── package.json                     # React/Vite deps
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx                      # Main React UI
        ├── main.tsx
        ├── styles.css                   # VS Code theme-aware styles
        └── types.ts                     # Webview message types
```

## Package.json Contributions

```json
{
  "commands": ["commitComposer.open", "commitComposer.focus"],
  "keybindings": {
    "command": "commitComposer.focus",
    "key": "ctrl+alt+c",
    "mac": "cmd+alt+c"
  },
  "viewsContainers": {
    "activitybar": [{ "id": "commitComposerContainer", "title": "Commit Composer", "icon": "$(git-commit)" }]
  },
  "views": {
    "commitComposerContainer": [{ "type": "webview", "id": "commitComposerView", "name": "Commit Composer" }]
  }
}
```

## Publishing

### VS Code Marketplace

```bash
vsce login your-publisher
vsce publish
```

### Open VSX (for VSCodium)

```bash
ovsx publish commit-composer-0.0.1.vsix -p <OPEN_VSX_TOKEN>
```

## Roadmap

- [ ] Hunk-level commit execution (temporary Git index)
- [ ] Drag-and-drop hunk reassignment between commits
- [ ] Edit commit messages inline
- [ ] Reorder commits
- [ ] Diff preview inside the composer
- [ ] Conflict detection
- [ ] Rollback/recovery after partial commits
- [ ] Anthropic / OpenRouter providers

## License

MIT