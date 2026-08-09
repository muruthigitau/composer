# Commit Composer

> AI-powered Git commit composer for VS Code. Splits your staged changes into logical, reviewable, independently commit-able units.

## Features

- **🧠 AI-Driven Commit Planning** — Stage your changes, hit "Generate Commits", and let AI decompose your diff into logical commits.
- **🎯 Hunk-Level Precision** — Each generated commit maps to specific files *and* specific diff hunks, not just whole files.
- **📦 Commit Cards** — Review each proposed commit: subject, body, files, hunks, and AI reasoning.
- **✅ Select & Commit** — Commit all generated commits, or only the ones you select.
- **🔄 Regenerate** — Don't like the grouping? Regenerate with one click.
- **🔌 Multiple AI Providers** — OpenAI, Google Gemini, Anthropic Claude, DeepSeek, Ollama (local, free), and any OpenAI-compatible endpoint.
- **⚙️ In-App Provider Settings** — Select your provider, enter API keys, choose models, test connections, and save settings without editing JSON. Change anytime before generating commits.

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

Most settings can be configured **in-app** via the ⚙️ settings gear in the Commit Composer header. They are also available as VS Code settings:

| Setting                            | Description                                  | Default            |
|------------------------------------|----------------------------------------------|--------------------|
| `commitComposer.provider`          | AI provider (`openai`, `gemini`, `claude`, `deepseek`, `ollama`, `custom`) | `ollama` |
| `commitComposer.openaiModel`       | OpenAI model                                 | `gpt-4o-mini`      |
| `commitComposer.openaiApiKey`      | OpenAI API key (or `OPENAI_API_KEY` env var) | *(empty)*          |
| `commitComposer.openaiBaseUrl`     | OpenAI base URL                              | `https://api.openai.com/v1` |
| `commitComposer.geminiModel`       | Gemini model                                 | `gemini-2.5-flash` |
| `commitComposer.geminiApiKey`      | Gemini API key (or `GEMINI_API_KEY` env var) | *(empty)*          |
| `commitComposer.geminiBaseUrl`     | Gemini base URL                              | `https://generativelanguage.googleapis.com/v1beta` |
| `commitComposer.claudeModel`       | Claude model                                 | `claude-3-5-sonnet-latest` |
| `commitComposer.claudeApiKey`      | Claude API key (or `ANTHROPIC_API_KEY` env var) | *(empty)*       |
| `commitComposer.claudeBaseUrl`     | Claude base URL                              | `https://api.anthropic.com/v1` |
| `commitComposer.deepseekModel`     | DeepSeek model                               | `deepseek-chat`    |
| `commitComposer.deepseekApiKey`    | DeepSeek API key (or `DEEPSEEK_API_KEY` env var) | *(empty)*      |
| `commitComposer.deepseekBaseUrl`   | DeepSeek base URL                            | `https://api.deepseek.com/v1` |
| `commitComposer.ollamaModel`       | Ollama model                                 | `qwen2.5-coder`    |
| `commitComposer.ollamaBaseUrl`     | Ollama base URL                              | `http://localhost:11434` |
| `commitComposer.customModel`       | Custom endpoint model                        | *(empty)*          |
| `commitComposer.customBaseUrl`     | Custom OpenAI-compatible base URL            | *(empty)*          |
| `commitComposer.customApiKey`      | Custom endpoint API key                      | *(empty)*          |
| `commitComposer.saveApiKeys`       | Persist API keys to global settings          | `true`             |
| `commitComposer.maxCommits`        | Max commits AI should produce                | `6`                |

### Example — Local with Ollama

```json
{
  "commitComposer.provider": "ollama",
  "commitComposer.ollamaModel": "qwen2.5-coder"
}
```

### Example — OpenAI

```json
{
  "commitComposer.provider": "openai",
  "commitComposer.openaiModel": "gpt-4o",
  "commitComposer.openaiApiKey": "sk-..."
}
```

### Example — Google Gemini

```json
{
  "commitComposer.provider": "gemini",
  "commitComposer.geminiModel": "gemini-2.5-pro",
  "commitComposer.geminiApiKey": "AIza..."
}
```

### Example — Anthropic Claude

```json
{
  "commitComposer.provider": "claude",
  "commitComposer.claudeModel": "claude-3-7-sonnet-latest",
  "commitComposer.claudeApiKey": "sk-ant-..."
}
```

### Example — DeepSeek

```json
{
  "commitComposer.provider": "deepseek",
  "commitComposer.deepseekModel": "deepseek-chat",
  "commitComposer.deepseekApiKey": "sk-..."
}
```

> **💡 Tip:** You can also configure everything from the ⚙️ settings panel inside the extension UI — no JSON editing required. Use **Test Connection** to verify your API keys before generating commits.

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
│   │   ├── BaseAIProvider.ts            # Shared JSON parsing
│   │   ├── ProviderFactory.ts           # Provider factory
│   │   ├── OpenAIProvider.ts            # OpenAI provider
│   │   ├── GeminiProvider.ts            # Google Gemini provider
│   │   ├── ClaudeProvider.ts            # Anthropic Claude provider
│   │   ├── DeepSeekProvider.ts          # DeepSeek provider
│   │   ├── OllamaProvider.ts            # Local Ollama provider
│   │   └── prompts.ts                   # System/user prompts
│   ├── services/
│   │   ├── GitService.ts                # Git CLI wrapper + diff parsing
│   │   └── AIService.ts                 # Provider config + factory
│   └── types/
│       ├── messages.ts                  # Shared message types
│       └── provider.ts                  # Provider config types & defaults
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