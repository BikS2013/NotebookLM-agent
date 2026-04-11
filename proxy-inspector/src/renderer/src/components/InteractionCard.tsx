import type { InteractionSummary } from '@shared/types'

interface InteractionCardProps {
  summary: InteractionSummary
  isSelected: boolean
  onClick: (id: string) => void
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '??:??:??'
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function StatusIcon({ status }: { status: InteractionSummary['status'] }): JSX.Element {
  switch (status) {
    case 'complete':
      return <span className="interaction-card-status status-complete">&#10003;</span>
    case 'in-progress':
      return <span className="interaction-card-status status-in-progress status-spinner">&#9696;</span>
    case 'error':
      return <span className="interaction-card-status status-error">&#10007;</span>
  }
}

export function InteractionCard({ summary, isSelected, onClick }: InteractionCardProps): JSX.Element {
  const classes = [
    'interaction-card',
    isSelected ? 'selected' : '',
    summary.hasErrors ? 'has-error' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      onClick={() => onClick(summary.id)}
      role="option"
      aria-selected={isSelected}
    >
      <div className="interaction-card-header">
        <span className="interaction-card-index">#{summary.index}</span>
        <span className="interaction-card-message" title={summary.userMessage}>
          {summary.userMessage || '(empty message)'}
        </span>
        <StatusIcon status={summary.status} />
      </div>

      <div className="interaction-card-meta">
        <span>{formatTime(summary.timestamp)}</span>
        <span>{formatDuration(summary.durationMs)}</span>
        <span>{formatTokens(summary.totalTokens)} tokens</span>
      </div>

      {(summary.roundTripCount > 0 || summary.toolCalls.length > 0 || summary.hasErrors) && (
        <div className="interaction-card-badges">
          {summary.roundTripCount > 0 && (
            <span className="badge badge-rt">{summary.roundTripCount} RT</span>
          )}
          {summary.toolCalls.length > 0 && summary.toolCalls.map((tool, idx) => (
            <span key={`${tool}-${idx}`} className="badge badge-tool">{tool}</span>
          ))}
          {summary.hasErrors && <span className="badge badge-error">error</span>}
        </div>
      )}
    </div>
  )
}
