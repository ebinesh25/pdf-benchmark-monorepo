"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Check, FileText } from "lucide-react"
import type { ParserCatalogEntry } from "@/lib/catalog"

interface ToolSelectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTools: string[]
  onSelectTool: (toolId: string) => void
  tools: ParserCatalogEntry[]
  maxSelections?: number
}

export default function ToolSelectionModal({ open, onOpenChange, selectedTools, onSelectTool, tools, maxSelections = 3 }: ToolSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const filteredTools = useMemo(() => tools.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(searchQuery.toLowerCase()),
  ), [tools, searchQuery])

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>Select Parsers</DialogTitle>
        <DialogDescription>Choose up to {maxSelections} parsers. Selected: {selectedTools.length}.</DialogDescription>
      </DialogHeader>
      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search parsers" placeholder="Search parsers..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-10" /></div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {filteredTools.map((tool) => {
          const selected = selectedTools.includes(tool.id)
          const disabled = !selected && selectedTools.length >= maxSelections
          return <button type="button" key={tool.id} disabled={disabled} aria-pressed={selected} className={`w-full rounded-lg border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/10" : disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted"}`} onClick={() => onSelectTool(tool.id)}>
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted"><FileText className="h-6 w-6 text-primary" aria-hidden="true" /></div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2"><h3 className="font-semibold">{tool.name}</h3>{selected && <Badge className="gap-2"><Check className="h-3 w-3" />Selected</Badge>}</div>
                <Badge variant="secondary" className="mb-2">{tool.category}</Badge>
                <p className="text-sm text-muted-foreground">{tool.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">Parser ID: <code>{tool.id}</code></p>
              </div>
            </div>
          </button>
        })}
      </div>
      <div className="flex items-center justify-between border-t pt-4"><p className="text-sm text-muted-foreground">{selectedTools.length} of {maxSelections} selected</p><Button onClick={() => onOpenChange(false)}>Done</Button></div>
    </DialogContent>
  </Dialog>
}
