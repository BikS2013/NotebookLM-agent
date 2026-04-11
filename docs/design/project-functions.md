# Project Functions: ADK NLM Agent

**Version**: 1.0
**Date**: 2026-04-10
**Source**: Refined request (refined-request.md)

---

## Functional Requirements

### FR-1: Authentication Verification

The agent must verify that `nlm` authentication is active before performing operations. If authentication has expired, the agent must instruct the user to run `nlm login` manually (since browser-based auth cannot be automated by the agent).

**Tool**: `check_auth()`
**NLM Command**: `nlm login --check`

---

### FR-2: Notebook Management

The agent must support:
- Listing all notebooks (with JSON parsing for structured reasoning, truncated at 50 items)
- Getting details of a specific notebook (ID, title, source count, URL, sources list)
- Creating new notebooks (and tracking the new notebook as "current" in session state)
- Renaming notebooks
- Deleting notebooks (with explicit user confirmation before execution)
- Describing notebooks (AI-generated summary with suggested topics)

**Tools**: `list_notebooks`, `get_notebook`, `create_notebook`, `rename_notebook`, `delete_notebook`, `describe_notebook`
**NLM Commands**: `nlm notebook list/get/create/rename/delete/describe`

---

### FR-3: Source Management

The agent must support:
- Adding sources by URL (including YouTube), text, file path, or Google Drive ID
- Listing sources for a notebook (truncated at 30 items)
- Describing a source (AI-generated summary with keywords)
- Reading source content (truncated at 2000 characters)
- Deleting sources (with confirmation)
- Checking for stale Drive sources
- Syncing stale sources

**Tools**: `add_source`, `list_sources`, `describe_source`, `get_source_content`, `delete_source`, `check_stale_sources`, `sync_sources`
**NLM Commands**: `nlm source add/list/describe/content/delete/stale/sync`

---

### FR-4: Notebook Querying

The agent must support asking questions against notebook sources, with support for conversation continuity (passing conversation IDs stored in session state) and source filtering. The agent must track `last_conversation_id` in session state to enable multi-turn Q&A.

**Tool**: `query_notebook`
**NLM Command**: `nlm notebook query <nb> "question" --json [--conversation-id <id>]`

---

### FR-5: Studio Content Generation

The agent must support creating all studio artifact types:
- Audio (with format: deep_dive/brief/critique/debate, length: short/default/long)
- Video (with format: explainer/brief, style options)
- Reports (with format: "Briefing Doc"/"Study Guide"/"Blog Post"/"Create Your Own")
- Quizzes (with count: 1-20, difficulty: 1-5)
- Flashcards (with difficulty: easy/medium/hard)
- Mind maps (with title)
- Slides (with format: detailed_deck/presenter_slides)
- Infographics (with orientation: landscape/portrait/square, detail: concise/standard/detailed)
- Data tables (with description)

All generation commands must include `--confirm` automatically since the agent operates non-interactively. Studio creation commands lack `--json` output; the agent must check exit codes and follow up with `studio status --json`.

**Tools**: `create_audio`, `create_video`, `create_report`, `create_quiz`, `create_flashcards`, `create_mindmap`, `create_slides`, `create_infographic`, `create_data_table`
**NLM Commands**: `nlm audio/video/report/quiz/flashcards/mindmap/slides/infographic/data-table create`

---

### FR-6: Artifact Status and Download

The agent must:
- Check studio status for a notebook (returns artifact list with id, type, status)
- Parse artifact statuses and report which are completed, pending, or failed
- Download completed artifacts to a specified output path (default from `NLM_DOWNLOAD_DIR` config)
- Handle the async nature of generation (advise waiting, offer to poll)

**Tools**: `studio_status`, `download_artifact`
**NLM Commands**: `nlm studio status <nb> --json`, `nlm download <type> <nb> --id <id> --output <path>`

---

### FR-7: Sharing Management

The agent must support viewing sharing status, enabling/disabling public links, and inviting collaborators with role assignment (viewer/editor).

**Tools**: `share_status`, `share_public`, `share_private`, `share_invite`
**NLM Commands**: `nlm share status/public/private/invite`

---

### FR-8: Alias Management

The agent must support creating, listing, getting, and deleting aliases for easier notebook reference by human-friendly names.

**Tools**: `list_aliases`, `set_alias`, `get_alias`, `delete_alias`
**NLM Commands**: `nlm alias list/set/get/delete`

---

### FR-9: Research Operations

