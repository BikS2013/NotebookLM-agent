import { useState, useEffect, useCallback } from 'react'
import type {
  ParsedFileData,
  InteractionSummary,
  AggregateStats,
  IncrementalUpdate,
  FileMetadata,
} from '@shared/types'

export interface FileDataState {
  metadata: FileMetadata | null
  interactions: InteractionSummary[]
  aggregates: AggregateStats | null
  isLoading: boolean
}

export function useFileData(): FileDataState & {
  openFile: () => Promise<void>
  reloadFile: () => Promise<void>
} {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [interactions, setInteractions] = useState<InteractionSummary[]>([])
  const [aggregates, setAggregates] = useState<AggregateStats | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Subscribe to push events from main process
  useEffect(() => {
    const cleanupFileData = window.api.onFileData((data: ParsedFileData) => {
      setMetadata(data.metadata)
      setInteractions(data.interactions)
      setAggregates(data.aggregates)
      setIsLoading(false)
    })

    const cleanupNewEvents = window.api.onNewEvents((update: IncrementalUpdate) => {
      setInteractions(prev => {
        const map = new Map(prev.map(s => [s.id, s]))
        for (const s of update.interactions) {
          map.set(s.id, s)
        }
        // Rebuild array preserving insertion order (by index)
        return Array.from(map.values()).sort((a, b) => a.index - b.index)
      })
      setAggregates(update.aggregates)
    })

    return () => {
      cleanupFileData()
      cleanupNewEvents()
    }
  }, [])

  const openFile = useCallback(async () => {
    setIsLoading(true)
    const result = await window.api.openFile()
    if (result.ok) {
      setMetadata(result.data.metadata)
      setInteractions(result.data.interactions)
      setAggregates(result.data.aggregates)
    }
    setIsLoading(false)
  }, [])

  const reloadFile = useCallback(async () => {
    if (!metadata) return
    setIsLoading(true)
    const result = await window.api.openRecent(metadata.filePath)
    if (result.ok) {
      setMetadata(result.data.metadata)
      setInteractions(result.data.interactions)
      setAggregates(result.data.aggregates)
    }
    setIsLoading(false)
  }, [metadata])

  return { metadata, interactions, aggregates, isLoading, openFile, reloadFile }
}
