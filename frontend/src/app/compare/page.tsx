"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Upload, X, FileText, Plus, Loader2, Play } from "lucide-react"
import ToolSelectionModal from "@/components/ToolSelectionModal"
import { canonicalParserId, loadParserCatalog, type ParserCatalogEntry } from "@/lib/catalog"

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024

type JobReceipt = { job_id: string; status: string; result_url: string }

function ComparePageContent() {
  const searchParams = useSearchParams()
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [tools, setTools] = useState<ParserCatalogEntry[]>([])
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)
  const [isBenchmarking, setIsBenchmarking] = useState(false)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    loadParserCatalog(controller.signal).then(setTools).catch((error) => setBenchmarkError(error instanceof Error ? error.message : "Could not load parser catalog."))
    return () => controller.abort()
  }, [])

  // Initialize selected tools from URL params
  useEffect(() => {
    const toolsParam = searchParams.get('tools')
    if (!toolsParam) {
      setSelectedTools([])
      setSelectionNotice(null)
      return
    }

    const requestedTools = toolsParam.split(",").filter(Boolean)
    const canonicalTools = requestedTools.map(canonicalParserId)
    const availableTools = canonicalTools.filter((id) => tools.some((tool) => tool.id === id))
    const unavailableTools = canonicalTools.filter((id) => !tools.some((tool) => tool.id === id))
    setSelectedTools([...new Set(availableTools)].slice(0, 3))

    if (unavailableTools.length > 0 && tools.length) {
      const unavailableNames = unavailableTools
      setSelectionNotice(
        `${unavailableNames.join(", ")} ${unavailableNames.length === 1 ? "is" : "are"} not available in the current parser catalog.`,
      )
    } else {
      setSelectionNotice(null)
    }
  }, [searchParams, tools])

  const handleSelectedFile = (file: File | null) => {
    if (!file) return

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Choose a PDF file to continue.")
      return
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      setUploadError("This PDF is larger than 10 MB. Choose a smaller file.")
      return
    }

    setUploadError(null)
    setUploadedFile(file)
    setBenchmarkError(null)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleSelectedFile(e.currentTarget.files?.[0] ?? null)
    e.currentTarget.value = ""
  }

  const handleToolSelect = (toolId: string) => {
    setBenchmarkError(null)
    setSelectionNotice(null)
    setSelectedTools(prev => {
      if (prev.includes(toolId)) {
        return prev.filter(id => id !== toolId)
      } else if (prev.length < 3) {
        return [...prev, toolId]
      }
      return prev
    })
  }

  const removeToolSlot = (toolId: string) => {
    setBenchmarkError(null)
    setSelectionNotice(null)
    setSelectedTools(prev => prev.filter(id => id !== toolId))
  }

  const runBenchmark = async () => {
    if (!uploadedFile || selectedTools.length === 0) return

    setIsBenchmarking(true)
    setBenchmarkError(null)

    const formData = new FormData()
    formData.append("file", uploadedFile)
    const query = new URLSearchParams()
    selectedTools.forEach((toolId) => query.append("tools", canonicalParserId(toolId)))

    try {
      const response = await fetch(`/api/backend/api/v1/benchmark?${query.toString()}`, {
        method: "POST",
        body: formData,
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.detail ?? "The benchmark request failed.")
      }
      const receipt = payload as JobReceipt
      window.location.assign(receipt.result_url)
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : "The benchmark request failed.")
    } finally {
      setIsBenchmarking(false)
    }
  }

  const getToolById = (id: string) => {
    return tools.find(tool => tool.id === id)
  }

  const selectedToolsData = selectedTools
    .map(id => getToolById(id))
    .filter((tool): tool is ParserCatalogEntry => Boolean(tool))

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Compare PDF Tools
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Upload your PDF and compare extraction results from up to 3 different tools side by side.
            </p>
          </div>

          {/* PDF Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle>Upload PDF Document</CardTitle>
            </CardHeader>
            <CardContent>
              {!uploadedFile ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setIsDragging(false)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setIsDragging(false)
                    handleSelectedFile(event.dataTransfer.files[0] ?? null)
                  }}
                  className={`rounded-lg ${isDragging ? "bg-primary/5 ring-2 ring-primary" : ""}`}
                >
                  <label
                    htmlFor="pdf-upload"
                    className="flex h-48 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/20 cursor-pointer transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-12 h-12 mb-4 text-muted-foreground" aria-hidden="true" />
                      <p className="mb-2 text-sm font-medium">Choose a PDF or drag it here</p>
                      <p id="pdf-upload-help" className="text-xs text-muted-foreground">PDF files up to 10 MB</p>
                    </div>
                    <input
                      id="pdf-upload"
                      type="file"
                      className="sr-only"
                      aria-label="Choose a PDF document"
                      aria-describedby={uploadError ? "pdf-upload-help pdf-upload-error" : "pdf-upload-help"}
                      accept="application/pdf,.pdf"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium">{uploadedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${uploadedFile.name}`}
                    onClick={() => {
                      setUploadedFile(null)
                      setBenchmarkError(null)
                      setUploadError(null)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {uploadError && (
            <p id="pdf-upload-error" role="alert" className="text-sm text-destructive">
              {uploadError}
            </p>
          )}

          {/* Tool Selection Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Selected extraction tools</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedTools.length} of 3 tools selected
                </p>
              </div>
              <Button onClick={() => setModalOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {selectedTools.length > 0 ? 'Change Tools' : 'Add Tools'}
              </Button>
            </div>

            {selectedTools.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">No tools selected for comparison</p>
                  <Button onClick={() => setModalOpen(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Select Tools
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {selectedToolsData.map((tool: any) => (
                  <Card key={tool.id} className="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2 z-10"
                      aria-label={`Remove ${tool.name}`}
                      onClick={() => removeToolSlot(tool.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <CardHeader>
                      <CardTitle className="text-lg pr-8">{tool.name}</CardTitle>
                      <Badge variant="secondary" className="w-fit">{tool.category}</Badge>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{tool.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {selectionNotice && (
            <p role="status" className="rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              {selectionNotice}
            </p>
          )}

          <div className="flex flex-col items-center gap-3">
            <Button
              size="lg"
              onClick={runBenchmark}
              disabled={!uploadedFile || selectedTools.length === 0 || isBenchmarking}
              className="gap-2"
            >
              {isBenchmarking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isBenchmarking ? "Queueing comparison…" : "Queue comparison"}
            </Button>
            {!uploadedFile && <p className="text-sm text-muted-foreground">Upload a PDF to start extraction.</p>}
            {uploadedFile && selectedTools.length === 0 && (
              <p className="text-sm text-muted-foreground">Select at least one supported tool.</p>
            )}
            {benchmarkError && (
              <p role="alert" className="text-sm text-destructive">{benchmarkError}</p>
            )}
          </div>

        </div>
      </div>

      {/* Tool Selection Modal */}
      <ToolSelectionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selectedTools={selectedTools}
        onSelectTool={handleToolSelect}
        tools={tools}
        maxSelections={3}
      />
    </main>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" aria-busy="true">Loading comparison tools…</main>}>
      <ComparePageContent />
    </Suspense>
  )
}