The agent must support starting research tasks (web or Drive, fast or deep mode), checking research status, and importing discovered sources. Research commands lack `--json` output; text parsing or exit code checking is required.

**Tools**: `start_research`, `research_status`, `import_research`
**NLM Commands**: `nlm research start/status/import`

---

### FR-10: Note Management

The agent must support listing, creating, updating, and deleting notes within notebooks. Note deletion requires confirmation.

**Tools**: `list_notes`, `create_note`, `update_note`, `delete_note`
**NLM Commands**: `nlm note list/create/update/delete`

---

### FR-YT-01: YouTube Video Search

The agent must support searching YouTube for videos by keyword, topic, or partial title. Results include video ID, title, channel name, publish date, description snippet, and thumbnail URL. Results are capped at 25 per search. Optionally supports filtering by channel ID and sorting by relevance, date, view count, or rating.

**Tool**: `search_youtube`
**API Endpoint**: YouTube Data API v3 `search.list` (100 quota units per call)

---

### FR-YT-02: YouTube Video Metadata Retrieval

The agent must support retrieving detailed metadata for a YouTube video, including title, full description, duration, view/like/comment counts, tags, category, channel info, publish date, and live status. Accepts both video IDs and full YouTube URLs (all known URL formats including youtu.be, /shorts/, /embed/, /live/, etc.).

**Tool**: `get_video_info`
**API Endpoint**: YouTube Data API v3 `videos.list` (1 quota unit per call)

---

### FR-YT-03: YouTube Video Description Retrieval

The agent must support retrieving only the description text of a YouTube video, truncated to 5000 characters. This is a lighter-weight alternative to `get_video_info` when only the description is needed.

**Tool**: `get_video_description`
**API Endpoint**: YouTube Data API v3 `videos.list` with `part=snippet` only (1 quota unit per call)

---

### FR-YT-04: YouTube Video Transcript Extraction

The agent must support extracting the full transcript/captions of a YouTube video with timestamps. Works with auto-generated and manually uploaded captions. Supports language preference. Transcript text is truncated to 10,000 characters and segments capped at 500. Does not consume YouTube API quota (uses `youtube-transcript-plus` library via YouTube Innertube).

**Tool**: `get_video_transcript`
**External Dependency**: `youtube-transcript-plus` npm package

---

### FR-YT-05: YouTube Channel Video Listing

The agent must support listing videos from a YouTube channel, accepting channel IDs (UC-prefixed), @handles, or channel URLs. Resolves handles/URLs to channel IDs before searching. Results include video IDs, titles, publish dates, and description snippets. Supports sorting by date, view count, relevance, or rating.

**Tool**: `list_channel_videos`
**API Endpoints**: YouTube Data API v3 `channels.list` (1 unit) + `search.list` (100 units)

---

### FR-FS-01: File Creation

The agent must support creating new files with text content at a specified path. Parent directories are created automatically. By default, existing files are not overwritten; the `overwrite` flag must be set to true to replace an existing file.

**Tool**: `create_file`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-02: File Reading

The agent must support reading text content of a file. Binary files (containing null bytes) are detected and rejected. Content is truncated to a configurable maximum (default 10,000 characters) to prevent token overflow.

**Tool**: `read_file`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-03: File Editing

The agent must support editing files by either replacing the first occurrence of a specific text string with new content, or appending content to the end of the file when no search text is specified.

**Tool**: `edit_file`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-04: File Deletion

The agent must support permanently deleting a file. The agent should confirm with the user before executing. Returns an error if the path points to a directory instead of a file.

**Tool**: `delete_file`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-05: Folder Creation

The agent must support creating new folders with automatic parent directory creation. The operation is idempotent: if the folder already exists, it succeeds silently.

**Tool**: `create_folder`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-06: Folder Deletion

The agent must support permanently deleting a folder. Non-empty folders require the `recursive` flag to be explicitly set to true as a safety guard against accidental data loss. The agent should confirm with the user before executing.

**Tool**: `delete_folder`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-FS-07: Folder Listing

The agent must support listing the contents of a folder, returning entry names, types (file/directory), and sizes. Supports recursive listing of subdirectories. Results are capped at 200 entries to prevent token overflow.

**Tool**: `list_folder`
**Module**: `notebooklm_agent/tools/filesystem-tools.ts`

---

### FR-11: Multi-Step Workflow Orchestration

