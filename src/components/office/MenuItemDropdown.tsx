import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MenuItem } from '@/lib/types'

interface MenuItemDropdownProps {
  readonly menuItem: MenuItem
}

export function MenuItemDropdown({ menuItem }: MenuItemDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const components = menuItem.components ?? []

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={toggle}
        className="
          flex w-full items-center justify-between px-4 py-3
          bg-white hover:bg-gray-50 transition-colors text-left
        "
      >
        <div>
          <p className="font-medium text-gray-900">{menuItem.name}</p>
          {menuItem.category && (
            <p className="text-xs text-gray-500">{menuItem.category}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {components.length} component{components.length !== 1 ? 's' : ''}
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

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
                    <td className="py-1.5 text-gray-800">
                      {bom.ingredient?.name ?? 'Unknown'}
                    </td>
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
    </div>
  )
}
