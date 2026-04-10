# Google ADK TypeScript SDK — Deep Dive API Reference

**Research date:** 2026-04-10
**Package:** `@google/adk` on npm
**Dev tools:** `@google/adk-devtools`
**GitHub:** https://github.com/google/adk-js
**Official docs:** https://google.github.io/adk-docs/get-started/typescript/

---

## Overview

Google Agent Development Kit (ADK) for TypeScript (`@google/adk`) is the official TypeScript/JavaScript port of the Python ADK. It reached general availability in 2025. The TypeScript SDK follows the same conceptual model as Python (agents, tools, sessions, runners) but uses TypeScript idioms:

- **Tools** are defined with `FunctionTool` + Zod schemas (not function docstrings or type hints like Python)
- **`rootAgent`** is a named export from `agent.ts` (equivalent of Python's `__init__.py` `root_agent`)
- **Session state** is read/written via `context.state.get()` / `context.state.set()` (not `tool_context.state["key"]` like Python)
- **`CallbackContext` and `ToolContext`** are unified into a single `Context` type in TypeScript

**Prerequisites:**
- Node.js 24.13.0 or later
- npm 11.8.0 or later

---

## Key Concepts

| Concept | Python equivalent | TypeScript form |
|---------|-------------------|-----------------|
| Agent entry point | `__init__.py` exporting `root_agent` | `agent.ts` exporting `rootAgent` |
| Tool definition | Plain `def` function added to `tools=[]` | `new FunctionTool({ name, description, parameters: ZodSchema, execute })` |
| Parameter schema | Type hints + docstring | Zod `z.object({ ... })` with `.describe()` |
| Session state write | `tool_context.state["key"] = value` | `context.state.set("key", value)` |
| Session state read | `tool_context.state.get("key")` | `context.state.get("key")` |
| Instruction provider | `def my_fn(ctx: ReadonlyContext) -> str:` | `function myFn(ctx: ReadonlyContext): string` |
| Runner | `Runner(agent=..., session_service=...)` | `new InMemoryRunner({ agent })` |
| Long-running / human-in-loop | `LongRunningFunctionTool(func=...)` | `new LongRunningFunctionTool({ name, description, parameters, execute })` |

---

## Installation and Project Setup

```bash
mkdir my-agent && cd my-agent

# Initialize as an ES module (required)
npm init --yes
npm pkg set type="module"
npm pkg set main="agent.ts"

# Install the main ADK library
npm install @google/adk

# Install dev tools (provides `adk web` and `adk run`)
npm install -D @google/adk-devtools
```

Also install `zod` for parameter schemas (it is a peer dependency):

```bash
npm install zod
```

### Required environment variables

Create a `.env` file in your agent directory. The key names differ slightly from Python:

```env
# For Google AI Studio (Gemini API key)
GOOGLE_GENAI_USE_VERTEXAI=FALSE
GOOGLE_GENAI_API_KEY=YOUR_API_KEY_HERE

# For Vertex AI
# GOOGLE_GENAI_USE_VERTEXAI=TRUE
# GOOGLE_CLOUD_PROJECT=your-project-id
# GOOGLE_CLOUD_LOCATION=us-central1
```

**Note:** The variable name is `GOOGLE_GENAI_API_KEY`, NOT `GEMINI_API_KEY`. The devtools auto-load the `.env` file when running `npx adk web` or `npx adk run`. In `agent.ts` itself you can also add `import 'dotenv/config';` at the top to load the `.env` manually.

---

## Directory Structure Convention

The `adk web` command must be run from the **parent folder** of the agent folder. The agent folder contains `agent.ts` as the entry point:

```
parent_folder/              <-- run `npx adk web` from here
  my-agent/
    agent.ts                <-- exports `rootAgent` (named export, camelCase)
    .env                    <-- GOOGLE_GENAI_API_KEY etc.
    package.json
    node_modules/
```

When running as a standalone file (not inside a subfolder), you can also:

```
my-agent/                   <-- run `npx adk web` from here
  agent.ts
  .env
  package.json
```

Then select your agent from the UI dropdown on `http://localhost:8000`.

---

## Agent Definition — `LlmAgent`

### Minimal example

```typescript
import { LlmAgent } from '@google/adk';

export const rootAgent = new LlmAgent({
  name: 'hello_agent',
  model: 'gemini-2.5-flash',        // Model identifier string
  description: 'A basic agent.',     // Used by orchestrators to route to this agent
  instruction: 'You are a helpful assistant.',
});
```

### Full `LlmAgent` constructor parameters

```typescript
import { LlmAgent, FunctionTool, ReadonlyContext } from '@google/adk';
import { GenerateContentConfig } from '@google/genai';
import { z } from 'zod';

const agent = new LlmAgent({
  // --- Identity (all strings) ---
  name: 'my_agent',                   // Required. Unique identifier; no spaces
  model: 'gemini-2.5-flash',          // Required. Model string
  description: 'What this agent does',// Optional but recommended for multi-agent

  // --- Instruction / System Prompt ---
  // Option 1: Static string with optional {state_var} placeholders
  instruction: `You are a helpful assistant. Current user: {user_name}.`,

  // Option 2: InstructionProvider function for dynamic/literal-brace instructions
  // instruction: (ctx: ReadonlyContext): string => {
  //   const userName = ctx.state.get('user_name') ?? 'User';
  //   return `You are helping ${userName}. Use JSON like: {"key": "value"}.`;
  // },

  // --- Tools ---
  tools: [myFunctionTool],            // Array of BaseTool instances

  // --- Output ---
  outputKey: 'last_response',         // Optional: saves final text to session state

  // --- LLM generation tuning ---
  generateContentConfig: {
    temperature: 0.2,
    maxOutputTokens: 2048,
  } as GenerateContentConfig,
});
```

### Model strings for Gemini 2.5 Flash

The official model string used in examples is `'gemini-2.5-flash'`. Aliases also seen in docs:

- `'gemini-flash-latest'` — latest Flash model
- `'gemini-2.0-flash'` — Gemini 2.0 Flash specifically
- `'gemini-2.5-flash'` — Gemini 2.5 Flash specifically

Use the exact string as documented by the Gemini API or Vertex AI. The ADK passes it directly to the underlying `@google/genai` client.

### Instruction template syntax

When `instruction` is a **string**, ADK supports `{var}` placeholders that are injected from session state at runtime:

```typescript
const agent = new LlmAgent({
  name: 'story_agent',
  model: 'gemini-2.5-flash',
  instruction: 'Write a short story about a cat with theme: {topic}.',
  // At runtime, if session.state has { topic: 'friendship' },
  // the LLM receives: "Write a short story about a cat with theme: friendship."
});
```

Use `{topic?}` (with `?`) to avoid errors when the key may not exist in state.

If your instruction contains literal curly braces (e.g., JSON examples), use a function instead:

```typescript
import { ReadonlyContext } from '@google/adk';

const agent = new LlmAgent({
  name: 'json_agent',
  model: 'gemini-2.5-flash',
  instruction: (ctx: ReadonlyContext): string => {
    // Curly braces are NOT interpreted as state placeholders here
    return 'Output valid JSON like: {"status": "ok", "count": 42}';
  },
});
```

---

## Tool Definition — `FunctionTool`

### How tools work

In TypeScript ADK, you must **explicitly create a `FunctionTool` instance**. Python ADK can auto-wrap plain functions; TypeScript cannot — you must wrap them yourself.

Tools use **Zod schemas** to define parameters. The Zod schema is converted to a JSON Schema that the LLM reads to understand parameter names, types, and descriptions. The `.describe()` method on each field becomes the parameter description for the LLM.

### Basic `FunctionTool` pattern

```typescript
import { FunctionTool } from '@google/adk';
import { z } from 'zod';

// Step 1: Define the Zod parameter schema
const getCurrentTimeSchema = z.object({
  city: z.string().describe('The name of the city to get the current time for.'),
});

// Step 2: Write the execute function
async function getCurrentTime({ city }: { city: string }): Promise<Record<string, unknown>> {
  // Simulate a time lookup
  return { status: 'success', report: `The current time in ${city} is 10:30 AM` };
}

// Step 3: Create the FunctionTool instance
const getCurrentTimeTool = new FunctionTool({
  name: 'get_current_time',             // snake_case convention for tool names
  description: 'Returns the current time in a specified city.',
  parameters: getCurrentTimeSchema,      // The Zod schema
  execute: getCurrentTime,               // The function
});

// Step 4: Register with the agent
export const rootAgent = new LlmAgent({
  name: 'time_agent',
  model: 'gemini-2.5-flash',
  description: 'Tells the current time in a specified city.',
  instruction: `You are a helpful assistant. Use the 'get_current_time' tool when the user asks for the time in a city.`,
  tools: [getCurrentTimeTool],
});
```

### FunctionTool with optional parameters

Use Zod's `.optional()` or provide a default to make parameters optional:

```typescript
const searchSchema = z.object({
  query: z.string().describe('The search query.'),               // Required
  maxResults: z.number().optional().describe('Maximum results. Defaults to 10 if not provided.'),
});
```

### FunctionTool return values

Tools must return an **object** (not a primitive). The LLM reads the returned object to continue reasoning. Best practice is to include a `status` field:

```typescript
// Good: structured return with status
return { status: 'success', data: result };
return { status: 'error', message: 'City not found' };

// Acceptable but less informative
return { result: someValue };

// Bad: plain primitive (gets auto-wrapped as { result: ... } but loses context)
return "some string";  // avoid
```

### How the LLM sees tool descriptions

The LLM receives:
1. **Tool name** from `name` field
2. **Tool description** from `description` field  
3. **Parameter schema** generated from the Zod object (field names + `.describe()` values become the JSON Schema that the LLM reads)

There are no JSDoc comments or decorators involved in TypeScript ADK tool descriptions. Everything goes through the Zod schema and the explicit `description` field.

### Alternative: `createTool` helper (third-party `@iqai/adk`)

Note that `@iqai/adk` (a related but separate package) provides a `createTool` helper:

```typescript
// This is from @iqai/adk, NOT @google/adk
import { createTool } from '@iqai/adk';

const myTool = createTool({
  name: 'my_tool',
  description: 'Does something.',
  schema: z.object({ input: z.string() }),
  fn: ({ input }) => ({ result: input.toUpperCase() }),
});
```

**Stick to `@google/adk`'s `new FunctionTool({...})` pattern** for the official Google SDK.

---

## ToolContext and Session State in Tools

### The `ToolContext` / `Context` type

In TypeScript ADK, `CallbackContext` and `ToolContext` are unified into a **single `Context` type**. To receive it in a tool, declare it as the second parameter of the `execute` function:

```typescript
import { FunctionTool, ToolContext } from '@google/adk';
import { z } from 'zod';

const savePreferencesTool = new FunctionTool({
  name: 'save_preferences',
  description: 'Saves user preferences to session state.',
  parameters: z.object({
    theme: z.enum(['light', 'dark']).describe('The UI theme preference.'),
    language: z.string().describe('The preferred language code, e.g., "en" or "fr".'),
  }),
  execute: async (
    { theme, language }: { theme: 'light' | 'dark'; language: string },
    context: ToolContext     // <-- Second parameter: ADK injects this automatically
  ) => {
    // Write to session state
    context.state.set('user:theme', theme);
    context.state.set('user:language', language);
    return { status: 'success', message: 'Preferences saved.' };
  },
});

const getPreferencesTool = new FunctionTool({
  name: 'get_preferences',
  description: 'Retrieves stored user preferences from session state.',
  parameters: z.object({}),
  execute: async (_args, context: ToolContext) => {
    // Read from session state
    const theme = context.state.get('user:theme');
    const language = context.state.get('user:language');
    return { status: 'success', theme, language };
  },
});
```

### State key API

```typescript
// Write
context.state.set('key', value);
context.state.set('user:preference', 'dark');
context.state.set('temp:intermediate_result', { data: 42 });

// Read
const value = context.state.get('key');
const withDefault = context.state.get('key') ?? 'default_value';
```

### State key prefix scoping

| Prefix | Scope | Persistence |
|--------|-------|-------------|
| (none) | Current session only | Only with `DatabaseSessionService` or `VertexAiSessionService` |
| `user:` | All sessions for this `userId` (same `appName`) | Persistent with Database/VertexAI |
| `app:` | All users and sessions for this `appName` | Persistent with Database/VertexAI |
| `temp:` | Current invocation only (discarded after response) | Never persisted |

**Examples:**

```typescript
context.state.set('current_step', 'collect_address');          // session-scoped
context.state.set('user:preferred_language', 'fr');            // user-scoped
context.state.set('app:global_discount_code', 'SAVE10');       // app-scoped
context.state.set('temp:raw_api_response', responseData);      // invocation-only
```

### State in `InstructionProvider` (read-only)

When building dynamic instructions via a function, use `ReadonlyContext`:

```typescript
import { ReadonlyContext } from '@google/adk';

const agent = new LlmAgent({
  name: 'adaptive_agent',
  model: 'gemini-2.5-flash',
  instruction: (ctx: ReadonlyContext): string => {
    const userName = ctx.state.get('user:name') ?? 'User';
    const sessionCount = ctx.state.get('session_count') ?? 0;
    // ctx.state is read-only here — calling ctx.state.set() would throw
    return `You are helping ${userName}. This is session #${Number(sessionCount) + 1}.`;
  },
});
```

### Saving agent output to state (`outputKey`)

To automatically save the agent's final text response into session state, use `outputKey`:

```typescript
const agent = new LlmAgent({
  name: 'summarizer',
  model: 'gemini-2.5-flash',
  instruction: 'Summarize the user input concisely.',
  outputKey: 'summary',   // Saves the LLM text response to state['summary']
});
```

---

## Long-Running Function Tools (Human-in-the-Loop)

In Python ADK, `require_confirmation` is a wrapper pattern. In TypeScript ADK, the equivalent is `LongRunningFunctionTool`. This pauses the agent run after the tool fires and waits for the client to send back a response before continuing.

```typescript
import { LongRunningFunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

// Define the long-running function
function askForApproval({ purpose, amount }: { purpose: string; amount: number }) {
  // In a real app: create a ticket, send a notification, etc.
  return {
    status: 'pending',
    approver: 'manager@company.com',
    purpose,
    amount,
    ticketId: 'approval-ticket-1',
  };
}

// Wrap with LongRunningFunctionTool
const approvalTool = new LongRunningFunctionTool({
  name: 'ask_for_approval',
  description: 'Requests human approval before processing a reimbursement.',
  parameters: z.object({
    purpose: z.string().describe('The purpose of the reimbursement request.'),
    amount: z.number().describe('The amount in USD to reimburse.'),
  }),
  execute: askForApproval,
});

export const rootAgent = new LlmAgent({
  name: 'reimbursement_agent',
  model: 'gemini-2.5-flash',
  description: 'Processes reimbursement requests with human approval.',
  instruction: `You process reimbursement requests. Always use 'ask_for_approval' before issuing a reimbursement.`,
  tools: [approvalTool],
});
```

**How it works:**
1. LLM calls `ask_for_approval` with arguments
2. The function returns its initial result (e.g., ticket ID, pending status)
3. The agent runner **pauses** and returns control to the client
4. The client polls for approval or sends an intermediate/final response back
5. The agent resumes with the approval result and continues reasoning

This is the TypeScript equivalent of Python's `require_confirmation` pattern.

---

## Running the Agent

### Dev UI (web interface)

```bash
# From the parent directory of your agent folder:
npx adk web
```

Opens `http://localhost:8000`. Select your agent from the dropdown in the top-right corner.

**Important:** Run `npx adk web` from the **parent folder** of your agent's folder. If your agent is at `my-agent/agent.ts`, run from the directory containing `my-agent/`.

### CLI mode

```bash
# Run a specific agent file directly:
npx adk run agent.ts

# Or if inside a parent directory:
npx adk run my-agent/agent.ts
```

### Programmatic runner

```typescript
import { InMemoryRunner, LlmAgent } from '@google/adk';
import { createUserContent, stringifyContent } from '@google/genai';

const agent = new LlmAgent({ /* ... */ });

// InMemoryRunner uses in-memory session service (no persistence)
const runner = new InMemoryRunner({ agent });

// Create a session
const session = await runner.sessionService.createSession({
  appName: runner.appName,
  userId: 'user-123',
});

// Send a message and stream events
const userMessage = createUserContent('What time is it in Tokyo?');

for await (const event of runner.runAsync({
  userId: session.userId,
  sessionId: session.id,
  newMessage: userMessage,
})) {
  if (event.content?.parts?.length) {
    console.log(stringifyContent(event));
  }
}
```

---

## Complete Agent Example

This is a complete, runnable `agent.ts` demonstrating all major patterns:

```typescript
import 'dotenv/config';                              // Auto-loads .env file
import { FunctionTool, LlmAgent, ToolContext } from '@google/adk';
import { z } from 'zod';

// --- Tool 1: Stateless lookup ---
const getCapitalCityTool = new FunctionTool({
  name: 'get_capital_city',
  description: 'Returns the capital city for a given country name.',
  parameters: z.object({
    country: z.string().describe('The name of the country.'),
  }),
  execute: async ({ country }: { country: string }) => {
    const capitals: Record<string, string> = {
      france: 'Paris',
      japan: 'Tokyo',
      canada: 'Ottawa',
      germany: 'Berlin',
    };
    const capital = capitals[country.toLowerCase()];
    if (capital) {
      return { status: 'success', capital };
    }
    return { status: 'not_found', message: `No capital found for "${country}"` };
  },
});

// --- Tool 2: Uses session state ---
const saveUserPreferenceTool = new FunctionTool({
  name: 'save_user_preference',
  description: 'Saves a user preference (key/value) to the current session.',
  parameters: z.object({
    key: z.string().describe('The preference key, e.g., "units" or "language".'),
    value: z.string().describe('The value to save for that preference.'),
  }),
  execute: async (
    { key, value }: { key: string; value: string },
    context: ToolContext
  ) => {
    context.state.set(`user:pref_${key}`, value);
    return { status: 'saved', key, value };
  },
});

// --- Tool 3: Reads from session state ---
const getUserPreferenceTool = new FunctionTool({
  name: 'get_user_preference',
  description: 'Retrieves a previously saved user preference from the current session.',
  parameters: z.object({
    key: z.string().describe('The preference key to look up.'),
  }),
  execute: async (
    { key }: { key: string },
    context: ToolContext
  ) => {
    const value = context.state.get(`user:pref_${key}`);
    if (value !== undefined && value !== null) {
      return { status: 'found', key, value };
    }
    return { status: 'not_found', message: `No preference found for key "${key}"` };
  },
});

// --- Agent definition ---
export const rootAgent = new LlmAgent({
  name: 'capital_and_prefs_agent',
  model: 'gemini-2.5-flash',
  description: 'Helps users look up capital cities and manage personal preferences.',
  instruction: `You are a helpful assistant with two capabilities:
1. Look up the capital city of any country using the 'get_capital_city' tool.
2. Save and retrieve user preferences using 'save_user_preference' and 'get_user_preference'.

When the user mentions a preference (like preferred units or language), save it.
Always confirm when you have saved a preference.`,
  tools: [getCapitalCityTool, saveUserPreferenceTool, getUserPreferenceTool],
});
```

---

## Session Service Options

### `InMemoryRunner` (development only)

```typescript
import { InMemoryRunner } from '@google/adk';

const runner = new InMemoryRunner({ agent: rootAgent });
// Sessions are not persisted; data is lost on process restart.
```

### `InMemorySessionService` (manual setup)

```typescript
import { LlmAgent, InMemorySessionService } from '@google/adk';

const sessionService = new InMemorySessionService();

const agent = new LlmAgent({
  name: 'my_agent',
  model: 'gemini-2.5-flash',
  description: '...',
  instruction: '...',
});
```

### `VertexAiSessionService` (production)

```typescript
import { VertexAiSessionService, LlmAgent } from '@google/adk';

const sessionService = new VertexAiSessionService({
  project: 'my-gcp-project',
  location: 'us-central1',
  agentEngineId: 'my-reasoning-engine-id',
});

const agent = new LlmAgent({
  name: 'production_agent',
  model: 'gemini-2.5-flash',
  description: '...',
  instruction: '...',
  // Pass session service directly to agent constructor
  sessionService,
  userId: 'user-123',
  appName: 'my-production-app',
});
```

---

## Configuration — `.env` File

ADK devtools (`npx adk web`, `npx adk run`) automatically look for a `.env` file in the working directory. In programmatic usage, add `import 'dotenv/config';` at the top of `agent.ts`.

```env
# Required for Google AI Studio (Gemini API)
GOOGLE_GENAI_USE_VERTEXAI=FALSE
GOOGLE_GENAI_API_KEY=your-api-key-here

# Required for Vertex AI instead
# GOOGLE_GENAI_USE_VERTEXAI=TRUE
# GOOGLE_CLOUD_PROJECT=your-project-id
# GOOGLE_CLOUD_LOCATION=us-central1
```

---

## Known Issues and Production Considerations

### ESM / CommonJS conflict (important)

The currently shipped `@google/adk` package has a known bug: the CommonJS build incorrectly imports `lodash-es` (ESM-only) instead of `lodash` (CJS). This breaks standard builds on modern TypeScript ESM projects.

**Workaround (pnpm patch):**
1. Run `pnpm patch @google/adk`
2. In the temp directory's `package.json`, add `"lodash": "^4.17.22"` alongside the existing `"lodash-es"` entry
3. In `dist/cjs/index.js`, replace all `'lodash-es'` with `'lodash'`
4. Run `pnpm patch-commit <path-to-temp-dir>`

This is confirmed as of April 2026 (package version used in production validation). Check the npm page for any updates.

### In-memory sessions (not for production)

`InMemorySessionService` and `InMemoryRunner` lose all state on process restart. For production, implement a custom `SessionService` backed by PostgreSQL, Redis, or use `VertexAiSessionService`.

### TypeScript documentation gap

The TypeScript ADK documentation is less comprehensive than the Python documentation. Some APIs (e.g., `ToolContext` full API surface, all `LlmAgent` constructor options) are not fully documented. When in doubt, check the source code in `node_modules/@google/adk/dist/` or the `adk-js` GitHub repo.

---

## Import Reference

All production imports come from `'@google/adk'`:

```typescript
import {
  LlmAgent,           // The main agent class
  FunctionTool,       // Wrap functions as tools
  LongRunningFunctionTool, // For human-in-the-loop / long-running tools
  InMemoryRunner,     // Quick runner for development
  InMemorySessionService, // In-memory session storage
  VertexAiSessionService, // Vertex AI session storage (production)
  ReadonlyContext,    // Type for InstructionProvider functions (read-only state)
  ToolContext,        // Type for tool execute functions (read/write state)
  BaseAgent,          // Base class for custom agent implementations
  InvocationContext,  // Advanced: passed to custom agent runAsyncImpl
} from '@google/adk';

// For creating user messages:
import { createUserContent, stringifyContent } from '@google/genai';

// For LLM generation config:
import { GenerateContentConfig } from '@google/genai';

// For Zod parameter schemas:
import { z } from 'zod';
```

---

## Comparison: Python vs TypeScript ADK

| Feature | Python ADK | TypeScript ADK |
|---------|-----------|----------------|
| Entry point | `__init__.py` with `root_agent = LlmAgent(...)` | `agent.ts` with `export const rootAgent = new LlmAgent(...)` |
| Tool definition | Plain `def` function; docstring = description | `new FunctionTool({ name, description, parameters: ZodSchema, execute })` |
| Parameter schema | Type hints + docstring args section | Zod `z.object()` with `.describe()` |
| Tool registration | `tools=[my_function]` (auto-wraps) | `tools: [myFunctionTool]` (must be `FunctionTool` instance) |
| Session state read | `tool_context.state["key"]` | `context.state.get("key")` |
| Session state write | `tool_context.state["key"] = value` | `context.state.set("key", value)` |
| Instruction provider | `def fn(ctx: ReadonlyContext) -> str:` | `(ctx: ReadonlyContext): string => { ... }` |
| Env variable | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `GOOGLE_GENAI_API_KEY` |
| Dev UI | `adk web` | `npx adk web` |
| CLI run | `adk run` | `npx adk run agent.ts` |
| Human-in-loop | `require_confirmation` decorator OR `LongRunningFunctionTool` | `LongRunningFunctionTool` only |
| ToolContext + CallbackContext | Separate types | Unified as single `Context` type |

---

## Assumptions and Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `GOOGLE_GENAI_API_KEY` is the correct env var name (not `GEMINI_API_KEY`) | HIGH | Agent won't authenticate; change the .env key |
| `ToolContext` is the correct import name for the second param of `execute` | HIGH | Minimal — type mismatch error at compile time, easy to fix |
| `rootAgent` (camelCase) is the required export name for `adk web` discovery | HIGH | Agent won't appear in the web UI dropdown |
| `require_confirmation` does not exist in TypeScript ADK; `LongRunningFunctionTool` is the equivalent | MEDIUM | There may be a `requireConfirmation` parameter not yet documented |
| The ESM/CJS `lodash-es` bug is still present as of April 2026 | MEDIUM | Bug may have been fixed in a newer release; check npm first |
| `@iqai/adk`'s `createTool` helper is NOT from `@google/adk` | HIGH | Mixing packages would cause import errors |

### What is Explicitly Out of Scope

- Multi-agent orchestration (`SequentialAgent`, `ParallelAgent`)
- Agent-as-tool patterns (`AgentTool`)
- MCP (Model Context Protocol) tool integration
- Memory service configuration
- Artifact service (file handling)
- Authentication / OAuth within tools
- Streaming / live mode
- Deployment to Google Cloud Run or Vertex AI Agent Engine

### Uncertainties and Gaps

- **`require_confirmation` equivalent:** The Python ADK `require_confirmation` wrapper is documented but no direct TypeScript equivalent with that name was found. `LongRunningFunctionTool` covers the human-in-the-loop use case but may have different semantics. Verification needed against the source code.
- **Full `ToolContext` API surface:** Only `state.get()`, `state.set()`, `functionCallId`, and `actions` (`EventActions`) are confirmed documented properties. Other properties may exist.
- **`adk web` root agent discovery:** It is confirmed that `rootAgent` (camelCase) is the expected export name. Whether `root_agent` (snake_case) is also accepted is undocumented.
- **`npx adk web` behavior with multiple agents in one folder:** The dropdown in the UI presumably lists all agent files, but the exact discovery logic is not documented.

---

## Clarifying Questions for Follow-up

1. Does Python's `require_confirmation` decorator have a direct TypeScript equivalent, or is `LongRunningFunctionTool` the only path for human-in-the-loop confirmation?
2. What is the full API surface of `ToolContext` in TypeScript — specifically, which `EventActions` can be triggered from a tool (e.g., transfer to another agent)?
3. Is there a TypeScript equivalent of the Python `after_agent_callback` / `before_model_callback` callback system?
4. Can `npx adk web` discover agents in subfolders automatically, or must it always point to the parent of the agent folder?
5. Has the ESM/CommonJS `lodash-es` bug been fixed in recent releases of `@google/adk`?

---

## References

See the [Sources section](#sources-collected) at the bottom of this document for full source details.

---

*Research compiled on 2026-04-10 using official Google ADK docs, the `@google/adk` npm package, and the `google/adk-js` GitHub repository.*
