# Google ADK TypeScript/JavaScript Options

**Research Date:** 2026-04-10
**Status:** Complete

---

## Overview

This document answers the question: does Google ADK support TypeScript/JavaScript, and how does it relate to other Google AI frameworks like Genkit? The short answer is: **yes, Google publishes an official TypeScript ADK SDK**, and it has been available since December 2025.

---

## 1. Official TypeScript/JavaScript SDK

### npm Package: `@google/adk`

There is an **official** npm package published by Google at `@google/adk`.

- **Publisher:** Google (`google-wombot`, Google's automated npm publisher)
- **License:** Apache-2.0
- **Latest version (as of 2026-04-10):** `0.6.1`
- **Repository:** `https://github.com/google/adk-js`
- **npm URL:** `https://www.npmjs.com/package/@google/adk`

Installation:

```bash
npm install @google/adk
```

The package ships in three formats:

| Format | Entry Point |
|--------|------------|
| ESM | `./dist/esm/index.js` |
| CommonJS | `./dist/cjs/index.js` |
| Web (browser) | `./dist/web/index_web.js` |
| TypeScript types | `./dist/types/index.d.ts` |

Key peer dependencies (as of v0.6.1):

- `@google/genai` ^1.37.0
- `@modelcontextprotocol/sdk` ^1.26.0
- `@opentelemetry/api` 1.9.0
- `@a2a-js/sdk` ^0.3.10
- `express` ^4.22.1
- `zod` ^4.2.1

### Companion Dev Tools Package: `@google/adk-devtools`

A second official package, `@google/adk-devtools`, provides the development CLI and web UI:

- **Latest version (as of 2026-04-10):** `0.6.1`
- **Binary exposed:** `adk` (CLI)

```bash
npm install -D @google/adk-devtools
```

This provides:
- `npx adk run agent.ts` — interactive command-line interface with the agent
- `npx adk web` — launches the ADK Web development UI at `http://localhost:8000`

---

## 2. GitHub Repository: `google/adk-js`

The official TypeScript ADK lives at `https://github.com/google/adk-js`.

**Not** `adk-node` or `adk-typescript` — the canonical Google repository name is `adk-js`.

Key facts from the repository:

- Language: TypeScript
- Build system: `esbuild` for bundling, `tsc` for type declarations
- Test framework: `vitest`
- Announced: December 17, 2025 on the Google Developers Blog

The repository links to the following related official repos:
- `google/adk-python` — Python ADK
- `google/adk-java` — Java ADK
- `google/adk-go` — Go ADK
- `google/adk-web` — The web dev UI (Angular app, shared across languages)
- `google/adk-samples` — Code samples for all languages
- `google/adk-docs` — Documentation source

---

## 3. Official Language Support

As of April 2026, ADK is officially supported in **four languages**:

| Language | Status | Package/Artifact | Repository |
|----------|--------|-----------------|------------|
| Python | GA | `google-adk` (PyPI) | `github.com/google/adk-python` |
| TypeScript/JS | GA (released Dec 2025) | `@google/adk` (npm) | `github.com/google/adk-js` |
| Java | GA | `com.google.adk:google-adk` (Maven) | `github.com/google/adk-java` |
| Go | Available | `google.golang.org/adk` | `github.com/google/adk-go` |

The official ADK documentation at `https://google.github.io/adk-docs/` lists quickstart guides for all four languages.

---

## 4. TypeScript Quickstart Summary

From the official docs at `https://google.github.io/adk-docs/get-started/typescript/`:

**Requirements:** Node.js 24.13.0+, npm 11.8.0+

```bash
mkdir my-agent && cd my-agent
npm init --yes
npm pkg set type="module"
npm pkg set main="agent.ts"
npm install @google/adk
npm install -D @google/adk-devtools
```

**Basic agent definition (agent.ts):**

```typescript
import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

const getCurrentTime = new FunctionTool({
  name: 'get_current_time',
  description: 'Returns the current time in a specified city.',
  parameters: z.object({
    city: z.string().describe("The name of the city for which to retrieve the current time."),
  }),
  execute: ({ city }) => {
    return { status: 'success', report: `The current time in ${city} is 10:30 AM` };
  },
});

export const rootAgent = new LlmAgent({
  name: 'hello_time_agent',
  model: 'gemini-flash-latest',
  description: 'Tells the current time in a specified city.',
  instruction: `You are a helpful assistant that tells the current time in a city.
                Use the 'getCurrentTime' tool for this purpose.`,
  tools: [getCurrentTime],
});
```

**Configuration — API key:**

```bash
echo 'GEMINI_API_KEY="YOUR_API_KEY"' > .env
```

**Running:**

```bash
# CLI mode
npx adk run agent.ts

# Web UI mode
npx adk web
```

---

## 5. ADK Web UI (`adk web`) with TypeScript

The `npx adk web` command (from `@google/adk-devtools`) starts a web server at `http://localhost:8000` with a visual chat interface. This is the **TypeScript-native equivalent** of `adk web` in Python — it does NOT require Python to be installed.

The ADK web repository (`github.com/google/adk-web`) is an **Angular-based frontend** that can connect to backends written in any supported ADK language (Python, TypeScript, Java, Go). The `@google/adk-devtools` package bundles a pre-built version of this UI.

**Important:** ADK Web is explicitly documented as a development-only tool, not for production deployment.

The Python `adk web` command and the TypeScript `npx adk web` command both serve the same Angular frontend — the difference is only in the backend process that serves the agent.

---

## 6. Community Ports and Alternatives

### Unofficial TypeScript Port: `adk-typescript`

Before the official `@google/adk` was released, a community developer (GitHub: `njraladdin`) created an unofficial TypeScript port:

- **npm package:** `adk-typescript`
- **GitHub:** `https://github.com/njraladdin/adk-typescript`
- **Status:** Alpha — explicitly marked as unofficial

This port predates the official release and mirrors much of the Python ADK API surface. It includes its own CLI (`npx adk`), web UI (`npx adk web`), graph visualization, and evaluation tooling. It was useful historically but is now superseded by the official `@google/adk`.

**Recommendation:** Use the official `@google/adk` package, not the community port.

---

## 7. Google Genkit: The TypeScript Alternative Context

### What is Genkit?

Genkit is a **separate Google-backed open-source framework** for building AI-powered features in applications. It was created by the Firebase team and is available at:

- **npm:** `genkit` (core) + `@genkit-ai/google-genai` (Gemini plugin)
- **Docs:** `https://firebase.google.com/docs/genkit`
- **Dev UI:** Launched via `genkit-cli`

**Language support:** TypeScript (GA), Go (Beta), Python (Alpha)

### Is Genkit the TypeScript Equivalent of ADK?

**No.** Genkit and ADK are different frameworks with different purposes, though both support TypeScript. They are complementary, not competing:

| Dimension | ADK | Genkit |
|-----------|-----|--------|
| Primary purpose | Multi-agent orchestration systems | Embedding GenAI features into apps |
| Primary use cases | Complex autonomous multi-agent pipelines, enterprise agent systems | Chatbots, RAG, text/image generation, recommendations, lightweight agents |
| Architecture philosophy | Agent-first, event-driven state machine, multi-agent hierarchies | Flow-based, plugin ecosystem, flexible model adapters |
| Multi-agent focus | Core design principle; native sub-agent delegation, AgentTool | Secondary; possible but not the primary model |
| Deployment target | Anywhere; deepest integration with Vertex AI Agent Engine | Firebase, Cloud Run, any container |
| Model support | Gemini-first; LiteLLM adapters for others | Plugin system: Gemini, OpenAI, Claude, Ollama, etc. |
| Dev UI | `npx adk web` (or `adk web` in Python) | `genkit-cli` developer UI |

### ADK and Genkit Interoperability

As of April 2026, there is **no official integration plugin** between Genkit and ADK that allows Genkit to consume ADK tools or agents directly, or vice versa. They are separate frameworks.

However, both frameworks:
- Support MCP (Model Context Protocol) tools
- Support custom function tools via Zod schemas
- Can be deployed on the same infrastructure (Cloud Run, etc.)
- Work with the Gemini models via `@google/genai`

An agent built with ADK can expose an A2A (Agent-to-Agent protocol) endpoint, which theoretically allows any compatible client — including Genkit-based agents — to call it remotely. But this is not a native Genkit plugin integration.

### When to Choose Genkit vs ADK

**Choose ADK when:**
- You are building systems with multiple coordinating AI agents
- You need auditability, evaluation, and fine-grained control over agent execution
- You want the same framework used in Google's own products (Agentspace, Customer Engagement Suite)
- You are deploying to Vertex AI Agent Engine
- You need the full ADK ecosystem (Sessions, Memory, Artifacts, Planning, Code Execution)

**Choose Genkit when:**
- You are adding AI features to an existing web or mobile app
- You need broad, easy-to-swap model provider support
- You want a lightweight, flow-based programming model
- You are building Firebase-hosted applications
- You need fast prototyping with minimal boilerplate

---

## 8. The A2A Protocol: Cross-Language Interoperability

ADK (in all its language variants) integrates with Google's **A2A (Agent-to-Agent) protocol** at `https://github.com/google/A2A`. This protocol allows ADK agents written in different languages to communicate with each other remotely.

This means a Python ADK agent and a TypeScript ADK agent can work together in a multi-agent system via A2A, without sharing a process or language runtime.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `@google/adk` v0.6.1 is the current latest version | HIGH — verified from npm registry | Minor; version numbers change frequently |
| ADK TypeScript GA since December 2025 | HIGH — confirmed by Google Developers Blog post dated Dec 17, 2025 | None expected |
| Genkit and ADK have no official interop plugin | MEDIUM — no plugin found in Genkit docs or ADK docs, but ecosystem is evolving rapidly | A plugin may have been released after research date |
| The `adk-web` Angular frontend is shared across language backends | HIGH — confirmed from `github.com/google/adk-web` prerequisites | Minor |
| `adk-typescript` (community port by njraladdin) is superseded | HIGH — Google published official package in Dec 2025 | Low; community port may still have features not in official SDK |
| Node.js 24.13.0 is required minimum | HIGH — stated explicitly in official quickstart docs | Breaking if wrong; check current docs before project setup |

### What Was Explicitly Excluded

- Vertex AI Agent Builder (the managed cloud product) — this research focuses on the open-source ADK SDK
- LangChain, LangGraph, CrewAI integration with ADK (mentioned as possible but not detailed here)
- ADK Python-specific features that may not yet exist in TypeScript SDK
- Production deployment patterns (Cloud Run, Vertex AI Agent Engine configuration)

---

## Clarifying Questions for Follow-up

1. **Feature parity:** Is the TypeScript ADK at feature parity with the Python ADK? The Python version has been available since April 2025 while TypeScript shipped in December 2025 — are there missing features in the TypeScript SDK?

2. **Node.js version requirement:** The quickstart states Node.js 24.13.0+. Is this a hard requirement or can older LTS versions (20.x, 22.x) work?

3. **Genkit integration:** Is there a planned or existing Genkit plugin for consuming ADK agents, or a way to use ADK as a Genkit flow plugin?

4. **Streaming support:** The TypeScript `@google/adk` package — does it support the same bidirectional audio/video streaming as the Python SDK?

5. **Session persistence:** The Python ADK supports session persistence via `DatabaseSessionService`. Does the TypeScript SDK have equivalent database session storage (the npm dependencies list `@mikro-orm` packages which suggests yes)?

---

## References

| Source | URL | Information Gathered |
|--------|-----|---------------------|
| npm Registry - `@google/adk` | https://registry.npmjs.org/@google/adk | Confirmed official package, version history, dependencies, repository |
| npm Registry - `@google/adk-devtools` | https://registry.npmjs.org/@google/adk-devtools | Confirmed CLI binary, dev tools package, version 0.6.1 |
| GitHub: google/adk-js | https://github.com/google/adk-js | Official TypeScript ADK repository, README, feature list, links to ecosystem |
| GitHub: google/adk-go | https://github.com/google/adk-go | Confirmed Go ADK existence and official status |
| GitHub: google/adk-java | https://github.com/google/adk-java | Confirmed Java ADK (Maven: `com.google.adk:google-adk` v1.1.0) |
| GitHub: google/adk-web | https://github.com/google/adk-web | Angular-based dev UI, shared across all language ADKs |
| GitHub: njraladdin/adk-typescript | https://github.com/njraladdin/adk-typescript | Unofficial community port (alpha, pre-official SDK) |
| ADK Official Docs — Home | https://google.github.io/adk-docs/ | Confirmed 4 official languages: Python, TypeScript, Go, Java |
| ADK Official Docs — Get Started | https://google.github.io/adk-docs/get-started/ | Quickstart links for all 4 languages |
| ADK Official Docs — TypeScript Quickstart | https://google.github.io/adk-docs/get-started/typescript/ | Full TypeScript setup, code examples, Node.js version requirement |
| ADK Official Docs — Technical Overview | https://google.github.io/adk-docs/get-started/about/ | Core ADK concepts: Agents, Tools, Events, Sessions, Memory, Artifacts |
| Google Developers Blog — ADK TypeScript Announcement | https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/ | Official announcement dated Dec 17, 2025 |
| Firebase Genkit Docs — Home | https://firebase.google.com/docs/genkit | Genkit overview, language support, purpose |
| Firebase Genkit Docs — Get Started | https://firebase.google.com/docs/genkit/get-started | TypeScript quickstart, npm packages, Developer UI |
| Web Search — Genkit vs ADK | (Web Search) | Summary of differences, use cases, complementary nature |
| Web Search — ADK-JS Web UI | (Web Search) | Confirmed `npx adk web`, `@google/adk-devtools` dev tools |

### Recommended for Deep Reading

- **ADK TypeScript Quickstart** (`https://google.github.io/adk-docs/get-started/typescript/`): The authoritative starting point for any TypeScript ADK project.
- **Google Developers Blog — ADK TypeScript Announcement** (`https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/`): Explains the motivation, philosophy, and key differentiators.
- **GitHub: google/adk-js** (`https://github.com/google/adk-js`): Source of truth for current features, examples, and contribution information.
- **Genkit vs ADK — Medium** (`https://medium.com/firebase-developers/genkit-vs-agent-development-kit-adk-choosing-the-right-google-backed-ai-framework-1744b73234ac`): Practical comparison from a Firebase Developer Advocate.
