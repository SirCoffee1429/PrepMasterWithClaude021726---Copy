import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LogIn } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { APP_NAME } from '@/lib/constants'

export function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setIsSubmitting(true)

      const { error: signInError } = await signIn(email, password)

      if (signInError) {
        setError(signInError)
        setIsSubmitting(false)
      } else {
        navigate('/office')
      }
    },
    [email, password, signIn, navigate]
  )

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6">
      <button
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-5 w-5" />
        Back
      </button>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-brand-900">{APP_NAME}</h1>
          <p className="mt-2 text-gray-500">Office Login</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-8 shadow-lg border border-gray-200"
        >
          <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="chef@oldhawthorne.com"
                className="
                  w-full rounded-xl border border-gray-300 px-4 py-3 text-base
                  focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200
                  placeholder:text-gray-400
                "
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="
                  w-full rounded-xl border border-gray-300 px-4 py-3 text-base
                  focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200
                  placeholder:text-gray-400
                "
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="
                flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3.5
                text-base font-semibold text-white
                transition-all hover:bg-brand-500 active:bg-brand-700
                disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[48px]
              "
            >
              <LogIn className="h-5 w-5" />
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
