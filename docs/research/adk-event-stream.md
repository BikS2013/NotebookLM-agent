# ADK Event Stream Structure — Deep Dive

**Research date:** 2026-04-11
**Package version:** `@google/adk` (installed in project, copyright header reads 2025-2026)
**Source of truth:** Live type inspection of `node_modules/@google/adk/dist/types/` and `node_modules/@google/adk/dist/esm/` (the actual compiled JavaScript)
**Context:** Building a terminal UI (`useAgent` hook) that must detect text chunks, tool calls, and tool results from the `InMemoryRunner.runAsync()` event stream.

---

## Overview

`InMemoryRunner.runAsync()` returns an `AsyncGenerator<Event, void, undefined>`. Each `Event` is a union of `LlmResponse` fields plus ADK-specific metadata. Understanding the event structure is required to:

1. Render streaming text as it arrives
2. Show tool call spinners when a tool is executing
3. Display tool results when they arrive
4. Know when the agent is done (final response)
5. Handle errors

The ADK ships an official utility — `toStructuredEvents()` — that classifies raw events into named types. This is the preferred approach for the TUI rather than manual field inspection.

---

## Key Concepts

### Event Lifecycle for a Single User Message

A single call to `runner.runAsync()` yields multiple events in sequence. For a message that triggers a tool call:

```
[partial text event]       event.partial === true, event.content has text parts
[partial text event]       ... more text streaming ...
[final text event]         event.partial === undefined/false (accumulated thought/preamble)
[tool call event]          event.content.parts[].functionCall is populated
  (tool executes internally — no event emitted during execution)
[tool result event]        event.content.parts[].functionResponse is populated
[partial text event]       streaming the final response text
[final text event]         isFinalResponse(event) === true
```

For a simple text-only response (no tools):

```
[partial text event]       event.partial === true
[partial text event]       ...
[final text event]         isFinalResponse(event) === true
```

### Streaming Mode

By default, `runAsync()` uses `StreamingMode.NONE`, which means the LLM is called with `generateContent()` (not `generateContentStream()`). In this mode:

- **No partial/streaming events are emitted for text.** The LLM processes the full request and returns one response.
- `event.partial` will always be `false`/`undefined`.
- Each event represents a complete LLM output (text, tool call, or tool result).

To enable text streaming, pass `runConfig: { streamingMode: StreamingMode.SSE }` to `runAsync()`. In SSE mode:

- Text chunk events have `event.partial === true`.
- The final text event has `event.partial === false` (or absent) and contains the accumulated full text.
- Tool call events are still atomic (not streamed).

---

## TypeScript Interfaces

### The `Event` Interface

```typescript
// From @google/adk/dist/types/events/event.d.ts
// Event extends LlmResponse

interface Event extends LlmResponse {
  id: string;                        // 8-char random identifier, assigned by session
  invocationId: string;              // Groups events from the same user message
  author?: string;                   // "user" | agent name (e.g., "notebooklm_agent")
  actions: EventActions;             // State deltas, agent transfers, auth requests
  longRunningToolIds?: string[];     // IDs of long-running tool calls in this event
  branch?: string;                   // For multi-agent routing ("agent_1.agent_2")
  timestamp: number;                 // Date.now() when event was created
}
```

### The `LlmResponse` Interface (base of Event)

```typescript
// From @google/adk/dist/types/models/llm_response.d.ts

interface LlmResponse {
  content?: Content;                 // The actual content (text, function calls, etc.)
  partial?: boolean;                 // true = streaming chunk; false/absent = complete
  turnComplete?: boolean;            // Used for streaming mode: conversation turn done
  errorCode?: string;                // Error code if this is an error response
  errorMessage?: string;             // Human-readable error message
  interrupted?: boolean;             // True if LLM was interrupted (bidi streaming only)
  finishReason?: FinishReason;       // STOP, MAX_TOKENS, SAFETY, etc.
  usageMetadata?: GenerateContentResponseUsageMetadata; // Token counts
  groundingMetadata?: GroundingMetadata;
  citationMetadata?: CitationMetadata;
  customMetadata?: { [key: string]: unknown };
}
```

### The `Content` and `Part` Interfaces (from `@google/genai`)

