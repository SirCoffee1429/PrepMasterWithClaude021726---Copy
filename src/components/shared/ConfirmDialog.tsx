import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
    readonly open: boolean
    readonly title: string
    readonly message: string
    readonly confirmLabel?: string
    readonly cancelLabel?: string
    readonly variant?: 'danger' | 'default'
    readonly onConfirm: () => void
    readonly onCancel: () => void
}

export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        const el = dialogRef.current
        if (!el) return
        if (open && !el.open) el.showModal()
        if (!open && el.open) el.close()
    }, [open])

    if (!open) return null

    const confirmClass =
        variant === 'danger'
            ? 'bg-red-600 hover:bg-red-500 text-white'
            : 'bg-brand-600 hover:bg-brand-500 text-white'

    return (
        <dialog
            ref={dialogRef}
            onClose={onCancel}
            className="fixed inset-0 z-50 m-auto w-full max-w-sm rounded-xl border border-gray-200 bg-white p-0 shadow-2xl backdrop:bg-black/40"
        >
            <div className="flex flex-col gap-4 p-6">
                <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-600">{message}</p>
                <div className="flex justify-end gap-3 pt-2">
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${confirmClass}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </dialog>
    )
}
