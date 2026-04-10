# Plan 003: YouTube Tools Implementation

**Date**: 2026-04-10
**Status**: Draft
**Dependencies**: refined-request-youtube-tools.md, investigation-youtube-tools.md, codebase-scan-youtube-tools.md
**Estimated Total Tool Count After Completion**: 46 (41 existing + 5 new)

---

## Overview

Add 5 YouTube tools to the NotebookLM ADK agent, enabling video search, metadata retrieval, transcript extraction, and channel browsing. This introduces a new tool category backed by the YouTube Data API v3 and the `youtube-transcript-plus` npm package, distinct from the existing `nlm`-based tools which use subprocess execution.

### Key Decisions (Pre-Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transcript library | `youtube-transcript-plus` (NOT `youtube-transcript`) | Actively maintained, Innertube-based, typed errors, language selection |
| HTTP client | Node.js built-in `fetch()` | No new dependencies; Node 20+ guaranteed |
| Config variable | `YOUTUBE_API_KEY` via `requireEnv()` | No fallback, consistent with project convention |
| Schema validation | Zod v4 | Matches existing codebase |
| Tool framework | `FunctionTool` from `@google/adk` | Matches existing codebase |

---

## Phase 1: Infrastructure

**Goal**: Add configuration, install dependency, create the YouTube API client module.

**Dependencies**: None (can start immediately).

**Parallelizable**: Phase 1 and Phase 2 can be developed in parallel once the `youtube-client.ts` interface is agreed upon. In practice, Phase 2 imports from `youtube-client.ts`, so they are best done sequentially.

### 1.1 Modify: `package.json`

**Change**: Add `youtube-transcript-plus` to `dependencies`.

```diff
  "dependencies": {
    "@google/adk": "^0.6.1",
    "dotenv": "^16.4.7",
+   "youtube-transcript-plus": "^1.2.0",
    "zod": "^4.3.6"
  },
```

**Then run**: `npm install`

### 1.2 Modify: `notebooklm_agent/config.ts`

**Change 1**: Add `youtubeApiKey` to `AgentConfig` interface.

```diff
  export interface AgentConfig {
    readonly googleGenaiApiKey: string;
    readonly nlmCliPath: string;
    readonly geminiModel: string;
    readonly nlmDownloadDir: string;
+   readonly youtubeApiKey: string;
  }
```

**Change 2**: Add `requireEnv('YOUTUBE_API_KEY')` to `getConfig()`.

```diff
  _config = Object.freeze({
    googleGenaiApiKey: requireEnv('GOOGLE_GENAI_API_KEY'),
    nlmCliPath: requireEnv('NLM_CLI_PATH'),
    geminiModel: requireEnv('GEMINI_MODEL'),
    nlmDownloadDir: requireEnv('NLM_DOWNLOAD_DIR'),
+   youtubeApiKey: requireEnv('YOUTUBE_API_KEY'),
  });
```

### 1.3 Modify: `notebooklm_agent/.env.example`

**Change**: Append YouTube API key entry.

```diff
+ # YouTube Data API v3 key.
+ # Obtain from: Google Cloud Console > APIs & Services > Credentials
+ # Enable "YouTube Data API v3" in your Google Cloud project.
+ # Daily quota: 10,000 units (free tier). See https://developers.google.com/youtube/v3/determine_quota_cost
+ # search.list = 100 units, videos.list = 1 unit, channels.list = 1 unit
+ YOUTUBE_API_KEY=
```

### 1.4 Create: `notebooklm_agent/tools/youtube-client.ts`

**Purpose**: YouTube Data API HTTP client and utilities. Analogous to `nlm-runner.ts` but for REST API calls instead of subprocess execution.

**Exports** (public API):

| Export | Signature | Purpose |
|--------|-----------|---------|
| `extractVideoId` | `(input: string) => string \| null` | Parse video ID from any YouTube URL format or bare ID |
| `resolveChannelId` | `(input: string, apiKey: string) => Promise<YouTubeResult<string>>` | Resolve handle/URL/raw ID to a `UC`-prefixed channel ID |
| `youtubeSearchVideos` | `(params: SearchParams, apiKey: string) => Promise<YouTubeResult<SearchResponse>>` | `search.list` wrapper |
| `youtubeGetVideos` | `(videoIds: string[], apiKey: string, parts: string[]) => Promise<YouTubeResult<VideoListResponse>>` | `videos.list` wrapper |
| `parseDuration` | `(iso: string) => number` | Convert ISO 8601 duration (e.g., `PT4M13S`) to seconds |
| `YouTubeResult` | type | `{ status: 'success'; data: T } \| { status: 'not_found' \| 'rate_limit' \| 'config_error' \| 'error'; error: string; action?: string }` |

