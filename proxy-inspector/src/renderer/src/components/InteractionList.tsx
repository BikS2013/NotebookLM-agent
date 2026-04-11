import { useRef, useEffect, useCallback } from 'react'
import type { InteractionSummary } from '@shared/types'
import { InteractionCard } from './InteractionCard'

interface InteractionListProps {
  interactions: InteractionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function InteractionList({
  interactions,
  selectedId,
  onSelect,
}: InteractionListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Detect if scrolled to bottom before new items arrive
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [interactions.length])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const threshold = 50
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (interactions.length === 0) return

      const currentIdx = selectedId
        ? interactions.findIndex(i => i.id === selectedId)
        : -1

      let nextIdx: number | null = null

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          nextIdx = Math.min(currentIdx + 1, interactions.length - 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          nextIdx = Math.max(currentIdx - 1, 0)
          break
        case 'Home':
          e.preventDefault()
          nextIdx = 0
          break
        case 'End':
          e.preventDefault()
          nextIdx = interactions.length - 1
          break
      }

      if (nextIdx !== null && nextIdx >= 0) {
        onSelect(interactions[nextIdx].id)
        // Scroll the selected card into view
        const el = listRef.current
        if (el) {
          const cards = el.querySelectorAll('.interaction-card')
          cards[nextIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }
    },
    [interactions, selectedId, onSelect]
  )

  return (
    <div
      ref={listRef}
      className="interaction-list"
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listbox"
      aria-label="Interactions"
    >
      {interactions.length === 0 && (
        <div style={{
          padding: 16,
          color: '#6c7086',
          textAlign: 'center',
          fontSize: 13,
        }}>
          No interactions loaded. Open a file to begin.
        </div>
      )}
      {interactions.map(summary => (
        <InteractionCard
          key={summary.id}
          summary={summary}
          isSelected={summary.id === selectedId}
          onClick={onSelect}
        />
      ))}
    </div>
  )
}
