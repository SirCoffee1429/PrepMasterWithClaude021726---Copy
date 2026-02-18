import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Calendar, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/constants'
import type { SalesReport, SalesDataItem } from '@/lib/types'
import { FileUpload } from '@/components/shared/FileUpload'

export function SalesDataTab() {
  const queryClient = useQueryClient()
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [parsedItems, setParsedItems] = useState<SalesDataItem[]>([])
  const [showReview, setShowReview] = useState(false)
  const [currentReportId, setCurrentReportId] = useState<string | null>(null)

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

  const handleFileSelect = useCallback(async (file: File) => {
    setUploadStatus('uploading')
    setStatusMessage('Uploading and parsing sales data...')
    setParsedItems([])
    setShowReview(false)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const { data, error } = await supabase.functions.invoke('parse-sales', {
        body: formData,
      })

      if (error) throw error

      setUploadStatus('success')
      setStatusMessage(`Parsed ${data?.items?.length ?? 0} items from sales report.`)
      setParsedItems(data?.items ?? [])
      setCurrentReportId(data?.report_id ?? null)
      setShowReview(true)
      queryClient.invalidateQueries({ queryKey: ['sales-reports'] })
    } catch (err) {
      setUploadStatus('error')
      setStatusMessage(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [queryClient])

  const handleGeneratePrepList = useCallback(async () => {
    if (!currentReportId) return

    try {
      setStatusMessage('Generating prep list...')

      const { data, error } = await supabase.functions.invoke('generate-prep-list', {
        body: { report_id: currentReportId },
      })

      if (error) throw error

      setStatusMessage(`Prep list generated with ${data?.item_count ?? 0} prep items.`)
      setShowReview(false)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to generate prep list')
    }
  }, [currentReportId])

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
        onFileSelect={handleFileSelect}
        uploadStatus={uploadStatus}
        statusMessage={statusMessage}
        label="Upload Sales Report (PDF)"
      />

      {showReview && parsedItems.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
            <h3 className="font-semibold text-gray-900">
              Review Parsed Sales Data ({parsedItems.length} items)
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
                {parsedItems.map((item) => (
                  <tr key={item.id} className="border-t border-gray-100">
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
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Upload History</h3>
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
    </div>
  )
}
