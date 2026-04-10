# Investigation: YouTube Tools for TypeScript

**Date:** 2026-04-10
**Scope:** YouTube Data API v3 and transcript extraction libraries for a TypeScript/Node.js project. Covers search, video metadata, transcript fetching, channel video listing, URL parsing, and integration patterns.

---

## Overview

This document covers everything needed to build YouTube tools in a TypeScript project using:

1. **YouTube Data API v3** — official Google REST API for search, metadata, and channel data (requires an API key)
2. **`youtube-transcript-plus`** — actively maintained npm package for transcript extraction without OAuth

All code examples use Node.js native `fetch()` (Node 18+) with no axios dependency.

---

## Key Concepts

| Term | Description |
|---|---|
| API Key | A simple browser-key or server-key credential for non-user-data read operations |
| OAuth 2.0 | Required only for user-specific operations (not needed for public data reads) |
| Quota | Daily cap of 10,000 units; resets at midnight Pacific Time |
| Video ID | 11-character alphanumeric identifier for a YouTube video (e.g., `dQw4w9WgXcQ`) |
| Channel ID | `UC`-prefixed string identifying a YouTube channel (e.g., `UCxxxxxx`) |
| Handle | `@`-prefixed vanity name for a channel (e.g., `@ChannelName`) |
| Innertube API | YouTube's undocumented internal API; used by transcript libraries to bypass missing official transcript endpoints |

---

## YouTube Data API v3

### Authentication

The API accepts an API key as a query parameter. No OAuth is required for read operations on public data.

**Base URL:**
```
https://www.googleapis.com/youtube/v3/
```

**API Key parameter (append to every request):**
```
?key=YOUR_API_KEY
```

**How to obtain an API key:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **YouTube Data API v3**
4. Under **APIs & Services > Credentials**, create an API key
5. Optionally restrict the key to the YouTube Data API v3 and your server's IP

### Quota System

Default allocation: **10,000 units per day** per project. Resets at midnight Pacific Time.

| Endpoint | Method | Quota Cost |
|---|---|---|
| `search.list` | Search videos / channels / playlists | **100 units** |
| `videos.list` | Retrieve video details | **1 unit** |
| `channels.list` | Retrieve channel info / resolve handles | **1 unit** |
| `playlists.list` | Retrieve playlist info | **1 unit** |
| `commentThreads.list` | List comment threads | **1 unit** |
| `captions.list` | List captions for a video | **50 units** |
| `videos.insert` | Upload a video | **100 units** |
| `channels.update` | Update channel settings | **50 units** |

**Practical implications:**
- With 10,000 units/day you can make 10,000 `videos.list` calls OR only 100 `search.list` calls
- Cache `videos.list` responses aggressively — they are cheap and stable
- Avoid redundant `search.list` calls — they are expensive and count per page

**Quota calculator:** https://developers.google.com/youtube/v3/determine_quota_cost

### Error Response Format

All API errors follow this JSON structure:

```json
{
  "error": {
    "code": 403,
    "message": "The request cannot be completed because you have exceeded your quota.",
    "errors": [
      {
        "message": "The request cannot be completed because you have exceeded your quota.",
        "domain": "youtube.quota",
        "reason": "quotaExceeded"
      }
    ]
  }
}
```

**Common error codes:**

| HTTP Code | `reason` | Meaning |
|---|---|---|
| `400` | `missingRequiredParameter` | Missing required parameter |
| `400` | `invalidPageToken` | Invalid page token |
| `400` | `incompatibleParameters` | Conflicting parameters used together |
| `401` | `authorizationRequired` | OAuth required but not provided |
| `403` | `quotaExceeded` | Daily quota exhausted |
| `403` | `forbidden` | Request not authorized |
| `403` | `channelNotFound` | Channel does not exist |
| `404` | `videoNotFound` | Video does not exist |

**TypeScript error-handling helper:**

```typescript
interface YouTubeApiError {
  error: {
    code: number;
    message: string;
    errors: Array<{
      message: string;
      domain: string;
      reason: string;
    }>;
  };
}

function isYouTubeApiError(data: unknown): data is YouTubeApiError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as YouTubeApiError).error?.code === 'number'
  );
}

async function youtubeGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || isYouTubeApiError(data)) {
    const err = (data as YouTubeApiError).error;
    throw new Error(
      `YouTube API error ${err.code} [${err.errors[0]?.reason ?? 'unknown'}]: ${err.message}`
    );
  }

  return data as T;
}
```

