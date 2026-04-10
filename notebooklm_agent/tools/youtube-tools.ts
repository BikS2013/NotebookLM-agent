/**
 * YouTube tools for the NotebookLM ADK agent.
 * Enables searching YouTube, retrieving video metadata, fetching transcripts,
 * and listing channel videos.
 */

import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { YoutubeTranscript } from 'youtube-transcript-plus';
import type { TranscriptSegment } from 'youtube-transcript-plus';
import { getConfig } from '../config.ts';
import { truncateText, truncateList } from './parsers.ts';
import {
  extractVideoId,
  youtubeSearchVideos,
  youtubeGetVideos,
  resolveChannelId,
} from './youtube-client.ts';

// ──────────────────────────────────────────────
// Tool 1: search_youtube
// ──────────────────────────────────────────────

const searchYoutubeSchema = z.object({
  query: z.string().describe(
    'Search query string (keywords, title fragments, topic).',
  ),
  max_results: z.number().optional().describe(
    'Maximum number of results to return (1-25).',
  ),
  channel_id: z.string().optional().describe(
    'Optional channel ID to restrict search to a specific channel.',
  ),
  order: z.enum(['relevance', 'date', 'viewCount', 'rating']).optional().describe(
    'Sort order for results.',
  ),
});

export const searchYoutubeTool = new FunctionTool({
  name: 'search_youtube',
  description:
    'Search YouTube for videos matching a query. Returns a list of matching videos with their IDs, ' +
    'titles, channel names, publish dates, and thumbnail URLs. Use this to find videos by topic, ' +
    'keyword, or partial title. Results are capped at 25 videos per search. ' +
    'Costs 100 API quota units per call -- use sparingly.',
  parameters: searchYoutubeSchema,
  execute: async ({
    query,
    max_results,
    channel_id,
    order,
  }: z.infer<typeof searchYoutubeSchema>) => {
    if (!query.trim()) {
      return { status: 'error', error: 'Query string cannot be empty.' };
    }

    const { youtubeApiKey } = getConfig();
    const result = await youtubeSearchVideos(youtubeApiKey, {
      query,
      maxResults: max_results,
      channelId: channel_id,
      order,
    });

    if (result.status !== 'success') return result;

    return {
      status: 'success',
      videos: result.data.items,
      total_results: result.data.totalResults,
      returned_count: result.data.items.length,
    };
  },
});

// ──────────────────────────────────────────────
// Tool 2: get_video_info
// ──────────────────────────────────────────────

const getVideoInfoSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID (e.g., "dQw4w9WgXcQ") or full YouTube URL ' +
    '(e.g., "https://www.youtube.com/watch?v=dQw4w9WgXcQ" or "https://youtu.be/dQw4w9WgXcQ").',
  ),
});

export const getVideoInfoTool = new FunctionTool({
  name: 'get_video_info',
  description:
    'Get detailed information about a YouTube video including its title, description, ' +
    'publish date, duration, view count, like count, channel info, tags, and category. ' +
    'Accepts either a video ID or a full YouTube URL. Costs only 1 API quota unit.',
  parameters: getVideoInfoSchema,
  execute: async ({ video_id }: z.infer<typeof getVideoInfoSchema>) => {
    let parsedId: string;
    try {
      parsedId = extractVideoId(video_id);
    } catch {
      return { status: 'error', error: 'Invalid YouTube video ID or URL.' };
    }

    const { youtubeApiKey } = getConfig();
    const result = await youtubeGetVideos(youtubeApiKey, [parsedId], [
      'snippet',
      'contentDetails',
      'statistics',
    ]);

    if (result.status !== 'success') return result;
    if (result.data.length === 0) {
      return { status: 'not_found', error: `Video not found for ID: ${parsedId}` };
    }

    const video = result.data[0];

    // Truncate description to 3000 characters
    const [description, descTruncated] = truncateText(video.description, 3000);

    return {
      status: 'success',
      video: {
        ...video,
        description,
        truncated: descTruncated,
      },
    };
  },
});

// ──────────────────────────────────────────────
// Tool 3: get_video_description
// ──────────────────────────────────────────────

const getVideoDescriptionSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID or full YouTube URL.',
  ),
});

export const getVideoDescriptionTool = new FunctionTool({
  name: 'get_video_description',
  description:
    'Get the full description text of a YouTube video. Accepts either a video ID or a full ' +
    'YouTube URL. Use this when you only need the description without other metadata. ' +
    'The description is truncated to 5000 characters. Costs 1 API quota unit.',
  parameters: getVideoDescriptionSchema,
  execute: async ({ video_id }: z.infer<typeof getVideoDescriptionSchema>) => {
    let parsedId: string;
    try {
      parsedId = extractVideoId(video_id);
    } catch {
      return { status: 'error', error: 'Invalid YouTube video ID or URL.' };
    }

    const { youtubeApiKey } = getConfig();
    // Only request snippet part -- smaller payload, same 1 unit cost
    const result = await youtubeGetVideos(youtubeApiKey, [parsedId], ['snippet']);

    if (result.status !== 'success') return result;
    if (result.data.length === 0) {
      return { status: 'not_found', error: `Video not found for ID: ${parsedId}` };
    }

    const video = result.data[0];
    const originalLength = video.description.length;
    const [description, truncated] = truncateText(video.description, 5000);

    return {
      status: 'success',
      video_id: parsedId,
      title: video.title,
      description,
      truncated,
      original_length: originalLength,
    };
  },
});

// ──────────────────────────────────────────────
// Tool 4: get_video_transcript
// ──────────────────────────────────────────────