**Internal helpers** (not exported):

| Helper | Purpose |
|--------|---------|
| `fetchWithTimeout(url, timeoutMs)` | `fetch()` wrapper with `AbortController` timeout (default 10s) |
| `classifyYouTubeError(httpStatus, errorBody)` | Map HTTP status + error reason to `YouTubeResult` status categories |
| `youtubeApiGet<T>(url)` | Core HTTP GET, parses JSON, classifies errors, returns `YouTubeResult<T>` |

**`extractVideoId` must handle these URL formats**:
- `https://www.youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- `https://www.youtube.com/embed/ID`
- `https://www.youtube.com/shorts/ID`
- `https://www.youtube.com/live/ID`
- `https://www.youtube.com/v/ID`
- `https://m.youtube.com/watch?v=ID`
- `https://music.youtube.com/watch?v=ID`
- `https://www.youtube-nocookie.com/embed/ID`
- `https://www.youtube.com/watch?list=PL&v=ID` (v not first param)
- Bare 11-character ID

**`resolveChannelId` must handle**:
- Raw `UC`-prefixed channel ID (return as-is, no API call)
- `@handle` (use `channels.list?forHandle=@handle`)
- `https://www.youtube.com/@handle` (extract handle, then API call)
- `https://www.youtube.com/channel/UCxxx` (extract ID, return as-is)
- `https://youtube.com/c/name` (legacy, try `forHandle` with name)

**Error classification mapping**:

| HTTP Status | `reason` field | Classified Status |
|:-----------:|:--------------:|:-----------------:|
| 200 | - | `success` |
| 400 | any | `error` |
| 403 | `quotaExceeded` | `rate_limit` |
| 403 | other | `config_error` |
| 404 | any | `not_found` |
| 429 | any | `rate_limit` |
| 5xx | any | `error` |
| Network/timeout | - | `error` |

**YouTube API TypeScript interfaces to define inline** (not exported separately):

- `YouTubeApiErrorResponse` -- the `{ error: { code, message, errors[] } }` shape
- `SearchListResponse` -- `search.list` response
- `VideoListResponse` -- `videos.list` response
- `ChannelListResponse` -- `channels.list` response

**Implementation notes**:
- Import `getConfig` from `config.ts` only inside the exported functions (not at module top level) to allow unit testing with mocked API keys
- Actually: export functions that accept `apiKey` as a parameter. The tool layer (`youtube-tools.ts`) calls `getConfig().youtubeApiKey` and passes it in. This keeps the client testable without env vars.
- Use `const BASE = 'https://www.googleapis.com/youtube/v3'` as module-level constant
- All functions return `YouTubeResult<T>` -- never throw

### Acceptance Criteria (Phase 1)

1. `npm install` succeeds and `youtube-transcript-plus` appears in `node_modules`
2. `npm run build` (`tsc --noEmit`) passes with the new config field added
3. Starting the agent without `YOUTUBE_API_KEY` set throws `Error` containing the string `YOUTUBE_API_KEY`
4. `extractVideoId` correctly parses all 11 URL formats listed above (tested in Phase 5)
5. `parseDuration('PT1H30M45S')` returns `5445`
6. `youtubeApiGet` returns `{ status: 'rate_limit', ... }` for HTTP 403 with `quotaExceeded` reason

---

## Phase 2: YouTube Tools Implementation

**Goal**: Create the 5 `FunctionTool` definitions.

**Dependencies**: Phase 1 must be complete (imports `youtube-client.ts` and `config.ts`).

**Parallelizable**: No -- depends on Phase 1.

### 2.1 Create: `notebooklm_agent/tools/youtube-tools.ts`