The agent must be capable of executing multi-step workflows autonomously. For example:
- "Create a notebook, add these 3 URLs, wait for processing, then generate a podcast" should result in the agent calling multiple tools in sequence
- The agent should use its LLM reasoning to determine the correct order of operations
- The system prompt must include explicit multi-step workflow patterns

**Implementation**: System prompt with workflow patterns; no dedicated tool needed.

---

### FR-12: Error Handling and Recovery

The agent must:
- Parse error output from `nlm` commands and provide meaningful explanations
- Detect authentication failures and guide the user to re-authenticate
- Handle rate limit errors gracefully (inform user about ~50/day limit)
- Retry transient failures where appropriate
- Classify errors into: `auth_error`, `not_found`, `rate_limit`, `timeout`, `config_error`, `error`

**Implementation**: Error classification in `_run_nlm()` helper; system prompt maps error statuses to user-facing guidance.

---

### FR-13: Destructive Operation Safeguards

The agent must always confirm with the user before executing destructive operations (delete notebook, delete source, delete artifact, delete note). Safeguards are dual-layered:
1. ADK `require_confirmation=True` on `FunctionTool` (framework-level, works in `adk web`)
2. System prompt instruction "always confirm before deleting" (LLM-level, works in `adk run`)
3. The `--confirm` flag is always passed to nlm for non-interactive execution

---

### FR-14: Session State Tracking

The agent must maintain conversational context using ADK session state (`tool_context.state`):

| State Key | Type | Written By | Purpose |
|-----------|------|-----------|---------|
| `current_notebook_id` | `str | None` | `get_notebook`, `create_notebook` | Implicit notebook reference ("add source to it") |
| `current_notebook_title` | `str | None` | `get_notebook`, `create_notebook` | Display name in system prompt |
| `last_conversation_id` | `str | None` | `query_notebook` | Multi-turn Q&A continuity |
| `auth_verified` | `bool` | `check_auth` | Whether auth was checked this session |

State is injected into the system prompt via `{key?}` template syntax.

---

## Non-Functional Requirements

### NFR-1: Response Quality

The agent should provide well-structured, informative responses. When listing notebooks or sources, it should format the data readably rather than dumping raw JSON.

### NFR-2: Latency