```typescript
// From @google/genai/dist/genai.d.ts

interface Content {
  parts?: Part[];
  role?: string;   // "user" | "model"
}

interface Part {
  text?: string;                        // Plain text
  thought?: boolean;                    // True if this text is a reasoning trace
  functionCall?: FunctionCall;          // Tool call request from the LLM
  functionResponse?: FunctionResponse;  // Tool execution result
  executableCode?: ExecutableCode;      // Code execution request
  codeExecutionResult?: CodeExecutionResult; // Code execution result
  inlineData?: Blob;                    // Binary data (images, audio)
  fileData?: FileData;                  // File reference
  // ... other media fields
}

interface FunctionCall {
  id?: string;                          // Client-generated ID (prefixed "adk-")
  name?: string;                        // Tool name (e.g., "search_youtube")
  args?: Record<string, unknown>;       // Tool arguments as parsed JSON
}

interface FunctionResponse {
  id?: string;                          // Matches the FunctionCall.id
  name?: string;                        // Tool name
  response?: Record<string, unknown>;   // Tool return value
}
```

### The `EventActions` Interface

```typescript
// From @google/adk/dist/types/events/event_actions.d.ts

interface EventActions {
  stateDelta: { [key: string]: unknown };          // Session state changes
  artifactDelta: { [key: string]: number };        // Artifact version changes
  skipSummarization?: boolean;                     // Skip LLM summarizing tool response
  transferToAgent?: string;                        // Agent transfer target name
  escalate?: boolean;                              // Escalate to parent agent
  requestedAuthConfigs: { [key: string]: AuthConfig }; // Auth requests
  requestedToolConfirmations: { [key: string]: ToolConfirmation }; // Confirmation requests
}
```

---

## Official Event Classification: `toStructuredEvents()`

The ADK ships `toStructuredEvents(event: Event): StructuredEvent[]` in `@google/adk`. This is the **recommended** way to process events in a TUI. It converts a raw `Event` into typed structured events.

### `StructuredEvent` Union Type

```typescript
// From @google/adk/dist/types/events/structured_events.d.ts

enum EventType {
  THOUGHT = "thought",            // LLM reasoning trace (thought part with thought=true)
  CONTENT = "content",            // Text content for the user
  TOOL_CALL = "tool_call",        // Tool invocation request from the LLM
  TOOL_RESULT = "tool_result",    // Tool execution result
  CALL_CODE = "call_code",        // Code execution request
  CODE_RESULT = "code_result",    // Code execution result
  ERROR = "error",                // Runtime error
  ACTIVITY = "activity",          // Generic activity/status update
  TOOL_CONFIRMATION = "tool_confirmation", // Tool needs human confirmation
  FINISHED = "finished",          // Agent has produced final response
}

// One raw Event can produce multiple StructuredEvents
type StructuredEvent =
  | ThoughtEvent          // { type: "thought"; content: string }
  | ContentEvent          // { type: "content"; content: string }
  | ToolCallEvent         // { type: "tool_call"; call: FunctionCall }
  | ToolResultEvent       // { type: "tool_result"; result: FunctionResponse }
  | CallCodeEvent         // { type: "call_code"; code: ExecutableCode }
  | CodeResultEvent       // { type: "code_result"; result: CodeExecutionResult }
  | ErrorEvent            // { type: "error"; error: Error }
  | ActivityEvent         // { type: "activity"; kind: string; detail: Record<string, unknown> }
  | ToolConfirmationEvent // { type: "tool_confirmation"; confirmations: Record<string, unknown> }
  | FinishedEvent;        // { type: "finished"; output?: unknown }
```

### How `toStructuredEvents` Works (from source)

The implementation iterates over `event.content.parts` and classifies each part:

1. If `part.functionCall` is non-empty → `TOOL_CALL`
2. If `part.functionResponse` is non-empty → `TOOL_RESULT`
3. If `part.executableCode` is non-empty → `CALL_CODE`
4. If `part.codeExecutionResult` is non-empty → `CODE_RESULT`
5. If `part.text && part.thought === true` → `THOUGHT`
6. If `part.text && !part.thought` → `CONTENT`

After parts, it checks:
- If `event.actions.requestedToolConfirmations` is non-empty → `TOOL_CONFIRMATION`
- If `isFinalResponse(event)` → `FINISHED`

If `event.errorCode` is set, returns a single `ERROR` structured event.