**Pattern**: Follow `source-tools.ts` exactly:
1. Import `FunctionTool` from `@google/adk`, `z` from `zod`
2. Import helpers from `youtube-client.ts` and `parsers.ts`
3. Import `getConfig` from `config.ts`
4. Define Zod schemas per tool
5. Export `const xxxTool = new FunctionTool({...})`

**Lazy config access**: Each `execute` function calls `const { youtubeApiKey } = getConfig()` at the top, not at module level. This ensures the config is only read when a tool is invoked.

#### Tool 1: `search_youtube`

```typescript
const searchYoutubeSchema = z.object({
  query: z.string().describe('Search query string (keywords, title fragments, topic).'),
  max_results: z.number().optional().describe('Maximum results to return (1-25).'),
  channel_id: z.string().optional().describe('Optional channel ID to restrict search.'),
  order: z.enum(['relevance', 'date', 'viewCount', 'rating']).optional()
    .describe('Sort order for results.'),
});
```

**Execute logic**:
1. Validate `query` is non-empty; return `{ status: 'error', error: 'Query string cannot be empty.' }` if empty
2. Call `youtubeSearchVideos({ query, maxResults: max_results, channelId: channel_id, order }, apiKey)`
3. On success, map response items to `{ video_id, title, channel_title, channel_id, published_at, description_snippet, thumbnail_url }`
4. `description_snippet`: truncate `snippet.description` to 200 characters using `truncateText`
5. Return `{ status: 'success', videos: [...], total_results, returned_count }`

#### Tool 2: `get_video_info`

```typescript
const getVideoInfoSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID (e.g., "dQw4w9WgXcQ") or full YouTube URL.'
  ),
});
```

**Execute logic**:
1. Call `extractVideoId(video_id)` -- if null, return `{ status: 'error', error: 'Invalid YouTube video ID or URL.' }`
2. Call `youtubeGetVideos([parsedId], apiKey, ['snippet', 'contentDetails', 'statistics'])`
3. If `items.length === 0`, return `{ status: 'not_found', error: 'Video not found for ID: ...' }`
4. Map the single item to the response shape including:
   - `parseDuration()` for `duration_seconds`
   - `parseInt()` for `view_count`, `like_count`, `comment_count`
   - Truncate `description` to 3000 characters, set `truncated` flag
   - `thumbnail_url`: prefer `maxres` > `high` > `medium` > `default`
   - `is_live`: check `snippet.liveBroadcastContent === 'live'`
5. Return `{ status: 'success', video: {...} }`

#### Tool 3: `get_video_description`

```typescript
const getVideoDescriptionSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID or full YouTube URL.'
  ),
});
```

**Execute logic**:
1. Call `extractVideoId(video_id)` -- if null, return error
2. Call `youtubeGetVideos([parsedId], apiKey, ['snippet'])` (only snippet part, smaller payload)
3. If not found, return `not_found`
4. Extract `description` from `snippet.description`, truncate to 5000 characters
5. Return `{ status: 'success', video_id, title, description, truncated, original_length }`

#### Tool 4: `get_video_transcript`

```typescript
const getVideoTranscriptSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID or full YouTube URL.'
  ),
  language: z.string().optional().describe(
    'Preferred transcript language code (e.g., "en", "es", "fr").'
  ),
});
```

**Execute logic**:
1. Call `extractVideoId(video_id)` -- if null, return error
2. Call `fetchTranscript(parsedId, { lang: language })` from `youtube-transcript-plus`
3. Wrap in try/catch with specific error class handling:
   - `YoutubeTranscriptVideoUnavailableError` -> `{ status: 'not_found', error: '...' }`
   - `YoutubeTranscriptDisabledError` -> `{ status: 'error', error: 'Transcripts disabled...' }`
   - `YoutubeTranscriptNotAvailableError` -> `{ status: 'error', error: 'No transcript available...' }`
   - `YoutubeTranscriptNotAvailableLanguageError` -> `{ status: 'error', error: error.message }` (includes available languages)
   - `YoutubeTranscriptTooManyRequestError` -> `{ status: 'rate_limit', error: '...' }`
   - `YoutubeTranscriptInvalidVideoIdError` -> `{ status: 'error', error: 'Invalid video ID...' }`
   - Any other error -> `{ status: 'error', error: String(err) }`
