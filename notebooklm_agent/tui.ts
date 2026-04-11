#!/usr/bin/env node
/**
 * TUI entry point for the NotebookLM Agent.
 *
 * Usage:
 *   npx tsx notebooklm_agent/tui.ts
 *   npm run tui
 *
 * Must load dotenv BEFORE any module that calls getConfig().
 */

import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import App from './tui/index.tsx';

try {
  render(React.createElement(App), {
    alternateScreen: true,
    kittyKeyboard: {
      mode: 'enabled',
      flags: ['disambiguateEscapeCodes', 'reportAlternateKeys'],
    },
  });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('Missing required environment variable') || message.includes('requireEnv')) {
    console.error('\n\x1b[31mConfiguration Error:\x1b[0m', message);
    console.error('\nEnsure your .env file contains all required variables.');
    console.error('See notebooklm_agent/.env.example for reference.\n');
  } else {
    console.error('\n\x1b[31mFatal Error:\x1b[0m', message);
  }

  process.exit(1);
}
