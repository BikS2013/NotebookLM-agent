/**
 * Discriminated union of all possible editing and navigation actions.
 * This is the bridge between key handling and text buffer operations.
 * The App component dispatches EditActions to the useTextEditor hook.
 */
export type EditAction =
  // Cursor movement
  | { type: 'move'; direction: 'left' | 'right' | 'up' | 'down';
      select: boolean; word: boolean; line: boolean; doc: boolean }
  // Text deletion
  | { type: 'delete'; direction: 'backward' | 'forward';
      word: boolean; line: boolean }
  // Text insertion (printable characters, paste)
  | { type: 'insert'; text: string }
  // Line operations
  | { type: 'newline' }
  | { type: 'submit' }
  // Kill ring operations (Emacs)
  | { type: 'killToEnd' }
  | { type: 'killToStart' }
  | { type: 'killWord' }
  | { type: 'yank' }
  // Text manipulation
  | { type: 'transpose' }
  | { type: 'openLine' }
  // Selection
  | { type: 'selectAll' }
  // Undo/Redo
  | { type: 'undo' }
  | { type: 'redo' }
  // Input history
  | { type: 'historyPrev' }
  | { type: 'historyNext' }
  // Chat history scrolling
  | { type: 'scrollUp'; amount: 'line' | 'page' | 'top' }
  | { type: 'scrollDown'; amount: 'line' | 'page' | 'bottom' }
  // Application-level
  | { type: 'cancel' }
  | { type: 'ctrlD' }
  | { type: 'slashCommand'; command: string }
  | { type: 'none' };
