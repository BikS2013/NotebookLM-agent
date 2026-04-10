# Refined Request: NotebookLM Agent using Google ADK

**Version**: 1.0
**Date**: 2026-04-10
**Status**: Draft - Awaiting User Review

---

## 1. Objective

Build a Google ADK (Agent Development Kit) Python agent that provides intelligent, conversational access to the user's Google NotebookLM collection. The agent wraps the existing `nlm` CLI tool (v0.4.4) as a set of ADK tools, enabling a Gemini-powered agent to plan and execute multi-step NotebookLM operations through natural language instructions.

The agent should be able to answer questions like:
- "List all my notebooks and tell me which ones have YouTube sources"
- "Create a new notebook called 'AI Trends 2026', add these three URLs as sources, and generate a podcast"
- "What's the status of my latest audio generation?"
- "Delete all notebooks that haven't been updated in the last 30 days"

---

## 2. Background

### 2.1 Google ADK (Agent Development Kit)

Google ADK is an open-source, code-first Python framework for building AI agents. Key characteristics relevant to this project:

- **Installation**: `pip install google-adk` (latest: v1.29.0)
- **Agent Types**: `LlmAgent` (LLM-powered reasoning), `SequentialAgent`, `ParallelAgent`, `LoopAgent` (workflow orchestration)
- **Tool Integration**: Python functions are automatically wrapped as tools via `FunctionTool`. The agent's LLM decides when and how to call tools based on their docstrings and type annotations.
- **Session Management**: Built-in session and state persistence across conversation turns
- **Runner**: Orchestrates the agent's reason-act loop, yielding event streams
- **Model Support**: Primarily Gemini models (gemini-2.5-flash, gemini-2.5-pro), but supports other providers via LiteLLM
- **Development Tools**: `adk run` (CLI), `adk web` (web UI for development/debugging)
- **Deployment**: Local, Cloud Run, Vertex AI Agent Engine, GKE

**Documentation**: https://google.github.io/adk-docs/
**GitHub**: https://github.com/google/adk-python

### 2.2 NLM CLI Tool (v0.4.4)

The `nlm` CLI is a Python-based command-line tool that provides full programmatic access to Google NotebookLM. It is installed via `uv tool install notebooklm-mcp-cli` and authenticated via browser-based Google sign-in (`nlm login`).

**Complete Command Capabilities:**

