import { describe, it, expect } from 'vitest';
import { ProxyBuffer } from '../notebooklm_agent/proxy/proxy-buffer.ts';
import type { InteractionRecord } from '../notebooklm_agent/proxy/proxy-types.ts';

/** Helper to create a minimal InteractionRecord with a given ID. */
function makeInteraction(id: string): InteractionRecord {
  return {
    interactionId: id,
    sessionId: 'sess-1',
    startedAt: Date.now(),
    roundTrips: [],
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  };
}

describe('ProxyBuffer', () => {
  describe('constructor', () => {
    it('creates a buffer with the given capacity', () => {
      const buf = new ProxyBuffer(5);
      expect(buf.size).toBe(0);
    });

    it('enforces minimum capacity of 1', () => {
      const buf = new ProxyBuffer(0);
      buf.push(makeInteraction('a'));
      expect(buf.size).toBe(1);
      // Capacity is 1, so pushing another evicts the first
      buf.push(makeInteraction('b'));
      expect(buf.size).toBe(1);
      expect(buf.getLast()!.interactionId).toBe('b');
    });
  });

  describe('push and getAll', () => {
    it('adds items and returns them via getAll', () => {
      const buf = new ProxyBuffer(5);
      buf.push(makeInteraction('a'));
      buf.push(makeInteraction('b'));
      const all = buf.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].interactionId).toBe('a');
      expect(all[1].interactionId).toBe('b');
    });

    it('returns items in chronological order (oldest first)', () => {
      const buf = new ProxyBuffer(3);
      buf.push(makeInteraction('1'));
      buf.push(makeInteraction('2'));
      buf.push(makeInteraction('3'));
      const ids = buf.getAll().map(i => i.interactionId);
      expect(ids).toEqual(['1', '2', '3']);
    });
  });

  describe('eviction', () => {
    it('evicts oldest items when buffer is full', () => {
      const buf = new ProxyBuffer(2);
      buf.push(makeInteraction('a'));
      buf.push(makeInteraction('b'));
      buf.push(makeInteraction('c'));
      expect(buf.size).toBe(2);
      const ids = buf.getAll().map(i => i.interactionId);
      expect(ids).toEqual(['b', 'c']);
    });
  });

  describe('getLast', () => {
    it('returns the most recently added item', () => {
      const buf = new ProxyBuffer(5);
      buf.push(makeInteraction('a'));
      buf.push(makeInteraction('b'));
      expect(buf.getLast()!.interactionId).toBe('b');
    });

    it('returns undefined when empty', () => {
      const buf = new ProxyBuffer(5);
      expect(buf.getLast()).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('resets the buffer', () => {
      const buf = new ProxyBuffer(5);
      buf.push(makeInteraction('a'));
      buf.push(makeInteraction('b'));
      buf.clear();
      expect(buf.size).toBe(0);
      expect(buf.getAll()).toEqual([]);
      expect(buf.getLast()).toBeUndefined();
    });
  });

  describe('size', () => {
    it('tracks current count correctly', () => {
      const buf = new ProxyBuffer(3);
      expect(buf.size).toBe(0);
      buf.push(makeInteraction('a'));
      expect(buf.size).toBe(1);
      buf.push(makeInteraction('b'));
      expect(buf.size).toBe(2);
      buf.push(makeInteraction('c'));
      expect(buf.size).toBe(3);
      // After eviction, size stays at capacity
      buf.push(makeInteraction('d'));
      expect(buf.size).toBe(3);
    });
  });

  describe('wrap-around', () => {
    it('correctly handles multiple cycles around the ring', () => {
      const buf = new ProxyBuffer(3);
      // Fill and overflow multiple times
      for (let i = 0; i < 10; i++) {
        buf.push(makeInteraction(`item-${i}`));
      }
      expect(buf.size).toBe(3);
      const ids = buf.getAll().map(i => i.interactionId);
      expect(ids).toEqual(['item-7', 'item-8', 'item-9']);
    });
  });
});