const getVideoTranscriptSchema = z.object({
  video_id: z.string().describe(
    'YouTube video ID or full YouTube URL.',
  ),
  language: z.string().optional().describe(
    'Preferred transcript language code (e.g., "en", "es", "fr"). ' +
    'If not provided, returns the first available transcript.',
  ),
});

export const getVideoTranscriptTool = new FunctionTool({
  name: 'get_video_transcript',
  description:
    'Get the text transcript of a YouTube video. Returns the full transcript text with timestamps. ' +
    'Works with both auto-generated and manually uploaded captions. Accepts either a video ID or ' +
    'a full YouTube URL. The transcript is truncated to 10000 characters to manage context size. ' +
    'Does NOT use YouTube API quota (uses a separate transcript service).',
  parameters: getVideoTranscriptSchema,
  execute: async ({ video_id, language }: z.infer<typeof getVideoTranscriptSchema>) => {
    let parsedId: string;
    try {
      parsedId = extractVideoId(video_id);
    } catch {
      return { status: 'error', error: 'Invalid YouTube video ID or URL.' };
    }

    try {
      const config: { lang?: string } = {};
      if (language) config.lang = language;

      const segments = await YoutubeTranscript.fetchTranscript(parsedId, config);

      if (!segments || segments.length === 0) {
        return {
          status: 'error',
          error: `No transcript available for video ${parsedId}. The video may have captions disabled.`,
        };
      }

      // Map segments to our output format
      const mappedSegments = segments.map((s: TranscriptSegment) => ({
        text: s.text,
        start: s.offset,
        duration: s.duration,
      }));

      // Build full text and truncate
      const fullTextRaw = segments.map((s: TranscriptSegment) => s.text).join(' ');
      const originalLength = fullTextRaw.length;
      const [fullText, textTruncated] = truncateText(fullTextRaw, 10_000);

      // Limit segments array to 500 entries
      const [truncatedSegments, segsTruncated] = truncateList(mappedSegments, 500);

      // Detect language from first segment
      const detectedLang = segments[0]?.lang ?? language ?? 'unknown';

      return {
        status: 'success',
        video_id: parsedId,
        language: detectedLang,
        segments: truncatedSegments,
        full_text: fullText,
        truncated: textTruncated || segsTruncated,
        original_length: originalLength,
        segment_count: segments.length,
      };
    } catch (err: unknown) {
      // Classify transcript-specific errors by constructor name
      // (error classes are re-exported from youtube-transcript-plus but
      //  NodeNext module resolution cannot resolve them at type-check time)
      const errName = err instanceof Error ? err.constructor.name : '';
      const errMsg = err instanceof Error ? err.message : String(err);

      switch (errName) {
        case 'YoutubeTranscriptVideoUnavailableError':
          return { status: 'not_found' as const, error: `Video not found or unavailable: ${parsedId}` };
        case 'YoutubeTranscriptDisabledError':
          return { status: 'error' as const, error: `Transcripts are disabled for video ${parsedId}. The video owner has turned off captions.` };
        case 'YoutubeTranscriptNotAvailableError':
          return { status: 'error' as const, error: `No transcript available for video ${parsedId}. The video may have captions disabled.` };
        case 'YoutubeTranscriptNotAvailableLanguageError':
          return { status: 'error' as const, error: errMsg };
        case 'YoutubeTranscriptTooManyRequestError':
          return { status: 'rate_limit' as const, error: 'Transcript service rate limit reached. Try again later.' };
        case 'YoutubeTranscriptInvalidVideoIdError':
          return { status: 'error' as const, error: `Invalid video ID format: ${parsedId}` };
        default:
          return { status: 'error' as const, error: `Transcript extraction failed: ${errMsg}` };
      }
    }
  },
});

// ──────────────────────────────────────────────
// Tool 5: list_channel_videos
// ──────────────────────────────────────────────

const listChannelVideosSchema = z.object({
  channel_id: z.string().describe(
    'YouTube channel ID (e.g., "UCxxxxxxxx"), channel handle (e.g., "@ChannelName"), ' +
    'or channel URL (e.g., "https://www.youtube.com/@ChannelName").',
  ),
  max_results: z.number().optional().describe(
    'Maximum number of videos to return (1-50).',
  ),
  order: z.enum(['date', 'viewCount', 'relevance', 'rating']).optional().describe(
    'Sort order for results.',
  ),
});

export const listChannelVideosTool = new FunctionTool({
  name: 'list_channel_videos',
  description:
    'List videos from a YouTube channel, ordered by most recent first. Accepts a channel ID, ' +
    'channel handle (e.g., "@ChannelName"), or channel URL. Returns video IDs, titles, ' +
    'publish dates, and description snippets. Results are capped at 50 videos. ' +
    'Costs 100 API quota units (uses search internally) plus 1 unit for channel resolution.',
  parameters: listChannelVideosSchema,
  execute: async ({
    channel_id,
    max_results,
    order,
  }: z.infer<typeof listChannelVideosSchema>) => {
    const { youtubeApiKey } = getConfig();

    // Step 1: Resolve channel identifier to a UC-prefixed channel ID
    const channelResult = await resolveChannelId(youtubeApiKey, channel_id);
    if (channelResult.status !== 'success') return channelResult;

    const resolvedId = channelResult.data.channelId;
    const channelTitle = channelResult.data.channelTitle;

    // Step 2: Search for videos in the channel
    const searchResult = await youtubeSearchVideos(youtubeApiKey, {
      query: '',
      channelId: resolvedId,
      maxResults: max_results,
      order: order ?? 'date',
    });

    if (searchResult.status !== 'success') return searchResult;

    return {
      status: 'success',
      channel: {
        channel_id: resolvedId,
        channel_title: channelTitle,
      },
      videos: searchResult.data.items,
      returned_count: searchResult.data.items.length,
    };
  },
});
