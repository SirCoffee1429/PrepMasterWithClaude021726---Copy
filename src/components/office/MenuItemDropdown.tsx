import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Pencil, Trash2, Check, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MenuItem } from '@/lib/types'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

interface MenuItemDropdownProps {
  readonly menuItem: MenuItem
}

export function MenuItemDropdown({ menuItem }: MenuItemDropdownProps) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(menuItem.name)
  const [editCategory, setEditCategory] = useState(menuItem.category ?? '')
  const [showDelete, setShowDelete] = useState(false)

  const toggle = useCallback(() => {
    if (!editing) setIsOpen((prev) => !prev)
  }, [editing])

  const components = menuItem.components ?? []

  // ── Rename ──
  const renameMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, string | null> = {}
      const trimName = editName.trim()
      const trimCat = editCategory.trim()
      if (trimName && trimName !== menuItem.name) updates.name = trimName
      if (trimCat !== (menuItem.category ?? '')) updates.category = trimCat || null
      if (Object.keys(updates).length === 0) return
      const { error } = await supabase.from('menu_items').update(updates).eq('id', menuItem.id)
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['menu-items-with-components'] })
    },
  })

  // ── Delete ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('menu_items').delete().eq('id', menuItem.id)
      if (error) throw error
    },
    onSuccess: () => {
      setShowDelete(false)
      queryClient.invalidateQueries({ queryKey: ['menu-items-with-components'] })
    },
  })

  const handleCancelEdit = () => {
    setEditName(menuItem.name)
    setEditCategory(menuItem.category ?? '')
    setEditing(false)
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div
        className="flex w-full items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
      >
        {editing ? (
          <div className="flex items-center gap-2 flex-1 mr-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameMutation.mutate()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              autoFocus
              placeholder="Item name"
              className="flex-1 rounded border border-brand-400 px-2 py-1 text-sm font-medium
                focus:outline-none focus:ring-1 focus:ring-brand-300"
            />
            <input
              type="text"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameMutation.mutate()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              placeholder="Category"
              className="w-32 rounded border border-gray-300 px-2 py-1 text-xs
                focus:outline-none focus:ring-1 focus:ring-brand-300"
            />
            <button
              onClick={() => renameMutation.mutate()}
              className="p-1 text-green-600 hover:text-green-700"
            >
              <Check className="h-4 w-4" />
            </button>
            <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button onClick={toggle} className="flex-1 text-left">
            <div>
              <p className="font-medium text-gray-900">{menuItem.name}</p>
              {menuItem.category && (
                <p className="text-xs text-gray-500">{menuItem.category}</p>
              )}
            </div>
          </button>
        )}

        <div className="flex items-center gap-2">
          {!editing && (
            <>
              <span className="text-xs text-gray-400">
                {components.length} component{components.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditName(menuItem.name); setEditCategory(menuItem.category ?? ''); setEditing(true) }}
                className="p-1.5 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowDelete(true) }}
                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={toggle} className="p-1">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="border-t bg-gray-50 px-4 py-3">
          {components.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="pb-1.5 text-left text-xs font-medium text-gray-500">Ingredient</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-gray-500">Qty</th>
                  <th className="pb-1.5 text-left text-xs font-medium text-gray-500">Unit</th>
                </tr>
              </thead>
              <tbody>
                {components.map((bom) => (
                  <tr key={bom.id} className="border-t border-gray-200/50">
                    <td className="py-1.5 text-gray-800">{bom.ingredient?.name ?? 'Unknown'}</td>
                    <td className="py-1.5 text-right text-gray-600">{bom.quantity}</td>
                    <td className="py-1.5 text-gray-500">{bom.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400 italic">
              No components linked. Upload a recipe workbook to populate.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showDelete}
        title="Delete Menu Item"
        message={`Are you sure you want to delete "${menuItem.name}"? This will remove all of its component links.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  )
}