4. Map segments to `{ text, start: segment.offset, duration: segment.duration }`
5. Build `full_text` by joining segment texts with spaces
6. Truncate `full_text` to 10000 characters using `truncateText`
7. Return `{ status: 'success', video_id, language: segments[0]?.lang ?? language ?? 'unknown', segments: truncatedSegments, full_text, truncated, original_length, segment_count }`

**Note**: The `segments` array in the response should be limited to a reasonable count (e.g., 500) to prevent enormous payloads. Use `truncateList` from `parsers.ts`.

#### Tool 5: `list_channel_videos`

```typescript
const listChannelVideosSchema = z.object({
  channel_id: z.string().describe(
    'YouTube channel ID, channel handle (e.g., "@ChannelName"), or channel URL.'
  ),
  max_results: z.number().optional().describe(
    'Maximum number of videos to return (1-50).'
  ),
  order: z.enum(['date', 'viewCount', 'relevance', 'rating']).optional()
    .describe('Sort order for results.'),
});
```

**Execute logic**:
1. Call `resolveChannelId(channel_id, apiKey)` -- if error, return it
2. Call `youtubeSearchVideos({ channelId: resolvedId, type: 'video', order, maxResults: max_results }, apiKey)`
3. Map results to `{ video_id, title, published_at, description_snippet, thumbnail_url }`
4. Return `{ status: 'success', channel: { channel_id: resolvedId, channel_title }, videos: [...], returned_count }`

### Acceptance Criteria (Phase 2)

1. `npm run build` passes with all 5 tools defined
2. All 5 tools are exported as named constants: `searchYoutubeTool`, `getVideoInfoTool`, `getVideoDescriptionTool`, `getVideoTranscriptTool`, `listChannelVideosTool`
3. Each tool's `execute` function never throws -- all errors are caught and returned as structured objects with `status` field
4. Each Zod schema uses `.describe()` on every field
5. Tool names are snake_case: `search_youtube`, `get_video_info`, `get_video_description`, `get_video_transcript`, `list_channel_videos`

---

## Phase 3: Agent Integration

**Goal**: Wire YouTube tools into the agent's tool array, barrel export, and system prompt.

**Dependencies**: Phase 2 must be complete.

**Parallelizable**: No -- depends on Phase 2.

### 3.1 Modify: `notebooklm_agent/tools/index.ts`

**Change**: Add YouTube tools barrel export section at the end.

```diff
  // Notes
  export {
    listNotesTool,
    createNoteTool,
    updateNoteTool,
    deleteNoteTool,
  } from './note-tools.ts';
+
+ // YouTube
+ export {
+   searchYoutubeTool,
+   getVideoInfoTool,
+   getVideoDescriptionTool,
+   getVideoTranscriptTool,
+   listChannelVideosTool,
+ } from './youtube-tools.ts';
```

### 3.2 Modify: `notebooklm_agent/agent.ts`

**Change 1**: Add YouTube tool imports to the existing import block from `./tools/index.ts`:

```diff
    deleteNoteTool,
+   searchYoutubeTool,
+   getVideoInfoTool,
+   getVideoDescriptionTool,
+   getVideoTranscriptTool,
+   listChannelVideosTool,
  } from './tools/index.ts';
```

**Change 2**: Add YouTube tools to the `tools` array in `rootAgent`:

```diff
      // Notes
      listNotesTool,
      createNoteTool,
      updateNoteTool,
      deleteNoteTool,
+     // YouTube
+     searchYoutubeTool,
+     getVideoInfoTool,
+     getVideoDescriptionTool,
+     getVideoTranscriptTool,
+     listChannelVideosTool,
    ],
```

**Change 3**: Update `buildInstruction` to add YouTube tool guidance. Insert before the closing backtick of the system prompt string:

```diff
  - When operations fail, explain why and suggest next steps`;
```

Add after `## Response Style` and before the closing backtick:

```
## YouTube Tools

- Use **search_youtube** to find videos by topic, keyword, or partial title. Costs 100 API quota units per call -- use sparingly.
- Use **get_video_info** for comprehensive metadata (views, duration, tags, publish date). Costs only 1 quota unit.
- Use **get_video_description** for just the description text (same 1 unit cost but smaller response).
- Use **get_video_transcript** to get the full transcript/captions of a video. Does NOT use API quota (uses a separate transcript service).
- Use **list_channel_videos** to browse a channel's video catalog. Costs 100 quota units (uses search internally).
- YouTube video URLs are accepted wherever a video_id is required (standard URLs, short URLs, embed URLs, Shorts URLs).
- Transcripts may not be available for all videos (e.g., if captions are disabled by the uploader).
- To add a YouTube video as a NotebookLM source, first get the video URL, then use **add_source** with source_type "url".
- Prefer get_video_info (1 unit) over search_youtube (100 units) when you already have a video ID or URL.
```

**Change 4**: Update the `## Capabilities` line in `buildInstruction` to mention YouTube:

```diff
- You can manage notebooks, sources, queries, studio content (audio, video, reports, quizzes, flashcards, mind maps, slides, infographics, data tables), downloads, sharing, research, aliases, and notes.
+ You can manage notebooks, sources, queries, studio content (audio, video, reports, quizzes, flashcards, mind maps, slides, infographics, data tables), downloads, sharing, research, aliases, notes, and YouTube content (search, video info, transcripts, channel browsing).
```

### Acceptance Criteria (Phase 3)

1. `npm run build` passes with all imports resolved
2. The `rootAgent.tools` array contains 46 tools (41 existing + 5 new)
3. The system prompt returned by `buildInstruction` includes the string "YouTube Tools"
4. All 5 YouTube tools are importable from `./tools/index.ts`

---

## Phase 4: Documentation

**Goal**: Update all project documentation to reflect the new YouTube tools.

**Dependencies**: Phase 2 must be complete (need to know exact tool signatures).

**Parallelizable**: Can run in parallel with Phase 3 (both depend on Phase 2 only).

### 4.1 Modify: `CLAUDE.md`

Add YouTube tools documentation block after the existing tools section. Since these are agent tools (not standalone CLI tools), document them under the project's tool documentation section using the standard `<toolName>` format:

```xml
<YouTubeTools>
    <objective>
        YouTube integration tools for the NotebookLM ADK agent. Enables searching
        YouTube, retrieving video metadata and descriptions, extracting transcripts,
        and listing channel videos. These are agent tools invoked by Gemini, not
        standalone CLI commands.
    </objective>
    <command>
        Invoked automatically by the agent. No direct CLI command.
        Agent tools: search_youtube, get_video_info, get_video_description,
        get_video_transcript, list_channel_videos
    </command>
    <info>
        These 5 tools are registered in the ADK agent and called by Gemini during
        conversations. They use the YouTube Data API v3 (requires YOUTUBE_API_KEY)
        and the youtube-transcript-plus package (no API key needed for transcripts).

        Tools:
            search_youtube          Search YouTube videos by query (100 quota units)
            get_video_info          Get full video metadata (1 quota unit)
            get_video_description   Get video description only (1 quota unit)
            get_video_transcript    Get video transcript/captions (no quota cost)
            list_channel_videos     List videos from a channel (100 quota units)

        Configuration:
            YOUTUBE_API_KEY env var required. No fallback.
            Obtain from: Google Cloud Console > APIs & Services > Credentials
            Daily quota: 10,000 units (free tier)

        Source files:
            notebooklm_agent/tools/youtube-client.ts  - YouTube API HTTP client
            notebooklm_agent/tools/youtube-tools.ts    - 5 FunctionTool definitions
    </info>
</YouTubeTools>
```

### 4.2 Modify: `docs/design/project-design.md`

**Changes needed**:

1. **Section 1.1 (Component Diagram)**: Add a `YT` box in Tool Layer and a `YTAPI` box in External Systems:
   - Add `YT["youtube_tools.ts"]` to the Tool Layer subgraph
   - Add `YTCLIENT["youtube_client.ts"]` to the Infrastructure Layer subgraph
   - Add `YTAPI["YouTube Data API v3<br/>(REST + transcript scraping)"]` to External Systems
   - Add connections: `AGENT --> YT`, `YT --> YTCLIENT`, `YTCLIENT --> YTAPI`, `YTCLIENT --> CONFIG`

