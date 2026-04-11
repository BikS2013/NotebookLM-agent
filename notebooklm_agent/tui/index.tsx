/**
 * App — Root shell component for the TUI.
 *
 * Wires together all hooks and components:
 * - useAgent: ADK agent integration
 * - useTextEditor: text buffer with undo/kill ring
 * - useKeyHandler: keyboard shortcut resolution
 * - useInputHistory: up/down arrow history recall
 * - useScrollManager: chat history scrolling
 *
 * Layout: StatusBar (top) | ChatHistory (middle, flex) | InputArea (bottom)
 */

import { useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp, useWindowSize, usePaste } from 'ink';

import { useAgent } from './hooks/useAgent.ts';
import { useTextEditor } from './hooks/useTextEditor.ts';
import { resolveKeyAction } from './hooks/useKeyHandler.ts';
import { useInputHistory } from './hooks/useInputHistory.ts';
import { useScrollManager } from './hooks/useScrollManager.ts';
import { isOnFirstLine, isOnLastLine } from './lib/text-buffer.ts';

import StatusBar from './components/StatusBar.tsx';
import { ChatHistory, estimateLineCount } from './components/ChatHistory.tsx';
import { InputArea } from './components/InputArea.tsx';
import {
  formatHistory,
  formatSessionState,
  formatLastExchange,
} from './lib/format-commands.ts';
import { formatInspect, formatInspectDisabled } from '../proxy/index.ts';

