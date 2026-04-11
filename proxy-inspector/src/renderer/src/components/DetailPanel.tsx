import { useDetail } from '../hooks/useDetail'
import { EventTimeline } from './EventTimeline'

interface DetailPanelProps {
  selectedId: string | null
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

export function DetailPanel({ selectedId }: DetailPanelProps) {
  const { detail, isLoading, error } = useDetail(selectedId)
  if (!selectedId) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder">
          Select an interaction to view details
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
          Error: {error}
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="detail-panel">
        <div className="detail-placeholder">No data available</div>
      </div>
    )
  }

  const { summary, events } = detail

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-header-title">
          #{summary.index} {summary.userMessage || '(empty message)'}
        </div>
        <div className="detail-header-meta">
          <span>ID: <code style={{ fontSize: 10 }}>{summary.id}</code></span>
          <span>Duration: {formatDuration(summary.durationMs)}</span>
          <span>Tokens: {formatTokens(summary.totalTokens)}</span>
          <span>Events: {summary.eventCount}</span>
        </div>
      </div>

      <EventTimeline events={events} />
    </div>
  )
}
