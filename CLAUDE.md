<structure-and-conventions>
## Structure & Conventions

- Every time you want to create a test script, you must create it in the test_scripts folder. If the folder doesn't exist, you must make it.

- All the plans must be kept under the docs/design folder inside the project's folder in separate files: Each plan file must be named according to the following pattern: plan-xxx-<indicative description>.md

- The complete project design must be maintained inside a file named docs/design/project-design.md under the project's folder. The file must be updated with each new design or design change.

- All the reference material used for the project must be collected and kept under the docs/reference folder.
- All the functional requirements and all the feature descriptions must be registered in the /docs/design/project-functions.MD document under the project's folder.

<configuration-guide>
- If the user ask you to create a configuration guide, you must create it under the docs/design folder, name it configuration-guide.md and be sure to explain the following:
  - if multiple configuration options exist (like config file, env variables, cli params, etc) you must explain the options and what is the priority of each one.
  - Which is the purpose and the use of each configuration variable
  - How the user can obtain such a configuration variable
  - What is the recomented approach of storing or managing this configuration variable
  - Which options exist for the variable and what each option means for the project
  - If there are any default value for the parameter you must present it.
  - For configuration parameters that expire (e.g., PAT keys, tokens), I want you to propose to the user adding a parameter to capture the parameter's expiration date, so the app or service can proactively warn users to renew.
</configuration-guide>

- Every time you create a prompt working in a project, the prompt must be placed inside a dedicated folder named prompts. If the folder doesn't exists you must create it. The prompt file name must have an sequential number prefix and must be representative to the prompt use and purpose.

- You must maintain a document at the root level of the project, named "Issues - Pending Items.md," where you must register any issue, pending item, inconsistency, or discrepancy you detect. Every time you fix a defect or an issue, you must check this file to see if there is an item to remove.
- The "Issues - Pending Items.md" content must be organized with the pending items on top and the completed items after. From the pending items the most critical and important must be first followed by the rest.

- When I ask you to create tools in the context of a project everything must be in Typescript.
- Every tool you develop must be documented in the project's Claude.md file
- The documentation must be in the following format:
<toolName>
    <objective>
        what the tool does
    </objective>
    <command>
        the exact command to run
    </command>
    <info>
        detailed description of the tool
        command line parameters and their description
        examples of usage
    </info>
</toolName>

- Every time I ask you to do something that requires the creation of a code script, I want you to examine the tools already implemented in the scope of the project to detect if the code you plan to write, fits to the scope of the tool.
- If so, I want you to implement the code as an extension of the tool, otherwise I want you to build a generic and abstract version of the code as a tool, which will be part of the toolset of the project.
- Our goal is, while the project progressing, to develop the tools needed to test, evaluate, generate data, collect information, etc and reuse them in a consistent manner.
- All these tools must be documented inside the CLAUDE.md to allow their consistent reuse.

- When I ask you to locate code, I need to give me the folder, the file name, the class, and the line number together with the code extract.
- Don't perform any version control operation unless I explicitly request it.

- When you design databases you must align with the following table naming conventions:
  - Table names must be singular e.g. the table that keeps customers' data must be called "Customer"
  - Tables that are used to express references from one entity to another can by plural if the first entity is linked to many other entities.
  - So we have "Customer" and "Transaction" tables, we have CustomerTransactions.

- You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception. You must never substitute the missing config value with a default or a fallback value.
- If I ask you to make an exception to the configuration setting rule, you must write this exception in the projects memory file, before you implement it.
</structure-and-conventions>

# NotebookLM Agent

## Project Overview

An AI agent built on Google ADK (Agent Development Kit) that manages Google NotebookLM collections through natural language. Uses the `nlm` CLI tool for NotebookLM operations and the YouTube Data API v3 for YouTube content discovery.

## Tools

