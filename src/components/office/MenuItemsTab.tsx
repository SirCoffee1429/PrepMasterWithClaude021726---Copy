import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES, STATIONS } from '@/lib/constants'
import type { MenuItem } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'
import type { FileItem } from '@/components/shared/FileUpload'
import { DuplicateReport } from '@/components/shared/DuplicateReport'
import type { DuplicateGroup } from '@/components/shared/DuplicateReport'
import { MenuItemDropdown } from './MenuItemDropdown'

export function MenuItemsTab() {
  const queryClient = useQueryClient()
  const [fileItems, setFileItems] = useState<FileItem[]>([])
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [crossFileDuplicates, setCrossFileDuplicates] = useState<string[]>([])

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

  const handleFilesSelect = useCallback(async (files: File[]) => {
    const items: FileItem[] = files.map((f) => ({ file: f, status: 'queued' as const }))
    setFileItems(items)
    setDuplicateGroups([])
    setCrossFileDuplicates([])

    const allNewMenu: string[] = []
    const allDupMenu: string[] = []
    const allNewRecipes: string[] = []
    const allDupRecipes: string[] = []
    const allNewIngredients: string[] = []
    const allDupIngredients: string[] = []
    const seenAcrossFiles = new Map<string, number>()

    for (let i = 0; i < files.length; i++) {
      setFileItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: 'uploading' as const, message: 'Parsing...' } : item
        )
      )

      try {
        const formData = new FormData()
        formData.append('file', files[i])

        const { data, error } = await supabase.functions.invoke('import-menu-workbook', {
          body: formData,
        })

        if (error) throw error

        const menuCount = data?.menu_items_count ?? 0
        const recipesCount = data?.recipes_count ?? 0

        // Collect duplicate info
        allNewMenu.push(...(data?.new_menu_items ?? []))
        allDupMenu.push(...(data?.duplicate_menu_items ?? []))
        allNewRecipes.push(...(data?.new_recipes ?? []))
        allDupRecipes.push(...(data?.duplicate_recipes ?? []))
        allNewIngredients.push(...(data?.new_ingredients ?? []))
        allDupIngredients.push(...(data?.duplicate_ingredients ?? []))

        // Track cross-file occurrences
        const allNames = [
          ...(data?.new_menu_items ?? []),
          ...(data?.duplicate_menu_items ?? []),
          ...(data?.new_recipes ?? []),
          ...(data?.duplicate_recipes ?? []),
          ...(data?.new_ingredients ?? []),
          ...(data?.duplicate_ingredients ?? []),
        ]
        for (const name of allNames) {
          const lower = name.toLowerCase()
          seenAcrossFiles.set(lower, (seenAcrossFiles.get(lower) ?? 0) + 1)
        }

        setFileItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                ...item,
                status: 'success' as const,
                message: `${menuCount} items, ${recipesCount} recipes`,
              }
              : item
          )
        )
      } catch (err) {
        setFileItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                ...item,
                status: 'error' as const,
                message: err instanceof Error ? err.message : 'Failed',
              }
              : item
          )
        )
      }
    }

    // Build duplicate groups
    const groups: DuplicateGroup[] = []
    if (allNewMenu.length > 0 || allDupMenu.length > 0) {
      groups.push({
        label: 'Menu Items',
        newItems: [...new Set(allNewMenu)],
        duplicateItems: [...new Set(allDupMenu)],
      })
    }
    if (allNewRecipes.length > 0 || allDupRecipes.length > 0) {
      groups.push({
        label: 'Recipes',
        newItems: [...new Set(allNewRecipes)],
        duplicateItems: [...new Set(allDupRecipes)],
      })
    }
    if (allNewIngredients.length > 0 || allDupIngredients.length > 0) {
      groups.push({
        label: 'Ingredients',
        newItems: [...new Set(allNewIngredients)],
        duplicateItems: [...new Set(allDupIngredients)],
      })
    }
    setDuplicateGroups(groups)

    // Cross-file duplicates
    const crossFile = Array.from(seenAcrossFiles.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
    setCrossFileDuplicates(crossFile)

    queryClient.invalidateQueries({ queryKey: ['menu-items-with-components'] })
    queryClient.invalidateQueries({ queryKey: ['ingredients-with-stations'] })
    queryClient.invalidateQueries({ queryKey: ['recipes'] })
  }, [queryClient])

  const isUploading = fileItems.some((f) => f.status === 'uploading')

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
        onFilesSelect={handleFilesSelect}
        isUploading={isUploading}
        fileItems={fileItems}
        label="Upload Recipe Workbooks (XLSX)"
      />

      <DuplicateReport groups={duplicateGroups} crossFileDuplicates={crossFileDuplicates} />

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