| Category | Commands | Description |
|----------|----------|-------------|
| **Authentication** | `nlm login`, `nlm login --check`, `nlm login --profile <name>`, `nlm login profile list/delete/rename`, `nlm login switch` | Browser-based Google auth with multi-profile support, 3-layer auto-recovery |
| **Notebooks** | `nlm notebook list`, `nlm notebook get <id>`, `nlm notebook describe <id>`, `nlm notebook create <title>`, `nlm notebook rename <id> <title>`, `nlm notebook delete <id> --confirm` | Full CRUD on notebooks |
| **Aliases** | `nlm alias list`, `nlm alias set <name> <uuid>`, `nlm alias get <name>`, `nlm alias delete <name>` | Human-friendly shortcuts for UUIDs |
| **Sources** | `nlm source add <nb> --url/--text/--file/--drive`, `nlm source list <nb>`, `nlm source describe <id>`, `nlm source content <id>`, `nlm source rename`, `nlm source delete`, `nlm source stale`, `nlm source sync` | Add URLs, text, files, Drive docs; inspect and manage sources |
| **Querying** | `nlm notebook query <nb> "question"`, with `--conversation-id`, `--source-ids`, `--json` | AI-powered Q&A against notebook sources |
| **Chat Config** | `nlm chat configure <nb> --goal <type> --response-length <len>` | Configure chat behavior (default, learning_guide, custom prompt) |
| **Research** | `nlm research start "query" --notebook-id <nb> --mode fast/deep --source web/drive`, `nlm research status`, `nlm research import` | Web/Drive research with source discovery and import |
| **Audio** | `nlm audio create <nb> --format deep_dive/brief/critique/debate --length short/default/long --confirm` | Podcast-style audio generation |
| **Video** | `nlm video create <nb> --format explainer/brief --style <style> --confirm` | Video generation with style options |
| **Reports** | `nlm report create <nb> --format "Briefing Doc"/"Study Guide"/"Blog Post"/"Create Your Own" --confirm` | Document generation |
| **Quizzes** | `nlm quiz create <nb> --count <n> --difficulty 1-5 --confirm` | Quiz generation |
| **Flashcards** | `nlm flashcards create <nb> --difficulty easy/medium/hard --confirm` | Flashcard generation |
| **Mind Maps** | `nlm mindmap create <nb> --title <title> --confirm` | Mind map generation |
| **Slides** | `nlm slides create <nb> --format detailed_deck/presenter_slides --confirm`, `nlm slides revise` | Slide deck generation and revision |
| **Infographics** | `nlm infographic create <nb> --orientation landscape/portrait/square --detail concise/standard/detailed --confirm` | Infographic generation |
| **Data Tables** | `nlm data-table create <nb> "description" --confirm` | Structured data extraction |
| **Studio Status** | `nlm studio status <nb>`, `nlm studio delete <nb> <artifact-id> --confirm` | Check generation status, delete artifacts |
| **Downloads** | `nlm download audio/video/report/mind-map/slide-deck/infographic/data-table/quiz/flashcards <nb> --id <id> --output <path>` | Download completed artifacts |
| **Export** | `nlm export to-docs <nb> <artifact-id>`, `nlm export to-sheets <nb> <artifact-id>` | Export to Google Docs/Sheets |
| **Sharing** | `nlm share status/public/private <nb>`, `nlm share invite <nb> <email> --role viewer/editor` | Sharing and collaboration |
| **Notes** | `nlm note list/create/update/delete` | Notebook notes management |
| **Config** | `nlm config show/get/set` | CLI configuration |
| **Diagnostics** | `nlm doctor` | Health checks |

**Output Formats**: Default (compact table), `--json` (structured), `--quiet` (IDs only), `--title` (ID: Title), `--full` (all details).

**Authentication Model**: Browser-based cookie auth. Sessions last ~20 minutes with auto-recovery. Tokens stored at `~/.notebooklm-mcp-cli/`.

**Rate Limits**: Free tier allows ~50 API queries/day.

---

## 3. Scope

### 3.1 In Scope

1. **ADK Agent Definition**: A Python-based ADK agent (`LlmAgent`) with Gemini as the LLM backbone
2. **NLM Tool Wrappers**: Python functions that wrap `nlm` CLI commands as ADK-compatible tools, using `subprocess` to execute the CLI and parse JSON output
3. **Core Tool Categories** (matching nlm capabilities):
   - Authentication verification (`nlm login --check`)
   - Notebook CRUD (list, get, create, rename, delete)
   - Source management (add URL/text/file, list, describe, delete)
   - Querying notebooks (Q&A against sources)
   - Studio content generation (audio, video, report, quiz, flashcards, slides, infographic, mind map, data table)
   - Studio status checking and artifact downloading
   - Sharing management
   - Alias management
   - Research operations (start, status, import)
4. **Agent Instructions**: A well-crafted system prompt that guides the agent to use tools appropriately, handle multi-step workflows, and provide informative responses
5. **Session State**: Use ADK session state to track the current working notebook, recent operations, and conversation context
6. **Local Development**: Runnable via `adk run` (CLI) and `adk web` (web UI)
7. **Project Documentation**: Design docs, configuration guide, and project structure per conventions

### 3.2 Out of Scope

1. **Production deployment** to Cloud Run, Vertex AI, or GKE (future phase)
2. **Multi-agent architecture** (single agent with tools is sufficient for v1; multi-agent orchestration can be added later)
3. **Custom UI** beyond what `adk web` provides
4. **Modifying the nlm CLI** itself -- we wrap it as-is
5. **Bulk export TypeScript tools** (export-youtube-notebooks.ts and related) -- these are specialized scripts outside the agent's scope for v1
6. **OAuth/service account authentication** -- the agent relies on the user having already authenticated via `nlm login`
7. **MCP server integration** -- while nlm has an MCP mode, we use direct CLI invocation for simplicity and control