<YouTubeTools>
    <objective>
        Five ADK FunctionTools that enable searching YouTube, retrieving video metadata,
        fetching transcripts, and listing channel videos. These tools allow the agent to
        discover YouTube content and integrate it with NotebookLM notebooks.
    </objective>
    <command>
        Tools are registered in the agent and invoked by the LLM automatically.
        No direct CLI command -- they are part of the ADK agent tool set.
    </command>
    <info>
        The YouTube tools are defined in notebooklm_agent/tools/youtube-tools.ts and backed
        by the HTTP client in notebooklm_agent/tools/youtube-client.ts.

        Requires YOUTUBE_API_KEY environment variable (no fallback).

        Tool 1: search_youtube
            Search YouTube for videos matching a query.
            Parameters:
                query (string, required) - Search keywords, title fragments, or topic
                max_results (number, optional) - Max results 1-25
                channel_id (string, optional) - Restrict to a specific channel
                order (enum, optional) - "relevance" | "date" | "viewCount" | "rating"
            Quota cost: 100 units per call

        Tool 2: get_video_info
            Get detailed metadata about a YouTube video (title, description, duration,
            views, likes, tags, category, channel info).
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
            Quota cost: 1 unit per call

        Tool 3: get_video_description
            Get only the description text of a YouTube video (truncated to 5000 chars).
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
            Quota cost: 1 unit per call

        Tool 4: get_video_transcript
            Get the full transcript/captions of a YouTube video with timestamps.
            Works with auto-generated and manual captions.
            Parameters:
                video_id (string, required) - Video ID or full YouTube URL
                language (string, optional) - Preferred language code (e.g., "en", "es")
            Quota cost: 0 units (uses youtube-transcript-plus, not the API)

        Tool 5: list_channel_videos
            List videos from a YouTube channel. Accepts channel ID, @handle, or URL.
            Parameters:
                channel_id (string, required) - Channel ID, @handle, or channel URL
                max_results (number, optional) - Max results 1-50
                order (enum, optional) - "date" | "viewCount" | "relevance" | "rating"
            Quota cost: 101 units (100 search + 1 channel resolution)

        Supporting modules:
            youtube-client.ts - HTTP client for YouTube Data API v3 with:
                - YouTubeApiResult<T> union type for all responses
                - extractVideoId() - parses any YouTube URL format to video ID
                - parseDuration() - ISO 8601 duration to seconds
                - youtubeSearchVideos() - search.list endpoint wrapper
                - youtubeGetVideos() - videos.list endpoint wrapper
                - resolveChannelId() - handle/URL to UC-prefixed channel ID
                - Error classification (rate_limit, config_error, not_found, error)
                - AbortController-based 10s timeout on all requests

        Daily API quota: 10,000 units (free tier).
    </info>
</YouTubeTools>

<FilesystemTools>
    <objective>
        Seven ADK FunctionTools that enable creating, reading, editing, and deleting files
        and folders on the local filesystem. These tools allow the agent to manage documents,
        save generated content, and organize project files.
    </objective>
    <command>
        Tools are registered in the agent and invoked by the LLM automatically.
        No direct CLI command -- they are part of the ADK agent tool set.
    </command>
    <info>
        The filesystem tools are defined in notebooklm_agent/tools/filesystem-tools.ts.
        Uses Node.js built-in `node:fs` and `node:path` modules -- no external dependencies.
        No configuration variables required.

        Tool 1: create_file
            Create a new file with given content at the specified path.
            Parent directories are created automatically if they do not exist.
            Parameters:
                file_path (string, required) - Absolute or relative path for the new file
                content (string, required) - Text content to write
                overwrite (boolean, optional) - If true, overwrite existing file; otherwise fail if exists

        Tool 2: read_file
            Read the text content of a file with optional truncation.
            Detects binary files (null bytes) and refuses to read them.
            Parameters:
                file_path (string, required) - Path to the file to read
                max_chars (number, optional) - Maximum characters to return (default: 10000)

        Tool 3: edit_file
            Edit a file by replacing text or appending content.
            When old_text is provided, the first occurrence is replaced with new_text.
            When old_text is omitted, new_text is appended to the end.
            Parameters:
                file_path (string, required) - Path to the file to edit
                old_text (string, optional) - Text to find and replace
                new_text (string, required) - Replacement or append text

        Tool 4: delete_file
            Permanently delete a file. Agent should confirm with user first.
            Parameters:
                file_path (string, required) - Path to the file to delete

        Tool 5: create_folder
            Create a new folder. Parent directories created automatically.
            Idempotent: succeeds silently if folder already exists.
            Parameters:
                folder_path (string, required) - Path for the new folder

        Tool 6: delete_folder
            Permanently delete a folder. Requires recursive=true for non-empty folders.
            Agent should confirm with user first.
            Parameters:
                folder_path (string, required) - Path to the folder to delete
                recursive (boolean, optional) - Must be true to delete non-empty folders

        Tool 7: list_folder
            List contents of a folder with file types and sizes.
            Results capped at 200 entries.
            Parameters:
                folder_path (string, required) - Path to the folder to list
                recursive (boolean, optional) - If true, include subdirectory contents

        Tests: test_scripts/test-filesystem-tools.test.ts (25 tests)
    </info>
</FilesystemTools>

