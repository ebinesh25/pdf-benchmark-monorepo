"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check, FileText } from "lucide-react"
import { useRouter } from "next/navigation"
import type { ParserCatalogEntry } from "@/lib/catalog"

interface ToolCardProps {
  tool: ParserCatalogEntry
  isSelected?: boolean
  onSelect?: () => void
  selectionMode?: boolean
}

export default function ToolCard({ tool, isSelected = false, onSelect, selectionMode = false }: ToolCardProps) {
  const router = useRouter()
  return (
    <Card className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] ${isSelected ? "ring-2 ring-primary" : ""}`} onClick={() => router.push(`/tools/${tool.id}`)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-muted"><FileText className="h-6 w-6 text-primary" aria-hidden="true" /></div>
            <div>
              <CardTitle className="text-lg">{tool.name}</CardTitle>
              <Badge variant="secondary" className="mt-1">{tool.category}</Badge>
            </div>
          </div>
          {selectionMode && <Button size="icon" variant={isSelected ? "default" : "outline"} type="button" aria-label={`${isSelected ? "Deselect" : "Select"} ${tool.name}`} aria-pressed={isSelected} onClick={(event) => { event.stopPropagation(); onSelect?.() }}>
            {isSelected && <Check className="h-4 w-4" />}
          </Button>}
        </div>
        <CardDescription className="mt-3">{tool.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Parser ID: <code>{tool.id}</code></p>
        <div className="flex flex-wrap gap-2">{tool.features.map((feature) => <Badge key={feature} variant="outline">{feature}</Badge>)}</div>
      </CardContent>
    </Card>
  )
}