2. **Section 2.1 (File Tree)**: Add these entries under `notebooklm_agent/tools/`:
   ```
   ├── youtube-client.ts   # YouTube Data API HTTP client
   ├── youtube-tools.ts    # YouTube FunctionTool definitions
   ```
   And under `test_scripts/`:
   ```
   ├── test-youtube-client.test.ts
   ├── test-youtube-tools.test.ts
   ```

3. **Section 3 (Configuration)**: Add row to config table:
   | Variable | Interface Field | Purpose |
   |----------|----------------|---------|
   | `YOUTUBE_API_KEY` | `youtubeApiKey` | YouTube Data API v3 authentication |

4. **Section 5 (Tool Design)**: Add Section 5.12 "YouTube Tools" documenting all 5 tools with their schemas, return formats, and edge cases. Reference the refined request document for full specifications.

5. **Section 5.11 (Tool Summary Table)**: Add 5 rows:
   | Tool | Module | Confirmation | Session Write |
   |------|--------|:------------:|:-------------:|
   | `search_youtube` | `youtube-tools.ts` | No | No |
   | `get_video_info` | `youtube-tools.ts` | No | No |
   | `get_video_description` | `youtube-tools.ts` | No | No |
   | `get_video_transcript` | `youtube-tools.ts` | No | No |
   | `list_channel_videos` | `youtube-tools.ts` | No | No |

6. **Appendix A (Tool Count)**: Update from 41 to 46 tools.

### 4.3 Modify: `docs/design/project-functions.md`

Add 5 new functional requirements:

```
### FR-YT-01: Search YouTube Videos
The agent can search YouTube for videos matching a query string, returning video IDs, titles, channel names, publish dates, and thumbnails. Supports optional channel filtering and sort order.

### FR-YT-02: Get Video Metadata
The agent can retrieve comprehensive metadata for a specific YouTube video including title, description, duration, view count, like count, tags, and category. Accepts video IDs or full YouTube URLs.

### FR-YT-03: Get Video Description
The agent can retrieve only the description text of a YouTube video. Lightweight alternative to full metadata retrieval.

### FR-YT-04: Get Video Transcript
The agent can extract the transcript (captions/subtitles) of a YouTube video with timestamps. Supports language selection. Works with auto-generated and manually uploaded captions.

### FR-YT-05: List Channel Videos
The agent can list recent videos from a YouTube channel. Accepts channel IDs, handles, or URLs. Supports sort order and result count control.
```

### 4.4 Modify: `Issues - Pending Items.md`

Review and update. Expected new items:
- `youtube-transcript-plus` uses undocumented YouTube internals (Innertube API) -- may break if YouTube changes internal APIs. Pin version and monitor.
- `search.list` caps channel videos at 500 results -- `list_channel_videos` cannot enumerate full back-catalogs for large channels.

### Acceptance Criteria (Phase 4)

1. `CLAUDE.md` contains a `<YouTubeTools>` documentation block
2. `project-design.md` Section 1.1 diagram includes YouTube API boxes
3. `project-design.md` tool count is updated to 46
4. `project-functions.md` contains FR-YT-01 through FR-YT-05
5. `Issues - Pending Items.md` is updated with transcript library risk

---

## Phase 5: Testing

**Goal**: Create unit tests for the YouTube client utilities and the 5 YouTube tools with mocked API responses.

**Dependencies**: Phase 2 must be complete. Phase 3 not required (tests import directly, not through agent).

**Parallelizable**: Can run in parallel with Phase 3 and Phase 4 (all depend only on Phase 2).

### 5.1 Create: `test_scripts/test-youtube-client.test.ts`

**Testing strategy**: Unit tests for pure functions (no network calls).

**Test cases for `extractVideoId`**:

| Input | Expected Output |
|-------|-----------------|
| `'dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/watch?v=dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://youtu.be/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://youtu.be/dQw4w9WgXcQ?t=30'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/embed/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/shorts/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/live/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/v/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://m.youtube.com/watch?v=dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube.com/watch?list=PL&v=dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'` | `'dQw4w9WgXcQ'` |
| `'not-a-video'` | `null` |
| `''` | `null` |
| `'https://www.youtube.com/'` | `null` |

**Test cases for `parseDuration`**:

| Input | Expected Output |
|-------|-----------------|
| `'PT4M13S'` | `253` |
| `'PT1H30M45S'` | `5445` |
| `'PT1H'` | `3600` |
| `'PT30S'` | `30` |
| `'PT0S'` | `0` |
| `'PT2H'` | `7200` |

**Test pattern**: Follow the `test-config.test.ts` vitest pattern with `describe`/`it`/`expect`.

### 5.2 Create: `test_scripts/test-youtube-tools.test.ts`

**Testing strategy**: Mock `global.fetch` and `youtube-transcript-plus` to test tool execute functions without network calls.

**Setup**:
- Use `vi.mock` or `vi.stubGlobal` to mock `fetch`
- Use `vi.mock('youtube-transcript-plus', ...)` to mock transcript library
- Set `process.env.YOUTUBE_API_KEY = 'test-key'` (plus all other required env vars) in `beforeEach`
- Call `resetConfig()` in `afterEach`

**Test cases for `search_youtube`**:
1. Returns search results on success (mock 200 response with 3 items)
2. Returns error for empty query string
3. Returns `rate_limit` status when API returns 403 with `quotaExceeded`
4. Returns `config_error` for invalid API key (403 with `forbidden`)

**Test cases for `get_video_info`**:
1. Returns video metadata on success
2. Returns `not_found` for non-existent video (empty items array)
3. Correctly parses duration to seconds
4. Handles full YouTube URL input (not just bare ID)
5. Returns error for invalid URL/ID

**Test cases for `get_video_description`**:
1. Returns description on success
2. Truncates description longer than 5000 characters

**Test cases for `get_video_transcript`**:
1. Returns transcript on success (mock `fetchTranscript` returning segments)
2. Returns error when transcript is disabled (mock `YoutubeTranscriptDisabledError`)
3. Returns error when language is unavailable (mock `YoutubeTranscriptNotAvailableLanguageError`)
4. Truncates long transcripts to 10000 characters

**Test cases for `list_channel_videos`**:
1. Returns channel videos on success
2. Resolves `@handle` to channel ID before searching
3. Returns `not_found` for non-existent channel

### Acceptance Criteria (Phase 5)

1. `npm test` runs all tests including the new YouTube test files
2. All `extractVideoId` test cases pass
3. All `parseDuration` test cases pass
4. All 5 tool execute functions are tested with mocked responses
5. No test makes real network calls (all HTTP is mocked)
6. Tests follow the existing vitest pattern from `test-config.test.ts`

---

## Phase Summary

| Phase | Description | Depends On | Parallel With | Files Created | Files Modified |
|:-----:|-------------|:----------:|:-------------:|:-------------:|:--------------:|
| 1 | Infrastructure | None | - | `youtube-client.ts` | `package.json`, `config.ts`, `.env.example` |
| 2 | Tool Implementation | Phase 1 | - | `youtube-tools.ts` | None |
| 3 | Agent Integration | Phase 2 | Phase 4, Phase 5 | None | `tools/index.ts`, `agent.ts` |
| 4 | Documentation | Phase 2 | Phase 3, Phase 5 | None | `CLAUDE.md`, `project-design.md`, `project-functions.md`, `Issues - Pending Items.md` |
| 5 | Testing | Phase 2 | Phase 3, Phase 4 | `test-youtube-client.test.ts`, `test-youtube-tools.test.ts` | None |

**Execution order** (optimal):
1. Phase 1 (sequential)
2. Phase 2 (sequential, after Phase 1)
3. Phase 3 + Phase 4 + Phase 5 (parallel, after Phase 2)

**Total new files**: 4
**Total modified files**: 7

---

## Final Verification Checklist

After all phases complete, verify:

- [ ] `npm run build` passes with zero errors
- [ ] `npm test` passes with all tests green
- [ ] `YOUTUBE_API_KEY` missing causes a clear error at startup
- [ ] All 5 tools are in the agent's `tools` array (46 total)
- [ ] System prompt mentions YouTube tools
- [ ] `youtube-transcript-plus` is in `package.json` dependencies
- [ ] `extractVideoId` handles all 11 URL formats
- [ ] All tool execute functions return `{ status: ... }` objects (never throw)
- [ ] Documentation is consistent across CLAUDE.md, project-design.md, and project-functions.md
- [ ] `Issues - Pending Items.md` reflects current state