---

## Detecting Event Types: Manual Approach

When you cannot use `toStructuredEvents()` (e.g., need access to raw `Event` metadata), use these checks directly:

```typescript
import {
  isFinalResponse,
  getFunctionCalls,
  getFunctionResponses,
  type Event,
} from '@google/adk';

function classifyEvent(event: Event) {
  // 1. Error
  if (event.errorCode) {
    return { type: 'error', code: event.errorCode, message: event.errorMessage };
  }

  // 2. Streaming partial text chunk
  if (event.partial === true) {
    const text = event.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    return { type: 'text_chunk', text };
  }

  const functionCalls = getFunctionCalls(event);   // helper from @google/adk
  const functionResponses = getFunctionResponses(event); // helper from @google/adk

  // 3. Tool call (LLM requesting tool execution)
  if (functionCalls.length > 0) {
    return { type: 'tool_call', calls: functionCalls };
  }

  // 4. Tool result (tool executed, result returned to LLM)
  if (functionResponses.length > 0) {
    return { type: 'tool_result', responses: functionResponses };
  }

  // 5. Long-running tool (LongRunningFunctionTool, human-in-loop)
  if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
    return { type: 'long_running_tool', ids: event.longRunningToolIds };
  }

  // 6. Final response (complete text for the user)
  if (isFinalResponse(event)) {
    const text = event.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    return { type: 'final_response', text };
  }

  // 7. Intermediate text (complete but not final — agent still processing)
  return { type: 'intermediate', event };
}
```

### `isFinalResponse()` Logic (from source)

```typescript
function isFinalResponse(event: Event): boolean {
  // True if long-running tool or skipSummarization (tool result is the final answer)
  if (event.actions.skipSummarization ||
      (event.longRunningToolIds && event.longRunningToolIds.length > 0)) {
    return true;
  }
  // True only if: no function calls, no function responses, not partial,
  // and no trailing code execution result
  return (
    getFunctionCalls(event).length === 0 &&
    getFunctionResponses(event).length === 0 &&
    !event.partial &&
    !hasTrailingCodeExecutionResult(event)
  );
}
```

This means: **only text-only, complete events with no tool calls or responses are `isFinalResponse`**. Tool call events and tool result events are always `false`.

---

## "Agent is Thinking" vs "Agent is Responding" vs "Agent is Calling a Tool"

There is no explicit "thinking" state event emitted by the runner. The state machine for the TUI must be inferred:

| State | How to detect | What to show |
|-------|--------------|--------------|
| **Idle** | No `runAsync()` in progress | Cursor in input field |
| **Thinking / Waiting for LLM** | `runAsync()` started, no events yet OR last event was a tool result | Spinner: "Agent thinking..." |
| **Streaming text** | `event.partial === true` with text parts | Append text chunks to message |
| **Tool call in progress** | `getFunctionCalls(event).length > 0` received | Spinner: "Calling search_youtube..." |
| **Tool result received** | `getFunctionResponses(event).length > 0` received | Spinner stops, tool result logged |
| **Final response** | `isFinalResponse(event) === true` | Complete message displayed |
| **Error** | `event.errorCode` is set | Show error message |

**Important:** The ADK does not emit events during tool execution. Between the tool call event and the tool result event, the runner is synchronously (or asynchronously) executing the tool. During this gap, the TUI receives no events. This is the "freezing" problem noted in the investigation document, especially when tools use `execFileSync`.

### Thought Events (Gemini Thinking)

When using Gemini 2.5 Flash or Pro with `thinking` enabled in `generateContentConfig`, the model emits reasoning traces as `Part` objects where `part.thought === true`. These appear as:

```typescript
// Example thought event (streaming mode)
event.content.parts = [{ text: "Let me think about this...", thought: true }]
event.partial = true

// Processed by toStructuredEvents() as:
{ type: EventType.THOUGHT, content: "Let me think about this..." }
```

Thought events arrive in streaming partial events before the actual text response. They should be shown in a collapsible "Thinking..." section in the TUI, not in the main message flow.

---

## Streaming Text: Enabling SSE Mode

By default, `runAsync()` returns events with complete LLM responses (no partial streaming). To enable streaming text chunks:

```typescript
import { StreamingMode } from '@google/adk';

for await (const event of runner.runAsync({
  userId: session.userId,
  sessionId: session.id,
  newMessage: userContent,
  runConfig: {
    streamingMode: StreamingMode.SSE,
  },
})) {
  // Now you get partial events as text streams in
}
```

In SSE mode, the `google_llm.js` sets `event.partial = true` for each streaming chunk. The streaming behavior:

1. Each streaming chunk: `event.partial = true`, `event.content.parts[0].text` = delta text
2. When a non-text part arrives (tool call, inline data): the accumulated text is emitted as a complete event first
3. Final text chunk: `event.partial = false` (or absent), containing the final accumulated text

**Pitfall:** In SSE mode, `isFinalResponse()` still works correctly because it checks `!event.partial`. Partial events will never be flagged as final.

**Note:** SSE mode (`StreamingMode.SSE`) uses `generateContentStream()` under the hood. The streaming happens between the ADK and the Gemini API. Partial events aggregate the streaming delta locally.

---

## Cancellation / Interrupting a Run

### The Problem

`AsyncGenerator` iteration is cooperative. There is no built-in `runner.cancel()` method. Cancellation requires the consumer to stop iterating.

### Approach 1: Break the Loop (Simplest)

```typescript
const abortController = new AbortController();

async function runWithCancellation(text: string) {
  const gen = runner.runAsync({ ... });

  try {
    for await (const event of gen) {
      if (abortController.signal.aborted) {
        // Stop consuming events
        await gen.return(undefined); // Signal the generator to stop
        break;
      }
      processEvent(event);
    }
  } catch (e) {
    if (!abortController.signal.aborted) throw e;
    // Ignore error if we cancelled
  }
}

// To cancel:
abortController.abort();
```

### Approach 2: `invocationContext.endInvocation = true`

The `InvocationContext` has a public `endInvocation: boolean` flag that signals the agent to stop its loop. However, this is set on the invocation context **inside** the runner and is not accessible from the consumer. It can be set from:
- A `beforeAgentCallback` or `afterAgentCallback`
- A `beforeModelCallback`
- A tool's `execute` function

For external cancellation (e.g., Ctrl+C from TUI), the `gen.return()` approach is simpler.

### Approach 3: Worker Thread with `MessagePort`

For the TUI, the recommended approach from the investigation document is to run the agent in a Worker thread. Cancellation is achieved by:
1. Sending a cancel message via `MessagePort` to the worker
2. Worker calls `gen.return()` and terminates
3. Main thread updates UI state

### Ctrl+C Handling in the `useAgent` Hook

```typescript
// hooks/useAgent.ts pattern

const generatorRef = useRef<AsyncGenerator<Event> | null>(null);

const cancelRun = useCallback(() => {
  if (generatorRef.current) {
    // Signal generator to stop
    generatorRef.current.return(undefined).catch(() => {});
    generatorRef.current = null;
  }
  setAgentStatus('idle');
}, []);

const sendMessage = useCallback(async (text: string) => {
  const gen = runner.runAsync({ ... });
  generatorRef.current = gen;

  try {
    for await (const event of gen) {
      if (!generatorRef.current) break; // Cancelled externally
      // Process event...
    }
  } finally {
    generatorRef.current = null;
    setAgentStatus('idle');
  }
}, [runner]);
```

---

## Complete `useAgent` Hook Pattern

This is the recommended implementation pattern for the TUI's `useAgent.ts` hook, using `toStructuredEvents()`:

