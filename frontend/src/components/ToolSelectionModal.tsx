"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Check } from "lucide-react"
import { useState, useMemo } from "react"
import Image from "next/image"
import toolsData from "@/data/pdf-tools.json"
import { isBackendSupportedTool } from "@/lib/backend-tools"

interface ToolSelectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTools: string[]
  onSelectTool: (toolId: string) => void
  maxSelections?: number
}

export default function ToolSelectionModal({ 
  open, 
  onOpenChange, 
  selectedTools, 
  onSelectTool,
  maxSelections = 3 
}: ToolSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredTools = useMemo(() => {
    return toolsData.tools.filter(tool => 
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.category.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [searchQuery])

  const handleToolClick = (toolId: string) => {
    onSelectTool(toolId)
  }

  const isToolSelected = (toolId: string) => selectedTools.includes(toolId)
  const canSelectMore = selectedTools.length < maxSelections

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Tools to Compare</DialogTitle>
          <DialogDescription>
            Choose up to {maxSelections} tools supported by this backend. Currently selected: {selectedTools.length}
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            Accuracy, speed, and cost values are static catalog estimates; their source and test method were not recorded.
          </p>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tools List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {filteredTools.map((tool) => {
            const isSelected = isToolSelected(tool.id)
            const isSupported = isBackendSupportedTool(tool.id)
            const isDisabled = !isSupported || (!isSelected && !canSelectMore)

            return (
              <button
                type="button"
                key={tool.id}
                disabled={isDisabled}
                aria-pressed={isSelected}
                className={`w-full p-4 border rounded-lg text-left transition-all ${
                  isSelected 
                    ? 'bg-primary/10 border-primary' 
                    : isDisabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-muted'
                }`}
                onClick={() => handleToolClick(tool.id)}
              >
                <div className="flex items-start gap-4">
                  <div className="relative h-12 w-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    <Image 
                      src={tool.logo} 
                      alt={tool.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold">{tool.name}</h3>
                      {isSelected && (
                        <Badge variant="default" className="gap-2">
                          <Check className="h-3 w-3" />
                          Selected
                        </Badge>
                      )}
                    </div>
                    <Badge variant="secondary" className="mb-2">
                      {tool.category}
                    </Badge>
                    {!isSupported && (
                      <Badge variant="outline" className="mb-2 ml-2">
                        Not available in this backend
                      </Badge>
                    )}
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {tool.description}
                    </p>
                    
                    <div className="mt-3 flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Accuracy:</span>
                        <span className="font-medium">{tool.benchmarks.accuracy}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Speed:</span>
                        <span className="font-medium">{tool.benchmarks.speed}ms</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Cost:</span>
                        <span className="font-medium">
                          {tool.benchmarks.costPerPage === 0 ? "Free" : `$${tool.benchmarks.costPerPage}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedTools.length} of {maxSelections} tools selected
          </p>
          <Button onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