<TerminalUI>
    <objective>
        Interactive terminal user interface (TUI) for chatting with the NotebookLM agent.
        Built on Ink 7 (React for CLI) with full macOS keyboard navigation support
        including Option+Arrow word navigation, Shift+Arrow selection, Emacs keybindings
        (Ctrl+A/E/K/W/T/Y), undo/redo, kill ring, and Kitty keyboard protocol support.
    </objective>
    <command>
        npm run tui
        # Or directly: npx tsx notebooklm_agent/tui.ts
    </command>
    <info>
        The TUI provides a three-region terminal interface:
        - StatusBar (top): agent status with animated spinner, session ID, key hints
        - ChatHistory (middle): scrollable message list with windowing
        - InputArea (bottom): multi-line text input with cursor and selection highlighting

        Architecture:
            notebooklm_agent/tui.ts              CLI entry point (loads dotenv, renders App)
            notebooklm_agent/tui/index.tsx        App root component (wires hooks + components)
            notebooklm_agent/tui/types.ts         Shared types (Message, AgentStatus, ToolCallInfo)
            notebooklm_agent/tui/lib/             Pure library modules (no React dependency)
                text-buffer.ts                    Immutable TextBuffer with 22 pure operations
                word-boundaries.ts                macOS word boundary detection
                kill-ring.ts                      Circular buffer for killed text (Emacs Ctrl+K/Y)
                undo-stack.ts                     Operation-based undo/redo with 300ms grouping
                edit-actions.ts                   EditAction discriminated union (shared contract)
                format-commands.ts                Pure formatters for /history, /memory, /last output
            notebooklm_agent/tui/hooks/           React hooks
                useAgent.ts                       ADK InMemoryRunner wrapper, event stream processing
                useTextEditor.ts                  TextBuffer state + undo + kill ring
                useKeyHandler.ts                  47 keyboard shortcuts → EditAction mapping
                useInputHistory.ts                Up/Down arrow input recall (50 entries)
                useScrollManager.ts               Chat history scroll state
            notebooklm_agent/tui/components/      Ink React components
                InputArea.tsx                     Multi-line input with cursor/selection rendering
                ChatHistory.tsx                   Scrollable message list with windowing
                MessageBubble.tsx                 Single message rendering (user/agent/system)
                StatusBar.tsx                     Agent status, session ID, key hints
                ToolCallIndicator.tsx             Animated spinner for tool calls
            notebooklm_agent/tui/worker/          Worker thread (protocol types, future impl)
                agent-protocol.ts                 MainToWorker/WorkerToMain message types

        Keyboard shortcuts (47 total):
            Enter                   Send message
            Shift+Enter / Ctrl+O    New line in input
            Option+Left/Right       Word-by-word navigation
            Ctrl+A / Ctrl+E         Line start / line end
            Ctrl+F / Ctrl+B         Forward / backward character
            Ctrl+N / Ctrl+P         Down / up line
            Shift+Arrow             Text selection
            Shift+Option+Arrow      Word selection
            Option+Backspace        Delete previous word
            Ctrl+K                  Kill to end of line
            Ctrl+U                  Kill to start of line
            Ctrl+W                  Kill previous word
            Ctrl+Y                  Yank (paste from kill ring)
            Ctrl+T                  Transpose characters
            Ctrl+Z                  Undo
            Ctrl+Shift+Z            Redo
            PageUp / PageDown       Scroll chat history
            Ctrl+C                  Cancel agent / exit
            Ctrl+D                  Delete forward / exit (empty)
            /quit, /exit            Exit TUI

        Slash commands:
            /history                Show conversation history
            /memory (alias /state)  Show ADK session state (agent memory)
            /new (alias /reset)     Clear memory and start new conversation
            /last (alias /raw)      Show last request/response exchanged with model
            /quit (alias /exit)     Exit TUI
            /clear                  Clear input area

        Kitty keyboard protocol:
            Enabled by default for terminals that support it (iTerm2, Kitty, Alacritty,
            Ghostty, WezTerm). Enables Shift+Enter detection, Cmd+Arrow via Super key
            mapping, and full modifier disambiguation. Terminal.app gracefully degrades
            to legacy escape sequences with Ctrl/Emacs bindings as primary.

        Prerequisites:
            - All standard agent env vars (GOOGLE_GENAI_API_KEY, etc.)
            - Node.js (LTS)
            - Terminal with Kitty protocol support recommended (iTerm2, Kitty)

        Tests:
            test_scripts/test-text-buffer.test.ts (87 tests)
            test_scripts/test-word-boundaries.test.ts (28 tests)
            test_scripts/test-kill-ring.test.ts (11 tests)
            test_scripts/test-undo-stack.test.ts (17 tests)
            test_scripts/test-key-handler.test.ts (49 tests)
            test_scripts/test-format-commands.test.ts (27 tests)
            Total: 219 tests
    </info>
