/**
 * Circular buffer for killed text (Ctrl+K, Ctrl+U, Ctrl+W).
 * Ctrl+Y yanks the most recent entry.
 */
export class KillRing {
  private readonly maxSize: number;
  private ring: string[] = [];
  private index: number = -1;

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
  }

  /** Push text onto the kill ring. */
  kill(text: string): void {
    if (text.length === 0) return;
    this.ring.push(text);
    if (this.ring.length > this.maxSize) {
      this.ring.shift();
    }
    this.index = this.ring.length - 1;
  }

  /** Get the most recent killed text, or null if empty. */
  yank(): string | null {
    if (this.ring.length === 0) return null;
    this.index = this.ring.length - 1;
    return this.ring[this.index]!;
  }

  /** Rotate to the previous kill ring entry (for future Esc+Y support). */
  yankRotate(): string | null {
    if (this.ring.length === 0) return null;
    this.index = (this.index - 1 + this.ring.length) % this.ring.length;
    return this.ring[this.index]!;
  }

  /** Get the current size of the ring. */
  get size(): number {
    return this.ring.length;
  }
}