---

## Endpoint Reference

### 1. Search Videos — `search.list`

**Endpoint:**
```
GET https://www.googleapis.com/youtube/v3/search
```

**Quota cost:** 100 units per call

**Key parameters:**

| Parameter | Type | Description |
|---|---|---|
| `part` | string | Required. Set to `snippet` |
| `q` | string | Search query string |
| `type` | string | `video`, `channel`, or `playlist` (default: all) |
| `maxResults` | integer | 1–50, default 5 |
| `channelId` | string | Filter results to a specific channel |
| `order` | string | `relevance` (default), `date`, `viewCount`, `rating`, `title` |
| `pageToken` | string | Token for pagination |
| `publishedAfter` | datetime | ISO 8601 datetime filter |
| `publishedBefore` | datetime | ISO 8601 datetime filter |
| `videoDuration` | string | `short` (<4 min), `medium` (4–20 min), `long` (>20 min) |
| `key` | string | Your API key |

**Response schema:**

```typescript
interface SearchListResponse {
  kind: 'youtube#searchListResponse';
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  regionCode: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: SearchResult[];
}

interface SearchResult {
  kind: 'youtube#searchResult';
  etag: string;
  id: {
    kind: 'youtube#video' | 'youtube#channel' | 'youtube#playlist';
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: {
    publishedAt: string;        // ISO 8601
    channelId: string;
    title: string;
    description: string;
    thumbnails: {
      default?: Thumbnail;
      medium?: Thumbnail;
      high?: Thumbnail;
    };
    channelTitle: string;
    liveBroadcastContent: 'live' | 'upcoming' | 'none';
  };
}

interface Thumbnail {
  url: string;
  width: number;
  height: number;
}
```

**Example — search for videos:**

```typescript
const BASE = 'https://www.googleapis.com/youtube/v3';

async function searchVideos(
  query: string,
  apiKey: string,
  maxResults = 10
): Promise<SearchListResponse> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    key: apiKey,
  });

  return youtubeGet<SearchListResponse>(`${BASE}/search?${params}`);
}

// Usage
const results = await searchVideos('TypeScript tutorial', API_KEY, 5);
for (const item of results.items) {
  if (item.id.kind === 'youtube#video') {
    console.log(item.id.videoId, item.snippet.title);
  }
}
```

**Important note:** Search results do NOT include full video metadata (duration, view count, etc.). A second call to `videos.list` is needed for those fields. This is the recommended pattern — search is for discovery, `videos.list` is for details.

---

### 2. Get Video Metadata — `videos.list`

**Endpoint:**
```
GET https://www.googleapis.com/youtube/v3/videos
```

**Quota cost:** 1 unit per call

**Key parameters:**

| Parameter | Type | Description |
|---|---|---|
| `part` | string | Comma-separated: `snippet`, `contentDetails`, `statistics`, `status` |
| `id` | string | Comma-separated video IDs (up to 50 per call) |
| `key` | string | Your API key |

**Response schema:**

```typescript
interface VideoListResponse {
  kind: 'youtube#videoListResponse';
  etag: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: VideoResource[];
}

interface VideoResource {
  kind: 'youtube#video';
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;        // ISO 8601
    channelId: string;
    title: string;
    description: string;
    thumbnails: {
      default?: Thumbnail;
      medium?: Thumbnail;
      high?: Thumbnail;
      standard?: Thumbnail;
      maxres?: Thumbnail;
    };
    channelTitle: string;
    tags?: string[];
    categoryId: string;
    liveBroadcastContent: string;
    defaultLanguage?: string;
    localized: {
      title: string;
      description: string;
    };
    defaultAudioLanguage?: string;
  };
  contentDetails: {
    duration: string;           // ISO 8601 duration, e.g. "PT4M13S"
    dimension: '2d' | '3d';
    definition: 'hd' | 'sd';
    caption: 'true' | 'false';
    licensedContent: boolean;
    regionRestriction?: {
      allowed?: string[];
      blocked?: string[];
    };
    contentRating: Record<string, string>;
    projection: string;
  };
  statistics: {
    viewCount: string;          // String, parse to number
    likeCount: string;
    favoriteCount: string;
    commentCount: string;
  };
  status: {
    uploadStatus: string;
    privacyStatus: 'public' | 'unlisted' | 'private';
    license: string;
    embeddable: boolean;
    publicStatsViewable: boolean;
    madeForKids: boolean;
  };
}
```