---

## 4. Functional Requirements

### FR-1: Authentication Verification
The agent must verify that `nlm` authentication is active before performing operations. If authentication has expired, the agent must instruct the user to run `nlm login` manually (since browser-based auth cannot be automated by the agent).

### FR-2: Notebook Management
The agent must support:
- Listing all notebooks (with optional JSON parsing for structured reasoning)
- Getting details of a specific notebook
- Creating new notebooks
- Renaming notebooks
- Deleting notebooks (with explicit user confirmation before execution)
- Describing notebooks (AI-generated summary)

### FR-3: Source Management
The agent must support:
- Adding sources by URL (including YouTube), text, file path, or Google Drive ID
- Listing sources for a notebook
- Describing a source (AI summary)
- Reading source content
- Deleting sources (with confirmation)
- Checking for stale Drive sources and syncing them

### FR-4: Notebook Querying
The agent must support asking questions against notebook sources, with support for conversation continuity (passing conversation IDs) and source filtering.

### FR-5: Studio Content Generation
The agent must support creating all studio artifact types:
- Audio (with format, length, focus options)
- Video (with format, style options)
- Reports (with format options)
- Quizzes (with count, difficulty)
- Flashcards (with difficulty)
- Mind maps (with title)
- Slides (with format, length)
- Infographics (with orientation, detail level)
- Data tables (with description)

All generation commands must include `--confirm` automatically since the agent operates non-interactively.

### FR-6: Artifact Status and Download
The agent must:
- Check studio status for a notebook
- Parse artifact statuses and report which are completed, pending, or failed
- Download completed artifacts to a specified output path
- Handle the async nature of generation (advise waiting, offer to poll)

### FR-7: Sharing Management
The agent must support viewing sharing status, enabling/disabling public links, and inviting collaborators.

### FR-8: Alias Management
The agent must support creating, listing, and deleting aliases for easier notebook reference.

### FR-9: Research Operations
The agent must support starting research tasks (web or Drive), checking research status, and importing discovered sources.

### FR-10: Multi-Step Workflow Orchestration
The agent must be capable of executing multi-step workflows autonomously. For example:
- "Create a notebook, add these 3 URLs, wait for processing, then generate a podcast" should result in the agent calling multiple tools in sequence
- The agent should use its LLM reasoning to determine the correct order of operations

### FR-11: Error Handling and Recovery
The agent must:
- Parse error output from `nlm` commands and provide meaningful explanations
- Detect authentication failures and guide the user to re-authenticate
- Handle rate limit errors gracefully (inform user about limits)
- Retry transient failures where appropriate

### FR-12: Destructive Operation Safeguards
The agent must always confirm with the user before executing destructive operations (delete notebook, delete source, delete artifact). The `--confirm` flag must only be passed after explicit user approval within the conversation.

---

## 5. Non-Functional Requirements

### NFR-1: Response Quality
The agent should provide well-structured, informative responses. When listing notebooks or sources, it should format the data readably rather than dumping raw JSON.

