import { useState } from 'react'
import type { EventEntry, EventType } from '@shared/types'
import { CollapsibleSection } from './CollapsibleSection'
import { JsonViewer } from './JsonViewer'

interface EventCardProps {
  event: EventEntry
  relativeMs: number
}

const EVENT_LABELS: Record<EventType, string> = {
  interaction_start: 'START',
  llm_request: 'LLM REQ',
  llm_response: 'LLM RES',
  tool_start: 'TOOL',
  tool_result: 'RESULT',
  tool_error: 'TOOL ERR',
  llm_error: 'LLM ERR',
  interaction_end: 'END',
  // LangGraph events
  llm_call_start: 'LLM CALL',
  llm_call_end: 'LLM DONE',
  tool_call_start: 'TOOL CALL',
  tool_call_end: 'TOOL DONE',
  turn_summary: 'SUMMARY',
}

const EVENT_DOT_COLORS: Record<EventType, string> = {
  interaction_start: 'var(--event-start)',
  llm_request: 'var(--event-llm-req)',
  llm_response: 'var(--event-llm-res)',
  tool_start: 'var(--event-tool)',
  tool_result: 'var(--event-result)',
  tool_error: 'var(--event-error)',
  llm_error: 'var(--event-error)',
  interaction_end: 'var(--event-end)',
  // LangGraph events
  llm_call_start: 'var(--event-llm-req)',
  llm_call_end: 'var(--event-llm-res)',
  tool_call_start: 'var(--event-tool)',
  tool_call_end: 'var(--event-result)',
  turn_summary: 'var(--event-end)',
}

function formatRelativeMs(ms: number): string {
  if (ms < 1000) return `+${ms}ms`
  return `+${(ms / 1000).toFixed(1)}s`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── Payload renderers ──

function InteractionStartBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  return (
    <div className="event-card-body">
      <div className="event-section">
        <div className="event-section-label">Session ID</div>
        <div className="event-section-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {String(payload.sessionId ?? '')}
        </div>
      </div>
      <div className="event-section">
        <div className="event-section-label">User Message</div>
        <div className="event-text-preview selectable">{String(payload.userMessage ?? '')}</div>
      </div>
    </div>
  )
}

function LlmRequestBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const model = String(payload.model ?? '')
  const contentsCount = payload.contentsCount as number | undefined
  const toolNames = (payload.toolNames ?? []) as string[]
  const systemText = payload.systemInstructionText as string | undefined
  const toolDeclarations = payload.toolDeclarations as unknown | undefined
  const contents = payload.contents as unknown[] | undefined
  const generationConfig = payload.generationConfig as unknown | undefined

  return (
    <div className="event-card-body">
      <div className="event-section">
        <div className="event-section-label">Model</div>
        <div className="event-model-name">{model}</div>
      </div>

      {contentsCount !== undefined && (
        <div className="event-section">
          <CollapsibleSection title="Conversation Contents" badge={`${contentsCount} items`}>
            {contents && Array.isArray(contents) ? (
              <div>
                {contents.map((item: any, idx: number) => {
                  const role = item?.role ?? 'unknown'
                  const parts = item?.parts ?? []
                  const text = parts.map((p: any) => {
                    if (p.text) return p.text
                    if (p.functionCall) return `[functionCall: ${p.functionCall.name}]`
                    if (p.functionResponse) return `[functionResponse: ${p.functionResponse.name}]`
                    return '[unknown part]'
                  }).join('\n')

                  return (
                    <div key={idx} className={`chat-bubble role-${role}`}>
                      <div className="chat-bubble-role">{role}</div>
                      {text}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-dim)' }}>No contents data</div>
            )}
          </CollapsibleSection>
        </div>
      )}

      {systemText && (
        <div className="event-section">
          <CollapsibleSection title="System Instruction" badge={`${systemText.length} chars`}>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 300,
              overflowY: 'auto',
              color: 'var(--text-secondary)',
            }} className="selectable">
              {systemText}
            </pre>
          </CollapsibleSection>
        </div>
      )}

      {toolNames.length > 0 && (
        <div className="event-section">
          <div className="event-section-label">Tools ({toolNames.length})</div>
          <div className="tool-chip-list">
            {toolNames.map(name => (
              <span key={name} className="tool-chip">{name}</span>
            ))}
          </div>
        </div>
      )}

      {toolDeclarations && (
        <div className="event-section">
          <CollapsibleSection title="Tool Declarations">
            <JsonViewer data={toolDeclarations} />
          </CollapsibleSection>
        </div>
      )}

      {generationConfig && (
        <div className="event-section">
          <CollapsibleSection title="Generation Config">
            <JsonViewer data={generationConfig} />
          </CollapsibleSection>
        </div>
      )}
    </div>
  )
}

function LlmResponseBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const content = payload.content as any
  const usage = payload.usageMetadata as any
  const durationMs = payload.durationMs as number | undefined
  const streamed = payload.streamed as boolean | undefined
  const chunkCount = payload.chunkCount as number | undefined
  const finishReason = payload.finishReason as string | undefined

  // Extract text or function call from content
  let responseText = ''
  let functionCall: { name: string; args: unknown } | null = null
  if (content?.parts) {
    for (const part of content.parts) {
      if (part.text) responseText += part.text
      if (part.functionCall) functionCall = part.functionCall
    }
  }

  return (
    <div className="event-card-body">
      {functionCall && (
        <div className="event-section">
          <div className="event-section-label">Function Call</div>
          <div className="event-tool-name">{functionCall.name}</div>
          {functionCall.args && Object.keys(functionCall.args as object).length > 0 && (
            <div style={{ marginTop: 4 }}>
              <JsonViewer data={functionCall.args} label="Arguments" />
            </div>
          )}
        </div>
      )}

      {responseText && (
        <div className="event-section">
          <div className="event-section-label">Response</div>
          <div className="event-text-preview selectable">{responseText}</div>
        </div>
      )}

      {usage && (
        <div className="event-section">
          <div className="event-section-label">Tokens</div>
          <div className="token-summary">
            <span className="token-badge">
              <span className="token-badge-label">prompt</span>
              <span className="token-badge-value">{formatTokens(usage.promptTokenCount ?? 0)}</span>
            </span>
            <span className="token-badge">
              <span className="token-badge-label">completion</span>
              <span className="token-badge-value">{formatTokens(usage.candidatesTokenCount ?? 0)}</span>
            </span>
            <span className="token-badge">
              <span className="token-badge-label">total</span>
              <span className="token-badge-value">{formatTokens(usage.totalTokenCount ?? 0)}</span>
            </span>
          </div>
        </div>
      )}

      <div className="event-section">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {durationMs !== undefined && <span className="duration-text">{formatDuration(durationMs)}</span>}
          {streamed !== undefined && (
            <span className="streaming-info">
              {streamed ? `Streamed (${chunkCount ?? '?'} chunks)` : 'Not streamed'}
            </span>
          )}
          {finishReason && <span className="streaming-info">Finish: {finishReason}</span>}
        </div>
      </div>
    </div>
  )
}

function ToolStartBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  return (
    <div className="event-card-body">
      <div className="event-section">
        <div className="event-section-label">Tool</div>
        <div className="event-tool-name">{String(payload.toolName ?? '')}</div>
      </div>
      {payload.functionCallId && (
        <div className="event-section">
          <div className="event-section-label">Function Call ID</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
            {String(payload.functionCallId)}
          </div>
        </div>
      )}
      {payload.args && (
        <div className="event-section">
          <CollapsibleSection title="Arguments" defaultOpen>
            <JsonViewer data={payload.args} />
          </CollapsibleSection>
        </div>
      )}
    </div>
  )
}

function ToolResultBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const resultKeys = (payload.resultKeys ?? []) as string[]
  return (
    <div className="event-card-body">
      <div className="event-section">
        <div className="event-section-label">Tool</div>
        <div className="event-tool-name">{String(payload.toolName ?? '')}</div>
      </div>
      {payload.durationMs !== undefined && (
        <div className="event-section">
          <div className="event-section-label">Duration</div>
          <span className="duration-text">{formatDuration(payload.durationMs as number)}</span>
        </div>
      )}
      {resultKeys.length > 0 && (
        <div className="event-section">
          <div className="event-section-label">Result Keys</div>
          <ul style={{ paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
            {resultKeys.map(k => <li key={k}>{k}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function ErrorBody({ payload, type }: { payload: Record<string, unknown>; type: 'tool' | 'llm' }): JSX.Element {
  const message = String(payload.errorMessage ?? payload.error ?? 'Unknown error')
  const code = payload.errorCode as string | undefined
  return (
    <div className="event-card-body">
      {type === 'tool' && payload.toolName && (
        <div className="event-section">
          <div className="event-section-label">Tool</div>
          <div className="event-tool-name">{String(payload.toolName)}</div>
        </div>
      )}
      {code && (
        <div className="event-section">
          <div className="event-section-label">Error Code</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--error)' }}>{code}</div>
        </div>
      )}
      <div className="event-section">
        <div className="event-error-message">{message}</div>
      </div>
    </div>
  )
}

function InteractionEndBody({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const rtCount = payload.roundTripCount as number | undefined
  const totalTokens = payload.totalTokens as number | undefined
  const promptTokens = payload.totalPromptTokens as number | undefined
  const completionTokens = payload.totalCompletionTokens as number | undefined
  const durationMs = payload.durationMs as number | undefined
  const toolCalls = (payload.toolCalls ?? []) as string[]

  return (
    <div className="event-card-body">
      <div className="end-summary-grid">
        {rtCount !== undefined && (
          <div className="end-summary-item">
            <div className="end-summary-item-label">Round Trips</div>
            <div className="end-summary-item-value">{rtCount}</div>
          </div>
        )}
        {totalTokens !== undefined && (
          <div className="end-summary-item">
            <div className="end-summary-item-label">Total Tokens</div>
            <div className="end-summary-item-value">{formatTokens(totalTokens)}</div>
          </div>
        )}
        {durationMs !== undefined && (
          <div className="end-summary-item">
            <div className="end-summary-item-label">Duration</div>
            <div className="end-summary-item-value">{formatDuration(durationMs)}</div>
          </div>
        )}
      </div>

      {(promptTokens !== undefined || completionTokens !== undefined) && (
        <div className="event-section" style={{ marginTop: 'var(--spacing-sm)' }}>
          <div className="token-summary">
            <span className="token-badge">
              <span className="token-badge-label">prompt</span>
              <span className="token-badge-value">{formatTokens(promptTokens ?? 0)}</span>
            </span>
            <span className="token-badge">
              <span className="token-badge-label">completion</span>
              <span className="token-badge-value">{formatTokens(completionTokens ?? 0)}</span>
            </span>
          </div>
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="event-section" style={{ marginTop: 'var(--spacing-sm)' }}>
          <div className="event-section-label">Tool Calls</div>
          <div className="tool-chip-list">
            {toolCalls.map((name, i) => (
              <span key={`${name}-${i}`} className="tool-chip">{name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main EventCard ──

function extractTextContent(payload: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, val] of Object.entries(payload)) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string') {
      lines.push(`${key}: ${val}`)
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      lines.push(`${key}: ${String(val)}`)
    } else if (Array.isArray(val)) {
      lines.push(`${key}: [${val.length} items]`)
      for (const item of val) {
        if (typeof item === 'string') lines.push(`  - ${item}`)
        else if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>
          // Common shapes: messages with role/content, tool calls with name
          if (obj.role && obj.content) lines.push(`  [${String(obj.role)}] ${String(obj.content).slice(0, 500)}`)
          else if (obj.name || obj.toolName) lines.push(`  - ${String(obj.name ?? obj.toolName)}`)
          else lines.push(`  - ${JSON.stringify(item).slice(0, 200)}`)
        }
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(val).slice(0, 300)}`)
    }
  }
  return lines.join('\n')
}

export function EventCard({ event, relativeMs }: EventCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [rawMode, setRawMode] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const dotColor = EVENT_DOT_COLORS[event.event]
  const label = EVENT_LABELS[event.event]
  const toolName =
    event.event === 'tool_start' || event.event === 'tool_result' || event.event === 'tool_error'
      || event.event === 'tool_call_start' || event.event === 'tool_call_end'
      ? String(event.payload.toolName ?? '')
      : ''
  const eventDuration = event.payload.durationMs as number | undefined
    ?? event.payload.latencyMs as number | undefined

  const showCopyFeedback = (msg: string) => {
    setCopyFeedback(msg)
    setTimeout(() => setCopyFeedback(null), 1500)
  }

  const copyJson = (e: React.MouseEvent) => {
    e.stopPropagation()
    const json = JSON.stringify(event.payload, null, 2)
    navigator.clipboard.writeText(json).then(
      () => showCopyFeedback('JSON copied'),
      () => showCopyFeedback('Copy failed')
    )
  }

  const copyText = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = extractTextContent(event.payload)
    navigator.clipboard.writeText(text).then(
      () => showCopyFeedback('Text copied'),
      () => showCopyFeedback('Copy failed')
    )
  }

  return (
    <div className="event-card">
      <div className="event-card-dot" style={{ background: dotColor }} />

      <div className="event-card-header" onClick={() => setExpanded(e => !e)}>
        <span className={`event-type-badge ${event.event}`}>{label}</span>
        <span className="event-card-timestamp">{formatRelativeMs(relativeMs)}</span>
        {event.roundTrip !== undefined && (
          <span className="event-card-rt">RT{event.roundTrip}</span>
        )}
        {toolName && <span className="event-card-info">{toolName}</span>}
        {eventDuration !== undefined && (
          <span className="event-card-info">{formatDuration(eventDuration)}</span>
        )}
        {expanded && (
          <div className="event-card-actions" onClick={e => e.stopPropagation()}>
            {copyFeedback && <span className="copy-feedback">{copyFeedback}</span>}
            <button className="raw-toggle-btn" onClick={copyJson} title="Copy payload as JSON">
              CP JSON
            </button>
            <button className="raw-toggle-btn" onClick={copyText} title="Copy payload as text">
              CP TEXT
            </button>
            <button
              className="raw-toggle-btn"
              onClick={() => setRawMode(r => !r)}
              title={rawMode ? 'Switch to formatted view' : 'Switch to raw JSON view'}
            >
              {rawMode ? '{ }' : 'RAW'}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        rawMode
          ? <div className="event-card-body"><JsonViewer data={event.payload} label="payload" defaultExpanded={true} /></div>
          : renderBody(event)
      )}
    </div>
  )
}

function renderBody(event: EventEntry): React.ReactNode {
  const p = event.payload
  switch (event.event) {
    // ── ADK Proxy events ──
    case 'interaction_start':
      return <InteractionStartBody payload={p} />
    case 'llm_request':
      return <LlmRequestBody payload={p} />
    case 'llm_response':
      return <LlmResponseBody payload={p} />
    case 'tool_start':
      return <ToolStartBody payload={p} />
    case 'tool_result':
      return <ToolResultBody payload={p} />
    case 'tool_error':
      return <ErrorBody payload={p} type="tool" />
    case 'llm_error':
      return <ErrorBody payload={p} type="llm" />
    case 'interaction_end':
      return <InteractionEndBody payload={p} />
    // ── LangGraph events ──
    case 'llm_call_start':
      return <LlmCallStartBody payload={p} />
    case 'llm_call_end':
      return <LlmCallEndBody payload={p} />
    case 'tool_call_start':
      return <ToolCallStartBody payload={p} />
    case 'tool_call_end':
      return <ToolCallEndBody payload={p} />
    case 'turn_summary':
      return <TurnSummaryBody payload={p} />
    default:
      return <JsonViewer data={p} label="payload" defaultExpanded={false} />
  }
}

// ── LangGraph body renderers ──

function LlmCallStartBody({ payload }: { payload: Record<string, unknown> }) {
  const model = String(payload.model ?? '')
  const provider = String(payload.provider ?? '')
  const messages = payload.messages as Array<Record<string, unknown>> | undefined

  return (
    <div className="event-body">
      <div className="event-field">
        <span className="event-field-label">Model:</span>
        <span className="event-field-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {model}
        </span>
      </div>
      <div className="event-field">
        <span className="event-field-label">Provider:</span>
        <span className="event-field-value">{provider}</span>
      </div>
      {messages && messages.length > 0 && (
        <CollapsibleSection title={`Messages (${messages.length})`} defaultOpen={false}>
          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble chat-${String(msg.role ?? 'unknown')}`}>
              <div className="chat-role">{String(msg.role ?? 'unknown')}</div>
              <div className="chat-content">{String(msg.content ?? '').slice(0, 500)}</div>
            </div>
          ))}
        </CollapsibleSection>
      )}
      {payload.extraParams && (
        <CollapsibleSection title="Extra Params" defaultOpen={false}>
          <JsonViewer data={payload.extraParams} label="extraParams" defaultExpanded={false} />
        </CollapsibleSection>
      )}
    </div>
  )
}

function LlmCallEndBody({ payload }: { payload: Record<string, unknown> }) {
  const content = String(payload.content ?? '')
  const toolCalls = payload.toolCalls as Array<Record<string, unknown>> | undefined
  const usage = payload.tokenUsage as Record<string, number> | undefined
  const latency = payload.latencyMs as number | undefined

  return (
    <div className="event-body">
      {content && (
        <CollapsibleSection title="Response" defaultOpen={true}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', padding: '8px', background: 'var(--bg-primary)', borderRadius: '4px' }}>
            {content.slice(0, 2000)}
            {content.length > 2000 && '...'}
          </div>
        </CollapsibleSection>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <CollapsibleSection title={`Tool Calls (${toolCalls.length})`} defaultOpen={true}>
          {toolCalls.map((tc, i) => (
            <div key={i} style={{ marginBottom: '8px' }}>
              <span className="badge badge-tool">{String(tc.name ?? tc.function ?? 'unknown')}</span>
              <JsonViewer data={tc.args ?? tc} label="args" defaultExpanded={false} />
            </div>
          ))}
        </CollapsibleSection>
      )}
      {usage && (
        <div className="token-summary">
          <span className="badge badge-info">in: {usage.input_tokens?.toLocaleString()}</span>
          <span className="badge badge-info">out: {usage.output_tokens?.toLocaleString()}</span>
          <span className="badge badge-info">total: {usage.total_tokens?.toLocaleString()}</span>
        </div>
      )}
      {latency != null && (
        <div className="event-field">
          <span className="event-field-label">Latency:</span>
          <span className="event-field-value">{(latency / 1000).toFixed(1)}s</span>
        </div>
      )}
    </div>
  )
}

function ToolCallStartBody({ payload }: { payload: Record<string, unknown> }) {
  const toolName = String(payload.toolName ?? '')
  return (
    <div className="event-body">
      <div className="event-field">
        <span className="event-field-label">Tool:</span>
        <span className="badge badge-tool">{toolName}</span>
      </div>
      {payload.args && (
        <CollapsibleSection title="Arguments" defaultOpen={true}>
          <JsonViewer data={payload.args} label="args" defaultExpanded={true} />
        </CollapsibleSection>
      )}
    </div>
  )
}

function ToolCallEndBody({ payload }: { payload: Record<string, unknown> }) {
  const toolName = String(payload.toolName ?? '')
  const durationMs = payload.durationMs as number | undefined
  return (
    <div className="event-body">
      <div className="event-field">
        <span className="event-field-label">Tool:</span>
        <span className="badge badge-tool">{toolName}</span>
        {durationMs != null && (
          <span className="event-field-value" style={{ marginLeft: '8px' }}>
            {(durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {payload.result && (
        <CollapsibleSection title="Result" defaultOpen={false}>
          <JsonViewer data={payload.result} label="result" defaultExpanded={false} />
        </CollapsibleSection>
      )}
    </div>
  )
}

function TurnSummaryBody({ payload }: { payload: Record<string, unknown> }) {
  const userInput = String(payload.userInput ?? '')
  const llmCallCount = payload.llmCallCount as number | undefined
  const toolNames = payload.toolNames as string[] | undefined
  const turnDuration = payload.turnDurationMs as number | undefined
  const usage = payload.totalTokenUsage as Record<string, number> | undefined
  const stateChanges = payload.stateChanges as unknown[] | undefined

  return (
    <div className="event-body">
      <div className="event-field">
        <span className="event-field-label">Turn:</span>
        <span className="event-field-value">#{String(payload.turnNumber ?? '?')}</span>
        {payload.level && (
          <span className="badge badge-info" style={{ marginLeft: '8px' }}>{String(payload.level)}</span>
        )}
      </div>
      {userInput && (
        <div className="event-field">
          <span className="event-field-label">User:</span>
          <span className="event-field-value">{userInput.slice(0, 200)}</span>
        </div>
      )}
      <div className="token-summary">
        {llmCallCount != null && <span className="badge badge-info">LLM calls: {llmCallCount}</span>}
        {usage && <span className="badge badge-info">tokens: {usage.total_tokens?.toLocaleString()}</span>}
        {turnDuration != null && <span className="badge badge-info">{(turnDuration / 1000).toFixed(1)}s</span>}
      </div>
      {toolNames && toolNames.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          {toolNames.map((t, i) => <span key={`${t}-${i}`} className="badge badge-tool">{t}</span>)}
        </div>
      )}
      {stateChanges && stateChanges.length > 0 && (
        <CollapsibleSection title={`State Changes (${stateChanges.length})`} defaultOpen={false}>
          <JsonViewer data={stateChanges} label="stateChanges" defaultExpanded={false} />
        </CollapsibleSection>
      )}
      {payload.stateBefore && (
        <CollapsibleSection title="State Before" defaultOpen={false}>
          <JsonViewer data={payload.stateBefore} label="stateBefore" defaultExpanded={false} />
        </CollapsibleSection>
      )}
      {payload.stateAfter && (
        <CollapsibleSection title="State After" defaultOpen={false}>
          <JsonViewer data={payload.stateAfter} label="stateAfter" defaultExpanded={false} />
        </CollapsibleSection>
      )}
    </div>
  )
}
