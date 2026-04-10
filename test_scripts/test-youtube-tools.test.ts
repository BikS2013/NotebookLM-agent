import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config to avoid requiring real env vars
vi.mock('../notebooklm_agent/config.js', () => ({
  getConfig: () => ({
    youtubeApiKey: 'fake-youtube-key',
  }),
}));

// Mock youtube-client
vi.mock('../notebooklm_agent/tools/youtube-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../notebooklm_agent/tools/youtube-client.ts')>();
  return {
    ...actual,
    youtubeSearchVideos: vi.fn(),
    youtubeGetVideos: vi.fn(),
    resolveChannelId: vi.fn(),
  };
});

// Mock youtube-transcript-plus
vi.mock('youtube-transcript-plus', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}));

import { youtubeSearchVideos, youtubeGetVideos, resolveChannelId } from '../notebooklm_agent/tools/youtube-client.ts';
import { YoutubeTranscript } from 'youtube-transcript-plus';
import {
  searchYoutubeTool,
  getVideoInfoTool,
  getVideoDescriptionTool,
  getVideoTranscriptTool,
  listChannelVideosTool,
} from '../notebooklm_agent/tools/youtube-tools.ts';

const mockSearchVideos = vi.mocked(youtubeSearchVideos);
const mockGetVideos = vi.mocked(youtubeGetVideos);
const mockResolveChannelId = vi.mocked(resolveChannelId);
const mockFetchTranscript = vi.mocked(YoutubeTranscript.fetchTranscript);

// Helper to call the private execute method (same pattern as test-notebook-tools.test.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(tool: any, args: any) {
  return tool.execute(args);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────
// Tool 1: search_youtube
// ──────────────────────────────────────────────

describe('searchYoutubeTool', () => {
  it('returns search results on success', async () => {
    mockSearchVideos.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          {
            video_id: 'abc123def45',
            title: 'Test Video',
            channel_title: 'Test Channel',
            channel_id: 'UCtest',
            published_at: '2025-01-01T00:00:00Z',
            description_snippet: 'A test video',
            thumbnail_url: 'https://img.youtube.com/vi/abc123def45/hqdefault.jpg',
          },
        ],
        totalResults: 1,
      },
    });

    const result = await callTool(searchYoutubeTool,{ query: 'test query' });

    expect(result).toEqual({
      status: 'success',
      videos: expect.any(Array),
      total_results: 1,
      returned_count: 1,
    });
    expect(mockSearchVideos).toHaveBeenCalledWith('fake-youtube-key', {
      query: 'test query',
      maxResults: undefined,
      channelId: undefined,
      order: undefined,
    });
  });

  it('returns error for empty query', async () => {
    const result = await callTool(searchYoutubeTool,{ query: '   ' });

    expect(result).toEqual({ status: 'error', error: 'Query string cannot be empty.' });
    expect(mockSearchVideos).not.toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    mockSearchVideos.mockResolvedValue({
      status: 'rate_limit',
      error: 'YouTube API daily quota exceeded.',
      action: 'Wait until quota resets.',
    });

    const result = await callTool(searchYoutubeTool,{ query: 'test' });

    expect(result).toEqual(expect.objectContaining({ status: 'rate_limit' }));
  });
});

// ──────────────────────────────────────────────
// Tool 2: get_video_info
// ──────────────────────────────────────────────

