import { describe, it, expect } from 'vitest';
import { KillRing } from '../notebooklm_agent/tui/lib/kill-ring.ts';

describe('KillRing', () => {
  describe('yank on empty ring', () => {
    it('returns null', () => {
      const ring = new KillRing();
      expect(ring.yank()).toBeNull();
    });
  });

  describe('kill then yank', () => {
    it('returns the killed text', () => {
      const ring = new KillRing();
      ring.kill('hello');
      expect(ring.yank()).toBe('hello');
    });
  });

  describe('multiple kills', () => {
    it('yank returns the most recent', () => {
      const ring = new KillRing();
      ring.kill('first');
      ring.kill('second');
      ring.kill('third');
      expect(ring.yank()).toBe('third');
    });
  });

  describe('kill with empty string', () => {
    it('does not add to ring', () => {
      const ring = new KillRing();
      ring.kill('');
      expect(ring.size).toBe(0);
      expect(ring.yank()).toBeNull();
    });
  });

  describe('yankRotate', () => {
    it('returns null on empty ring', () => {
      const ring = new KillRing();
      expect(ring.yankRotate()).toBeNull();
    });

    it('cycles through previous kills', () => {
      const ring = new KillRing();
      ring.kill('first');
      ring.kill('second');
      ring.kill('third');

      // yank returns most recent
      expect(ring.yank()).toBe('third');

      // yankRotate goes backwards
      expect(ring.yankRotate()).toBe('second');
      expect(ring.yankRotate()).toBe('first');

      // wraps around
      expect(ring.yankRotate()).toBe('third');
    });

    it('works with single item', () => {
      const ring = new KillRing();
      ring.kill('only');
      expect(ring.yank()).toBe('only');
      expect(ring.yankRotate()).toBe('only');
    });
  });

  describe('ring max size', () => {
    it('drops oldest entries when exceeding max size', () => {
      const ring = new KillRing(3);
      ring.kill('a');
      ring.kill('b');
      ring.kill('c');
      ring.kill('d'); // 'a' should be dropped

      expect(ring.size).toBe(3);
      expect(ring.yank()).toBe('d');
      expect(ring.yankRotate()).toBe('c');
      expect(ring.yankRotate()).toBe('b');
      // 'a' is gone, wrapping should go to 'd'
      expect(ring.yankRotate()).toBe('d');
    });

    it('respects default max size of 10', () => {
      const ring = new KillRing();
      for (let i = 0; i < 15; i++) {
        ring.kill(`item-${i}`);
      }
      expect(ring.size).toBe(10);
      // Most recent is item-14
      expect(ring.yank()).toBe('item-14');
    });
  });

  describe('size getter', () => {
    it('returns 0 for new ring', () => {
      expect(new KillRing().size).toBe(0);
    });

    it('tracks items added', () => {
      const ring = new KillRing();
      ring.kill('a');
      expect(ring.size).toBe(1);
      ring.kill('b');
      expect(ring.size).toBe(2);
    });
  });
});
