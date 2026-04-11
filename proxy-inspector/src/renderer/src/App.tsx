import { useState, useMemo, useCallback } from 'react'
import { useFileData } from './hooks/useFileData'
import { Toolbar } from './components/Toolbar'
import { InteractionList } from './components/InteractionList'
import { DetailPanel } from './components/DetailPanel'
import type { InteractionSummary } from '@shared/types'

function App(): JSX.Element {
  const { metadata, interactions, aggregates, isLoading, openFile } = useFileData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Client-side filtering by user message
  const filtered = useMemo<InteractionSummary[]>(() => {
    if (!searchQuery.trim()) return interactions
    const q = searchQuery.toLowerCase()
    return interactions.filter(i => i.userMessage.toLowerCase().includes(q))
  }, [interactions, searchQuery])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  // File is considered "watching" if metadata is loaded (tailer starts on file open)
  const isWatching = metadata !== null

  return (
    <div className="app-layout">
      <Toolbar
        metadata={metadata}
        aggregates={aggregates}
        isWatching={isWatching}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenFile={openFile}
      />

      <div className="content-area">
        <InteractionList
          interactions={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
        <DetailPanel selectedId={selectedId} />
      </div>
    </div>
  )
}

export default App
