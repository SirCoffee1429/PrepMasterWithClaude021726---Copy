import { useCallback, useState, useRef } from 'react'
import { Upload, X, FileText, CheckCircle, AlertCircle } from 'lucide-react'
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@/lib/constants'

interface FileUploadProps {
  readonly accept: ReadonlyArray<string>
  readonly onFileSelect: (file: File) => void
  readonly isUploading?: boolean
  readonly uploadStatus?: 'idle' | 'uploading' | 'success' | 'error'
  readonly statusMessage?: string
  readonly label?: string
}

export function FileUpload({
  accept,
  onFileSelect,
  isUploading = false,
  uploadStatus = 'idle',
  statusMessage,
  label = 'Upload File',
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const acceptString = accept.join(',')

  const validateFile = useCallback(
    (file: File): boolean => {
      setValidationError(null)

      const extension = `.${file.name.split('.').pop()?.toLowerCase()}`
      if (!accept.includes(extension)) {
        setValidationError(`Invalid file type. Accepted: ${accept.join(', ')}`)
        return false
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setValidationError(`File too large. Maximum size: ${MAX_FILE_SIZE_MB}MB`)
        return false
      }

      return true
    },
    [accept]
  )

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file)
        onFileSelect(file)
      }
    },
    [validateFile, onFileSelect]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const clearFile = useCallback(() => {
    setSelectedFile(null)
    setValidationError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [])

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
          onChange={handleChange}
          className="hidden"
        />

        {uploadStatus === 'success' ? (
          <CheckCircle className="h-10 w-10 text-green-500" />
        ) : uploadStatus === 'error' ? (
          <AlertCircle className="h-10 w-10 text-red-500" />
        ) : (
          <Upload className="h-10 w-10 text-gray-400" />
        )}

        <div className="text-center">
          <p className="text-base font-medium text-gray-700">{label}</p>
          <p className="mt-1 text-sm text-gray-500">
            Drag & drop or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Accepted: {accept.join(', ')} (max {MAX_FILE_SIZE_MB}MB)
          </p>
        </div>
      </div>

      {selectedFile && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2">
          <FileText className="h-4 w-4 text-gray-500" />
          <span className="flex-1 truncate text-sm text-gray-700">
            {selectedFile.name}
          </span>
          {!isUploading && (
            <button onClick={clearFile} className="p-1 hover:bg-gray-200 rounded">
              <X className="h-4 w-4 text-gray-400" />
            </button>
          )}
        </div>
      )}

      {validationError && (
        <p className="mt-2 text-sm text-red-600">{validationError}</p>
      )}

      {statusMessage && (
        <p
          className={`mt-2 text-sm ${
            uploadStatus === 'error' ? 'text-red-600' : 'text-gray-600'
          }`}
        >
          {statusMessage}
        </p>
      )}
    </div>
  )
}
