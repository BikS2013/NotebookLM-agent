import type { FileMetadata, AggregateStats } from '@shared/types'

interface ToolbarProps {
  metadata: FileMetadata | null
  aggregates: AggregateStats | null
  isWatching: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onOpenFile: () => void
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function Toolbar({
  metadata,
  aggregates,
  isWatching,
  searchQuery,
  onSearchChange,
  onOpenFile,
}: ToolbarProps): JSX.Element {
  const fileName = metadata
    ? metadata.filePath.split('/').pop() ?? metadata.filePath
    : null

  return (
    <div className="toolbar">
      <button className="toolbar-btn" onClick={onOpenFile}>
        Open File
      </button>

      {fileName && <span className="toolbar-file-name" title={metadata!.filePath}>{fileName}</span>}

      {metadata && (
        <div className="watch-indicator">
          <span className={`watch-dot ${isWatching ? 'active' : ''}`} />
          {isWatching ? 'Watching' : 'Stopped'}
        </div>
      )}

      <div className="toolbar-stats">
        {aggregates && (
          <>
            <span className="toolbar-stat">
              Interactions: <span className="toolbar-stat-value">{aggregates.totalInteractions}</span>
            </span>
            <span className="toolbar-stat">
              Tokens: <span className="toolbar-stat-value">{formatTokens(aggregates.totalTokens)}</span>
            </span>
            <span className="toolbar-stat">
              Tools: <span className="toolbar-stat-value">{aggregates.totalToolCalls}</span>
            </span>
          </>
        )}
      </div>

      <input
        className="search-input"
        type="text"
        placeholder="Search interactions..."
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
      />
    </div>
  )
}
