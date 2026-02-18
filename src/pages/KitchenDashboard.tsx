import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { APP_NAME, STATIONS } from '@/lib/constants'
import type { PrepListItem, PrepItemStatus } from '@/lib/types'
import { ConnectionStatus } from '@/components/shared/ConnectionStatus'
import { StationSection } from '@/components/kitchen/StationSection'
import { PrepProgress } from '@/components/kitchen/PrepProgress'
import { RecipeModal } from '@/components/kitchen/RecipeModal'
import { useRealtimePrepList } from '@/hooks/useRealtimePrepList'

export function KitchenDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedItem, setSelectedItem] = useState<PrepListItem | null>(null)

  const { data: prepList } = useQuery({
    queryKey: ['prep-list', today],
    queryFn: async () => {
      const { data } = await supabase
        .from('prep_lists')
        .select('id, prep_date')
        .eq('prep_date', today)
        .single()
      return data
    },
  })

  const { data: prepItems = [] } = useQuery({
    queryKey: ['prep-items', prepList?.id],
    enabled: !!prepList?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('prep_list_items')
        .select(`
          id, prep_list_id, ingredient_id, amount_needed, unit,
          status, assigned_user_id, completed_at, last_status_update,
          ingredient:ingredients(id, name, station_id, unit, recipe_data,
            station:stations(id, name)
          ),
          assigned_user:profiles(id, email, full_name)
        `)
        .eq('prep_list_id', prepList!.id)

      return (data ?? []) as unknown as PrepListItem[]
    },
  })

  const handleRealtimeUpdate = useCallback(
    (updatedItem: PrepListItem) => {
      queryClient.setQueryData<PrepListItem[]>(
        ['prep-items', prepList?.id],
        (old) =>
          old
            ? old.map((item) => (item.id === updatedItem.id ? { ...item, ...updatedItem } : item))
            : []
      )
    },
    [queryClient, prepList?.id]
  )

  const handleRealtimeInsert = useCallback(
    () => {
      queryClient.invalidateQueries({ queryKey: ['prep-items', prepList?.id] })
    },
    [queryClient, prepList?.id]
  )

  const { isConnected } = useRealtimePrepList({
    prepListId: prepList?.id ?? null,
    onUpdate: handleRealtimeUpdate,
    onInsert: handleRealtimeInsert,
    onDelete: handleRealtimeInsert,
  })

  const statusMutation = useMutation({
    mutationFn: async ({ itemId, newStatus }: { itemId: string; newStatus: PrepItemStatus }) => {
      const updates: Record<string, unknown> = {
        status: newStatus,
        last_status_update: new Date().toISOString(),
      }
      if (newStatus === 'completed') {
        updates.completed_at = new Date().toISOString()
      }
      if (newStatus === 'open') {
        updates.assigned_user_id = null
        updates.completed_at = null
      }

      const { error } = await supabase
        .from('prep_list_items')
        .update(updates)
        .eq('id', itemId)

      if (error) throw error
    },
    onMutate: async ({ itemId, newStatus }) => {
      queryClient.setQueryData<PrepListItem[]>(
        ['prep-items', prepList?.id],
        (old) =>
          old
            ? old.map((item) =>
                item.id === itemId ? { ...item, status: newStatus } : item
              )
            : []
      )
    },
  })

  const handleStatusChange = useCallback(
    (itemId: string, newStatus: PrepItemStatus) => {
      statusMutation.mutate({ itemId, newStatus })
    },
    [statusMutation]
  )

  const handleViewRecipe = useCallback((item: PrepListItem) => {
    setSelectedItem(item)
  }, [])

  const handleCloseRecipe = useCallback(() => {
    setSelectedItem(null)
  }, [])

  const itemsByStation = useMemo(() => {
    const grouped = new Map<string, PrepListItem[]>()
    for (const station of STATIONS) {
      grouped.set(station, [])
    }

    for (const item of prepItems) {
      const stationName = item.ingredient?.station?.name ?? 'Other'
      const existing = grouped.get(stationName) ?? []
      grouped.set(stationName, [...existing, item])
    }

    return grouped
  }, [prepItems])

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-20 border-b bg-brand-900 px-6 py-4 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-brand-300 hover:bg-brand-800 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">{APP_NAME}</h1>
              <p className="text-sm text-brand-300">
                {format(new Date(), 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
          </div>
          <ConnectionStatus isConnected={isConnected} />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-5">
        <PrepProgress items={prepItems} />

        {STATIONS.map((station) => {
          const items = itemsByStation.get(station) ?? []
          return (
            <StationSection
              key={station}
              stationName={station}
              items={items}
              onStatusChange={handleStatusChange}
              onViewRecipe={handleViewRecipe}
            />
          )
        })}

        {itemsByStation.has('Other') && (itemsByStation.get('Other')?.length ?? 0) > 0 && (
          <StationSection
            stationName="Other"
            items={itemsByStation.get('Other') ?? []}
            onStatusChange={handleStatusChange}
            onViewRecipe={handleViewRecipe}
          />
        )}
      </main>

      <RecipeModal item={selectedItem} onClose={handleCloseRecipe} />
    </div>
  )
}
