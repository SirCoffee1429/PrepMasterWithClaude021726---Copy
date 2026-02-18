import { useCallback } from 'react'
import { Clock, CheckCircle, Circle, BookOpen } from 'lucide-react'
import type { PrepListItem, PrepItemStatus } from '@/lib/types'
import { STATUS_COLORS } from '@/lib/constants'

interface PrepItemCardProps {
  readonly item: PrepListItem
  readonly onStatusChange: (itemId: string, newStatus: PrepItemStatus) => void
  readonly onViewRecipe: (item: PrepListItem) => void
}

const NEXT_STATUS: Record<PrepItemStatus, PrepItemStatus> = {
  open: 'in_progress',
  in_progress: 'completed',
  completed: 'open',
}

const STATUS_ICONS: Record<PrepItemStatus, typeof Circle> = {
  open: Circle,
  in_progress: Clock,
  completed: CheckCircle,
}

export function PrepItemCard({ item, onStatusChange, onViewRecipe }: PrepItemCardProps) {
  const StatusIcon = STATUS_ICONS[item.status]

  const handleStatusTap = useCallback(() => {
    onStatusChange(item.id, NEXT_STATUS[item.status])
  }, [item.id, item.status, onStatusChange])

  const handleViewRecipe = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onViewRecipe(item)
    },
    [item, onViewRecipe]
  )

  return (
    <div
      className={`
        flex items-center gap-4 rounded-xl border-2 px-5 py-4
        transition-all duration-200
        ${STATUS_COLORS[item.status]}
        ${item.status === 'completed' ? 'opacity-60' : ''}
      `}
    >
      <button
        onClick={handleStatusTap}
        className={`
          flex h-12 w-12 shrink-0 items-center justify-center rounded-full
          transition-all duration-200 active:scale-90
          ${item.status === 'open' ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : ''}
          ${item.status === 'in_progress' ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : ''}
          ${item.status === 'completed' ? 'bg-green-100 text-green-600 hover:bg-green-200' : ''}
        `}
        aria-label={`Mark as ${NEXT_STATUS[item.status]}`}
      >
        <StatusIcon className="h-6 w-6" />
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-lg font-semibold ${
            item.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'
          }`}
        >
          {item.ingredient?.name ?? 'Unknown Item'}
        </p>
        {item.status === 'in_progress' && item.assigned_user && (
          <p className="text-sm text-amber-700">
            {item.assigned_user.full_name ?? item.assigned_user.email}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-xl font-bold text-gray-900">{item.amount_needed}</p>
          <p className="text-xs text-gray-500 uppercase">{item.unit}</p>
        </div>

        <button
          onClick={handleViewRecipe}
          className="
            flex h-11 w-11 items-center justify-center rounded-lg
            bg-brand-100 text-brand-700
            transition-all hover:bg-brand-200 active:scale-90
          "
          aria-label="View recipe"
        >
          <BookOpen className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
