/**
 * macOS-style word boundary detection.
 * Words are alphanumeric sequences (including underscore).
 * Delimiters are whitespace and punctuation.
 * camelCase and snake_case are NOT word boundaries.
 */

/**
 * Check if a character is a word character (alphanumeric or underscore).
 */
export function isWordChar(ch: string): boolean {
  return /[\w]/.test(ch);
}

/**
 * Find the start of the previous word boundary from position.
 *
 * @param text The full text content
 * @param position Current character offset
 * @returns New character offset at the beginning of the previous word
 */
export function wordBoundaryLeft(text: string, position: number): number {
  if (position <= 0) return 0;

  let pos = position;

  // Skip any non-word characters (whitespace/punctuation) going left
  while (pos > 0 && !isWordChar(text[pos - 1]!)) {
    pos--;
  }

  // Skip word characters going left
  while (pos > 0 && isWordChar(text[pos - 1]!)) {
    pos--;
  }

  return pos;
}

/**
 * Find the end of the next word boundary from position.
 *
 * @param text The full text content
 * @param position Current character offset
 * @returns New character offset at the end of the next word
 */
export function wordBoundaryRight(text: string, position: number): number {
  const len = text.length;
  if (position >= len) return len;

  let pos = position;

  // Skip any word characters going right
  while (pos < len && isWordChar(text[pos]!)) {
    pos++;
  }

  // Skip non-word characters going right
  while (pos < len && !isWordChar(text[pos]!)) {
    pos++;
  }

  return pos;
}