describe('getVideoInfoTool', () => {
  const sampleVideo = {
    video_id: 'dQw4w9WgXcQ',
    title: 'Test Video',
    description: 'A short description.',
    channel_title: 'Test Channel',
    channel_id: 'UCtest',
    published_at: '2025-01-01T00:00:00Z',
    duration: 'PT3M30S',
    duration_seconds: 210,
    view_count: 1000,
    like_count: 100,
    comment_count: 10,
    tags: ['test'],
    category_id: '22',
    thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    is_live: false,
    default_language: 'en',
  };

  it('returns video info on success', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'success',
      data: [sampleVideo],
    });

    const result = await callTool(getVideoInfoTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    expect((result as any).video.title).toBe('Test Video');
  });

  it('accepts a full YouTube URL as video_id', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'success',
      data: [sampleVideo],
    });

    const result = await callTool(getVideoInfoTool,{
      video_id: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    expect(mockGetVideos).toHaveBeenCalledWith(
      'fake-youtube-key',
      ['dQw4w9WgXcQ'],
      ['snippet', 'contentDetails', 'statistics'],
    );
  });

  it('returns error for invalid video ID', async () => {
    const result = await callTool(getVideoInfoTool,{ video_id: 'not-valid!!!' });

    expect(result).toEqual({ status: 'error', error: 'Invalid YouTube video ID or URL.' });
    expect(mockGetVideos).not.toHaveBeenCalled();
  });

  it('returns not_found when API returns empty array', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'success',
      data: [],
    });

    const result = await callTool(getVideoInfoTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({ status: 'not_found' }));
  });

  it('propagates API errors', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'config_error',
      error: 'YouTube API access denied',
      action: 'Check your API key.',
    });

    const result = await callTool(getVideoInfoTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({ status: 'config_error' }));
  });
});

// ──────────────────────────────────────────────
// Tool 3: get_video_description
// ──────────────────────────────────────────────

describe('getVideoDescriptionTool', () => {
  it('returns description on success', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'success',
      data: [
        {
          video_id: 'dQw4w9WgXcQ',
          title: 'Test Video',
          description: 'Full description text here.',
          channel_title: 'Test',
          channel_id: 'UCtest',
          published_at: '2025-01-01T00:00:00Z',
          duration: '',
          duration_seconds: 0,
          view_count: 0,
          like_count: 0,
          comment_count: 0,
          tags: [],
          category_id: '22',
          thumbnail_url: '',
          url: '',
          is_live: false,
          default_language: null,
        },
      ],
    });

    const result = await callTool(getVideoDescriptionTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'success',
      video_id: 'dQw4w9WgXcQ',
      title: 'Test Video',
      description: 'Full description text here.',
      truncated: false,
    }));
  });

  it('returns error for invalid video ID', async () => {
    const result = await callTool(getVideoDescriptionTool,{ video_id: '!!invalid!!' });

    expect(result).toEqual({ status: 'error', error: 'Invalid YouTube video ID or URL.' });
  });

  it('returns not_found when video does not exist', async () => {
    mockGetVideos.mockResolvedValue({
      status: 'success',
      data: [],
    });

    const result = await callTool(getVideoDescriptionTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({ status: 'not_found' }));
  });
});

// ──────────────────────────────────────────────
// Tool 4: get_video_transcript
// ──────────────────────────────────────────────

describe('getVideoTranscriptTool', () => {
  it('returns transcript on success', async () => {
    mockFetchTranscript.mockResolvedValue([
      { text: 'Hello world', offset: 0, duration: 2000, lang: 'en' },
      { text: 'This is a test', offset: 2000, duration: 3000, lang: 'en' },
    ] as any);

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'success',
      video_id: 'dQw4w9WgXcQ',
      language: 'en',
      segment_count: 2,
    }));
    expect((result as any).full_text).toBe('Hello world This is a test');
  });

  it('returns error for invalid video ID', async () => {
    const result = await callTool(getVideoTranscriptTool,{ video_id: '!!bad!!' });

    expect(result).toEqual({ status: 'error', error: 'Invalid YouTube video ID or URL.' });
    expect(mockFetchTranscript).not.toHaveBeenCalled();
  });

  it('returns error when no transcript segments are available', async () => {
    mockFetchTranscript.mockResolvedValue([] as any);

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      error: expect.stringContaining('No transcript available'),
    }));
  });

  it('classifies transcript disabled error', async () => {
    const err = new Error('Transcripts are disabled');
    Object.defineProperty(err, 'constructor', {
      value: { name: 'YoutubeTranscriptDisabledError' },
    });
    // Re-create with proper class name
    class YoutubeTranscriptDisabledError extends Error {
      constructor(msg: string) { super(msg); }
    }
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptDisabledError('disabled'));

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      error: expect.stringContaining('disabled'),
    }));
  });

  it('classifies rate limit error', async () => {
    class YoutubeTranscriptTooManyRequestError extends Error {
      constructor(msg: string) { super(msg); }
    }
    mockFetchTranscript.mockRejectedValue(new YoutubeTranscriptTooManyRequestError('rate limited'));

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'rate_limit',
      error: expect.stringContaining('rate limit'),
    }));
  });

  it('handles generic transcript errors', async () => {
    mockFetchTranscript.mockRejectedValue(new Error('Something went wrong'));

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ' });

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      error: expect.stringContaining('Something went wrong'),
    }));
  });

  it('passes language option to transcript service', async () => {
    mockFetchTranscript.mockResolvedValue([
      { text: 'Hola mundo', offset: 0, duration: 2000, lang: 'es' },
    ] as any);

    const result = await callTool(getVideoTranscriptTool,{ video_id: 'dQw4w9WgXcQ', language: 'es' });

    expect(mockFetchTranscript).toHaveBeenCalledWith('dQw4w9WgXcQ', { lang: 'es' });
    expect((result as any).language).toBe('es');
  });
});

