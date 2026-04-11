import { useState, useEffect, createContext, useContext } from 'react'

interface JsonViewerProps {
  data: unknown
  label?: string
  defaultExpanded?: boolean
}

const MAX_STRING_LENGTH = 500

// Context for expand/collapse all within a single JsonViewer tree
const ExpandAllContext = createContext<number>(0)

export function JsonViewer({
  data,
  label,
  defaultExpanded = false,
}: JsonViewerProps) {
  // signal: positive = expand all nodes, negative = collapse all nodes
  const [expandAllSignal, setExpandAllSignal] = useState(0)

  return (
    <ExpandAllContext.Provider value={expandAllSignal}>
      <div className="json-viewer">
        <div className="json-viewer-toolbar">
          {label && (
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11 }}>
              {label}
            </span>
          )}
          <div className="json-viewer-actions">
            <button
              className="json-expand-btn"
              onClick={() => setExpandAllSignal(s => Math.abs(s) + 1)}
              title="Expand all nodes"
            >
              ⊞ Expand All
            </button>
            <button
              className="json-expand-btn"
              onClick={() => setExpandAllSignal(s => -(Math.abs(s) + 1))}
              title="Collapse all nodes"
            >
              ⊟ Collapse All
            </button>
          </div>
        </div>
        <JsonNode value={data} defaultExpanded={defaultExpanded} depth={0} />
      </div>
    </ExpandAllContext.Provider>
  )
}

function JsonNode({
  value,
  defaultExpanded,
  depth,
  keyName,
}: {
  value: unknown
  defaultExpanded: boolean
  depth: number
  keyName?: string
}) {
  if (value === null) {
    return (
      <span>
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-null">null</span>
      </span>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <span>
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-boolean">{String(value)}</span>
      </span>
    )
  }

  if (typeof value === 'number') {
    return (
      <span>
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-number">{value}</span>
      </span>
    )
  }

  if (typeof value === 'string') {
    return (
      <StringValue value={value} keyName={keyName} />
    )
  }

  if (Array.isArray(value)) {
    return (
      <ArrayNode
        value={value}
        defaultExpanded={defaultExpanded || depth < 1}
        depth={depth}
        keyName={keyName}
      />
    )
  }

  if (typeof value === 'object') {
    return (
      <ObjectNode
        value={value as Record<string, unknown>}
        defaultExpanded={defaultExpanded || depth < 1}
        depth={depth}
        keyName={keyName}
      />
    )
  }

  return <span className="json-string">{String(value)}</span>
}

function StringValue({ value, keyName }: { value: string; keyName?: string }) {
  const [showFull, setShowFull] = useState(false)
  const isTruncated = value.length > MAX_STRING_LENGTH && !showFull
  const display = isTruncated ? value.slice(0, MAX_STRING_LENGTH) : value

  return (
    <span>
      {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
      <span className="json-string">"{display}"</span>
      {isTruncated && (
        <>
          <span className="json-string">...</span>{' '}
          <button className="json-show-more" onClick={() => setShowFull(true)}>
            Show more ({value.length} chars)
          </button>
        </>
      )}
      {showFull && value.length > MAX_STRING_LENGTH && (
        <> <button className="json-show-more" onClick={() => setShowFull(false)}>Show less</button></>
      )}
    </span>
  )
}

function ObjectNode({
  value,
  defaultExpanded,
  depth,
  keyName,
}: {
  value: Record<string, unknown>
  defaultExpanded: boolean
  depth: number
  keyName?: string
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const expandAllSignal = useContext(ExpandAllContext)
  const keys = Object.keys(value)

  // Respond to expand/collapse all signal from the JsonViewer root
  useEffect(() => {
    if (expandAllSignal === 0) return
    setExpanded(expandAllSignal > 0)
  }, [expandAllSignal])

  if (keys.length === 0) {
    return (
      <span>
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-bracket">{'{}'}</span>
      </span>
    )
  }

  return (
    <div>
      <span
        className="json-node-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-bracket">{'{'}</span>
        {!expanded && (
          <span className="json-collapsed-indicator"> {keys.length} keys... </span>
        )}
        {!expanded && <span className="json-bracket">{'}'}</span>}
      </span>
      {expanded && (
        <div className="json-node">
          {keys.map((k, i) => (
            <div key={k}>
              <JsonNode
                value={value[k]}
                defaultExpanded={false}
                depth={depth + 1}
                keyName={k}
              />
              {i < keys.length - 1 && <span className="json-bracket">,</span>}
            </div>
          ))}
        </div>
      )}
      {expanded && <span className="json-bracket">{'}'}</span>}
    </div>
  )
}

function ArrayNode({
  value,
  defaultExpanded,
  depth,
  keyName,
}: {
  value: unknown[]
  defaultExpanded: boolean
  depth: number
  keyName?: string
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const expandAllSignal = useContext(ExpandAllContext)

  // Respond to expand/collapse all signal from the JsonViewer root
  useEffect(() => {
    if (expandAllSignal === 0) return
    setExpanded(expandAllSignal > 0)
  }, [expandAllSignal])

  if (value.length === 0) {
    return (
      <span>
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-bracket">[]</span>
      </span>
    )
  }

  return (
    <div>
      <span
        className="json-node-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        {keyName !== undefined && <><span className="json-key">"{keyName}"</span>: </>}
        <span className="json-bracket">[</span>
        {!expanded && (
          <span className="json-collapsed-indicator"> {value.length} items... </span>
        )}
        {!expanded && <span className="json-bracket">]</span>}
      </span>
      {expanded && (
        <div className="json-node">
          {value.map((item, i) => (
            <div key={i}>
              <JsonNode
                value={item}
                defaultExpanded={false}
                depth={depth + 1}
              />
              {i < value.length - 1 && <span className="json-bracket">,</span>}
            </div>
          ))}
        </div>
      )}
      {expanded && <span className="json-bracket">]</span>}
    </div>
  )
}
