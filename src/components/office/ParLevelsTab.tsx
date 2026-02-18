import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES, STATIONS } from '@/lib/constants'
import type { ParLevel, Ingredient } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ParLevelsTab() {
  const queryClient = useQueryClient()
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [editedPars, setEditedPars] = useState<Map<string, number>>(new Map())

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients-with-stations'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ingredients')
        .select('id, name, station_id, unit, station:stations(id, name)')
        .order('name')
      return (data ?? []) as unknown as Ingredient[]
    },
  })

  const { data: parLevels = [] } = useQuery({
    queryKey: ['par-levels'],
    queryFn: async () => {
      const { data } = await supabase
        .from('par_levels')
        .select('id, ingredient_id, day_of_week, par_quantity')
      return (data ?? []) as ParLevel[]
    },
  })

  const parMap = new Map<string, number>()
  for (const pl of parLevels) {
    parMap.set(`${pl.ingredient_id}-${pl.day_of_week}`, pl.par_quantity)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const upserts = Array.from(editedPars.entries()).map(([key, value]) => {
        const [ingredient_id, day] = key.split('-')
        return {
          ingredient_id,
          day_of_week: parseInt(day, 10),
          par_quantity: value,
        }
      })

      const { error } = await supabase
        .from('par_levels')
        .upsert(upserts, { onConflict: 'ingredient_id,day_of_week' })

      if (error) throw error
    },
    onSuccess: () => {
      setEditedPars(new Map())
      queryClient.invalidateQueries({ queryKey: ['par-levels'] })
    },
  })

  const handleParChange = useCallback(
    (ingredientId: string, dayOfWeek: number, value: string) => {
      const num = parseFloat(value)
      if (isNaN(num) || num < 0) return
      setEditedPars((prev) => {
        const next = new Map(prev)
        next.set(`${ingredientId}-${dayOfWeek}`, num)
        return next
      })
    },
    []
  )

  const getParValue = (ingredientId: string, day: number): string => {
    const editKey = `${ingredientId}-${day}`
    if (editedPars.has(editKey)) return String(editedPars.get(editKey))
    const stored = parMap.get(editKey)
    return stored !== undefined ? String(stored) : ''
  }

  const handleFileSelect = useCallback(async (file: File) => {
    setUploadStatus('uploading')
    setStatusMessage('Uploading and parsing par levels...')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const { data, error } = await supabase.functions.invoke('parse-par-levels', {
        body: formData,
      })

      if (error) throw error

      setUploadStatus('success')
      setStatusMessage(`Parsed ${data?.count ?? 0} par level entries.`)
      queryClient.invalidateQueries({ queryKey: ['par-levels'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    } catch (err) {
      setUploadStatus('error')
      setStatusMessage(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [queryClient])

  const ingredientsByStation = new Map<string, Ingredient[]>()
  for (const station of STATIONS) {
    ingredientsByStation.set(station, [])
  }
  ingredientsByStation.set('Other', [])

  for (const ing of ingredients) {
    const stationName = ing.station?.name ?? 'Other'
    const list = ingredientsByStation.get(stationName) ?? []
    ingredientsByStation.set(stationName, [...list, ing])
  }

  return (
    <div className="flex flex-col gap-6">
      <FileUpload
        accept={[...ACCEPTED_UPLOAD_TYPES.parLevels]}
        onFileSelect={handleFileSelect}
        uploadStatus={uploadStatus}
        statusMessage={statusMessage}
        label="Upload Par Level Sheet (PDF / XLSX)"
      />

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Par Level Grid</h3>
        {editedPars.size > 0 && (
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="
              flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2
              text-sm font-medium text-white hover:bg-brand-500
              disabled:opacity-50
            "
          >
            <Save className="h-4 w-4" />
            Save Changes ({editedPars.size})
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-4 py-3 text-left font-medium text-gray-600 min-w-[200px]">
                Ingredient
              </th>
              {DAYS.map((day) => (
                <th key={day} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[70px]">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(ingredientsByStation.entries()).map(([station, ings]) =>
              ings.length > 0 ? (
                <StationGroup
                  key={station}
                  stationName={station}
                  ingredients={ings}
                  getParValue={getParValue}
                  onParChange={handleParChange}
                />
              ) : null
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface StationGroupProps {
  readonly stationName: string
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly getParValue: (ingredientId: string, day: number) => string
  readonly onParChange: (ingredientId: string, day: number, value: string) => void
}

function StationGroup({ stationName, ingredients, getParValue, onParChange }: StationGroupProps) {
  return (
    <>
      <tr>
        <td
          colSpan={8}
          className="bg-brand-50 px-4 py-2 text-sm font-bold text-brand-800 border-t"
        >
          {stationName}
        </td>
      </tr>
      {ingredients.map((ing) => (
        <tr key={ing.id} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="sticky left-0 bg-white px-4 py-2 font-medium text-gray-900">
            {ing.name}
          </td>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <td key={day} className="px-1 py-1 text-center">
              <input
                type="number"
                min="0"
                step="1"
                value={getParValue(ing.id, day)}
                onChange={(e) => onParChange(ing.id, day, e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-center text-sm
                  focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
