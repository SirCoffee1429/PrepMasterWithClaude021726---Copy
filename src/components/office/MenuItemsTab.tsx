import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES, STATIONS } from '@/lib/constants'
import type { MenuItem } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'
import { MenuItemDropdown } from './MenuItemDropdown'

export function MenuItemsTab() {
  const queryClient = useQueryClient()
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')

  const { data: menuItems = [] } = useQuery({
    queryKey: ['menu-items-with-components'],
    queryFn: async () => {
      const { data } = await supabase
        .from('menu_items')
        .select(`
          id, name, category, station_id, pos_name, created_at,
          station:stations(id, name),
          components:bill_of_materials(
            id, quantity, unit,
            ingredient:ingredients(id, name, unit, station_id)
          )
        `)
        .order('name')

      return (data ?? []) as unknown as MenuItem[]
    },
  })

  const handleFileSelect = useCallback(async (file: File) => {
    setUploadStatus('uploading')
    setStatusMessage('Uploading and parsing recipe workbook...')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const { data, error } = await supabase.functions.invoke('import-menu-workbook', {
        body: formData,
      })

      if (error) throw error

      setUploadStatus('success')
      setStatusMessage(
        `Imported ${data?.menu_items_count ?? 0} menu items, ${data?.ingredients_count ?? 0} ingredients, ${data?.recipes_count ?? 0} recipes.`
      )
      queryClient.invalidateQueries({ queryKey: ['menu-items-with-components'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
      queryClient.invalidateQueries({ queryKey: ['recipes'] })
    } catch (err) {
      setUploadStatus('error')
      setStatusMessage(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [queryClient])

  const itemsByStation = new Map<string, MenuItem[]>()
  for (const station of STATIONS) {
    itemsByStation.set(station, [])
  }
  itemsByStation.set('Unassigned', [])

  for (const item of menuItems) {
    const stationName = item.station?.name ?? 'Unassigned'
    const list = itemsByStation.get(stationName) ?? []
    itemsByStation.set(stationName, [...list, item])
  }

  return (
    <div className="flex flex-col gap-6">
      <FileUpload
        accept={[...ACCEPTED_UPLOAD_TYPES.menuWorkbook]}
        onFileSelect={handleFileSelect}
        uploadStatus={uploadStatus}
        statusMessage={statusMessage}
        label="Upload Recipe Workbook (XLSX)"
      />

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Menu Items ({menuItems.length})
        </h3>

        {Array.from(itemsByStation.entries()).map(([station, items]) =>
          items.length > 0 ? (
            <div key={station} className="mb-6">
              <h4 className="text-sm font-bold uppercase tracking-wider text-brand-700 mb-3 px-1">
                {station} ({items.length})
              </h4>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <MenuItemDropdown key={item.id} menuItem={item} />
                ))}
              </div>
            </div>
          ) : null
        )}

        {menuItems.length === 0 && (
          <p className="py-12 text-center text-gray-400">
            No menu items yet. Upload a recipe workbook to get started.
          </p>
        )}
      </div>
    </div>
  )
}
