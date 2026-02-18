interface ConnectionStatusProps {
  readonly isConnected: boolean
}

export function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div
        className={`h-2.5 w-2.5 rounded-full ${
          isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'
        }`}
      />
      <span className={isConnected ? 'text-green-700' : 'text-red-600 font-medium'}>
        {isConnected ? 'Live' : 'Offline'}
      </span>
    </div>
  )
}