// ──────────────────────────────────────────────
// Tool 5: list_channel_videos
// ──────────────────────────────────────────────

describe('listChannelVideosTool', () => {
  it('returns channel videos on success', async () => {
    mockResolveChannelId.mockResolvedValue({
      status: 'success',
      data: { channelId: 'UCtest123456789012345', channelTitle: 'Test Channel' },
    });
    mockSearchVideos.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          {
            video_id: 'vid123456789',
            title: 'Channel Video',
            channel_title: 'Test Channel',
            channel_id: 'UCtest123456789012345',
            published_at: '2025-01-01T00:00:00Z',
            description_snippet: 'A video',
            thumbnail_url: 'https://img.youtube.com/vi/vid123456789/hqdefault.jpg',
          },
        ],
        totalResults: 1,
      },
    });

    const result = await callTool(listChannelVideosTool,{ channel_id: '@TestChannel' });

    expect(result).toEqual(expect.objectContaining({
      status: 'success',
      channel: { channel_id: 'UCtest123456789012345', channel_title: 'Test Channel' },
      returned_count: 1,
    }));
  });

  it('propagates channel resolution errors', async () => {
    mockResolveChannelId.mockResolvedValue({
      status: 'not_found',
      error: 'Channel not found',
    });

    const result = await callTool(listChannelVideosTool,{ channel_id: '@nonexistent' });

    expect(result).toEqual(expect.objectContaining({ status: 'not_found' }));
    expect(mockSearchVideos).not.toHaveBeenCalled();
  });

  it('propagates search errors after successful channel resolution', async () => {
    mockResolveChannelId.mockResolvedValue({
      status: 'success',
      data: { channelId: 'UCtest123456789012345', channelTitle: 'Test Channel' },
    });
    mockSearchVideos.mockResolvedValue({
      status: 'error',
      error: 'YouTube server error (500): Internal error',
    });

    const result = await callTool(listChannelVideosTool,{ channel_id: '@TestChannel' });

    expect(result).toEqual(expect.objectContaining({ status: 'error' }));
  });

  it('passes order and max_results to search', async () => {
    mockResolveChannelId.mockResolvedValue({
      status: 'success',
      data: { channelId: 'UCtest123456789012345', channelTitle: 'Test' },
    });
    mockSearchVideos.mockResolvedValue({
      status: 'success',
      data: { items: [], totalResults: 0 },
    });

    await callTool(listChannelVideosTool,{
      channel_id: '@TestChannel',
      max_results: 10,
      order: 'viewCount',
    });

    expect(mockSearchVideos).toHaveBeenCalledWith('fake-youtube-key', {
      query: '',
      channelId: 'UCtest123456789012345',
      maxResults: 10,
      order: 'viewCount',
    });
  });

  it('defaults order to date when not specified', async () => {
    mockResolveChannelId.mockResolvedValue({
      status: 'success',
      data: { channelId: 'UCtest123456789012345', channelTitle: 'Test' },
    });
    mockSearchVideos.mockResolvedValue({
      status: 'success',
      data: { items: [], totalResults: 0 },
    });

    await callTool(listChannelVideosTool,{ channel_id: '@TestChannel' });

    expect(mockSearchVideos).toHaveBeenCalledWith('fake-youtube-key', expect.objectContaining({
      order: 'date',
    }));
  });
});