**Example — get full video metadata:**

```typescript
async function getVideoMetadata(
  videoIds: string | string[],
  apiKey: string
): Promise<VideoListResponse> {
  const ids = Array.isArray(videoIds) ? videoIds.join(',') : videoIds;
  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    id: ids,
    key: apiKey,
  });

  return youtubeGet<VideoListResponse>(`${BASE}/videos?${params}`);
}

// Parse ISO 8601 duration (e.g., "PT4M13S" -> 253 seconds)
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0');
  const m = parseInt(match[2] ?? '0');
  const s = parseInt(match[3] ?? '0');
  return h * 3600 + m * 60 + s;
}
```

**Example — get video description only (lightweight):**

When only the description is needed, request only the `snippet` part to keep the response small:

```typescript
async function getVideoDescription(videoId: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    part: 'snippet',
    id: videoId,
    key: apiKey,
  });

  const data = await youtubeGet<VideoListResponse>(`${BASE}/videos?${params}`);
  return data.items[0]?.snippet.description ?? null;
}
```

Note: Requesting fewer `part` values does NOT reduce quota cost — `videos.list` is always 1 unit regardless of which parts are requested. The benefit of fetching only `snippet` is smaller payload size and faster parsing.

---

### 3. List Channel Videos — `search.list` with `channelId`

There is no dedicated "list all channel videos" endpoint. The standard approach is `search.list` filtered by `channelId`. Note the 500-video result limit per the API documentation.

**Endpoint:** Same `search.list` as above, with `channelId` parameter.

**Example:**

```typescript
interface ChannelVideoPage {
  videos: Array<{
    videoId: string;
    title: string;
    publishedAt: string;
    description: string;
  }>;
  nextPageToken?: string;
}

async function listChannelVideos(
  channelId: string,
  apiKey: string,
  maxResults = 50,
  pageToken?: string
): Promise<ChannelVideoPage> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(maxResults),
    key: apiKey,
  });
  if (pageToken) params.set('pageToken', pageToken);

  const data = await youtubeGet<SearchListResponse>(`${BASE}/search?${params}`);

  return {
    videos: data.items
      .filter((item) => item.id.kind === 'youtube#video')
      .map((item) => ({
        videoId: item.id.videoId!,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
        description: item.snippet.description,
      })),
    nextPageToken: data.nextPageToken,
  };
}
```

**Pagination pattern (full channel crawl):**

```typescript
async function* iterateChannelVideos(channelId: string, apiKey: string) {
  let pageToken: string | undefined;

  do {
    const page = await listChannelVideos(channelId, apiKey, 50, pageToken);
    yield* page.videos;
    pageToken = page.nextPageToken;

    // Respect rate limits between pages
    if (pageToken) await new Promise((r) => setTimeout(r, 500));
  } while (pageToken);
}
```

---

### 4. Resolve Channel Handle to Channel ID — `channels.list`

**Endpoint:**
```
GET https://www.googleapis.com/youtube/v3/channels
```

**Quota cost:** 1 unit per call

**Key parameters for handle resolution:**

| Approach | Parameter | Example |
|---|---|---|
| From `@handle` | `forHandle=@ChannelName` | `forHandle=@mkbhd` |
| From legacy username | `forUsername=username` | `forUsername=PewDiePie` |
| From known ID | `id=UCxxxxxx` | `id=UC-lHJZR3Gqxm24_Vd_AJ5Yw` |

**Example:**

```typescript
interface ChannelListResponse {
  kind: 'youtube#channelListResponse';
  etag: string;
  pageInfo: { totalResults: number; resultsPerPage: number };
  items: Array<{
    kind: 'youtube#channel';
    etag: string;
    id: string;
    snippet?: {
      title: string;
      description: string;
      publishedAt: string;
      thumbnails: Record<string, Thumbnail>;
    };
    statistics?: {
      viewCount: string;
      subscriberCount: string;
      hiddenSubscriberCount: boolean;
      videoCount: string;
    };
  }>;
}

async function resolveChannelHandle(
  handle: string,
  apiKey: string
): Promise<string | null> {
  // Strip leading '@' if present for the API parameter — API accepts with or without
  const params = new URLSearchParams({
    part: 'id',
    forHandle: handle.startsWith('@') ? handle : `@${handle}`,
    key: apiKey,
  });

  const data = await youtubeGet<ChannelListResponse>(`${BASE}/channels?${params}`);
  return data.items[0]?.id ?? null;
}

// Usage
const channelId = await resolveChannelHandle('@mkbhd', API_KEY);
// channelId -> "UCBcRF18a7Qf58cMRMN05FkA"
```

