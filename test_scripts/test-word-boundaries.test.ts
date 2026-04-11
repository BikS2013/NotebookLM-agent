import { describe, it, expect } from 'vitest';
import {
  isWordChar,
  wordBoundaryLeft,
  wordBoundaryRight,
} from '../notebooklm_agent/tui/lib/word-boundaries.ts';

describe('isWordChar', () => {
  it('returns true for lowercase letters', () => {
    expect(isWordChar('a')).toBe(true);
    expect(isWordChar('z')).toBe(true);
  });
  it('returns true for uppercase letters', () => {
    expect(isWordChar('A')).toBe(true);
    expect(isWordChar('Z')).toBe(true);
  });
  it('returns true for digits', () => {
    expect(isWordChar('0')).toBe(true);
    expect(isWordChar('9')).toBe(true);
  });
  it('returns true for underscore', () => {
    expect(isWordChar('_')).toBe(true);
  });
  it('returns false for space', () => {
    expect(isWordChar(' ')).toBe(false);
  });
  it('returns false for punctuation', () => {
    expect(isWordChar('.')).toBe(false);
    expect(isWordChar(',')).toBe(false);
    expect(isWordChar('!')).toBe(false);
    expect(isWordChar('-')).toBe(false);
    expect(isWordChar('(')).toBe(false);
  });
  it('returns false for tab and newline', () => {
    expect(isWordChar('\t')).toBe(false);
    expect(isWordChar('\n')).toBe(false);
  });
});

describe('wordBoundaryLeft', () => {
  it('returns 0 when at position 0', () => {
    expect(wordBoundaryLeft('hello', 0)).toBe(0);
  });
  it('returns 0 for negative position', () => {
    expect(wordBoundaryLeft('hello', -5)).toBe(0);
  });
  it('jumps to start of current word from middle', () => {
    // "hello world" cursor at 8 (in "world") => skips no non-word, then back to 6
    expect(wordBoundaryLeft('hello world', 8)).toBe(6);
  });
  it('skips whitespace then finds word start', () => {
    // "hello world" cursor at 6 (start of "world") => skip no non-word (w is word char)
    // Actually at pos 6, char[5] = ' ' (non-word), so skip spaces, then skip "hello" => 0
    expect(wordBoundaryLeft('hello world', 6)).toBe(0);
  });
  it('skips punctuation before word', () => {
    // "foo...bar" cursor at 6 (in "bar") => skip "bar" leftward? No, pos=6, text[5]='.' non-word
    // Actually cursor at 6: text[5]='.' skip dots => pos=3, then skip 'foo' => 0
    expect(wordBoundaryLeft('foo...bar', 6)).toBe(0);
  });
  it('from space between words', () => {
    // "hello world" cursor at 5 (the space), text[4]='o' word char => skip word => 0
    expect(wordBoundaryLeft('hello world', 5)).toBe(0);
  });
  it('handles single character word', () => {
    expect(wordBoundaryLeft('a b', 3)).toBe(2);
  });
  it('handles all spaces', () => {
    expect(wordBoundaryLeft('   ', 3)).toBe(0);
  });
  it('does not treat camelCase as boundary', () => {
    // "camelCase" from end should go to 0, not stop at 'C'
    expect(wordBoundaryLeft('camelCase', 9)).toBe(0);
  });
  it('handles underscore as word character', () => {
    // "foo_bar" treated as one word
    expect(wordBoundaryLeft('foo_bar', 7)).toBe(0);
  });
});

describe('wordBoundaryRight', () => {
  it('returns length when at end', () => {
    expect(wordBoundaryRight('hello', 5)).toBe(5);
  });
  it('returns length when beyond end', () => {
    expect(wordBoundaryRight('hello', 10)).toBe(5);
  });
  it('jumps past word then past spaces to next word start', () => {
    // "hello world" from 0: skip word chars to 5, skip space to 6
    expect(wordBoundaryRight('hello world', 0)).toBe(6);
  });
  it('from middle of word jumps to next word start', () => {
    // "hello world" from 2: skip 'llo' to 5, skip ' ' to 6
    expect(wordBoundaryRight('hello world', 2)).toBe(6);
  });
  it('from space goes to next word start', () => {
    // "hello world" from 5: text[5]=' ' non-word, skip space... wait
    // Actually at 5, text[5]=' ', but the algo first skips word chars (text[5] is not word) => 0 skipped
    // Then skips non-word chars => pos=6
    expect(wordBoundaryRight('hello world', 5)).toBe(6);
  });
  it('handles consecutive spaces', () => {
    // "a   b" from 0: skip 'a' to 1, skip '   ' to 4
    expect(wordBoundaryRight('a   b', 0)).toBe(4);
  });
  it('handles empty string', () => {
    expect(wordBoundaryRight('', 0)).toBe(0);
  });
  it('does not treat camelCase as boundary', () => {
    // "camelCase test" from 0: skip 'camelCase' to 9, skip ' ' to 10
    expect(wordBoundaryRight('camelCase test', 0)).toBe(10);
  });
  it('handles punctuation as non-word', () => {
    // "foo.bar" from 0: skip 'foo' to 3, skip '.' to 4
    expect(wordBoundaryRight('foo.bar', 0)).toBe(4);
  });
  it('single character', () => {
    // "a" from 0: skip 'a' to 1, no non-word to skip => 1
    expect(wordBoundaryRight('a', 0)).toBe(1);
  });
  it('all spaces', () => {
    // "   " from 0: skip word chars (none), skip non-word to 3
    expect(wordBoundaryRight('   ', 0)).toBe(3);
  });
});