### NFR-2: Latency
CLI tool invocations add latency. The agent should:
- Use `--json` output format for tool calls to enable reliable parsing
- Avoid unnecessary calls (e.g., don't list all notebooks if the user provides an ID)
- Use `--quiet` when only IDs are needed

### NFR-3: Token Efficiency
The agent's system prompt and tool definitions must be concise. Large CLI output (e.g., full notebook list) should be summarized by the tool wrapper before returning to the LLM.

### NFR-4: Security
- Never store or log authentication credentials
- Never pass credentials as command-line arguments
- Rely on `nlm`'s own auth management at `~/.notebooklm-mcp-cli/`

### NFR-5: Maintainability
- Each nlm command category should be a separate tool or group of tools
- Tool functions should have clear docstrings that the LLM can use for reasoning
- Configuration should be externalized (no hardcoded values)

### NFR-6: Testability
- Tool wrapper functions should be testable independently of the ADK agent
- Mock-friendly design: subprocess calls should be isolatable for unit testing

---

## 6. Constraints

### C-1: Technology Stack
- **Language**: Python 3.10+ (ADK requirement)
- **Framework**: Google ADK (`google-adk` package)
- **Package Manager**: UV (per project conventions)
- **LLM**: Gemini 2.5 Flash (default) or Gemini 2.5 Pro
- **CLI Dependency**: `nlm` v0.4.4 must be installed and authenticated

### C-2: Configuration Requirements
The following must be configurable (no hardcoded values, no fallback defaults -- per project conventions):
- **Gemini Model**: Which Gemini model to use
- **Google API Key or Vertex AI credentials**: Required for ADK to call Gemini
- **NLM CLI path**: Path to the `nlm` executable (in case it's not on PATH)
- **Default output directory**: For artifact downloads

### C-3: NLM CLI Integration Pattern
The agent wraps `nlm` via `subprocess.run()` (or `asyncio.create_subprocess_exec()` for async). Key decisions:
- Always use `--json` flag when available to get structured output
- Parse JSON output in the tool wrapper, return clean Python dicts/strings to the LLM
- Capture stderr for error detection
- Set reasonable timeouts (research deep mode can take 5+ minutes)

### C-4: Authentication Boundary
The agent cannot perform browser-based authentication. It must verify auth status and instruct the user to authenticate externally if needed.

### C-5: Rate Limiting
The free tier allows ~50 API queries/day. The agent should be aware of this and avoid unnecessary calls.

### C-6: Project Structure
Per conventions, the project lives at `/Users/giorgosmarinos/aiwork/TrainingMaterial/108 - Google ADK/` and must follow the standard structure:
```
108 - Google ADK/
  CLAUDE.md                          # Project instructions and tool documentation
  Issues - Pending Items.md          # Issue tracker
  docs/
    design/
      project-design.md              # Complete project design
      project-functions.md           # Functional requirements
      configuration-guide.md         # Configuration documentation
      plan-001-*.md                  # Implementation plans
    reference/
      refined-request.md             # This document
  src/                               # Agent source code
    notebooklm_agent/
      __init__.py
      agent.py                       # ADK agent definition (root_agent)
      tools/                         # NLM tool wrappers
        __init__.py
        auth_tools.py
        notebook_tools.py
        source_tools.py
        query_tools.py
        studio_tools.py
        download_tools.py
        sharing_tools.py
        alias_tools.py
        research_tools.py
      config.py                      # Configuration loading
  test_scripts/                      # Test scripts
  pyproject.toml                     # Project dependencies (managed by uv)
```

---

## 7. Acceptance Criteria

### AC-1: Basic Agent Operation
- [ ] Agent starts via `adk run notebooklm_agent` and `adk web`
- [ ] Agent responds to natural language queries about NotebookLM
- [ ] Agent uses tools to interact with the nlm CLI

### AC-2: Notebook Operations
- [ ] Agent can list all notebooks and present them readably
- [ ] Agent can create a new notebook and return its ID
- [ ] Agent can delete a notebook after user confirmation
- [ ] Agent can describe a notebook's content

### AC-3: Source Operations
- [ ] Agent can add a URL source to a notebook
- [ ] Agent can add a text source to a notebook
- [ ] Agent can list sources for a notebook
- [ ] Agent can delete a source after user confirmation

### AC-4: Content Generation
- [ ] Agent can generate audio (podcast) for a notebook
- [ ] Agent can check studio status and report artifact states
- [ ] Agent can download a completed artifact

### AC-5: Multi-Step Workflows
- [ ] Agent can execute a create-notebook -> add-sources -> generate-audio pipeline from a single natural language request
- [ ] Agent correctly sequences operations (waits for source processing before generation)

### AC-6: Error Handling
- [ ] Agent detects expired authentication and instructs user to re-authenticate
- [ ] Agent handles rate limit errors gracefully
- [ ] Agent provides meaningful error messages for failed operations

### AC-7: Safeguards
- [ ] Agent never executes delete operations without explicit user confirmation in the conversation
- [ ] Agent never attempts browser-based authentication

---

## 8. Open Questions

### OQ-1: Gemini API Key vs Vertex AI
Should the agent use a direct Google AI API key (`GOOGLE_API_KEY`) or Vertex AI credentials for accessing Gemini? The API key approach is simpler for local development; Vertex AI is more suitable for production.

**Recommendation**: Start with `GOOGLE_API_KEY` for development simplicity. Add Vertex AI support as a future enhancement.

### OQ-2: Synchronous vs Asynchronous Tool Execution
Should tool wrappers use `subprocess.run()` (synchronous, simpler) or `asyncio.create_subprocess_exec()` (async, better for long-running operations like research deep mode)?

**Recommendation**: Start synchronous. Long-running operations (research, generation) are already async on the NotebookLM side -- the CLI just polls. Async subprocess would add complexity without significant benefit for v1.

### OQ-3: Tool Granularity
Should each nlm subcommand be a separate tool (e.g., `list_notebooks`, `create_notebook`, `delete_notebook`) or should they be grouped (e.g., `manage_notebook(action, ...)`)? 

**Recommendation**: Individual tools per action. This gives the LLM clearer tool descriptions and reduces ambiguity in tool selection. Grouped tools require the LLM to understand internal action dispatching.

### OQ-4: Output Truncation for Large Responses
When `nlm notebook list` returns 100+ notebooks, the full JSON may exceed token limits. How should the tool handle large outputs?

**Recommendation**: Tool wrappers should summarize large outputs (e.g., return count + first N items + indication of more). Provide a separate tool for pagination or filtering.

### OQ-5: State Management
Should the agent maintain "current notebook" state across turns so the user can say "add a source to it" without specifying the notebook again?

**Recommendation**: Yes, use ADK's session state (`tool_context.state`) to track the last-used notebook ID. This provides a more natural conversational experience.

### OQ-6: NLM Profile Support
Should the agent support multi-profile switching, or assume a single authenticated profile?

**Recommendation**: Start with single profile. Multi-profile support can be added as a configuration option later.

---

## 9. Implementation Approach Recommendation

### Phased Delivery

**Phase 1 -- Core Agent Skeleton**
- Project setup with UV, ADK dependency, configuration loading
- Agent definition with system prompt
- Authentication check tool
- Notebook list/get/create tools
- Verify with `adk run` and `adk web`

**Phase 2 -- Source and Query Tools**
- Source add/list/describe/delete tools
- Notebook query tool
- Session state for "current notebook" tracking

**Phase 3 -- Studio and Download Tools**
- All content generation tools (audio, video, report, quiz, etc.)
- Studio status tool
- Download tools
- Multi-step workflow testing (create -> add -> generate -> download)

**Phase 4 -- Complete Feature Set**
- Sharing tools
- Alias tools
- Research tools
- Note management tools
- Error handling refinement
- Output truncation and summarization

**Phase 5 -- Polish and Documentation**
- Configuration guide
- Comprehensive test scripts
- Project design document
- Issues tracking

---

## 10. References

- Google ADK Documentation: https://google.github.io/adk-docs/
- Google ADK Python GitHub: https://github.com/google/adk-python
- Google ADK PyPI: https://pypi.org/project/google-adk/
- ADK Getting Started (Python): https://google.github.io/adk-docs/get-started/python/
- ADK Tools Documentation: https://google.github.io/adk-docs/tools/
- ADK API Reference: https://google.github.io/adk-docs/api-reference/python/
- NLM CLI: `uv tool install notebooklm-mcp-cli`
- NLM Skill Reference: `/Users/giorgosmarinos/aiwork/TrainingMaterial/107b- NotebookLM/.claude/skills/manage-notebooklm/SKILL.md`
- NLM Command Reference: `/Users/giorgosmarinos/aiwork/TrainingMaterial/107b- NotebookLM/.claude/skills/manage-notebooklm/references/command_reference.md`
