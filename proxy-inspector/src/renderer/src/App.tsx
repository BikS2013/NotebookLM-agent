import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useFileData } from './hooks/useFileData'
import { Toolbar } from './components/Toolbar'
import { InteractionList } from './components/InteractionList'
import { DetailPanel } from './components/DetailPanel'
import type { InteractionSummary } from '@shared/types'

type Theme = 'dark' | 'light'

const MIN_PANEL_WIDTH = 180
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 320

function getInitialTheme(): Theme {
  const saved = localStorage.getItem('proxy-inspector-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return 'dark'
}

function getInitialPanelWidth(): number {
  const saved = localStorage.getItem('proxy-inspector-panel-width')
  if (saved) {
    const n = parseInt(saved, 10)
    if (!isNaN(n) && n >= MIN_PANEL_WIDTH && n <= MAX_PANEL_WIDTH) return n
  }
  return DEFAULT_PANEL_WIDTH
}

function App() {
  const { metadata, interactions, aggregates, isLoading, openFile, reloadFile } = useFileData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [panelWidth, setPanelWidth] = useState(getInitialPanelWidth)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const isDragging = useRef(false)

  // Apply theme to <html> element and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('proxy-inspector-theme', theme)
  }, [theme])

  // Persist panel width
  useEffect(() => {
    localStorage.setItem('proxy-inspector-panel-width', String(panelWidth))
  }, [panelWidth])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }, [])

  // Client-side filtering by user message
  const filtered = useMemo<InteractionSummary[]>(() => {
    if (!searchQuery.trim()) return interactions
    const q = searchQuery.toLowerCase()
    return interactions.filter(i => i.userMessage.toLowerCase().includes(q))
  }, [interactions, searchQuery])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  // Drag resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, ev.clientX))
      setPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const togglePanel = useCallback(() => {
    setPanelCollapsed(c => !c)
  }, [])

  // File is considered "watching" if metadata is loaded (tailer starts on file open)
  const isWatching = metadata !== null

  const effectiveWidth = panelCollapsed ? 0 : panelWidth

  return (
    <div className="app-layout">
      <Toolbar
        metadata={metadata}
        aggregates={aggregates}
        isWatching={isWatching}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenFile={openFile}
        onReloadFile={reloadFile}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div
        className="content-area"
        style={{ gridTemplateColumns: `${effectiveWidth}px auto 1fr` }}
      >
        <div
          className="interaction-list-container"
          style={{
            width: effectiveWidth,
            overflow: panelCollapsed ? 'hidden' : undefined,
          }}
        >
          {!panelCollapsed && (
            <InteractionList
              interactions={filtered}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          )}
        </div>

        <div className="resize-handle-area">
          <button
            className="collapse-toggle-btn"
            onClick={togglePanel}
            title={panelCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {panelCollapsed ? '▶' : '◀'}
          </button>
          {!panelCollapsed && (
            <div className="resize-handle" onMouseDown={handleMouseDown} />
          )}
        </div>

        <DetailPanel selectedId={selectedId} />
      </div>
    </div>
  )
}

export default App