CLI tool invocations add latency. The agent should:
- Use `--json` output format for tool calls to enable reliable parsing
- Avoid unnecessary calls (e.g., don't list all notebooks if the user provides an ID)
- Use `--quiet` when only IDs are needed

### NFR-3: Token Efficiency

The agent's system prompt and tool definitions must be concise. Large CLI output should be truncated by the tool wrapper before returning to the LLM:
- Notebook list: max 50 items
- Source list: max 30 items
- Source content: first 2000 characters
- Studio status: all items (typically <20)

### NFR-4: Security

- Never store or log authentication credentials
- Never pass credentials as command-line arguments
- Rely on `nlm`'s own auth management at `~/.notebooklm-mcp-cli/`

### NFR-5: Maintainability

- Each nlm command category is a separate tool module
- Tool functions have clear docstrings for LLM reasoning
- Configuration is externalized with no fallback values

### NFR-6: Testability

- Tool wrapper functions are testable independently of the ADK agent
- `subprocess.run` calls are mockable for unit testing
- Tests are located in `test_scripts/` per project conventions

---

## Constraints

### C-1: Technology Stack

- **Language**: Python 3.12+
- **Framework**: Google ADK (`google-adk >= 1.14.0`)
- **Package Manager**: UV
- **LLM**: Gemini 2.5 Flash (configurable via `GEMINI_MODEL`)
- **CLI Dependency**: `nlm` (notebooklm-mcp-cli) must be installed and authenticated

### C-2: Configuration (No Fallbacks)

| Variable | Purpose | Required |
|----------|---------|:--------:|
| `GOOGLE_API_KEY` | Gemini API key | Yes |
| `GEMINI_MODEL` | LLM model name | Yes |
| `NLM_CLI_PATH` | Path to nlm executable | Yes |
| `NLM_DOWNLOAD_DIR` | Default download directory | Yes |

### C-3: Authentication Boundary

The agent cannot perform browser-based authentication. It must verify auth status and instruct the user to authenticate externally if needed.

### C-4: Rate Limiting

The free tier allows ~50 API queries/day. The agent should be aware of this and avoid unnecessary calls.

### C-5: `adk web --no-reload`

Always run `adk web` with `--no-reload` flag to avoid subprocess transport issues.

---

## Terminal User Interface (TUI) Requirements

### FR-TUI-01: Chat Interface Layout

The TUI shall present a three-region layout:
- **Status bar** (fixed, 1 line) -- displays agent status, session info, and keyboard shortcut hints.
- **Message history area** (scrollable, flexGrow) -- displays the conversation between the user and the agent, distinguishing user messages from agent responses visually (color, prefix).
- **Input area** (multi-line capable, flexShrink=0) -- a text input region at the bottom where the user composes messages.

**Implementation**: Ink 7 Flexbox layout with `<Box flexDirection="column" height={rows}>`.

---

### FR-TUI-02: Message Submission

- Pressing **Enter** (without Shift) sends the current input to the agent.
- Pressing **Shift+Enter** inserts a newline in the input area (multi-line input support). Requires Kitty keyboard protocol; **Ctrl+O** as fallback for terminals without Kitty support.

**Component**: `InputArea.tsx`

---

### FR-TUI-03: Programmatic Agent Integration

The TUI shall invoke the NotebookLM ADK agent programmatically using `InMemoryRunner` from `@google/adk`, importing `rootAgent` directly from `agent.ts`. It shall not spawn a subprocess. Responses are streamed token-by-token using `StreamingMode.SSE`. Events are classified using `toStructuredEvents()`.

**Hook**: `useAgent.ts`

---

### FR-TUI-04: Conversation History Display

- User messages and agent responses displayed with clear visual distinction (green for user, cyan for agent).
- Message history is scrollable via keyboard: PageUp/PageDown (page), Home/End (top/bottom).
- Long agent responses word-wrap within the terminal width.
- Auto-scroll to bottom on new messages (unless user has scrolled up).

**Components**: `ChatHistory.tsx`, `Message.tsx`

---

### FR-TUI-05: Tool Call Visibility

When the agent invokes a tool, the TUI shall display a spinner with the tool name (e.g., "Calling search_youtube..."). The spinner animates using `useAnimation` from Ink. Tool results are not shown directly; the agent's summarized response is displayed instead.

**Component**: `ToolCallIndicator.tsx`

---

### FR-TUI-06: Input History

Per-session input history (up to 50 entries). **Up Arrow** (when cursor is on the first line of input) recalls the previous input. **Down Arrow** (when cursor is on the last line) navigates forward in history. The "draft" input is preserved when navigating history.

**Hook**: `useInputHistory.ts`

---

### FR-TUI-07: Graceful Exit

- **Ctrl+C** cancels the current agent operation (if running) or exits the TUI (if idle).
- **Ctrl+D** on empty input exits the TUI; on non-empty input, deletes character forward (Emacs).
- `/quit` or `/exit` commands exit the TUI.

**Component**: `App` (index.tsx)

---

### FR-TUI-08: Status Bar

Displays agent status (idle/thinking/streaming/tool_call/error) with color-coded indicator, session ID, and keyboard shortcut hints.

**Component**: `StatusBar.tsx`

---

### FR-TUI-09: Slash Commands

- `/clear` -- clear the message history display.
- `/quit` or `/exit` -- exit the TUI.
- `/help` -- display available commands and keyboard shortcuts.

**Component**: `App` (index.tsx)

---

### FR-TUI-14: Slash Command — `/history`

Typing `/history` inserts a system message into the chat history containing all conversation messages formatted with role, ISO timestamp, text content, and tool call details. System messages are visually distinct from user/agent messages (dim/yellow styling). If the conversation is empty, displays `No messages in the current session.` The command is only available when the agent status is `idle`. The command is case-insensitive and added to input history for up-arrow recall.

**Pure function**: `formatHistory()` in `lib/format-commands.ts`  
**Component**: `App` (index.tsx), `MessageBubble.tsx` (system role rendering)

---

### FR-TUI-15: Slash Command — `/memory` (alias `/state`)

Typing `/memory` or `/state` inserts a system message displaying the ADK session state (key-value pairs stored in `Session.state`). Shows session ID in the header, each key-value pair on its own line with JSON-stringified values, keys sorted alphabetically. If state is empty, displays `Session state is empty.` Only available when agent status is `idle`. Requires async access to `runner.sessionService.getSession()`.

**Pure function**: `formatSessionState()` in `lib/format-commands.ts`  
**Hook method**: `useAgent.getSessionState()`  
**Component**: `App` (index.tsx)

---

### FR-TUI-16: Slash Command — `/new` (alias `/reset`)

Typing `/new` or `/reset` deletes the current ADK session, creates a new one, clears all messages from the chat history, resets the scroll position, and inserts a confirmation system message with the new session ID. This is a destructive operation that executes immediately without confirmation. If session deletion or creation fails, an error system message is displayed and the existing session remains intact. Only available when agent status is `idle`.

**Hook method**: `useAgent.resetSession()`  
**Component**: `App` (index.tsx)

---

### FR-TUI-17: Slash Command — `/last` (alias `/raw`)

Typing `/last` or `/raw` inserts a system message showing the last user-to-model exchange extracted from the ADK session events. Displays the request (user content) and all response events (model text, function calls, function responses) in a structured format. Token usage metadata (prompt/completion tokens) is shown when available. If no events exist, displays `No request/response data available.` Only available when agent status is `idle`. Uses ADK helper functions `getFunctionCalls()` and `getFunctionResponses()` for event parsing.

**Pure function**: `formatLastExchange()` in `lib/format-commands.ts`  
**Hook method**: `useAgent.getSessionEvents()`  
**Component**: `App` (index.tsx)

---

### FR-TUI-10: Terminal Resize Handling

The TUI responds to terminal resize events (SIGWINCH) via `useWindowSize` from Ink and re-renders the layout correctly. Root `<Box>` height is bound to `rows`.

---

### FR-TUI-11: macOS Text Editing Keyboard Shortcuts

The input area must support 50+ keyboard shortcuts for cursor movement, text selection, deletion, text manipulation, clipboard operations, and undo/redo. Primary bindings are Ctrl/Emacs style (works in all terminals). Cmd+key bindings available only in Kitty-protocol terminals with Super key configuration.

Key groups:
- **Movement**: Arrow keys, Option+Arrow (word), Ctrl+A/E (line), Ctrl+F/B (char), Ctrl+N/P (line), Home/End
- **Selection**: Shift+Arrow (char), Shift+Option+Arrow (word), Shift+Home/End (line), Select All
- **Deletion**: Backspace, Delete, Option+Backspace (word), Ctrl+H/D, Ctrl+K (kill to EOL), Ctrl+U (kill to BOL), Ctrl+W (kill word)
- **Manipulation**: Ctrl+T (transpose), Ctrl+O (open line), Ctrl+Y (yank from kill ring)
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z

**Components**: `useKeyHandler.ts`, `useTextEditor.ts`, `text-buffer.ts`, `word-boundaries.ts`, `kill-ring.ts`, `undo-stack.ts`

---

### FR-TUI-12: Worker Thread Agent Execution

The agent runs in a Node.js Worker thread to prevent `execFileSync` calls in tools from blocking the TUI's event loop. The main thread communicates with the worker via `MessagePort`. The TUI remains responsive (spinner animates, input works) during tool execution.

**Components**: `agent-worker.ts`, `agent-protocol.ts`

---

### FR-TUI-13: Streaming Response Display

Agent responses appear token-by-token as they stream from the LLM via `StreamingMode.SSE`. Partial messages are displayed with a streaming indicator. The user can type while a response is streaming (non-blocking input).

**Hook**: `useAgent.ts`

---

### TUI Non-Functional Requirements

| NFR | Requirement |
|-----|-------------|
| NFR-TUI-01 | Input latency < 16ms from keypress to screen update |
| NFR-TUI-02 | Works in iTerm2 (full), Terminal.app (graceful degradation), and at least one other terminal |
| NFR-TUI-03 | Node.js only (no Python, Go, Rust dependencies) |
| NFR-TUI-04 | Startup time < 3 seconds |
| NFR-TUI-05 | Memory < 200MB for typical sessions |
| NFR-TUI-06 | All functionality accessible via keyboard (no mouse requirement) |
| NFR-TUI-07 | Terminal widths 80-300+ columns, minimum 24 rows |

---

### TUI Constraints

| Constraint | Description |
|------------|-------------|
| C-TUI-01 | TypeScript implementation, ES modules |
| C-TUI-02 | Ink 7 + React 19 framework |
| C-TUI-03 | Kitty keyboard protocol (`mode: 'enabled'`) for full shortcuts |
| C-TUI-04 | Same `.env` configuration as existing agent (no new env vars) |
| C-TUI-05 | Runnable via `npx tsx` and `npm run tui` |
| C-TUI-06 | macOS is primary platform |
| C-TUI-07 | Agent code (`agent.ts`, `tools/*`) must not be modified |
