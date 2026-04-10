# Refined Request: YouTube Tools for NotebookLM Agent

**Date**: 2026-04-10
**Status**: Draft
**Related**: project-design.md, project-functions.md, plan-001-adk-nlm-agent.md

---

## 1. Objective

Add a new category of YouTube tools to the existing NotebookLM ADK agent, enabling it to search for YouTube videos, retrieve video metadata (description, publish date, statistics), fetch video transcripts, and list videos from a channel. These tools allow the agent to discover and consume YouTube content as part of its knowledge management workflows -- for example, finding relevant videos, reading their transcripts, and then adding them as sources to NotebookLM notebooks.

Unlike the existing tools that wrap the `nlm` CLI via subprocess, the YouTube tools interact directly with the YouTube Data API v3 and a transcript extraction library. This introduces a new tool category with its own infrastructure layer.

---

## 2. Scope

### 2.1 In Scope

- **5 new tools**: `search_youtube`, `get_video_info`, `get_video_transcript`, `get_video_description`, `list_channel_videos`
- **New tool module**: `notebooklm_agent/tools/youtube-tools.ts`
- **New infrastructure module**: `notebooklm_agent/tools/youtube-client.ts` (YouTube Data API wrapper)
- **New configuration**: `YOUTUBE_API_KEY` environment variable
- **Agent integration**: Register all 5 tools in `agent.ts`, update barrel export in `tools/index.ts`
- **System prompt update**: Add YouTube-related guidance to the `buildInstruction` function
- **Documentation updates**: CLAUDE.md, project-design.md, project-functions.md, configuration-guide.md (if created), Issues - Pending Items.md

### 2.2 Out of Scope

- YouTube video download (actual media files)
- YouTube authentication (OAuth) for private/unlisted videos
- YouTube comment retrieval
- Automatic source addition (the agent can chain `search_youtube` -> `add_source` manually)
- YouTube playlist management

---

## 3. Tool Specifications

### 3.1 `search_youtube`

**Purpose**: Search YouTube for videos matching a query string. Maps to the YouTube Data API `search.list` endpoint.

**Description (what Gemini sees)**:
> Search YouTube for videos matching a query. Returns a list of matching videos with their IDs, titles, channel names, publish dates, and thumbnail URLs. Use this to find videos by topic, keyword, or partial title. Results are capped at 25 videos per search.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `query` | `string` | Yes | Search query string (keywords, title fragments, topic) |
| `max_results` | `number` | No | Maximum number of results to return (1-25). No default -- must be provided. |
| `channel_id` | `string` | No | Optional channel ID to restrict search to a specific channel |
| `order` | `enum('relevance', 'date', 'viewCount', 'rating')` | No | Sort order for results. No default -- must be provided. |

**YouTube Data API Endpoint**: `GET /youtube/v3/search?part=snippet&type=video&q={query}&maxResults={max_results}&channelId={channel_id}&order={order}`

**Expected Return Format**:
```json
{
  "status": "success",
  "videos": [
    {
      "video_id": "dQw4w9WgXcQ",
      "title": "Video Title",
      "channel_title": "Channel Name",
      "channel_id": "UCxxxxxxxx",
      "published_at": "2026-01-15T10:30:00Z",
      "description_snippet": "First 200 chars of description...",
      "thumbnail_url": "https://i.ytimg.com/vi/xxx/hqdefault.jpg"
    }
  ],
  "total_results": 150,
  "returned_count": 10
}
```

**Edge Cases**:
- Empty query string: Return `{ status: "error", error: "Query string cannot be empty." }`
- No results found: Return `{ status: "success", videos: [], total_results: 0, returned_count: 0 }`
- Invalid channel_id: Return the API error with descriptive message
- API quota exceeded: Return `{ status: "rate_limit", error: "YouTube API daily quota exceeded.", action: "Wait until quota resets (midnight Pacific Time) or check your API key quota in Google Cloud Console." }`

---

### 3.2 `get_video_info`

**Purpose**: Retrieve comprehensive metadata for a specific YouTube video. Maps to the YouTube Data API `videos.list` endpoint with `part=snippet,contentDetails,statistics`.

**Description (what Gemini sees)**:
> Get detailed information about a YouTube video including its title, description, publish date, duration, view count, like count, channel info, tags, and category. Accepts either a video ID or a full YouTube URL.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `video_id` | `string` | Yes | YouTube video ID (e.g., "dQw4w9WgXcQ") or full YouTube URL (e.g., "https://www.youtube.com/watch?v=dQw4w9WgXcQ" or "https://youtu.be/dQw4w9WgXcQ") |