```typescript
import { useState, useCallback, useRef } from 'react';
import {
  InMemoryRunner,
  StreamingMode,
  toStructuredEvents,
  EventType,
  type Event,
  type StructuredEvent,
} from '@google/adk';
import { createUserContent } from '@google/genai';

type AgentStatus = 'idle' | 'thinking' | 'streaming' | 'tool_call' | 'error';

interface Message {
  role: 'user' | 'agent';
  text: string;
  isPartial?: boolean;
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export function useAgent(runner: InMemoryRunner, sessionId: string, userId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [activeToolCall, setActiveToolCall] = useState<ToolCallInfo | null>(null);
  const generatorRef = useRef<AsyncGenerator<Event> | null>(null);

  const cancelRun = useCallback(() => {
    if (generatorRef.current) {
      generatorRef.current.return(undefined).catch(() => {});
      generatorRef.current = null;
    }
    setAgentStatus('idle');
    setActiveToolCall(null);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    // Append user message immediately
    setMessages(prev => [...prev, { role: 'user', text }]);
    setAgentStatus('thinking');

    const gen = runner.runAsync({
      userId,
      sessionId,
      newMessage: createUserContent(text),
      runConfig: {
        streamingMode: StreamingMode.SSE, // Enable partial text events
      },
    });
    generatorRef.current = gen;

    // Working buffer for the current agent response
    let currentAgentText = '';
    let agentMessageIndex = -1;

    try {
      for await (const event of gen) {
        if (!generatorRef.current) break; // Cancelled

        const structuredEvents = toStructuredEvents(event);

        for (const se of structuredEvents) {
          switch (se.type) {
            case EventType.CONTENT:
              // Text content (may be a partial chunk or complete)
              if (event.partial) {
                setAgentStatus('streaming');
                currentAgentText += se.content;
                // Update or create the in-progress agent message
                setMessages(prev => {
                  const next = [...prev];
                  if (agentMessageIndex === -1) {
                    agentMessageIndex = next.length;
                    next.push({ role: 'agent', text: currentAgentText, isPartial: true });
                  } else {
                    next[agentMessageIndex] = {
                      role: 'agent',
                      text: currentAgentText,
                      isPartial: true,
                    };
                  }
                  return next;
                });
              } else {
                // Complete text (non-streaming mode or final chunk in SSE)
                currentAgentText += se.content;
              }
              break;

            case EventType.THOUGHT:
              // Reasoning trace — optionally display in collapsible section
              console.debug('[Agent thought]', se.content);
              break;

            case EventType.TOOL_CALL:
              setAgentStatus('tool_call');
              setActiveToolCall({
                name: se.call.name ?? 'unknown',
                args: se.call.args ?? {},
              });
              break;

            case EventType.TOOL_RESULT:
              // Tool finished executing
              setActiveToolCall(null);
              setAgentStatus('thinking'); // LLM will now process the result
              break;

            case EventType.ERROR:
              setAgentStatus('error');
              setMessages(prev => [
                ...prev,
                { role: 'agent', text: `Error: ${se.error.message}` },
              ]);
              break;

            case EventType.TOOL_CONFIRMATION:
              // Human-in-loop confirmation requested (LongRunningFunctionTool)
              // Handle confirmation UI here
              break;

            case EventType.FINISHED:
              // Finalize the agent message
              setMessages(prev => {
                const next = [...prev];
                if (agentMessageIndex !== -1) {
                  next[agentMessageIndex] = {
                    role: 'agent',
                    text: currentAgentText,
                    isPartial: false,
                  };
                } else if (currentAgentText) {
                  next.push({ role: 'agent', text: currentAgentText });
                }
                return next;
              });
              currentAgentText = '';
              agentMessageIndex = -1;
              setAgentStatus('idle');
              setActiveToolCall(null);
              break;
          }
        }
      }
    } catch (e) {
      if (generatorRef.current !== null) {
        // Not a deliberate cancellation
        setAgentStatus('error');
        setMessages(prev => [
          ...prev,
          { role: 'agent', text: `Error: ${(e as Error).message}` },
        ]);
      }
    } finally {
      generatorRef.current = null;
      setActiveToolCall(null);
      setAgentStatus(prev => (prev !== 'error' ? 'idle' : prev));
    }
  }, [runner, userId, sessionId]);

  return { messages, agentStatus, activeToolCall, sendMessage, cancelRun };
}
```

---

## Key Utility Functions Exported from `@google/adk`

All of these are safe to import and use in the TUI:

```typescript
import {
  // Event classification
  isFinalResponse,          // (event: Event) => boolean
  getFunctionCalls,         // (event: Event) => FunctionCall[]
  getFunctionResponses,     // (event: Event) => FunctionResponse[]
  hasTrailingCodeExecutionResult, // (event: Event) => boolean
  stringifyContent,         // (event: Event) => string  -- concatenates all text parts

  // Structured events (RECOMMENDED for TUI)
  toStructuredEvents,       // (event: Event) => StructuredEvent[]
  EventType,                // Enum of event types

  // Types (import as `type` for type-checking only)
  type Event,
  type StructuredEvent,
  type ThoughtEvent,
  type ContentEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type ErrorEvent,
  type FinishedEvent,
  type EventActions,

  // Runner and config
  InMemoryRunner,
  StreamingMode,            // NONE | SSE | BIDI
  type RunConfig,
} from '@google/adk';
```

