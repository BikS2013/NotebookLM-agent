import { describe, it, expect } from 'vitest';
import { extractVideoId, parseDuration } from '../notebooklm_agent/tools/youtube-client.ts';

describe('extractVideoId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from shorts URL', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from live URL', () => {
    expect(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from v/ URL', () => {
    expect(extractVideoId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from mobile URL', () => {
    expect(extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from music URL', () => {
    expect(extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from nocookie URL', () => {
    expect(extractVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID when v param is not first in query string', () => {
    expect(
      extractVideoId('https://www.youtube.com/watch?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&v=dQw4w9WgXcQ'),
    ).toBe('dQw4w9WgXcQ');
  });

  it('accepts a bare 11-character video ID', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('trims whitespace around a bare ID', () => {
    expect(extractVideoId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('throws for an invalid URL', () => {
    expect(() => extractVideoId('https://example.com/not-youtube')).toThrow(
      'Could not extract a YouTube video ID',
    );
  });

  it('throws for empty input', () => {
    expect(() => extractVideoId('')).toThrow('Video ID or URL is required');
  });

  it('throws for non-string-like invalid input', () => {
    expect(() => extractVideoId('abc')).toThrow('Could not extract a YouTube video ID');
  });

  it('accepts an ID with hyphens and underscores', () => {
    expect(extractVideoId('a-b_c1234AB')).toBe('a-b_c1234AB');
  });
});

describe('parseDuration', () => {
  it('parses hours, minutes, and seconds', () => {
    expect(parseDuration('PT1H30M45S')).toBe(5445);
  });

  it('parses minutes and seconds', () => {
    expect(parseDuration('PT15M33S')).toBe(933);
  });

  it('parses minutes only', () => {
    expect(parseDuration('PT5M')).toBe(300);
  });

  it('parses seconds only', () => {
    expect(parseDuration('PT30S')).toBe(30);
  });

  it('parses hours only', () => {
    expect(parseDuration('PT2H')).toBe(7200);
  });

  it('returns 0 for an invalid string', () => {
    expect(parseDuration('not-a-duration')).toBe(0);
  });

  it('returns 0 for an empty string', () => {
    expect(parseDuration('')).toBe(0);
  });

  it('parses hours and seconds without minutes', () => {
    expect(parseDuration('PT1H15S')).toBe(3615);
  });
});