**YouTube Data API Endpoint**: `GET /youtube/v3/videos?part=snippet,contentDetails,statistics&id={video_id}`

**Expected Return Format**:
```json
{
  "status": "success",
  "video": {
    "video_id": "dQw4w9WgXcQ",
    "title": "Video Title",
    "description": "Full video description text...",
    "channel_title": "Channel Name",
    "channel_id": "UCxxxxxxxx",
    "published_at": "2026-01-15T10:30:00Z",
    "duration": "PT15M33S",
    "duration_seconds": 933,
    "view_count": 1500000,
    "like_count": 45000,
    "comment_count": 3200,
    "tags": ["tag1", "tag2"],
    "category_id": "22",
    "thumbnail_url": "https://i.ytimg.com/vi/xxx/maxresdefault.jpg",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "is_live": false,
    "default_language": "en"
  }
}
```

**Edge Cases**:
- Invalid video ID or URL: Return `{ status: "not_found", error: "Video not found for ID: xxx" }`
- URL parsing: The tool must extract the video ID from various YouTube URL formats:
  - `https://www.youtube.com/watch?v=VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
  - `https://www.youtube.com/embed/VIDEO_ID`
  - `https://youtube.com/shorts/VIDEO_ID`
  - Raw video ID (11 characters, alphanumeric + `-_`)
- Private/deleted video: Return `{ status: "not_found", error: "Video is private, deleted, or unavailable." }`
- Description truncation: Truncate description to 3000 characters with `truncated: true` flag if longer

---

### 3.3 `get_video_description`

**Purpose**: Retrieve only the description of a YouTube video. This is a lightweight alternative to `get_video_info` when only the description text is needed.

**Description (what Gemini sees)**:
> Get the full description text of a YouTube video. Accepts either a video ID or a full YouTube URL. Use this when you only need the description without other metadata. The description is truncated to 5000 characters.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `video_id` | `string` | Yes | YouTube video ID or full YouTube URL |

**YouTube Data API Endpoint**: `GET /youtube/v3/videos?part=snippet&id={video_id}` (same as get_video_info but only `snippet` part to save quota)

**Expected Return Format**:
```json
{
  "status": "success",
  "video_id": "dQw4w9WgXcQ",
  "title": "Video Title",
  "description": "Full description text...",
  "truncated": false,
  "original_length": 1234
}
```

**Edge Cases**:
- Same URL parsing as `get_video_info`
- Empty description: Return `{ status: "success", video_id: "...", title: "...", description: "", truncated: false, original_length: 0 }`
- Video not found: Return `{ status: "not_found", error: "Video not found for ID: xxx" }`

---

### 3.4 `get_video_transcript`

**Purpose**: Retrieve the transcript (captions/subtitles) of a YouTube video. This tool does NOT use the YouTube Data API. Instead, it uses the `youtube-transcript` npm package (or equivalent) which extracts auto-generated or manually uploaded captions without requiring an API key.

**Description (what Gemini sees)**:
> Get the text transcript of a YouTube video. Returns the full transcript text with timestamps. Works with both auto-generated and manually uploaded captions. Accepts either a video ID or a full YouTube URL. The transcript is truncated to 10000 characters to manage context size.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `video_id` | `string` | Yes | YouTube video ID or full YouTube URL |
| `language` | `string` | No | Preferred transcript language code (e.g., "en", "es", "fr"). No default -- if not provided, returns the first available transcript. |

**Implementation Note**: Use the `youtube-transcript` npm package (`npm install youtube-transcript`). This package scrapes YouTube's transcript endpoint and does NOT consume YouTube Data API quota.

**Expected Return Format**:
```json
{
  "status": "success",
  "video_id": "dQw4w9WgXcQ",
  "language": "en",
  "segments": [
    {
      "text": "Hello everyone, welcome to this video",
      "start": 0.0,
      "duration": 3.5
    },
    {
      "text": "Today we're going to talk about...",
      "start": 3.5,
      "duration": 4.2
    }
  ],
  "full_text": "Hello everyone, welcome to this video. Today we're going to talk about...",
  "truncated": false,
  "original_length": 5432,
  "segment_count": 245
}
```

**Edge Cases**:
- No transcript available: Return `{ status: "error", error: "No transcript available for video dQw4w9WgXcQ. The video may have captions disabled." }`
- Language not available: Return `{ status: "error", error: "Transcript not available in language 'fr'. Available languages: en, es, de." }` (list available languages if possible)
- Live stream (no transcript yet): Return `{ status: "error", error: "Transcript not available for live streams or premieres that have not ended." }`
- Very long transcript: Truncate `full_text` to 10000 characters with `truncated: true`. Always include `segment_count` for the original number of segments.
- Same URL parsing logic as other tools

