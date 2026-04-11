/**
 * useAgent — React hook that wraps ADK InMemoryRunner and processes the event stream.
 *
 * Phase 5 implementation: runs the agent directly on the main thread (no worker).
 * A future phase will move the runner into a Worker thread for non-blocking tool execution.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
  type Session,
} from '@google/adk';
import { createUserContent } from '@google/genai';
import { rootAgent } from '../../agent.ts';
import { createProxyPlugin, type LlmProxyPlugin } from '../../proxy/index.ts';

// ---------------------------------------------------------------------------
// Public types — re-exported from shared types module
// ---------------------------------------------------------------------------

import type { AgentStatus, Message, ToolCallInfo } from '../types.ts';
export type { AgentStatus, Message, ToolCallInfo };

export interface UseAgentResult {
  messages: Message[];
  agentStatus: AgentStatus;
  activeToolCall: ToolCallInfo | null;
  sendMessage: (text: string) => void;
  cancelRun: () => void;
  sessionId: string | null;
  isInitialized: boolean;
  initError: string | null;

  /** Retrieve the ADK session state (key-value pairs from Session.state). */
  getSessionState: () => Promise<Record<string, unknown>>;

  /** Retrieve the ADK session events array (Session.events). */
  getSessionEvents: () => Promise<Event[]>;

  /**
   * Delete current session, create a new one, clear messages and state.
   * Returns the new session ID.
   * Throws if the runner is not initialized.
   */
  resetSession: () => Promise<string>;

  /** Insert a system message into the chat history (TUI-local, never sent to agent). */
  addSystemMessage: (text: string) => void;

  /** LLM proxy plugin instance, or undefined if proxy is disabled. */
  proxyPlugin: LlmProxyPlugin | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgent(userId?: string): UseAgentResult {
  const effectiveUserId = userId ?? 'tui-user';

  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [activeToolCall, setActiveToolCall] = useState<ToolCallInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const runnerRef = useRef<InMemoryRunner | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const generatorRef = useRef<AsyncGenerator<Event, void, undefined> | null>(null);
  const proxyPluginRef = useRef<LlmProxyPlugin | undefined>(undefined);

  // -----------------------------------------------------------------------
  // Initialization: create runner + session on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const proxyPlugin = createProxyPlugin();
        proxyPluginRef.current = proxyPlugin;

        const runner = new InMemoryRunner({
          agent: rootAgent,
          appName: 'notebooklm-tui',
          ...(proxyPlugin ? { plugins: [proxyPlugin] } : {}),
        });
        runnerRef.current = runner;

        const session = await runner.sessionService.createSession({
          appName: 'notebooklm-tui',
          userId: effectiveUserId,
        });

        if (cancelled) return;

        sessionIdRef.current = session.id;
        setSessionId(session.id);
        setIsInitialized(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setInitError(message);
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  // -----------------------------------------------------------------------
  // cancelRun
  // -----------------------------------------------------------------------
  const cancelRun = useCallback(() => {
    if (generatorRef.current) {
      generatorRef.current.return(undefined).catch(() => {});
      generatorRef.current = null;
    }
    setAgentStatus('idle');
    setActiveToolCall(null);
  }, []);

  // -----------------------------------------------------------------------
  // sendMessage
  // -----------------------------------------------------------------------
  const sendMessage = useCallback(
    (text: string) => {
      const runner = runnerRef.current;
      const sid = sessionIdRef.current;
      if (!runner || !sid) return;

      // Append user message immediately
      const userMsg: Message = {
        id: generateId(),
        role: 'user',
        text,
        isPartial: false,
        toolCalls: [],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setAgentStatus('thinking');

      // Fire-and-forget async IIFE — React event handlers cannot be async
      void (async () => {
        const gen = runner.runAsync({
          userId: effectiveUserId,
          sessionId: sid,
          newMessage: createUserContent(text),
          runConfig: {
            streamingMode: StreamingMode.SSE,
          },
        });
        generatorRef.current = gen;

        // Working state for the current agent response
        let currentAgentText = '';
        let agentMessageId: string | null = null;
        const toolCallsAccum: ToolCallInfo[] = [];

        try {
          for await (const event of gen) {
            // If cancelled externally, stop consuming
            if (!generatorRef.current) break;

            const structuredEvents = toStructuredEvents(event);

            for (const se of structuredEvents) {
              switch (se.type) {
                case EventType.CONTENT: {
                  if (event.partial === true) {
                    setAgentStatus('streaming');
                  }
                  currentAgentText += se.content;

                  // Update or create the in-progress agent message
                  setMessages((prev) => {
                    const next = [...prev];
                    if (agentMessageId === null) {
                      agentMessageId = generateId();
                      next.push({
                        id: agentMessageId,
                        role: 'agent',
                        text: currentAgentText,
                        isPartial: true,
                        toolCalls: [...toolCallsAccum],
                        timestamp: Date.now(),
                      });
                    } else {
                      const idx = next.findIndex((m) => m.id === agentMessageId);
                      if (idx !== -1) {
                        next[idx] = {
                          ...next[idx],
                          text: currentAgentText,
                          isPartial: true,
                          toolCalls: [...toolCallsAccum],
                        };
                      }
                    }
                    return next;
                  });
                  break;
                }

                case EventType.TOOL_CALL: {
                  setAgentStatus('tool_call');
                  const toolInfo: ToolCallInfo = {
                    name: se.call.name ?? 'unknown',
                    args: (se.call.args as Record<string, unknown>) ?? {},
                    status: 'running',
                  };
                  toolCallsAccum.push(toolInfo);
                  setActiveToolCall(toolInfo);
                  break;
                }

                case EventType.TOOL_RESULT: {
                  // Mark the matching tool call as completed
                  const resultName = se.result.name ?? '';
                  for (let i = toolCallsAccum.length - 1; i >= 0; i--) {
                    if (toolCallsAccum[i].name === resultName && toolCallsAccum[i].status === 'running') {
                      toolCallsAccum[i] = { ...toolCallsAccum[i], status: 'completed' };
                      break;
                    }
                  }
                  setActiveToolCall(null);
                  setAgentStatus('thinking');
                  break;
                }

                case EventType.ERROR: {
                  setAgentStatus('error');
                  const errorText = `Error: ${se.error.message}`;
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: generateId(),
                      role: 'agent',
                      text: errorText,
                      isPartial: false,
                      toolCalls: [],
                      timestamp: Date.now(),
                    },
                  ]);
                  break;
                }

                case EventType.FINISHED: {
                  // Finalize the agent message
                  setMessages((prev) => {
                    const next = [...prev];
                    if (agentMessageId !== null) {
                      const idx = next.findIndex((m) => m.id === agentMessageId);
                      if (idx !== -1) {
                        next[idx] = {
                          ...next[idx],
                          text: currentAgentText,
                          isPartial: false,
                          toolCalls: [...toolCallsAccum],
                        };
                      }
                    } else if (currentAgentText) {
                      next.push({
                        id: generateId(),
                        role: 'agent',
                        text: currentAgentText,
                        isPartial: false,
                        toolCalls: [...toolCallsAccum],
                        timestamp: Date.now(),
                      });
                    }
                    return next;
                  });
                  // Reset working state for potential next turn within same runAsync
                  currentAgentText = '';
                  agentMessageId = null;
                  toolCallsAccum.length = 0;
                  setAgentStatus('idle');
                  setActiveToolCall(null);
                  break;
                }

                case EventType.THOUGHT:
                  // Reasoning traces — ignored for now (could be logged or shown)
                  break;

                case EventType.TOOL_CONFIRMATION:
                  // Human-in-loop confirmation — not implemented yet
                  break;

                default:
                  // ACTIVITY, CALL_CODE, CODE_RESULT — ignore for now
                  break;
              }
            }
          }
        } catch (err) {
          if (generatorRef.current !== null) {
            // Not a deliberate cancellation
            setAgentStatus('error');
            const errorText = `Error: ${err instanceof Error ? err.message : String(err)}`;
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'agent',
                text: errorText,
                isPartial: false,
                toolCalls: [],
                timestamp: Date.now(),
              },
            ]);
          }
        } finally {
          generatorRef.current = null;
          setActiveToolCall(null);
          // Only reset to idle if we are not already in error state
          setAgentStatus((prev) => (prev !== 'error' ? 'idle' : prev));
        }
      })();
    },
    [effectiveUserId],
  );

  // -----------------------------------------------------------------------
  // addSystemMessage — insert a TUI-local system message (never sent to agent)
  // -----------------------------------------------------------------------
  const addSystemMessage = useCallback((text: string) => {
    const sysMsg: Message = {
      id: generateId(),
      role: 'system',
      text,
      isPartial: false,
      toolCalls: [],
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, sysMsg]);
  }, []);

  // -----------------------------------------------------------------------
  // getSessionState — retrieve ADK session state (key-value pairs)
  // -----------------------------------------------------------------------
  const getSessionState = useCallback(async (): Promise<Record<string, unknown>> => {
    const runner = runnerRef.current;
    const sid = sessionIdRef.current;
    if (!runner || !sid) return {};

    const session: Session | undefined = await runner.sessionService.getSession({
      appName: 'notebooklm-tui',
      userId: effectiveUserId,
      sessionId: sid,
    });
    return (session?.state as Record<string, unknown>) ?? {};
  }, [effectiveUserId]);

  // -----------------------------------------------------------------------
  // getSessionEvents — retrieve ADK session events array
  // -----------------------------------------------------------------------
  const getSessionEvents = useCallback(async (): Promise<Event[]> => {
    const runner = runnerRef.current;
    const sid = sessionIdRef.current;
    if (!runner || !sid) return [];

    const session: Session | undefined = await runner.sessionService.getSession({
      appName: 'notebooklm-tui',
      userId: effectiveUserId,
      sessionId: sid,
    });
    return session?.events ?? [];
  }, [effectiveUserId]);

  // -----------------------------------------------------------------------
  // resetSession — delete current session, create new one, clear state
  // -----------------------------------------------------------------------
  const resetSession = useCallback(async (): Promise<string> => {
    const runner = runnerRef.current;
    const sid = sessionIdRef.current;
    if (!runner || !sid) {
      throw new Error('Agent not initialized');
    }

    // Step 1: Delete current session
    await runner.sessionService.deleteSession({
      appName: 'notebooklm-tui',
      userId: effectiveUserId,
      sessionId: sid,
    });

    // Step 2: Create new session
    const newSession: Session = await runner.sessionService.createSession({
      appName: 'notebooklm-tui',
      userId: effectiveUserId,
    });

    // Step 3: Update refs and React state
    sessionIdRef.current = newSession.id;
    setSessionId(newSession.id);
    setMessages([]);

    return newSession.id;
  }, [effectiveUserId]);

  return {
    messages,
    agentStatus,
    activeToolCall,
    sendMessage,
    cancelRun,
    sessionId,
    isInitialized,
    initError,
    getSessionState,
    getSessionEvents,
    resetSession,
    addSystemMessage,
    proxyPlugin: proxyPluginRef.current,
  };
}
