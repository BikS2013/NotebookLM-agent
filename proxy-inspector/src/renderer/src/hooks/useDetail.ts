import { useState, useEffect, useRef, useCallback } from 'react'
import type { DetailPayload } from '@shared/types'

export interface DetailState {
  detail: DetailPayload | null
  isLoading: boolean
  error: string | null
}

export function useDetail(interactionId: string | null): DetailState {
  const [detail, setDetail] = useState<DetailPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef<Map<string, DetailPayload>>(new Map())

  useEffect(() => {
    if (!interactionId) {
      setDetail(null)
      setError(null)
      return
    }

    // Check cache first
    const cached = cacheRef.current.get(interactionId)
    if (cached) {
      setDetail(cached)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    window.api.getInteractionDetail(interactionId).then(result => {
      if (cancelled) return
      if (result.ok) {
        cacheRef.current.set(interactionId, result.data)
        setDetail(result.data)
        setError(null)
      } else {
        setDetail(null)
        setError(result.error)
      }
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [interactionId])

  return { detail, isLoading, error }
}