---

### 3.5 `list_channel_videos`

**Purpose**: List recent videos from a YouTube channel. Maps to the YouTube Data API `search.list` endpoint filtered by channel ID.

**Description (what Gemini sees)**:
> List videos from a YouTube channel, ordered by most recent first. Accepts a channel ID, channel handle (e.g., "@ChannelName"), or channel URL. Returns video IDs, titles, publish dates, and description snippets. Results are capped at 25 videos.

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `channel_id` | `string` | Yes | YouTube channel ID (e.g., "UCxxxxxxxx"), channel handle (e.g., "@ChannelName"), or channel URL (e.g., "https://www.youtube.com/@ChannelName") |
| `max_results` | `number` | No | Maximum number of videos to return (1-50). No default -- must be provided. |
| `order` | `enum('date', 'viewCount', 'relevance', 'rating')` | No | Sort order. No default -- must be provided. |

**YouTube Data API Endpoints**:
1. If a handle or URL is provided, first resolve to channel ID via `GET /youtube/v3/channels?part=id&forHandle={handle}`
2. Then: `GET /youtube/v3/search?part=snippet&channelId={channel_id}&type=video&order={order}&maxResults={max_results}`

**Expected Return Format**:
```json
{
  "status": "success",
  "channel": {
    "channel_id": "UCxxxxxxxx",
    "channel_title": "Channel Name"
  },
  "videos": [
    {
      "video_id": "abc123",
      "title": "Latest Video Title",
      "published_at": "2026-04-08T14:00:00Z",
      "description_snippet": "First 200 chars...",
      "thumbnail_url": "https://i.ytimg.com/vi/xxx/hqdefault.jpg"
    }
  ],
  "returned_count": 10
}
```

**Edge Cases**:
- Channel not found: Return `{ status: "not_found", error: "Channel not found for identifier: xxx" }`
- Channel with no videos: Return `{ status: "success", channel: {...}, videos: [], returned_count: 0 }`
- Handle resolution: Extract handle from URL patterns like:
  - `https://www.youtube.com/@ChannelName`
  - `https://www.youtube.com/channel/UCxxxxxxxx`
  - `https://youtube.com/c/ChannelName` (legacy)
  - Raw handle `@ChannelName`
  - Raw channel ID `UCxxxxxxxx`

---

## 4. Integration Requirements

### 4.1 New Files

| File | Purpose |
|------|---------|
| `notebooklm_agent/tools/youtube-client.ts` | YouTube Data API HTTP client. Handles API requests, error classification, URL parsing, and response normalization. Analogous to `nlm-runner.ts` but for YouTube API. |
| `notebooklm_agent/tools/youtube-tools.ts` | The 5 FunctionTool definitions with Zod schemas and execute functions. Follows the exact pattern of `source-tools.ts`. |

### 4.2 Modified Files

| File | Change |
|------|--------|
| `notebooklm_agent/tools/index.ts` | Add YouTube tools barrel export section |
| `notebooklm_agent/agent.ts` | Import YouTube tools, register in tools array, update `buildInstruction` system prompt |
| `notebooklm_agent/config.ts` | Add `youtubeApiKey` to `AgentConfig` interface and `getConfig()` |
| `notebooklm_agent/.env.example` | Add `YOUTUBE_API_KEY=` entry with documentation |
| `package.json` | Add `youtube-transcript` dependency (for transcript extraction) |

### 4.3 Barrel Export Addition (`tools/index.ts`)

```typescript
// YouTube
export {
  searchYoutubeTool,
  getVideoInfoTool,
  getVideoDescriptionTool,
  getVideoTranscriptTool,
  listChannelVideosTool,
} from './youtube-tools.ts';
```

### 4.4 Agent Registration (`agent.ts`)

Add to the import block and tools array. Add a YouTube section to the system prompt:

```
## YouTube Tools
- Use search_youtube to find videos by topic, keyword, or title.
- Use get_video_info for comprehensive metadata (views, duration, tags, publish date).
- Use get_video_description for just the description text (lower API cost).
- Use get_video_transcript to get the full transcript/captions of a video.
- Use list_channel_videos to browse a channel's video catalog.
- YouTube video URLs are accepted wherever a video_id is required.
- Transcripts may not be available for all videos (e.g., if captions are disabled).
- To add a YouTube video as a NotebookLM source, first get the video URL, then use add_source with source_type "url".
```

### 4.5 YouTube Client Architecture (`youtube-client.ts`)