</TerminalUI>

<CLI>
    <objective>
        Simple readline-based CLI for chatting with the NotebookLM agent.
        Supports the same slash commands as the TUI: /history, /memory, /new, /last.
        Streams agent responses with inline tool call indicators.
    </objective>
    <command>
        npm run cli
        # Or directly: npx tsx notebooklm_agent/cli.ts
    </command>
    <info>
        The CLI provides a minimal terminal interface without Ink/React dependencies.
        Uses Node.js readline for input and ANSI escape codes for colored output.
        Shares the InMemoryRunner and format-commands module with the TUI.

        Slash commands:
            /history           Show conversation history
            /memory, /state    Show ADK session state (agent memory)
            /new, /reset       Clear memory and start new session
            /last, /raw        Show last request/response exchanged with model
            /help              Show available commands
            /quit, /exit       Exit the CLI

        Output formatting:
            - Agent responses stream character-by-character
            - Tool calls shown inline: ↳ calling tool_name({args}) ✓
            - System messages in dim yellow [system] prefix
            - Errors in red

        Architecture:
            notebooklm_agent/cli.ts              Entry point (readline loop, runner, commands)
            notebooklm_agent/tui/lib/format-commands.ts  Shared formatting (reused from TUI)
            notebooklm_agent/tui/types.ts        Shared Message type (reused from TUI)

        Prerequisites:
            - All standard agent env vars (GOOGLE_GENAI_API_KEY, etc.)
            - Node.js (LTS)
    </info>
</CLI>

<LlmProxy>
    <objective>
        Optional ADK plugin that intercepts all LLM request/response traffic between
        the agent and the model, capturing full payloads, tool calls, streaming chunks,
        and token usage for developer inspection and debugging.
    </objective>
    <command>
        # Enable the proxy via environment variables:
        LLM_PROXY_ENABLED=true LLM_PROXY_LOG_DIR=./logs npm run tui
        LLM_PROXY_ENABLED=true LLM_PROXY_LOG_DIR=./logs npm run cli

        # Use /inspect in the TUI or CLI to view captured interactions:
        /inspect
    </command>
    <info>
        The LLM Proxy Plugin is an optional component that acts as an observer between
        the ADK agent and the LLM. When enabled, it captures every request sent to the
        model and every response received, including streaming chunks, tool calls, and
        errors — without modifying any agent behavior.

        Architecture:
            notebooklm_agent/proxy/
                proxy-types.ts          All TypeScript types and interfaces
                proxy-serializer.ts     Safe JSON serialization for ADK objects
                proxy-buffer.ts         In-memory circular buffer for interactions
                proxy-logger.ts         Async NDJSON file writer with rotation
                proxy-config.ts         Environment variable configuration
                llm-proxy-plugin.ts     BasePlugin subclass (9 callback overrides)
                format-inspect.ts       /inspect command output formatter
                proxy-factory.ts        Conditional plugin creation
                index.ts                Barrel exports

        Environment variables:
            LLM_PROXY_ENABLED       "true" to enable (default: disabled)
            LLM_PROXY_LOG_DIR       Directory for NDJSON log files (required when enabled)
            LLM_PROXY_VERBOSE       "true" for stderr summaries (default: false)
            LLM_PROXY_BUFFER_SIZE   In-memory buffer capacity (default: 10)
            LLM_PROXY_MAX_FILE_SIZE Max log file bytes before rotation (default: 50MB)

        Note: LLM_PROXY_VERBOSE, LLM_PROXY_BUFFER_SIZE, and LLM_PROXY_MAX_FILE_SIZE
        have default values as documented exceptions to the no-fallback configuration rule.

        What is captured per interaction:
            - Interaction ID, session ID, timestamps, duration
            - User message text (first 500 chars)
            - For each LLM round trip:
                - Model name, system instruction, conversation history
                - Tool names and declarations (full on first round trip)
                - Generation config (temperature, topP, etc.)
                - Response content, token usage, finish reason
                - Streaming chunk count
                - Errors (if any)
            - For each tool call:
                - Tool name, arguments, result, duration
                - Error details (if failed)
            - Total token counts across all round trips

        Slash commands:
            /inspect        View last captured interaction (both TUI and CLI)
            /proxy          Alias for /inspect

        NDJSON log format:
            Each line is a JSON object with: event, timestamp, interactionId,
            roundTrip (optional), and payload. Event types: interaction_start,
            llm_request, llm_response, tool_start, tool_result, tool_error,
            llm_error, interaction_end.

        Safety guarantees:
            - All plugin callbacks return undefined (observe-only, never modifies behavior)
            - All callbacks wrapped in try/catch (never crashes the agent)
            - Zero overhead when disabled (plugin not created, not passed to runner)
            - Logger errors written to stderr with [llm-proxy] prefix

        Tests:
            test_scripts/test-proxy-serializer.test.ts (25 tests)
            test_scripts/test-proxy-buffer.test.ts (10 tests)
            test_scripts/test-proxy-config.test.ts (9 tests)
            test_scripts/test-llm-proxy-plugin.test.ts (22 tests)
            test_scripts/test-proxy-logger.test.ts (8 tests)
            test_scripts/test-format-inspect.test.ts (6 tests)
            Total: 80 tests

        Examples:
            # Basic usage with TUI
            LLM_PROXY_ENABLED=true LLM_PROXY_LOG_DIR=./logs npm run tui
            # Chat with the agent, then type /inspect to see captured data

            # Verbose mode (prints summaries to stderr)
            LLM_PROXY_ENABLED=true LLM_PROXY_LOG_DIR=./logs LLM_PROXY_VERBOSE=true npm run cli

            # Custom buffer and file size
            LLM_PROXY_ENABLED=true LLM_PROXY_LOG_DIR=./logs \
              LLM_PROXY_BUFFER_SIZE=100 LLM_PROXY_MAX_FILE_SIZE=52428800 npm run tui
    </info>
