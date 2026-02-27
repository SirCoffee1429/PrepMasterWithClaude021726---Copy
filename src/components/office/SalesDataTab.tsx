import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Calendar, CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/constants'
import type { SalesReport, SalesDataItem } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'
import type { FileItem } from '@/components/shared/FileUpload'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

export function SalesDataTab() {
  const queryClient = useQueryClient()
  const [fileItems, setFileItems] = useState<FileItem[]>([])
  const [allParsedItems, setAllParsedItems] = useState<SalesDataItem[]>([])
  const [showReview, setShowReview] = useState(false)
  const [currentReportId, setCurrentReportId] = useState<string | null>(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)

  const { data: reports = [] } = useQuery({
    queryKey: ['sales-reports'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales_reports')
        .select('id, report_date, file_name, status, error_message, created_at')
        .order('report_date', { ascending: false })
        .limit(20)
      return (data ?? []) as SalesReport[]
    },
  })

  const handleFilesSelect = useCallback(async (files: File[]) => {
    const items: FileItem[] = files.map((f) => ({ file: f, status: 'queued' as const }))
    setFileItems(items)
    setAllParsedItems([])
    setShowReview(false)
    setCurrentReportId(null)

    let lastReportId: string | null = null
    const aggregatedItems: SalesDataItem[] = []

    for (let i = 0; i < files.length; i++) {
      setFileItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: 'uploading' as const, message: 'Parsing...' } : item
        )
      )

      try {
        const formData = new FormData()
        formData.append('file', files[i])

        const { data, error } = await supabase.functions.invoke('parse-sales', {
          body: formData,
        })

        if (error) throw error

        const count = data?.items?.length ?? 0
        aggregatedItems.push(...(data?.items ?? []))
        lastReportId = data?.report_id ?? lastReportId

        setFileItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? { ...item, status: 'success' as const, message: `${count} items parsed` }
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

    if (aggregatedItems.length > 0) {
      setAllParsedItems(aggregatedItems)
      setCurrentReportId(lastReportId)
      setShowReview(true)
    }

    queryClient.invalidateQueries({ queryKey: ['sales-reports'] })
  }, [queryClient])

  const handleGeneratePrepList = useCallback(async () => {
    if (!currentReportId) return

    try {
      const { error } = await supabase.functions.invoke('generate-prep-list', {
        body: { report_id: currentReportId },
      })

      if (error) throw error

      setShowReview(false)
    } catch (err) {
      // error handled silently
    }
  }, [currentReportId])

  const isUploading = fileItems.some((f) => f.status === 'uploading')

  // ── Delete all sales data ──
  const deleteAllSalesMutation = useMutation({
    mutationFn: async () => {
      // Delete sales_data first (FK to sales_reports)
      const { error: dataErr } = await supabase.from('sales_data').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (dataErr) throw dataErr
      const { error: reportErr } = await supabase.from('sales_reports').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (reportErr) throw reportErr
    },
    onSuccess: () => {
      setShowDeleteAll(false)
      setFileItems([])
      setAllParsedItems([])
      setShowReview(false)
      queryClient.invalidateQueries({ queryKey: ['sales-reports'] })
    },
    onError: (err) => alert(err instanceof Error ? err.message : 'Failed to delete'),
  })

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      case 'processing':
        return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
      default:
        return <FileText className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FileUpload
        accept={[...ACCEPTED_UPLOAD_TYPES.sales]}
        onFilesSelect={handleFilesSelect}
        isUploading={isUploading}
        fileItems={fileItems}
        label="Upload Sales Reports (PDF)"
      />

      {showReview && allParsedItems.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
            <h3 className="font-semibold text-gray-900">
              Review Parsed Sales Data ({allParsedItems.length} items)
            </h3>
            <button
              onClick={handleGeneratePrepList}
              className="
                rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                hover:bg-brand-500 transition-colors
              "
            >
              Confirm & Generate Prep List
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Item</th>
                  <th className="px-4 py-2.5 text-right font-medium text-gray-600">Units Sold</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Matched To</th>
                </tr>
              </thead>
              <tbody>
                {allParsedItems.map((item, idx) => (
                  <tr key={`${item.raw_item_name}-${idx}`} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 text-gray-900">{item.raw_item_name}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{item.units_sold}</td>
                    <td className="px-4 py-2.5">
                      {item.menu_item ? (
                        <span className="text-green-700">{item.menu_item.name}</span>
                      ) : (
                        <span className="text-amber-600 italic">Unmatched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Upload History</h3>
          {reports.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2
                text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete All
            </button>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {reports.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">File</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      {format(new Date(report.report_date), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {report.file_name ?? 'Unknown'}
                    </td>
                    <td className="px-4 py-2.5 flex items-center gap-2">
                      {statusIcon(report.status)}
                      <span className="capitalize">{report.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-8 text-center text-gray-400">No sales reports uploaded yet</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Sales Data"
        message={`This will permanently delete all ${reports.length} sales reports and their associated data. This cannot be undone. Continue?`}
        confirmLabel="Delete All"
        onConfirm={() => deleteAllSalesMutation.mutate()}
        onCancel={() => setShowDeleteAll(false)}
      />
    </div>
  )
}
