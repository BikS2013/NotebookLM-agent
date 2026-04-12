import { useDetail } from '../hooks/useDetail'
import { EventTimeline } from './EventTimeline'

interface DetailPanelProps {
  selectedId: string | null
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function DetailPanel({ selectedId }: DetailPanelProps) {
  const { detail, isLoading, error } = useDetail(selectedId)

  if (!selectedId) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder">
          Select an interaction to inspect
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder" style={{ color: 'var(--error)' }}>
          {error}
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder">No data</div>
      </div>
    )
  }

  const { summary, events } = detail
  const statusClass = summary.status === 'complete' ? 'complete'
    : summary.status === 'error' ? 'error' : 'in-progress'
  const statusLabel = summary.status === 'complete' ? 'COMPLETED'
    : summary.status === 'error' ? 'ERROR' : 'IN PROGRESS'

  return (
    <div className="detail-panel">
      <div className="detail-header">
        {/* Title row: interaction ID + execution time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div className="detail-header-title">
            {summary.userMessage || `interaction-${summary.index}`}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="detail-execution-label">Execution Time</div>
            <div className="detail-execution-time">{formatDuration(summary.durationMs)}</div>
          </div>
        </div>

        {/* Status + meta badges */}
        <div className="detail-header-badges">
          <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
            {summary.eventCount} events
          </span>
        </div>

        {/* Stat cards */}
        <div className="detail-header-stats">
          <div className="detail-stat-card">
            <div className="detail-stat-label">Round Trips</div>
            <div className="detail-stat-value">{summary.roundTripCount}</div>
          </div>
          <div className="detail-stat-card">
            <div className="detail-stat-label">Prompt Tokens</div>
            <div className="detail-stat-value">{formatTokens(summary.totalPromptTokens)}</div>
          </div>
          <div className="detail-stat-card">
            <div className="detail-stat-label">Output Tokens</div>
            <div className="detail-stat-value">{formatTokens(summary.totalCompletionTokens)}</div>
          </div>
          <div className="detail-stat-card">
            <div className="detail-stat-label">Total Tokens</div>
            <div className="detail-stat-value">{formatTokens(summary.totalTokens)}</div>
          </div>
          {summary.toolCalls.length > 0 && (
            <div className="detail-stat-card">
              <div className="detail-stat-label">Tool Calls</div>
              <div className="detail-stat-value">{summary.toolCalls.length}</div>
            </div>
          )}
        </div>
      </div>

      <EventTimeline events={events} />
    </div>
  )
}
