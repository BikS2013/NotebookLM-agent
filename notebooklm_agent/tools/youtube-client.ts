/**
 * YouTube Data API v3 HTTP client and utilities.
 * Analogous to nlm-runner.ts but for REST API calls instead of subprocess execution.
 *
 * Design:
 * - All exported functions accept apiKey as a parameter (not read from config) for testability.
 * - All exported async functions return YouTubeApiResult<T> -- never throw.
 * - Uses Node.js built-in fetch() with AbortController for timeouts.
 * - Error classification maps HTTP status codes to NlmStatus-compatible values.
 */

// ──────────────────────────────────────────────
// Type definitions
// ──────────────────────────────────────────────

/** Unified result type for all YouTube API operations. */
export type YouTubeApiResult<T> =
  | { status: 'success'; data: T }
  | { status: 'not_found'; error: string }
  | { status: 'rate_limit'; error: string; action?: string }
  | { status: 'config_error'; error: string; action?: string }
  | { status: 'error'; error: string };

/** Shape of a YouTube API error response body. */
interface YouTubeApiErrorResponse {
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

/** A single item from search.list results. */
export interface YouTubeSearchItem {
  video_id: string;
  title: string;
  channel_title: string;
  channel_id: string;
  published_at: string;
  description_snippet: string;
  thumbnail_url: string;
}

/** A single item from videos.list results (full metadata). */
export interface YouTubeVideoItem {
  video_id: string;
  title: string;
  description: string;
  channel_title: string;
  channel_id: string;
  published_at: string;
  duration: string;
  duration_seconds: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  tags: string[];
  category_id: string;
  thumbnail_url: string;
  url: string;
  is_live: boolean;
  default_language: string | null;
}

// ──────────────────────────────────────────────
// Internal: YouTube API response shapes (raw)
// ──────────────────────────────────────────────

interface RawThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface RawSearchItem {
  id: { kind: string; videoId?: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: Record<string, RawThumbnail | undefined>;
    channelTitle: string;
  };
}

interface RawSearchListResponse {
  pageInfo: { totalResults: number; resultsPerPage: number };
  items: RawSearchItem[];
  nextPageToken?: string;
}

interface RawVideoItem {
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: Record<string, RawThumbnail | undefined>;
    channelTitle: string;
    tags?: string[];
    categoryId: string;
    liveBroadcastContent: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  contentDetails?: {
    duration: string;
    caption: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface RawVideoListResponse {
  items: RawVideoItem[];
}

interface RawChannelItem {
  id: string;
  snippet?: {
    title: string;
  };
}

interface RawChannelListResponse {
  items: RawChannelItem[];
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 10_000;

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

/** Type guard for YouTube API error responses. */
function isYouTubeApiError(data: unknown): data is YouTubeApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as YouTubeApiErrorResponse).error?.code === 'number'
  );
}

/**
 * Classify a YouTube API error into an NlmStatus-compatible status.
 *
 * HTTP 403 is disambiguated by checking the `reason` field:
 * - "quotaExceeded" -> rate_limit
 * - anything else (e.g., "forbidden", "keyInvalid") -> config_error
 */
function classifyYouTubeError(
  httpStatus: number,
  errorBody: YouTubeApiErrorResponse | null,
): YouTubeApiResult<never> {
  const reason = errorBody?.error?.errors?.[0]?.reason ?? '';
  const message = errorBody?.error?.message ?? `HTTP ${httpStatus}`;

  switch (true) {
    case httpStatus === 400:
      return { status: 'error', error: `Bad request: ${message}` };

    case httpStatus === 403 && reason === 'quotaExceeded':
      return {
        status: 'rate_limit',
        error: 'YouTube API daily quota exceeded.',
        action:
          'Wait until quota resets (midnight Pacific Time) or check your API key quota in Google Cloud Console.',
      };

    case httpStatus === 403:
      return {
        status: 'config_error',
        error: `YouTube API access denied: ${message}`,
        action:
          'Check that YOUTUBE_API_KEY is valid and the YouTube Data API v3 is enabled in your Google Cloud project.',
      };

    case httpStatus === 404:
      return { status: 'not_found', error: message };

    case httpStatus === 429:
      return {
        status: 'rate_limit',
        error: 'YouTube API rate limit reached (HTTP 429).',
        action: 'Wait before retrying.',
      };

    case httpStatus >= 500:
      return { status: 'error', error: `YouTube server error (${httpStatus}): ${message}` };

    default:
      return { status: 'error', error: `YouTube API error (${httpStatus}): ${message}` };
  }
}

/**
 * Perform a GET request to the YouTube Data API with timeout.
 * Returns a classified YouTubeApiResult -- never throws.
 */
async function youtubeApiGet<T>(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<YouTubeApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data: unknown = await response.json();

    if (!response.ok || isYouTubeApiError(data)) {
      const errorBody = isYouTubeApiError(data) ? data : null;
      return classifyYouTubeError(response.status, errorBody);
    }

    return { status: 'success', data: data as T };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', error: `YouTube API request timed out after ${timeoutMs}ms` };
    }
    return { status: 'error', error: `Network error: ${String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the best available thumbnail URL from a thumbnails object.
 * Preference: maxres > high > medium > default.
 */
function pickThumbnail(thumbnails: Record<string, RawThumbnail | undefined>): string {
  return (
    thumbnails.maxres?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    ''
  );
}

// ──────────────────────────────────────────────
// Exported pure functions
// ──────────────────────────────────────────────

/**
 * Extract an 11-character YouTube video ID from any known URL format or bare ID.
 * Returns the ID string or throws an Error if the input is not recognizable.
 *
 * Supported formats:
 * - https://www.youtube.com/watch?v=ID
 * - https://youtu.be/ID
 * - https://www.youtube.com/embed/ID
 * - https://www.youtube.com/shorts/ID
 * - https://www.youtube.com/live/ID
 * - https://www.youtube.com/v/ID
 * - https://m.youtube.com/watch?v=ID
 * - https://music.youtube.com/watch?v=ID
 * - https://www.youtube-nocookie.com/embed/ID
 * - https://www.youtube.com/watch?list=PL&v=ID (v not first param)
 * - Bare 11-character ID
 */
export function extractVideoId(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Video ID or URL is required.');
  }

  const trimmed = input.trim();

  // Bare 11-character video ID (alphanumeric, - and _)
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  const patterns: RegExp[] = [
    // youtu.be/<id>
    /youtu\.be\/([\w-]{11})/,
    // youtube.com/shorts/<id>
    /youtube\.com\/shorts\/([\w-]{11})/,
    // youtube.com/live/<id>
    /youtube\.com\/live\/([\w-]{11})/,
    // youtube.com/embed/<id>
    /youtube\.com\/embed\/([\w-]{11})/,
    // youtube-nocookie.com/embed/<id>
    /youtube-nocookie\.com\/embed\/([\w-]{11})/,
    // youtube.com/v/<id>
    /youtube\.com\/v\/([\w-]{11})/,
    // youtube.com/watch?...v=<id> (v can appear anywhere in query string)
    /(?:youtube(?:-nocookie)?\.com|music\.youtube\.com)\/watch\?.*[?&]v=([\w-]{11})/,
    // Fallback: youtube.com/watch?v=<id> (v is the first param)
    /(?:youtube(?:-nocookie)?\.com|music\.youtube\.com)\/watch\?v=([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }

  throw new Error(
    `Could not extract a YouTube video ID from: "${trimmed}". ` +
    'Provide a valid YouTube URL or an 11-character video ID.',
  );
}

/**
 * Convert an ISO 8601 duration string (e.g., "PT1H30M45S") to total seconds.
 * Returns 0 for unparseable strings.
 */
export function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// ──────────────────────────────────────────────
// Exported async API functions
// ──────────────────────────────────────────────

/**
 * Generic YouTube API fetch helper.
 * Constructs the full URL with the API key and delegates to youtubeApiGet.
 */
export async function youtubeApiFetch<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<YouTubeApiResult<T>> {
  const searchParams = new URLSearchParams({ ...params, key: apiKey });
  const url = `${YOUTUBE_API_BASE}/${endpoint}?${searchParams.toString()}`;
  return youtubeApiGet<T>(url);
}

/**
 * Resolve a channel identifier (handle, URL, or raw ID) to a UC-prefixed channel ID.
 *
 * Supported input formats:
 * - Raw UC-prefixed channel ID (returned as-is, no API call)
 * - @handle (resolved via channels.list?forHandle=@handle)
 * - https://www.youtube.com/@handle (handle extracted, then API call)
 * - https://www.youtube.com/channel/UCxxx (ID extracted, returned as-is)
 * - https://youtube.com/c/name (legacy -- treated as handle, resolved via API)
 */
export async function resolveChannelId(
  apiKey: string,
  input: string,
): Promise<YouTubeApiResult<{ channelId: string; channelTitle: string }>> {
  const trimmed = input.trim();

  // 1. Raw UC-prefixed channel ID -- return as-is (no API call needed)
  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { status: 'success', data: { channelId: trimmed, channelTitle: '' } };
  }

  // 2. Full URL: extract the relevant part
  let handle: string | null = null;

  // https://www.youtube.com/channel/UCxxxxxxx
  const channelUrlMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (channelUrlMatch) {
    return { status: 'success', data: { channelId: channelUrlMatch[1], channelTitle: '' } };
  }

  // https://www.youtube.com/@handle
  const handleUrlMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/);
  if (handleUrlMatch) {
    handle = handleUrlMatch[1];
  }

  // https://youtube.com/c/name (legacy)
  const legacyUrlMatch = trimmed.match(/youtube\.com\/c\/([\w.-]+)/);
  if (!handle && legacyUrlMatch) {
    handle = legacyUrlMatch[1];
  }

  // 3. Bare @handle
  if (!handle && trimmed.startsWith('@')) {
    handle = trimmed.slice(1);
  }

  // 4. If no pattern matched, treat the raw input as a handle attempt
  if (!handle) {
    handle = trimmed;
  }

  // Resolve handle via YouTube Data API channels.list
  const result = await youtubeApiFetch<RawChannelListResponse>(apiKey, 'channels', {
    part: 'id,snippet',
    forHandle: `@${handle}`,
  });

  if (result.status !== 'success') return result;

  const channel = result.data.items?.[0];
  if (!channel) {
    return { status: 'not_found', error: `Channel not found for identifier: "${input}"` };
  }

  return {
    status: 'success',
    data: {
      channelId: channel.id,
      channelTitle: channel.snippet?.title ?? '',
    },
  };
}

/**
 * Search YouTube for videos matching a query.
 * Wraps the search.list endpoint (100 quota units per call).
 */
export async function youtubeSearchVideos(
  apiKey: string,
  params: {
    query: string;
    maxResults?: number;
    channelId?: string;
    order?: string;
  },
): Promise<YouTubeApiResult<{ items: YouTubeSearchItem[]; totalResults: number }>> {
  const apiParams: Record<string, string> = {
    part: 'snippet',
    type: 'video',
    q: params.query,
  };
  if (params.maxResults !== undefined) apiParams.maxResults = String(params.maxResults);
  if (params.channelId) apiParams.channelId = params.channelId;
  if (params.order) apiParams.order = params.order;

  const result = await youtubeApiFetch<RawSearchListResponse>(apiKey, 'search', apiParams);
  if (result.status !== 'success') return result;

  const items: YouTubeSearchItem[] = result.data.items
    .filter((item) => item.id.kind === 'youtube#video' && item.id.videoId)
    .map((item) => ({
      video_id: item.id.videoId!,
      title: item.snippet.title,
      channel_title: item.snippet.channelTitle,
      channel_id: item.snippet.channelId,
      published_at: item.snippet.publishedAt,
      description_snippet: item.snippet.description.slice(0, 200),
      thumbnail_url: pickThumbnail(item.snippet.thumbnails),
    }));

  return {
    status: 'success',
    data: {
      items,
      totalResults: result.data.pageInfo?.totalResults ?? items.length,
    },
  };
}

/**
 * Get full metadata for one or more videos.
 * Wraps the videos.list endpoint (1 quota unit per call, up to 50 IDs).
 */
export async function youtubeGetVideos(
  apiKey: string,
  videoIds: string[],
  parts: string[] = ['snippet', 'contentDetails', 'statistics'],
): Promise<YouTubeApiResult<YouTubeVideoItem[]>> {
  const result = await youtubeApiFetch<RawVideoListResponse>(apiKey, 'videos', {
    part: parts.join(','),
    id: videoIds.join(','),
  });
  if (result.status !== 'success') return result;

  const items: YouTubeVideoItem[] = result.data.items.map((v) => ({
    video_id: v.id,
    title: v.snippet.title,
    description: v.snippet.description,
    channel_title: v.snippet.channelTitle,
    channel_id: v.snippet.channelId,
    published_at: v.snippet.publishedAt,
    duration: v.contentDetails?.duration ?? '',
    duration_seconds: parseDuration(v.contentDetails?.duration ?? ''),
    view_count: parseInt(v.statistics?.viewCount ?? '0', 10),
    like_count: parseInt(v.statistics?.likeCount ?? '0', 10),
    comment_count: parseInt(v.statistics?.commentCount ?? '0', 10),
    tags: v.snippet.tags ?? [],
    category_id: v.snippet.categoryId,
    thumbnail_url: pickThumbnail(v.snippet.thumbnails),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    is_live: v.snippet.liveBroadcastContent === 'live',
    default_language: v.snippet.defaultLanguage ?? v.snippet.defaultAudioLanguage ?? null,
  }));

  return { status: 'success', data: items };
}
