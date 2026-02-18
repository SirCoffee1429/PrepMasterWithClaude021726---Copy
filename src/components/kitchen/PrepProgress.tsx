import type { PrepListItem } from '@/lib/types'

interface PrepProgressProps {
  readonly items: ReadonlyArray<PrepListItem>
}

export function PrepProgress({ items }: PrepProgressProps) {
  const total = items.length
  const completed = items.filter((i) => i.status === 'completed').length
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex items-center gap-4 rounded-xl bg-white border border-gray-200 px-5 py-3 shadow-sm">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-700">
            {completed} of {total} items completed
          </span>
          <span className="text-sm font-bold text-brand-700">{percentage}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  )
}