---

## Transcript Extraction

### Background

YouTube has no official public API for transcript/caption data. All Node.js libraries use one of two undocumented approaches:

1. **Scraping the video page** — parse transcript URLs from the HTML (fragile)
2. **Innertube API** — YouTube's own internal JSON API used by the web player (more stable)

Because these approaches rely on undocumented internals, any library can break when YouTube changes its internal structure.

### Package Comparison

| Package | Version (Apr 2026) | Maintenance | Approach | Node.js Support | Language Select | Proxy Support |
|---|---|---|---|---|---|---|
| `youtube-transcript` | 1.3.0 | **Inactive** | Page scraping | Yes | No | No |
| `youtube-transcript-plus` | **1.2.0** | **Active** (updated ~1 month ago) | Innertube API | Yes (>=20) | Yes | Yes (custom fetch) |
| `youtube-transcript-api` | 3.0.6 | Unknown | youtube-transcript.io | Yes | Unknown | Unknown |
| `@playzone/youtube-transcript` | Unknown | Unknown | Innertube + Invidious fallback | Yes | Yes (17+ langs) | Yes |

**Recommendation:** Use `youtube-transcript-plus`. It is the actively maintained fork of `youtube-transcript`, uses the more stable Innertube approach, supports language selection, and provides typed error classes.

### `youtube-transcript-plus` — Full Usage Guide

**Installation:**

```bash
npm install youtube-transcript-plus
```

Requires Node.js >= 20.0.0.

**Basic usage:**

```typescript
import { fetchTranscript } from 'youtube-transcript-plus';

const segments = await fetchTranscript('dQw4w9WgXcQ');
// OR pass a full URL:
const segments = await fetchTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// Each segment:
// { text: string, duration: number, offset: number, lang: string }
```

**Transcript segment type:**

```typescript
interface TranscriptSegment {
  text: string;       // Transcript text for this segment
  duration: number;   // Duration of segment in seconds
  offset: number;     // Start time from beginning of video, in seconds
  lang: string;       // Language code (e.g., "en")
}
```

**Language selection:**

```typescript
const frenchTranscript = await fetchTranscript('videoId', { lang: 'fr' });
```

If the requested language is unavailable, a `YoutubeTranscriptNotAvailableLanguageError` is thrown. The error message lists the available languages, which can be parsed and surfaced to the caller.

**Full configuration options:**

```typescript
import { fetchTranscript, FsCache } from 'youtube-transcript-plus';

const transcript = await fetchTranscript('dQw4w9WgXcQ', {
  lang: 'en',                // Language code
  userAgent: 'Custom UA',    // Override User-Agent header
  disableHttps: false,       // Use HTTP (not recommended)
  cache: new FsCache('./cache', 86400000),  // Filesystem cache, 24h TTL
  cacheTTL: 3600000,         // In-memory cache TTL, 1 hour (default)
  videoFetch: undefined,     // Override GET request for video page
  playerFetch: undefined,    // Override POST request for Innertube API
  transcriptFetch: undefined // Override GET request for transcript data
});
```

**Filesystem caching (recommended for server use):**

```typescript
import { fetchTranscript, FsCache } from 'youtube-transcript-plus';

const cache = new FsCache('./transcript-cache', 86400000); // 24h

const transcript = await fetchTranscript('dQw4w9WgXcQ', { cache });
// Cached as: ./transcript-cache/yt:transcript:dQw4w9WgXcQ:en
```

**Full error handling:**