The YouTube client module should follow the same architectural principles as `nlm-runner.ts`:

- **Single responsibility**: All YouTube API HTTP calls go through this module
- **Error classification**: Translate HTTP status codes to the same `NlmStatus`-compatible categories (`success`, `not_found`, `rate_limit`, `error`, `config_error`)
- **URL parsing**: A `parseVideoId(input: string): string` utility that extracts video IDs from any URL format
- **Channel resolution**: A `resolveChannelId(input: string): Promise<string>` utility that handles handles, URLs, and raw IDs
- **No exceptions**: All errors are caught and returned as structured result objects
- **HTTP client**: Use Node.js built-in `fetch()` (available in Node 18+) -- no extra HTTP library needed

**Error Classification Mapping**:

| HTTP Status | Classified As | Meaning |
|:-----------:|:---:|---------|
| 200 | `success` | Normal response |
| 400 | `error` | Bad request (invalid parameter) |
| 403 | `rate_limit` or `config_error` | Quota exceeded or invalid API key |
| 404 | `not_found` | Resource not found |
| 429 | `rate_limit` | Too many requests |
| 5xx | `error` | YouTube server error |

---

## 5. Documentation Requirements

### 5.1 CLAUDE.md

Add a documentation block for each YouTube tool following the existing `<toolName>` format. Since these are agent tools (not standalone CLI tools), document them as part of the agent's capabilities section.

### 5.2 project-design.md

Update the following sections:
- **Section 1.1 (Component Diagram)**: Add a YouTube API box in the "External Systems" subgraph and connect youtube-tools to it via youtube-client
- **Section 2.1 (File Tree)**: Add `youtube-client.ts` and `youtube-tools.ts`
- **Section 3 (Configuration)**: Add `YOUTUBE_API_KEY` to the config table
- **Section 5 (Tool Design)**: Add Section 5.12 "YouTube Tools" with all 5 tools documented
- **Section 5.11 (Tool Summary Table)**: Add the 5 YouTube tools (none with `require_confirmation`, none writing session state)
- **Appendix A (Tool Count)**: Update from 41 to 46 tools

### 5.3 project-functions.md

Add functional requirements for each YouTube tool:
- FR-YT-01: Search YouTube videos
- FR-YT-02: Get video metadata
- FR-YT-03: Get video description
- FR-YT-04: Get video transcript
- FR-YT-05: List channel videos

### 5.4 Configuration Guide

If `docs/design/configuration-guide.md` does not exist, create it. Otherwise update it to include:
- `YOUTUBE_API_KEY`: purpose, how to obtain (Google Cloud Console > APIs & Services > Credentials), recommended storage approach (`.env` file, never commit to git), no default value allowed
- Note that `YOUTUBE_API_KEY` has a daily quota (10,000 units/day on the free tier). Suggest adding a `YOUTUBE_API_KEY_EXPIRY` parameter for proactive expiration warning.

### 5.5 Issues - Pending Items.md

Review and update with any new issues or pending items discovered during implementation.

---

## 6. Acceptance Criteria

1. **All 5 tools compile**: `npm run build` (i.e., `tsc --noEmit`) passes with zero errors after adding the YouTube tools.
2. **Tools are registered**: The agent's tools array in `agent.ts` includes all 5 YouTube tools. Running `npx adk web` shows the agent with 46 tools.
3. **Configuration enforced**: Starting the agent without `YOUTUBE_API_KEY` set throws an `Error` with a descriptive message. No fallback or default value.
4. **search_youtube works**: Given a valid API key, `search_youtube({ query: "typescript tutorial", max_results: 5, order: "relevance" })` returns a list of video objects with `video_id`, `title`, `published_at`, and `channel_title`.
5. **get_video_info works**: Given a valid video URL, returns comprehensive metadata including `duration_seconds`, `view_count`, `published_at`, and `tags`.
6. **get_video_description works**: Given a valid video ID, returns the full description text.
7. **get_video_transcript works**: Given a video with captions, returns the transcript with `full_text` and `segments`. Returns a descriptive error for videos without captions.
8. **list_channel_videos works**: Given a channel handle like `@GoogleDevelopers`, resolves the channel and returns a list of recent videos.
9. **URL parsing**: All tools that accept `video_id` correctly handle:
   - Raw 11-character video IDs
   - `youtube.com/watch?v=` URLs
   - `youtu.be/` short URLs
   - `youtube.com/embed/` URLs
   - `youtube.com/shorts/` URLs
