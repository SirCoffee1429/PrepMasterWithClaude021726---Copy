export const APP_NAME = 'Prep Master'

export const STATIONS = ['Grill', 'Salad', 'Sautee', 'Flattop', 'Fry'] as const
export type StationName = (typeof STATIONS)[number]

export const PREP_THRESHOLD_DEFAULT = 0.5

export const REALTIME_CHANNEL = 'prep-list-changes'

export const MAX_FILE_SIZE_MB = 10
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

export const ACCEPTED_UPLOAD_TYPES = {
  sales: ['.pdf'],
  parLevels: ['.pdf', '.xlsx', '.xls'],
  menuWorkbook: ['.xlsx', '.xls'],
} as const

export const STATUS_COLORS = {
  open: 'bg-white border-gray-200',
  in_progress: 'bg-amber-50 border-amber-300',
  completed: 'bg-gray-100 border-gray-300',
} as const

export const STATION_ICONS: Record<string, string> = {
  Grill: '🔥',
  Salad: '🥗',
  Sautee: '🍳',
  Flattop: '🫓',
  Fry: '🍟',
}
