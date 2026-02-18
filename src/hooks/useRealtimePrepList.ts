import { useEffect, useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { REALTIME_CHANNEL } from '@/lib/constants'
import type { PrepListItem } from '@/lib/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface UseRealtimePrepListOptions {
  readonly prepListId: string | null
  readonly onInsert?: (item: PrepListItem) => void
  readonly onUpdate?: (item: PrepListItem) => void
  readonly onDelete?: (oldItem: { id: string }) => void
}

export function useRealtimePrepList({
  prepListId,
  onInsert,
  onUpdate,
  onDelete,
}: UseRealtimePrepListOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const subscribe = useCallback(() => {
    if (!prepListId) return

    const channel = supabase
      .channel(`${REALTIME_CHANNEL}:${prepListId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'prep_list_items',
          filter: `prep_list_id=eq.${prepListId}`,
        },
        (payload) => onInsert?.(payload.new as PrepListItem)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'prep_list_items',
          filter: `prep_list_id=eq.${prepListId}`,
        },
        (payload) => onUpdate?.(payload.new as PrepListItem)
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'prep_list_items',
          filter: `prep_list_id=eq.${prepListId}`,
        },
        (payload) => onDelete?.(payload.old as { id: string })
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel
  }, [prepListId, onInsert, onUpdate, onDelete])

  useEffect(() => {
    subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [subscribe])

  return { isConnected }
}