```typescript
import {
  fetchTranscript,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptInvalidVideoIdError,
} from 'youtube-transcript-plus';

interface TranscriptResult {
  success: true;
  segments: TranscriptSegment[];
} | {
  success: false;
  error: string;
  errorType: 'unavailable' | 'disabled' | 'no_transcript' | 'language' | 'rate_limited' | 'invalid_id' | 'unknown';
}

async function getTranscript(videoId: string, lang = 'en'): Promise<TranscriptResult> {
  try {
    const segments = await fetchTranscript(videoId, { lang });
    return { success: true, segments };
  } catch (error) {
    if (error instanceof YoutubeTranscriptVideoUnavailableError) {
      return { success: false, error: 'Video not found or removed', errorType: 'unavailable' };
    }
    if (error instanceof YoutubeTranscriptDisabledError) {
      return { success: false, error: 'Transcripts disabled by video owner', errorType: 'disabled' };
    }
    if (error instanceof YoutubeTranscriptNotAvailableError) {
      return { success: false, error: 'No transcript available for this video', errorType: 'no_transcript' };
    }
    if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
      // error.message includes available languages
      return { success: false, error: error.message, errorType: 'language' };
    }
    if (error instanceof YoutubeTranscriptTooManyRequestError) {
      return { success: false, error: 'Rate limited — try again later or use proxy', errorType: 'rate_limited' };
    }
    if (error instanceof YoutubeTranscriptInvalidVideoIdError) {
      return { success: false, error: 'Invalid video ID or URL format', errorType: 'invalid_id' };
    }
    throw error; // Re-throw unexpected errors
  }
}
```

**Join segments into plain text:**

```typescript
function transcriptToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ');
}

function transcriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const m = Math.floor(s.offset / 60);
      const sec = Math.floor(s.offset % 60);
      return `[${m}:${sec.toString().padStart(2, '0')}] ${s.text}`;
    })
    .join('\n');
}
```

---

## URL Parsing — Video ID Extraction

### All YouTube URL Formats

| Format | Example |
|---|---|
| Standard watch | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` |
| Short URL | `https://youtu.be/dQw4w9WgXcQ` |
| Embed | `https://www.youtube.com/embed/dQw4w9WgXcQ` |
| Shorts | `https://www.youtube.com/shorts/dQw4w9WgXcQ` |
| Live | `https://www.youtube.com/live/dQw4w9WgXcQ` |
| `/v/` path | `https://www.youtube.com/v/dQw4w9WgXcQ` |
| Mobile | `https://m.youtube.com/watch?v=dQw4w9WgXcQ` |
| YouTube Music | `https://music.youtube.com/watch?v=dQw4w9WgXcQ` |
| No-cookie embed | `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ` |
| With timestamp | `https://youtu.be/dQw4w9WgXcQ?t=42` |
| v= not first param | `https://www.youtube.com/watch?list=PLxyz&v=dQw4w9WgXcQ` |
| Bare ID (11 chars) | `dQw4w9WgXcQ` |

### Recommended Implementation

```typescript
/**
 * Extracts an 11-character YouTube video ID from any known URL format,
 * or validates a bare ID. Returns null if the input is not recognizable.
 */
function extractVideoId(input: string): string | null {
  if (!input) return null;

  // If already a bare 11-character video ID
  if (/^[\w-]{11}$/.test(input)) return input;

  const patterns = [
    // youtu.be/<id>
    /youtu\.be\/([\w-]{11})/,
    // youtube.com/shorts/<id>
    /youtube\.com\/shorts\/([\w-]{11})/,
    // youtube.com/live/<id>
    /youtube\.com\/live\/([\w-]{11})/,
    // youtube.com/embed/<id>
    /youtube\.com\/embed\/([\w-]{11})/,
    // youtube.com/v/<id>
    /youtube\.com\/v\/([\w-]{11})/,
    // youtube.com/watch?v=<id> or youtube-nocookie.com/watch?v=<id>
    /(?:youtube(?:-nocookie)?\.com)\/watch\?.*v=([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Test cases
console.assert(extractVideoId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=30') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('https://www.youtube.com/watch?list=PL&v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
console.assert(extractVideoId('not-a-video') === null);
```

---

## Node.js `fetch()` Integration

### Gotchas and Mitigations

| Gotcha | Impact | Mitigation |
|---|---|---|
| No built-in timeout | Requests can hang indefinitely | Use `AbortController` with a timeout |
| No progress events | Cannot track large response streaming | Acceptable for API calls; not needed here |
| `keepAlive: true` by default (Node 19+) | Persists TCP connections — generally beneficial | No action needed |
| `quotaExceeded` returns HTTP 403 | Must parse body to distinguish auth 403 from quota 403 | Check `error.errors[0].reason === 'quotaExceeded'` |

