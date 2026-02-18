import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, BarChart3, ClipboardList, UtensilsCrossed, BookOpen } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { APP_NAME } from '@/lib/constants'
import { ParLevelsTab } from '@/components/office/ParLevelsTab'
import { SalesDataTab } from '@/components/office/SalesDataTab'
import { MenuItemsTab } from '@/components/office/MenuItemsTab'
import { RecipesTab } from '@/components/office/RecipesTab'

type TabId = 'par-levels' | 'sales-data' | 'menu-items' | 'recipes'

interface Tab {
  readonly id: TabId
  readonly label: string
  readonly icon: typeof BarChart3
}

const TABS: ReadonlyArray<Tab> = [
  { id: 'par-levels', label: 'Par Levels', icon: ClipboardList },
  { id: 'sales-data', label: 'Sales Data', icon: BarChart3 },
  { id: 'menu-items', label: 'Menu Items', icon: UtensilsCrossed },
  { id: 'recipes', label: 'Recipes', icon: BookOpen },
]

export function OfficeDashboard() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('par-levels')

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/')
  }, [signOut, navigate])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'par-levels':
        return <ParLevelsTab />
      case 'sales-data':
        return <SalesDataTab />
      case 'menu-items':
        return <MenuItemsTab />
      case 'recipes':
        return <RecipesTab />
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{APP_NAME} — Office</h1>
              {profile && (
                <p className="text-sm text-gray-500">
                  {profile.full_name ?? profile.email}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="
              flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2
              text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors
            "
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>

        <div className="mx-auto max-w-6xl px-6">
          <nav className="flex gap-1 -mb-px">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2
                    transition-colors
                    ${
                      isActive
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {renderTabContent()}
      </main>
    </div>
  )
}