10. **Error handling**: Invalid API key returns `config_error`, non-existent video returns `not_found`, quota exceeded returns `rate_limit`.
11. **System prompt updated**: The `buildInstruction` function includes YouTube tool guidance.
12. **Barrel export**: All 5 tools are exported from `tools/index.ts`.
13. **Unit tests exist**: At least one test file in `test_scripts/` covering the YouTube tools with mocked API responses.
14. **Documentation complete**: CLAUDE.md, project-design.md, and project-functions.md are all updated to reflect the new tools.
15. **Dependencies added**: `youtube-transcript` package is listed in `package.json` dependencies.

---

## 7. Configuration

### 7.1 New Environment Variable

| Variable | Purpose | How to Obtain | Example Value |
|----------|---------|---------------|---------------|
| `YOUTUBE_API_KEY` | API key for YouTube Data API v3 | Google Cloud Console > APIs & Services > Credentials > Create API Key. Enable "YouTube Data API v3" under APIs & Services > Library. | `AIzaSyC...` |

### 7.2 Config Module Changes

Add to `AgentConfig` interface in `config.ts`:

```typescript
export interface AgentConfig {
  readonly googleGenaiApiKey: string;
  readonly nlmCliPath: string;
  readonly geminiModel: string;
  readonly nlmDownloadDir: string;
  readonly youtubeApiKey: string;  // NEW
}
```

Add to `getConfig()`:

```typescript
youtubeApiKey: requireEnv('YOUTUBE_API_KEY'),
```

### 7.3 .env.example Addition

```bash
# YouTube Data API v3 key.
# Obtain from: Google Cloud Console > APIs & Services > Credentials
# Enable "YouTube Data API v3" in your Google Cloud project.
# Daily quota: 10,000 units (free tier). See https://developers.google.com/youtube/v3/determine_quota_cost
YOUTUBE_API_KEY=
```

### 7.4 API Quota Considerations

YouTube Data API v3 quota costs per operation:

| Operation | Quota Cost (units) |
|-----------|:-----------:|
| `search.list` | 100 |
| `videos.list` | 1 |
| `channels.list` | 1 |

With 10,000 units/day (free tier):
- ~100 searches per day
- ~10,000 video info lookups per day
- Each `list_channel_videos` costs 100 units (uses search.list)

The system prompt should mention that search operations are more expensive than info lookups.

---

## 8. Constraints

1. **TypeScript only**: All code must be TypeScript. Follow the existing patterns in the codebase.
2. **Follow existing tool patterns**: Use Zod v4 for parameter schemas, `FunctionTool` from `@google/adk`, structured return objects with `status` field.
3. **No fallback configuration values**: `YOUTUBE_API_KEY` must be required. If not set, throw an `Error`. No empty string defaults, no hardcoded keys.
4. **Error handling**: Never let exceptions propagate from tool execute functions. Always return structured error objects.
5. **No new HTTP libraries**: Use Node.js built-in `fetch()` for YouTube API calls. The project should not add `axios`, `got`, or similar.
6. **Transcript library**: Use `youtube-transcript` npm package for transcript extraction (not the YouTube Data API `captions` endpoint, which requires OAuth).
7. **Return format consistency**: All tools return objects with a `status` field as the first key, consistent with the existing `NlmResult` pattern.
8. **Token management**: Truncate long text fields (descriptions, transcripts) to prevent context window overflow. Use the same `truncateText` pattern from `parsers.ts`.
9. **URL parsing robustness**: The video ID parser must handle all common YouTube URL formats without external URL parsing libraries.
10. **No session state writes**: None of the YouTube tools need to write to session state (unlike `get_notebook` which sets `current_notebook_id`).

---

## 9. New Dependencies

| Package | Version | Purpose | Size Impact |
|---------|---------|---------|-------------|
| `youtube-transcript` | `^4.0.0` (latest) | Extract video transcripts/captions without API key | Lightweight (~15KB) |

No other new dependencies are required. The YouTube Data API v3 is accessed via plain HTTP `fetch()` calls.

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|------------|
| YouTube API quota exhaustion | Medium | Medium | Document quota costs in system prompt; agent should prefer `videos.list` (1 unit) over `search.list` (100 units) when possible |
| Transcript unavailable for target video | High | Low | Return descriptive error with explanation; agent can fall back to description |
| YouTube API key invalid/expired | Low | High | `config_error` status with clear instructions to check Google Cloud Console |
| `youtube-transcript` package breaking changes | Low | Medium | Pin to specific major version; transcript extraction is a secondary feature |
| Rate limiting by YouTube (HTTP 429) | Low | Medium | Classify as `rate_limit` status; agent informs user to wait |
