import { useCallback, useState, useRef } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@/lib/constants'

export type FileStatus = 'queued' | 'uploading' | 'success' | 'error'

export interface FileItem {
  file: File
  status: FileStatus
  message?: string
}

interface FileUploadProps {
  readonly accept: ReadonlyArray<string>
  readonly onFilesSelect: (files: File[]) => void
  readonly multiple?: boolean
  readonly isUploading?: boolean
  readonly fileItems?: ReadonlyArray<FileItem>
  readonly label?: string
}

export function FileUpload({
  accept,
  onFilesSelect,
  multiple = true,
  isUploading = false,
  fileItems = [],
  label = 'Upload Files',
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const acceptString = accept.join(',')

  const validateFile = useCallback(
    (file: File): boolean => {
      const extension = `.${file.name.split('.').pop()?.toLowerCase()}`
      if (!accept.includes(extension)) {
        return false
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return false
      }
      return true
    },
    [accept]
  )

  const handleFiles = useCallback(
    (rawFiles: FileList | File[]) => {
      setValidationError(null)
      const files = Array.from(rawFiles)

      const invalid = files.filter((f) => !validateFile(f))
      if (invalid.length > 0) {
        const names = invalid.map((f) => f.name).join(', ')
        setValidationError(
          `Skipped invalid files: ${names}. Accepted: ${accept.join(', ')} (max ${MAX_FILE_SIZE_MB}MB)`
        )
      }

      const valid = files.filter((f) => validateFile(f))
      if (valid.length > 0) {
        onFilesSelect(valid)
      }
    },
    [validateFile, onFilesSelect, accept]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files)
      }
      // Reset input so the same files can be selected again
      if (inputRef.current) inputRef.current.value = ''
    },
    [handleFiles]
  )

  const overallStatus = fileItems.length === 0
    ? 'idle'
    : fileItems.every((f) => f.status === 'success')
      ? 'success'
      : fileItems.some((f) => f.status === 'error')
        ? 'error'
        : fileItems.some((f) => f.status === 'uploading')
          ? 'uploading'
          : 'idle'

  const completedCount = fileItems.filter(
    (f) => f.status === 'success' || f.status === 'error'
  ).length

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8
          cursor-pointer transition-all duration-200
          ${isDragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-400 hover:bg-brand-50/50'}
          ${isUploading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptString}
          multiple={multiple}
          onChange={handleChange}
          className="hidden"
        />

        {overallStatus === 'success' ? (
          <CheckCircle className="h-10 w-10 text-green-500" />
        ) : overallStatus === 'error' ? (
          <AlertCircle className="h-10 w-10 text-red-500" />
        ) : (
          <Upload className="h-10 w-10 text-gray-400" />
        )}

        <div className="text-center">
          <p className="text-base font-medium text-gray-700">{label}</p>
          <p className="mt-1 text-sm text-gray-500">
            Drag & drop or click to browse{multiple ? ' (multiple files OK)' : ''}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Accepted: {accept.join(', ')} (max {MAX_FILE_SIZE_MB}MB each)
          </p>
        </div>
      </div>

      {/* Progress summary */}
      {fileItems.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {fileItems.length > 1 && (
            <p className="text-sm font-medium text-gray-600 mb-2">
              {overallStatus === 'uploading'
                ? `Processing ${completedCount + 1} of ${fileItems.length} files...`
                : `${completedCount} of ${fileItems.length} files processed`}
            </p>
          )}
          {fileItems.map((item, index) => (
            <div
              key={`${item.file.name}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2"
            >
              {item.status === 'uploading' ? (
                <Loader2 className="h-4 w-4 text-brand-500 animate-spin shrink-0" />
              ) : item.status === 'success' ? (
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              ) : item.status === 'error' ? (
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              )}
              <span className="flex-1 truncate text-sm text-gray-700">
                {item.file.name}
              </span>
              {item.message && (
                <span
                  className={`text-xs shrink-0 ${item.status === 'error' ? 'text-red-600' : 'text-gray-500'
                    }`}
                >
                  {item.message}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {validationError && (
        <p className="mt-2 text-sm text-red-600">{validationError}</p>
      )}
    </div>
  )
}