export default function App() {
  const { exit } = useApp();
  const { rows, columns } = useWindowSize();

  // --- Agent ---
  const agent = useAgent();

  // --- Text Editor ---
  const editor = useTextEditor();

  // --- Input History ---
  const history = useInputHistory();

  // --- Scroll Manager ---
  const scroll = useScrollManager();

  // Update max scroll when messages change
  useEffect(() => {
    const totalLines = agent.messages.reduce(
      (sum, msg) => sum + estimateLineCount(msg, columns),
      0,
    );
    // Approximate visible height: total rows - status bar (1) - input area (min 3) - some padding
    const inputHeight = Math.min(editor.lines.length, 10) + 2;
    const visibleHeight = Math.max(1, rows - 1 - inputHeight);
    const maxScroll = Math.max(0, totalLines - visibleHeight);
    scroll.setMaxScroll(maxScroll);
  }, [agent.messages, columns, rows, editor.lines.length, scroll]);

  // Auto-scroll on new messages
  useEffect(() => {
    scroll.onNewMessage();
  }, [agent.messages.length, scroll]);

  // --- Submit handler ---
  const handleSubmit = useCallback(() => {
    const text = editor.getText().trim();
    if (text.length === 0) return;

    // Check for slash commands
    if (text.startsWith('/')) {
      const command = text.toLowerCase().trim();

      if (command === '/quit' || command === '/exit') {
        exit();
        return;
      }

      if (command === '/clear') {
        editor.clear();
        return;
      }

      if (command === '/history') {
        history.addEntry(text);
        if (agent.agentStatus !== 'idle') {
          agent.addSystemMessage('Command unavailable while agent is running.');
        } else {
          const output = formatHistory(agent.messages);
          agent.addSystemMessage(output);
        }
        editor.clear();
        return;
      }

      if (command === '/memory' || command === '/state') {
        history.addEntry(text);
        if (agent.agentStatus !== 'idle') {
          agent.addSystemMessage('Command unavailable while agent is running.');
        } else {
          void (async () => {
            try {
              const state = await agent.getSessionState();
              const output = formatSessionState(state, agent.sessionId ?? '');
              agent.addSystemMessage(output);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              agent.addSystemMessage(`Error retrieving session state: ${msg}`);
            }
          })();
        }
        editor.clear();
        return;
      }

      if (command === '/new' || command === '/reset') {
        history.addEntry(text);
        if (agent.agentStatus !== 'idle') {
          agent.addSystemMessage('Command unavailable while agent is running.');
        } else {
          void (async () => {
            try {
              const newId = await agent.resetSession();
              agent.addSystemMessage(
                `Session reset. New session started (ID: ${newId}).`,
              );
              scroll.scrollToTop();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              agent.addSystemMessage(`Error resetting session: ${msg}`);
            }
          })();
        }
        editor.clear();
        return;
      }

      if (command === '/last' || command === '/raw') {
        history.addEntry(text);
        if (agent.agentStatus !== 'idle') {
          agent.addSystemMessage('Command unavailable while agent is running.');
        } else {
          void (async () => {
            try {
              const events = await agent.getSessionEvents();
              const output = formatLastExchange(events);
              agent.addSystemMessage(output);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              agent.addSystemMessage(`Error retrieving session events: ${msg}`);
            }
          })();
        }
        editor.clear();
        return;
      }

      if (command === '/inspect' || command === '/proxy') {
        history.addEntry(text);
        const output = agent.proxyPlugin
          ? formatInspect(agent.proxyPlugin)
          : formatInspectDisabled();
        agent.addSystemMessage(output);
        editor.clear();
        return;
      }

      if (command === '/help') {
        // Falls through to agent
      }
    }

    history.addEntry(text);
    agent.sendMessage(text);
    editor.clear();
  }, [editor, history, agent, exit, scroll]);

  // --- Paste handler ---
  usePaste((text) => {
    if (agent.agentStatus !== 'idle') return;
    editor.insertText(text);
  });

  // --- Keyboard input ---
  useInput((input, key) => {
    const context = {
      isBufferEmpty: editor.isEmpty(),
      isOnFirstLine: isOnFirstLine(editor.buffer),
      isOnLastLine: isOnLastLine(editor.buffer),
    };

    const action = resolveKeyAction(input, key, context);

    switch (action.type) {
      // --- Submit ---
      case 'submit':
        handleSubmit();
        break;

      // --- Text editing actions → dispatch to editor ---
      case 'move':
      case 'delete':
      case 'insert':
      case 'newline':
      case 'killToEnd':
      case 'killToStart':
      case 'killWord':
      case 'yank':
      case 'transpose':
      case 'openLine':
      case 'selectAll':
      case 'undo':
      case 'redo':
        if (agent.agentStatus === 'idle' || action.type === 'move' || action.type === 'selectAll') {
          editor.dispatch(action);
        }
        break;

      // --- History navigation ---
      case 'historyPrev': {
        const prev = history.recallPrevious(editor.getText());
        if (prev !== null) {
          editor.setContent(prev);
        }
        break;
      }
      case 'historyNext': {
        const next = history.recallNext();
        if (next !== null) {
          editor.setContent(next);
        }
        break;
      }

      // --- Scroll ---
      case 'scrollUp':
        if (action.amount === 'line') scroll.scrollUp(1);
        else if (action.amount === 'page') scroll.scrollUp(Math.max(1, rows - 6));
        else scroll.scrollToTop();
        break;
      case 'scrollDown':
        if (action.amount === 'line') scroll.scrollDown(1);
        else if (action.amount === 'page') scroll.scrollDown(Math.max(1, rows - 6));
        else scroll.scrollToBottom();
        break;

      // --- Cancel ---
      case 'cancel':
        if (agent.agentStatus !== 'idle') {
          agent.cancelRun();
        } else {
          exit();
        }
        break;

      // --- Ctrl+D ---
      case 'ctrlD':
        if (editor.isEmpty()) {
          exit();
        } else {
          editor.dispatch({ type: 'delete', direction: 'forward', word: false, line: false });
        }
        break;

      // --- Slash commands ---
      case 'slashCommand':
        // Handled in submit
        break;

      // --- No-op ---
      case 'none':
        break;
    }
  });

  // --- Initialization state ---
  if (!agent.isInitialized) {
    if (agent.initError) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red" bold>Configuration Error</Text>
          <Text color="red">{agent.initError}</Text>
          <Text dimColor>{'\n'}Press Ctrl+C to exit.</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Initializing agent...</Text>
      </Box>
    );
  }

  // --- Main layout ---
  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar
        agentStatus={agent.agentStatus}
        activeToolCall={agent.activeToolCall}
        sessionId={agent.sessionId ?? ''}
      />
      <ChatHistory
        messages={agent.messages}
        scrollOffset={scroll.scrollOffset}
        terminalWidth={columns}
      />
      <InputArea
        buffer={editor.buffer}
        cursorLine={editor.cursorLine}
        cursorCol={editor.cursorCol}
        selectionRange={editor.selectionRange}
        isDisabled={agent.agentStatus !== 'idle'}
      />
    </Box>
  );
}
