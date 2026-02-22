import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Plus, RefreshCw } from 'lucide-react'

export interface DuplicateGroup {
    label: string
    newItems: string[]
    duplicateItems: string[]
}

interface DuplicateReportProps {
    readonly groups: DuplicateGroup[]
    readonly crossFileDuplicates?: string[]
}

export function DuplicateReport({ groups, crossFileDuplicates = [] }: DuplicateReportProps) {
    const [isExpanded, setIsExpanded] = useState(true)

    const totalDuplicates = groups.reduce((sum, g) => sum + g.duplicateItems.length, 0) + crossFileDuplicates.length
    const totalNew = groups.reduce((sum, g) => sum + g.newItems.length, 0)

    if (totalDuplicates === 0 && totalNew === 0) return null

    return (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 border-b hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {totalDuplicates > 0 ? (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                    ) : (
                        <Plus className="h-5 w-5 text-green-500" />
                    )}
                    <h3 className="font-semibold text-gray-900">
                        Import Summary
                        {totalDuplicates > 0 && (
                            <span className="ml-2 text-sm font-normal text-amber-600">
                                ({totalDuplicates} duplicate{totalDuplicates !== 1 ? 's' : ''} found)
                            </span>
                        )}
                    </h3>
                </div>
                {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                )}
            </button>

            {isExpanded && (
                <div className="p-5 space-y-4">
                    {/* Cross-file duplicates */}
                    {crossFileDuplicates.length > 0 && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <RefreshCw className="h-4 w-4 text-amber-600" />
                                <h4 className="text-sm font-semibold text-amber-800">
                                    Appeared in Multiple Files ({crossFileDuplicates.length})
                                </h4>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {crossFileDuplicates.map((name) => (
                                    <span
                                        key={name}
                                        className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                                    >
                                        {name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Per-category breakdown */}
                    {groups.map((group) => (
                        <div key={group.label}>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">{group.label}</h4>
                            <div className="flex flex-wrap gap-1.5">
                                {group.newItems.map((name) => (
                                    <span
                                        key={`new-${name}`}
                                        className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-800"
                                    >
                                        <Plus className="h-3 w-3" />
                                        {name}
                                    </span>
                                ))}
                                {group.duplicateItems.map((name) => (
                                    <span
                                        key={`dup-${name}`}
                                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                        {name}
                                    </span>
                                ))}
                                {group.newItems.length === 0 && group.duplicateItems.length === 0 && (
                                    <span className="text-xs text-gray-400 italic">None</span>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Legend */}
                    <div className="flex items-center gap-4 pt-2 border-t border-gray-100 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400" />
                            New (created)
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                            Duplicate (updated)
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
