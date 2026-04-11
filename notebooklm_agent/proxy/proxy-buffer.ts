/**
 * In-memory circular buffer for storing the last N InteractionRecord objects.
 * Used by the /inspect command. No file I/O.
 */
import type { InteractionRecord } from './proxy-types.ts';

export class ProxyBuffer {
  private readonly capacity: number;
  private readonly buffer: (InteractionRecord | undefined)[];
  private head: number;   // next write position
  private count: number;  // current number of stored items

  /**
   * @param capacity - Maximum number of interactions to retain (default: 10)
   */
  constructor(capacity: number = 10) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.buffer = new Array<InteractionRecord | undefined>(this.capacity).fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Add an interaction to the buffer.
   * If the buffer is full, the oldest interaction is evicted.
   */
  push(interaction: InteractionRecord): void {
    this.buffer[this.head] = interaction;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Retrieve all stored interactions in chronological order (oldest first).
   */
  getAll(): InteractionRecord[] {
    if (this.count === 0) return [];

    const result: InteractionRecord[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry !== undefined) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Retrieve the most recently added interaction, or undefined if empty.
   */
  getLast(): InteractionRecord | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  /**
   * Remove all interactions from the buffer.
   */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Number of interactions currently in the buffer.
   */
  get size(): number {
    return this.count;
  }
}