</LlmProxy>

<ProxyInspector>
    <objective>
        Standalone Electron app for inspecting and monitoring NDJSON log files
        generated by the LLM Proxy Plugin. Provides a visual interface with
        interaction timeline, payload rendering, token dashboards, and live
        file tailing.
    </objective>
    <command>
        # Development mode (hot reload):
        cd proxy-inspector && npm run dev

        # Build and preview:
        cd proxy-inspector && npm run build && npm run preview

        # Or launch directly after build:
        cd proxy-inspector && npx electron out/main/index.js
    </command>
    <info>
        The Proxy Inspector is an independent Electron application under proxy-inspector/
        that visualizes the NDJSON log files produced by the LLM Proxy Plugin.

        Architecture:
            proxy-inspector/
                src/
                    main/                    Electron main process
                        index.ts             BrowserWindow, menu, window state
                        ndjson-parser.ts     NDJSON line parser with remainder buffer
                        interaction-store.ts Event grouping by interactionId
                        file-tailer.ts       fs.watch byte-offset tailing (500ms debounce)
                        file-manager.ts      File dialog, recent files
                        ipc-handlers.ts      IPC channel handlers
                    preload/
                        index.ts             contextBridge typed API
                    shared/
                        types.ts             Shared TypeScript interfaces
                        ipc-types.ts         ProxyInspectorAPI interface
                        ipc-channels.ts      IPC channel name constants
                    renderer/
                        src/
                            App.tsx          Root component
                            components/      React components (12 files)
                            hooks/           Custom hooks (useFileData, useDetail)
                            styles/          Dark theme CSS (Catppuccin Mocha)

        Features:
            - Open NDJSON log files via file dialog
            - Live file tailing (watches for new data appended by the proxy)
            - Interaction list with timestamps, user messages, badge indicators
            - Detail panel with vertical event timeline
            - Type-specific payload rendering for all 8 event types
            - Collapsible JSON viewer with syntax highlighting
            - Token usage display (prompt/completion/total)
            - Tool call tracking with arguments and results
            - Search interactions by user message text
            - Dark theme (Catppuccin Mocha palette)
            - Window state persistence
            - Recent files list

        Event types rendered:
            interaction_start   Session ID, user message
            llm_request         Model, system instruction, contents, tools, config
            llm_response        Response text, tokens, finish reason, streaming info
            tool_start          Tool name, arguments
            tool_result         Result summary, duration
            tool_error          Error message (red highlight)
            llm_error           Error details (red highlight)
            interaction_end     Duration, total tokens, tool calls summary

        Technology:
            - Electron 41 with context isolation and sandbox
            - React 19 renderer
            - electron-vite 4 build system
            - TypeScript throughout
            - No external UI framework (custom CSS)

        Prerequisites:
            - Node.js (LTS)
            - npm install in proxy-inspector/ directory

        Tests (in parent project test_scripts/):
            test-ndjson-parser.test.ts (21 tests)
            test-interaction-store.test.ts (18 tests)
            test-file-tailer.test.ts (8 tests)
            Total: 47 tests

        Examples:
            # Start in dev mode
            cd proxy-inspector && npm run dev

            # Open a specific log file (macOS)
            open -a proxy-inspector/out/proxy-inspector.app logs/*.ndjson
    </info>
</ProxyInspector>
