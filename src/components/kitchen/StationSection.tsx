import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { PrepListItem, PrepItemStatus } from '@/lib/types'
import { STATION_ICONS } from '@/lib/constants'
import { PrepItemCard } from './PrepItemCard'

interface StationSectionProps {
  readonly stationName: string
  readonly items: ReadonlyArray<PrepListItem>
  readonly onStatusChange: (itemId: string, newStatus: PrepItemStatus) => void
  readonly onViewRecipe: (item: PrepListItem) => void
}

export function StationSection({
  stationName,
  items,
  onStatusChange,
  onViewRecipe,
}: StationSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const openCount = items.filter((i) => i.status === 'open').length
  const progressCount = items.filter((i) => i.status === 'in_progress').length
  const completedCount = items.filter((i) => i.status === 'completed').length

  const sortedItems = [...items].sort((a, b) => {
    const statusOrder: Record<PrepItemStatus, number> = {
      in_progress: 0,
      open: 1,
      completed: 2,
    }
    return statusOrder[a.status] - statusOrder[b.status]
  })

  const icon = STATION_ICONS[stationName] ?? '📋'

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={toggleExpanded}
        className="
          flex w-full items-center justify-between px-6 py-4
          bg-gray-50 hover:bg-gray-100 transition-colors
        "
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <h2 className="text-xl font-bold text-gray-900">{stationName}</h2>
          <span className="rounded-full bg-brand-100 px-3 py-0.5 text-sm font-semibold text-brand-800">
            {items.length} items
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-sm">
            {openCount > 0 && (
              <span className="text-blue-600 font-medium">{openCount} open</span>
            )}
            {progressCount > 0 && (
              <span className="text-amber-600 font-medium">{progressCount} in progress</span>
            )}
            {completedCount > 0 && (
              <span className="text-green-600 font-medium">{completedCount} done</span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3 p-4">
          {sortedItems.length > 0 ? (
            sortedItems.map((item) => (
              <PrepItemCard
                key={item.id}
                item={item}
                onStatusChange={onStatusChange}
                onViewRecipe={onViewRecipe}
              />
            ))
          ) : (
            <p className="py-8 text-center text-gray-400">No prep items for this station</p>
          )}
        </div>
      )}
    </section>
  )
}
