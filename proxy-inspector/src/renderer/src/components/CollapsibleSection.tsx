import { useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  badge?: string
  children: ReactNode
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div>
      <div className="collapsible-header" onClick={() => setIsOpen(o => !o)}>
        <span className={`collapsible-chevron ${isOpen ? 'open' : ''}`}>&#9654;</span>
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
      </div>
      {isOpen && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  )
}