**Timeout wrapper using `AbortController`:**

```typescript
async function fetchWithTimeout(
  url: string,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

**Distinguishing quota exceeded from auth forbidden:**

```typescript
async function safeFetch<T>(url: string): Promise<T> {
  const response = await fetchWithTimeout(url);
  const data = await response.json();

  if (!response.ok) {
    const err = (data as YouTubeApiError)?.error;
    if (err?.errors?.[0]?.reason === 'quotaExceeded') {
      throw new Error('QUOTA_EXCEEDED: YouTube API daily quota exhausted. Resets at midnight PT.');
    }
    throw new Error(`API error ${err?.code}: ${err?.message}`);
  }

  return data as T;
}
```

### Rate Limiting and Quota Management Patterns

**Pattern 1 — simple request throttle:**

```typescript
class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly minDelayMs: number
  ) {}

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.running++;
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          await new Promise((r) => setTimeout(r, this.minDelayMs));
          this.next();
        }
      });
      this.next();
    });
  }

  private next() {
    if (this.running < this.maxConcurrent && this.queue.length > 0) {
      this.queue.shift()!();
    }
  }
}

// Allow max 1 concurrent search.list, with 500ms between calls
const searchLimiter = new RateLimiter(1, 500);
```

**Pattern 2 — quota budget tracker:**

```typescript
class QuotaBudget {
  private used = 0;
  private readonly dailyLimit: number;

  constructor(dailyLimit = 10000) {
    this.dailyLimit = dailyLimit;
  }

  consume(units: number): void {
    if (this.used + units > this.dailyLimit) {
      throw new Error(`Quota budget exhausted: ${this.used}/${this.dailyLimit} units used`);
    }
    this.used += units;
  }

  get remaining(): number {
    return this.dailyLimit - this.used;
  }
}

const budget = new QuotaBudget(10000);

async function searchWithBudget(query: string, apiKey: string) {
  budget.consume(100); // search.list costs 100 units
  return searchVideos(query, apiKey);
}
```

---

## Best Practices

### API Key Security

- Never embed the API key in client-side code or commit it to version control
- Store in environment variables or a secrets manager
- Restrict the key in Google Cloud Console to only the YouTube Data API v3 and your server's IP range

### Quota Efficiency

- Batch `videos.list` requests: pass up to 50 video IDs in a single call (1 unit for all 50)
- Cache `videos.list` responses — video metadata changes infrequently
- Use `search.list` sparingly — at 100 units each, 100 calls exhaust the daily quota
- For channel video listing, consider caching the list and refreshing periodically rather than re-querying on each request
- Request only the `part` values you actually need to keep response payloads small

### Transcript Extraction

- Always implement the full error-handling pattern — transcripts are frequently unavailable
- Cache transcripts to avoid repeated Innertube calls for the same video
- Prefer `lang: 'en'` as a default, with fallback logic to try without a language if `en` is unavailable
- Be aware that auto-generated transcripts may have lower quality text than manually uploaded ones
- The library uses undocumented YouTube internals — pin the version in `package.json` and monitor for breakage after YouTube updates

### Pagination

- Always handle `nextPageToken` in search and channel listing
- Add a minimum delay (500ms recommended) between paginated requests to avoid rate limits
- For large channel crawls, consider processing pages asynchronously and storing results incrementally

---

## Common Pitfalls

1. **Treating search results as having full metadata.** `search.list` returns only `snippet`. Always follow with `videos.list` for `contentDetails`, `statistics`, etc.

2. **Forgetting that `statistics` fields are strings.** `viewCount`, `likeCount`, etc. are returned as strings, not numbers. Use `parseInt()` or `Number()` to convert.

3. **Parsing ISO 8601 duration naively.** `PT1H30M` is 90 minutes. Use a dedicated parser function — simple string splitting on minutes will fail for hour-length videos.

4. **Using `youtube-transcript` (original package).** It is unmaintained and known to break in production as of 2024–2025. Use `youtube-transcript-plus` instead.

5. **Not handling the quota 403 distinctly from auth 403.** Both return HTTP 403 but have different `reason` values. Quota errors should surface a user-friendly message and stop further API calls.

6. **Assuming `search.list` returns all channel videos.** The API caps results at 500 videos per channel search regardless of pagination.

7. **Missing the `@` in `forHandle`.** The API accepts the handle with or without `@`, but being explicit avoids ambiguity.

---

## Advanced Topics

### Batching `videos.list` After Search

The recommended pattern for search-then-enrich:

```typescript
async function searchAndEnrich(
  query: string,
  apiKey: string,
  maxResults = 10
): Promise<VideoResource[]> {
  // Step 1: Search (100 units)
  const searchResults = await searchVideos(query, apiKey, maxResults);
  const videoIds = searchResults.items
    .filter((item) => item.id.kind === 'youtube#video')
    .map((item) => item.id.videoId!)
    .filter(Boolean);

  if (videoIds.length === 0) return [];

  // Step 2: Enrich (1 unit for all IDs, up to 50)
  const details = await getVideoMetadata(videoIds, apiKey);
  return details.items;
}
// Total cost: 101 units for up to 50 enriched video results
```

### Direct Innertube API (No Library)

For teams that want to avoid the transcript library dependency entirely and implement directly:

```typescript
// This is the approach used internally by youtube-transcript-plus
// Shown here for understanding, not necessarily recommended for production use.

