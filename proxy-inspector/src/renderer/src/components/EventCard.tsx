import { useState } from 'react'
import type { EventEntry, ProxyEventType } from '@shared/types'
import { CollapsibleSection } from './CollapsibleSection'
import { JsonViewer } from './JsonViewer'

interface EventCardProps {
  event: EventEntry
  relativeMs: number
}

const EVENT_LABELS: Record<ProxyEventType, string> = {
  interaction_start: 'START',
  llm_request: 'LLM REQ',
  llm_response: 'LLM RES',
  tool_start: 'TOOL',
  tool_result: 'RESULT',
  tool_error: 'TOOL ERR',
  llm_error: 'LLM ERR',
  interaction_end: 'END',
}

const EVENT_DOT_COLORS: Record<ProxyEventType, string> = {
  interaction_start: 'var(--event-start)',
  llm_request: 'var(--event-llm-req)',
  llm_response: 'var(--event-llm-res)',
  tool_start: 'var(--event-tool)',
  tool_result: 'var(--event-result)',
  tool_error: 'var(--event-error)',
  llm_error: 'var(--event-error)',
  interaction_end: 'var(--event-end)',
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

export function EventCard({ event, relativeMs }: EventCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const dotColor = EVENT_DOT_COLORS[event.event]
  const label = EVENT_LABELS[event.event]
  const toolName =
    event.event === 'tool_start' || event.event === 'tool_result' || event.event === 'tool_error'
      ? String(event.payload.toolName ?? '')
      : ''
  const eventDuration = event.payload.durationMs as number | undefined

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
      </div>

      {expanded && renderBody(event)}
    </div>
  )
}

function renderBody(event: EventEntry): JSX.Element {
  switch (event.event) {
    case 'interaction_start':
      return <InteractionStartBody payload={event.payload} />
    case 'llm_request':
      return <LlmRequestBody payload={event.payload} />
    case 'llm_response':
      return <LlmResponseBody payload={event.payload} />
    case 'tool_start':
      return <ToolStartBody payload={event.payload} />
    case 'tool_result':
      return <ToolResultBody payload={event.payload} />
    case 'tool_error':
      return <ErrorBody payload={event.payload} type="tool" />
    case 'llm_error':
      return <ErrorBody payload={event.payload} type="llm" />
    case 'interaction_end':
      return <InteractionEndBody payload={event.payload} />
  }
}
