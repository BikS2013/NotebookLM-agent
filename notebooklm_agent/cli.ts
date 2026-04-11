#!/usr/bin/env node
/**
 * CLI entry point for the NotebookLM Agent.
 *
 * A simple readline-based interface that supports the same slash commands
 * as the TUI (/history, /memory, /new, /last) plus agent interaction.
 *
 * Usage:
 *   npx tsx notebooklm_agent/cli.ts
 *   npm run cli
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Session,
} from '@google/adk';
import { createUserContent } from '@google/genai';
import { rootAgent } from './agent.ts';
import {
  formatHistory,
  formatSessionState,
  formatLastExchange,
} from './tui/lib/format-commands.ts';
import type { Message } from './tui/types.ts';

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function printSystem(text: string): void {
  console.log(`${DIM}${YELLOW}[system]${RESET} ${DIM}${text}${RESET}`);
}

function printError(text: string): void {
  console.log(`${RED}Error:${RESET} ${text}`);
}

// ---------------------------------------------------------------------------
// Unique ID generator (same as useAgent)
// ---------------------------------------------------------------------------

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const userId = 'cli-user';
  const appName = 'notebooklm-cli';

  // Initialize runner and session
  const runner = new InMemoryRunner({ agent: rootAgent, appName });
  let session = await runner.sessionService.createSession({ appName, userId });
  let sessionId = session.id;

  // Local message history (for /history command)
  let messages: Message[] = [];

  console.log(`${BOLD}NotebookLM Agent CLI${RESET}`);
  console.log(`${DIM}Session: ${sessionId.slice(0, 8)}${RESET}`);
  console.log(`${DIM}Commands: /history /memory /new /last /quit${RESET}`);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${GREEN}You>${RESET} `,
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const text = line.trim();
    if (text.length === 0) {
      rl.prompt();
      return;
    }

    const command = text.toLowerCase();

    // --- /quit, /exit ---
    if (command === '/quit' || command === '/exit') {
      console.log('Goodbye!');
      rl.close();
      process.exit(0);
    }

    // --- /history ---
    if (command === '/history') {
      const output = formatHistory(messages);
      printSystem(output);
      console.log();
      rl.prompt();
      return;
    }

    // --- /memory, /state ---
    if (command === '/memory' || command === '/state') {
      try {
        const sess: Session | undefined = await runner.sessionService.getSession({
          appName, userId, sessionId,
        });
        const state = (sess?.state as Record<string, unknown>) ?? {};
        const output = formatSessionState(state, sessionId);
        printSystem(output);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(`Retrieving session state: ${msg}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    // --- /new, /reset ---
    if (command === '/new' || command === '/reset') {
      try {
        await runner.sessionService.deleteSession({ appName, userId, sessionId });
        const newSession = await runner.sessionService.createSession({ appName, userId });
        session = newSession;
        sessionId = newSession.id;
        messages = [];
        printSystem(`Session reset. New session started (ID: ${sessionId}).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(`Resetting session: ${msg}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    // --- /last, /raw ---
    if (command === '/last' || command === '/raw') {
      try {
        const sess: Session | undefined = await runner.sessionService.getSession({
          appName, userId, sessionId,
        });
        const events = sess?.events ?? [];
        const output = formatLastExchange(events);
        printSystem(output);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(`Retrieving session events: ${msg}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    // --- /help ---
    if (command === '/help') {
      printSystem('Available commands:');
      printSystem('  /history         Show conversation history');
      printSystem('  /memory, /state  Show agent session state (memory)');
      printSystem('  /new, /reset     Clear memory and start new session');
      printSystem('  /last, /raw      Show last request/response with model');
      printSystem('  /quit, /exit     Exit the CLI');
      printSystem('  /help            Show this help');
      console.log();
      rl.prompt();
      return;
    }

    // --- Send to agent ---
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      text,
      isPartial: false,
      toolCalls: [],
      timestamp: Date.now(),
    };
    messages.push(userMsg);

    process.stdout.write(`${BOLD}${CYAN}Agent${RESET} `);

    try {
      const gen = runner.runAsync({
        userId,
        sessionId,
        newMessage: createUserContent(text),
        runConfig: { streamingMode: StreamingMode.SSE },
      });

      let agentText = '';

      for await (const event of gen) {
        const structuredEvents = toStructuredEvents(event);

        for (const se of structuredEvents) {
          switch (se.type) {
            case EventType.CONTENT: {
              const chunk = se.content;
              if (chunk) {
                process.stdout.write(chunk);
                agentText += chunk;
              }
              break;
            }
            case EventType.TOOL_CALL: {
              const name = se.call.name ?? 'unknown';
              const args = (se.call.args as Record<string, unknown>) ?? {};
              process.stdout.write(`\n${DIM}  ↳ calling ${name}(${JSON.stringify(args)})${RESET}`);
              break;
            }
            case EventType.TOOL_RESULT: {
              process.stdout.write(`${DIM} ✓${RESET}`);
              break;
            }
            case EventType.ERROR: {
              const errText = `\n${RED}Error: ${se.error.message}${RESET}`;
              process.stdout.write(errText);
              agentText += `Error: ${se.error.message}`;
              break;
            }
            case EventType.FINISHED: {
              // Done
              break;
            }
            default:
              break;
          }
        }
      }

      console.log('\n');

      // Record agent message in local history
      if (agentText) {
        messages.push({
          id: generateId(),
          role: 'agent',
          text: agentText,
          isPartial: false,
          toolCalls: [],
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n${RED}Error: ${msg}${RESET}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('Missing required environment variable') || message.includes('requireEnv')) {
    console.error(`\n${RED}Configuration Error:${RESET}`, message);
    console.error('\nEnsure your .env file contains all required variables.');
    console.error('See notebooklm_agent/.env.example for reference.\n');
  } else {
    console.error(`\n${RED}Fatal Error:${RESET}`, message);
  }

  process.exit(1);
});
