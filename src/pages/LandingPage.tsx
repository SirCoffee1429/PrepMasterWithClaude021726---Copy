import { useNavigate } from 'react-router-dom'
import { ChefHat, Briefcase } from 'lucide-react'
import { APP_NAME } from '@/lib/constants'

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-900 px-6">
      <div className="flex flex-col items-center gap-4 mb-16">
        <h1 className="text-6xl font-bold text-brand-100 tracking-tight">
          {APP_NAME}
        </h1>
        <p className="text-lg text-brand-300">
          The Country Club at Old Hawthorne
        </p>
      </div>

      <div className="flex flex-col gap-6 w-full max-w-md">
        <button
          onClick={() => navigate('/kitchen')}
          className="
            flex items-center justify-center gap-4 rounded-2xl bg-brand-500 px-8 py-7
            text-2xl font-semibold text-white shadow-lg
            transition-all duration-200 hover:bg-brand-400 hover:scale-[1.02]
            active:scale-[0.98] active:bg-brand-600
            min-h-[80px]
          "
        >
          <ChefHat className="h-8 w-8" />
          Kitchen
        </button>

        <button
          onClick={() => navigate('/login')}
          className="
            flex items-center justify-center gap-4 rounded-2xl bg-brand-700 px-8 py-7
            text-2xl font-semibold text-brand-100 shadow-lg border border-brand-600
            transition-all duration-200 hover:bg-brand-600 hover:scale-[1.02]
            active:scale-[0.98] active:bg-brand-800
            min-h-[80px]
          "
        >
          <Briefcase className="h-8 w-8" />
          Office
        </button>
      </div>
    </div>
  )
}