---

## Common Pitfalls

### 1. No Events During Tool Execution

The runner does not emit events while a tool is executing. Between `TOOL_CALL` and `TOOL_RESULT` structured events, there is a silent period. If tools use `execFileSync`, the Node.js event loop is **completely blocked** during this time, causing the TUI to freeze (no rendering, no input handling, no spinner animation).

**Detection:** The gap between `TOOL_CALL` and `TOOL_RESULT` events.

**Mitigation options (ordered by preference):**
1. Run the agent in a Worker thread (main thread stays responsive for rendering)
2. Convert tool internals from `execFileSync` to `execFile` (promisified) — keeps event loop responsive
3. Accept the brief freeze for v1 with a visible "tool executing..." message before the gap

### 2. `event.partial` Is `undefined`, Not `false`

In non-streaming mode (`StreamingMode.NONE`), `event.partial` is `undefined` (not set), not `false`. Always check `event.partial === true` rather than `!event.partial` when you want to detect streaming chunks.

```typescript
// WRONG
if (!event.partial) { /* this is true for BOTH streaming complete and non-streaming */ }

// CORRECT
if (event.partial === true) { /* streaming chunk */ }
if (!event.partial) { /* complete event (either final or non-streaming) */ }
```

### 3. One Raw Event Can Contain Multiple Part Types

A single raw `Event` can have multiple parts of different types. For example, a model response with both a thought and a tool call:

```
event.content.parts = [
  { text: "I should search YouTube for this.", thought: true },
  { functionCall: { name: "search_youtube", args: { query: "AI agents" } } }
]
```

`toStructuredEvents()` will return `[ThoughtEvent, ToolCallEvent]` for this single raw event. Always use `toStructuredEvents()` and iterate over all structured events, not just the first one.

### 4. Text in Tool Call Events Is Not Final Response Text

When the model calls a tool, it may also emit text in the same event (a preamble like "I'll search for that now"). This text is in the tool call event, and `isFinalResponse()` returns `false` for it (correctly, since there are function calls). However, you may want to display this preamble text to the user.

```typescript
// Event with both text and a tool call
event.content.parts = [
  { text: "Let me search YouTube for popular AI agent videos." },
  { functionCall: { name: "search_youtube", args: { ... } } }
]
// isFinalResponse(event) === false (there are function calls)
// getFunctionCalls(event) has 1 entry
// But there is also text!

// toStructuredEvents() handles this correctly:
// Returns: [ContentEvent("Let me search..."), ToolCallEvent(search_youtube)]
```

### 5. `stringifyContent()` Is Not Always the Right Text Extractor

`stringifyContent(event)` concatenates all `part.text` values, including thought text. For displaying to the user, you should filter out thought parts:

```typescript
function getUserText(event: Event): string {
  return (event.content?.parts ?? [])
    .filter(p => p.text && !p.thought)  // Exclude thought traces
    .map(p => p.text!)
    .join('');
}
```

Or use `toStructuredEvents()` and collect `ContentEvent` items (which already exclude `thought` parts).

### 6. Author Field Identifies Which Agent Produced the Event

