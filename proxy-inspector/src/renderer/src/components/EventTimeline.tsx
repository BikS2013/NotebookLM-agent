import type { EventEntry } from '@shared/types'
import { EventCard } from './EventCard'

interface EventTimelineProps {
  events: EventEntry[]
}

export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return <div style={{ color: 'var(--text-dim)' }}>No events</div>
  }

  const firstTimestamp = new Date(events[0].timestamp).getTime()

  return (
    <div className="event-timeline">
      {events.map(event => {
        const relativeMs = new Date(event.timestamp).getTime() - firstTimestamp
        return (
          <EventCard
            key={`${event.interactionId}-${event.lineIndex}`}
            event={event}
            relativeMs={relativeMs}
          />
        )
      })}
    </div>
  )
}