async function fetchTranscriptRaw(videoId: string): Promise<string | null> {
  // Step 1: Fetch the video page to get the innertube API key and context
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
  });
  const html = await pageResponse.text();

  // Extract innertube config (undocumented — format may change)
  const configMatch = html.match(/ytcfg\.set\(({.+?})\)/);
  if (!configMatch) return null;

  // Step 2: Call the Innertube player API
  // Step 3: Parse captions from player response and fetch transcript XML

  // NOTE: This implementation is intentionally incomplete.
  // The full implementation involves several undocumented fields.
  // Use youtube-transcript-plus which handles this reliably.
  return null;
}
```

This approach is shown for understanding only. The library encapsulates this complexity and handles YouTube's internal API changes.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| Node.js 20+ is the target runtime | HIGH | `youtube-transcript-plus` requires >= 20; lower versions would need a different package or polyfill |
| Only public videos need to be accessed | HIGH | Private or unlisted video transcript access may require different approaches |
| API key authentication is sufficient (no OAuth) | HIGH | If user-specific operations are added later, OAuth flow will need to be implemented separately |
| `youtube-transcript-plus` v1.2.0 is currently functional | MEDIUM | All transcript libraries can break when YouTube changes internal APIs — verified active maintenance but unverified live functionality |
| 10,000 daily quota units is the applicable limit | HIGH | Projects can apply for quota increases; the default is well-documented |
| `search.list` 500-video channel cap is a hard limit | MEDIUM | Documented limit in the API, but no workaround was confirmed — some sources suggest using playlist-based approaches for channels with > 500 videos |

**Explicitly out of scope:**
- OAuth 2.0 flows for user-authenticated operations
- Caption upload or modification (`captions.insert`, `captions.update`)
- YouTube Analytics API (separate API with different auth requirements)
- `youtubei.js` — a full Innertube client library that handles login sessions; heavyweight for this use case
- Audio/video downloading (yt-dlp approach) — separate tooling concern
- Paid third-party transcript APIs (Supadata, AssemblyAI, etc.)

---

## Technical Research Guidance

Research needed: Yes

### Topic 1: Transcript Library Live Validation

- **Why**: All Node.js transcript packages use undocumented YouTube internals. Documentation alone cannot confirm a package is currently functional. `youtube-transcript-plus` shows recent commits but this has not been validated against live YouTube responses.
- **Focus**: Install `youtube-transcript-plus` v1.2.0 in a Node.js 20 environment and run it against 3–5 real video IDs (including one with auto-generated captions, one with manual captions, and one with captions disabled). Verify the response structure matches the documented `TranscriptSegment` type.
- **Depth**: Surface — a working test script is sufficient; no architectural decisions depend on the internals.

### Topic 2: Channel Videos Beyond 500

- **Why**: The `search.list` endpoint is documented to cap channel video results at 500. For channels with large back-catalogs, a different approach may be needed (e.g., fetching the channel's "uploads" playlist via `playlistItems.list`).
- **Focus**: Research whether using the channel's uploads playlist ID (available in `channels.list` `contentDetails.relatedPlaylists.uploads`) and `playlistItems.list` bypasses the 500 cap, and what the quota cost would be.
- **Depth**: Moderate — this affects the design of the channel-listing tool.

### Topic 3: API Key vs. Project-Level Quotas

- **Why**: The 10,000 unit default applies per Google Cloud project, not per API key. Multiple API keys from the same project share the same quota. Understanding whether to create separate GCP projects for quota isolation may affect deployment architecture.
- **Focus**: Confirm whether rotating API keys across GCP projects is a viable quota scaling strategy and what Google's policy is.
- **Depth**: Surface — one paragraph of official policy documentation is sufficient.

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | YouTube Data API — `search.list` docs | https://developers.google.com/youtube/v3/docs/search/list | Endpoint parameters, response schema, quota cost |
| 2 | YouTube Data API — `videos.list` docs | https://developers.google.com/youtube/v3/docs/videos/list | Endpoint parameters, response schema, part list |
| 3 | YouTube Data API — errors | https://developers.google.com/youtube/v3/docs/errors | Full error type/reason reference |
| 4 | YouTube Data API — channels | https://developers.google.com/youtube/v3/guides/working_with_channel_ids | Channel ID resolution, `forHandle` parameter |
| 5 | YouTube Data API — quota calculator | https://developers.google.com/youtube/v3/determine_quota_cost | Authoritative quota unit costs per method |
| 6 | YouTube Data API — overview | https://developers.google.com/youtube/v3/getting-started | Authentication, quota system overview |
| 7 | `youtube-transcript-plus` GitHub | https://github.com/ericmmartin/youtube-transcript-plus | API, configuration options, error types, proxy patterns |
| 8 | `youtube-transcript-plus` npm | https://www.npmjs.com/package/youtube-transcript-plus | Current version (1.2.0), maintenance status |
| 9 | `youtube-transcript` Snyk analysis | https://snyk.io/advisor/npm-package/youtube-transcript | Maintenance inactive status, known production issues |
| 10 | `youtube-transcript` npm | https://www.npmjs.com/package/youtube-transcript | Version 1.3.0, download stats, dependency count |
| 11 | Supadata — transcript API comparison | https://supadata.ai/blog/best-youtube-transcript-api | Package landscape overview |
| 12 | Innertube API guide (Medium) | https://medium.com/@aqib-2/extract-youtube-transcripts-using-innertube-api-2025-javascript-guide-dc417b762f49 | Direct Innertube approach context (403 access during research) |
| 13 | Phyllo — quota analysis | https://www.getphyllo.com/post/youtube-api-limits-how-to-calculate-api-usage-cost-and-fix-exceeded-api-quota | Quota cost table, practical implications |
| 14 | contentstats.io — quota breakdown | https://www.contentstats.io/blog/youtube-api-quota-tracking | Per-endpoint quota cost confirmation |
| 15 | YouTube URL regex (labnol) | https://www.labnol.org/code/19797-regex-youtube-id | URL format patterns |
| 16 | YouTube URL formats (tutorialpedia) | https://www.tutorialpedia.org/blog/how-do-i-get-the-youtube-video-id-from-a-url/ | Comprehensive URL format list including Shorts and Live |
| 17 | Node.js Fetch API (LogRocket) | https://blog.logrocket.com/fetch-api-node-js/ | Native fetch gotchas, timeout handling, keepAlive behavior |
| 18 | Context7 — `youtube-transcript-plus` | https://context7.com/ericmmartin/youtube-transcript-plus/llms.txt | Code examples for caching, proxy, language selection |
| 19 | `channels.list` reference | https://developers.google.com/youtube/v3/docs/channels/list | forHandle parameter, channel ID resolution |
| 20 | Implementation: Channels guide | https://developers.google.com/youtube/v3/guides/implementation/channels | Channel identification approaches |

### Recommended for Deep Reading

- **YouTube Data API errors page** (https://developers.google.com/youtube/v3/docs/errors): The complete error reference covering every endpoint — essential for robust error handling implementation.
- **`youtube-transcript-plus` README** (https://github.com/ericmmartin/youtube-transcript-plus): Full configuration options, proxy setup, and caching strategies directly from the maintainer.
- **YouTube quota calculator** (https://developers.google.com/youtube/v3/determine_quota_cost): Interactive tool — use this before designing any feature that involves multiple API calls to verify the total quota cost.