In multi-agent setups, `event.author` tells you which agent emitted the event:
- `"user"` — the user message (only in session history, not yielded by `runAsync()`)
- `"notebooklm_agent"` (or your agent's `name`) — the root agent
- Sub-agent names — if using multi-agent patterns

For the TUI, filter for events with `event.author !== 'user'` for display purposes (though `runAsync()` only yields agent events anyway).

### 7. Tool Responses Are Not Shown to the User

Tool result events (`TOOL_RESULT`) contain the raw return value from tool execution. These are **internal** to the agent — the LLM reads them to formulate its next response. You should NOT display tool response objects directly to the user. Show the tool name/spinner while executing, and the LLM's summarized text response after.

Exception: You may want to display a brief "(called search_youtube)" indicator in the message history for transparency.

---

## Practical Pattern: Non-Streaming Mode (Simpler)

If streaming text is not required for v1, use the default `StreamingMode.NONE`. This simplifies the event handling significantly:

```typescript
for await (const event of runner.runAsync({ userId, sessionId, newMessage })) {
  const structured = toStructuredEvents(event);
  for (const se of structured) {
    if (se.type === EventType.TOOL_CALL) {
      // Show spinner: "Calling " + se.call.name + "..."
    } else if (se.type === EventType.TOOL_RESULT) {
      // Hide spinner
    } else if (se.type === EventType.CONTENT) {
      // Append text (this will only fire once per response in non-streaming mode)
      appendText(se.content);
    } else if (se.type === EventType.FINISHED) {
      // Done
      setStatus('idle');
    } else if (se.type === EventType.ERROR) {
      showError(se.error);
    }
  }
}
```

In non-streaming mode, `CONTENT` events fire once per complete LLM response, not as chunks. The trade-off is no streaming text, but simpler code and no need to manage partial state.

---

## Impact on the Investigation Recommendations

The investigation document (`investigation-terminal-ui.md`) mentioned that "ADK event stream structure undocumented" was a medium risk. This research resolves that uncertainty:

1. **The `toStructuredEvents()` utility exists.** It is exported from `@google/adk` and does exactly what the TUI needs. The `useAgent` hook should use it rather than manually inspecting event fields. This eliminates the risk of incorrect field inspection.

2. **Streaming requires explicit opt-in.** The default `StreamingMode.NONE` will not stream text chunks. The TUI must pass `runConfig: { streamingMode: StreamingMode.SSE }` to get partial text events. This affects the `useAgent` hook design.

3. **The freezing problem during tool execution is confirmed.** The runner emits no events while a tool is executing. The worker thread approach is the correct v1 solution.

4. **No direct cancellation API.** `gen.return(undefined)` is the correct approach for Ctrl+C handling.

5. **Thought events are supported.** If Gemini thinking is enabled, `THOUGHT` events appear as streaming chunks before the text response. The TUI should handle (or at least not crash on) these events.

---

## Assumptions and Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `StreamingMode.SSE` triggers `event.partial = true` for text chunks | HIGH — confirmed in `google_llm.js` source | Streaming would not work; revert to non-streaming |
| `toStructuredEvents()` is stable public API (not internal) | HIGH — exported from `common.d.ts` via index | Would need to use manual field inspection instead |
| `gen.return(undefined)` correctly stops the agent generator | HIGH — standard AsyncGenerator protocol | May need alternative cancellation mechanism |
| `event.partial === true` only for text parts in SSE mode, not tool calls | HIGH — confirmed in source: partial is set only for text parts | Tool call detection logic would need adjustment |
| Thought events only appear when Gemini thinking is configured | MEDIUM — behavior may vary by model/config | May need to always handle `THOUGHT` events |
| Non-streaming mode (`NONE`) produces single complete events | HIGH — confirmed: uses `generateContent()` not stream | Would get unexpected partial events |

### What is Explicitly Out of Scope

- `StreamingMode.BIDI` (live/audio mode) — not relevant for text TUI
- `runEphemeral()` — ephemeral sessions (creates and deletes session automatically)
- `LongRunningFunctionTool` human-in-loop flow — mentioned but not detailed
- Multi-agent event routing (`event.author`, `event.branch`) — brief mention only
- Auth event handling (`EventActions.requestedAuthConfigs`)

### Uncertainties and Gaps

- **SSE streaming and tool calls**: When streaming mode is SSE and a tool call is encountered, the streaming buffer is flushed first (emitting a complete text event), then the tool call event is emitted. The exact timing and whether the flush text event has `partial === false` needs runtime verification.

- **Thought events in streaming**: The interaction between thought streaming and text streaming in `google_llm.js` is complex (thoughtText buffer + text buffer). Edge cases like interleaved thought and text parts may behave unexpectedly.

- **`pauseOnToolCalls` in RunConfig**: There is a `pauseOnToolCalls?: boolean` option in `RunConfig` that, if true, suspends the agent loop after any tool call (client-side tool execution pattern). This was not investigated but could be relevant for a future TUI enhancement where the user can see and approve tool calls.

### Clarifying Questions for Follow-up

1. Does enabling `StreamingMode.SSE` significantly impact latency or cost compared to `StreamingMode.NONE`? (The streaming call uses `generateContentStream()` which has the same cost but different latency profile.)

2. Is `pauseOnToolCalls: true` in `RunConfig` a viable alternative to monitoring tool call events? (It would cause the generator to stop after each tool call, allowing the TUI to show the tool call and resume manually.)

3. Does the `toStructuredEvents()` function handle multi-part events where the same part type appears multiple times (e.g., multiple text parts in sequence)?

4. Is there a way to get `invocationContext.endInvocation` from outside the runner, to properly terminate an ongoing run without `gen.return()`?

---

## References

| # | Source | URL / Path | Information Gathered |
|---|--------|-----------|---------------------|
| 1 | `event.d.ts` | `node_modules/@google/adk/dist/types/events/event.d.ts` | Full `Event` interface, all exported utility functions |
| 2 | `event_actions.d.ts` | `node_modules/@google/adk/dist/types/events/event_actions.d.ts` | `EventActions` interface fields |
| 3 | `llm_response.d.ts` | `node_modules/@google/adk/dist/types/models/llm_response.d.ts` | `LlmResponse` fields including `partial`, `turnComplete`, `errorCode` |
| 4 | `runner.d.ts` | `node_modules/@google/adk/dist/types/runner/runner.d.ts` | `runAsync()` signature, `RunConfig` parameter, `runEphemeral()` |
| 5 | `run_config.d.ts` | `node_modules/@google/adk/dist/types/agents/run_config.d.ts` | `StreamingMode` enum, `pauseOnToolCalls`, `maxLlmCalls` |
| 6 | `structured_events.d.ts` | `node_modules/@google/adk/dist/types/events/structured_events.d.ts` | `EventType` enum, all `StructuredEvent` subtypes, `toStructuredEvents()` |
| 7 | `structured_events.js` | `node_modules/@google/adk/dist/esm/events/structured_events.js` | Full implementation of `toStructuredEvents()` — classification logic |
| 8 | `event.js` | `node_modules/@google/adk/dist/esm/events/event.js` | `isFinalResponse()`, `getFunctionCalls()`, `getFunctionResponses()` implementations |
| 9 | `runner.js` | `node_modules/@google/adk/dist/esm/runner/runner.js` | Full `runAsync()` implementation — how events flow |
| 10 | `llm_agent.js` | `node_modules/@google/adk/dist/esm/agents/llm_agent.js` | `runAsyncImpl()`, `runOneStepAsync()`, `postprocess()` — agent loop |
| 11 | `google_llm.js` | `node_modules/@google/adk/dist/esm/models/google_llm.js` | Streaming implementation — how `partial` is set |
| 12 | `functions.js` | `node_modules/@google/adk/dist/esm/agents/functions.js` | Tool call handling, function call ID generation |
| 13 | `llm_agent.d.ts` | `node_modules/@google/adk/dist/types/agents/llm_agent.d.ts` | `LlmAgentConfig` full interface, callback types |
| 14 | `context.d.ts` | `node_modules/@google/adk/dist/types/agents/context.d.ts` | `Context` class (= `ToolContext`) full API |
| 15 | `invocation_context.d.ts` | `node_modules/@google/adk/dist/types/agents/invocation_context.d.ts` | `InvocationContext.endInvocation` flag |
| 16 | `genai.d.ts` | `node_modules/@google/genai/dist/genai.d.ts` | `Content`, `Part`, `FunctionCall`, `FunctionResponse` interfaces |
| 17 | `common.d.ts` | `node_modules/@google/adk/dist/types/common.d.ts` | Full list of public exports from `@google/adk` |
| 18 | `investigation-terminal-ui.md` | `docs/reference/investigation-terminal-ui.md` | Background context, risk assessment, architecture |

### Recommended for Deep Reading

- **`structured_events.js`** (`node_modules/@google/adk/dist/esm/events/structured_events.js`): The 75-line implementation is the definitive guide to how raw events map to TUI-friendly types. Read this before implementing `useAgent`.

- **`llm_agent.js` — `postprocess()` method** (lines 401-470): Shows the exact sequence in which events are emitted for a tool call cycle. Critical for understanding the event ordering.

- **`google_llm.js` — `generateContentAsync()` method** (lines 58-137): Shows exactly how `partial` is set during SSE streaming, including the accumulated text buffer behavior.
