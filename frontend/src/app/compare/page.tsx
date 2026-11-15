"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Upload, X, FileText, Plus, Loader2, Play } from "lucide-react"
import ToolSelectionModal from "@/components/ToolSelectionModal"
import toolsData from "@/data/pdf-tools.json"

const BACKEND_TOOL_IDS: Record<string, string> = {
  pypdf2: "pypdf",
  pdfplumber: "pdfplumber",
  pdfminer: "pdfminer",
}

type BenchmarkResult = {
  tool: string
  execution_time_ms: number
  extracted_text_length: number
  extracted_text: string | null
  error: string | null
}

type BenchmarkResponse = {
  filename: string
  file_size_bytes: number
  results: BenchmarkResult[]
}

function ComparePageContent() {
  const searchParams = useSearchParams()
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [benchmarkResponse, setBenchmarkResponse] = useState<BenchmarkResponse | null>(null)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)
  const [isBenchmarking, setIsBenchmarking] = useState(false)

  // Initialize selected tools from URL params
  useEffect(() => {
    const toolsParam = searchParams.get('tools')
    if (toolsParam) {
      const toolIds = toolsParam.split(',').filter(id => 
        Boolean(BACKEND_TOOL_IDS[id]) && toolsData.tools.some(tool => tool.id === id)
      ).slice(0, 3)
      setSelectedTools(toolIds)
    }
  }, [searchParams])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setUploadedFile(file)
      setBenchmarkResponse(null)
      setBenchmarkError(null)
    }
  }

  const handleToolSelect = (toolId: string) => {
    setBenchmarkResponse(null)
    setBenchmarkError(null)
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
    setBenchmarkResponse(null)
    setBenchmarkError(null)
    setSelectedTools(prev => prev.filter(id => id !== toolId))
  }

  const runBenchmark = async () => {
    if (!uploadedFile || selectedTools.length === 0) return

    setIsBenchmarking(true)
    setBenchmarkError(null)
    setBenchmarkResponse(null)

    const formData = new FormData()
    formData.append("file", uploadedFile)
    const query = new URLSearchParams()
    selectedTools.forEach((toolId) => query.append("tools", BACKEND_TOOL_IDS[toolId]))

    try {
      const response = await fetch(`/api/benchmark?${query.toString()}`, {
        method: "POST",
        body: formData,
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.detail ?? "The benchmark request failed.")
      }
      setBenchmarkResponse(payload as BenchmarkResponse)
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : "The benchmark request failed.")
    } finally {
      setIsBenchmarking(false)
    }
  }

  const getToolById = (id: string) => {
    return toolsData.tools.find(tool => tool.id === id)
  }

  const selectedToolsData = selectedTools
    .map(id => getToolById(id))
    .filter(Boolean)

  return (
    <div className="min-h-screen bg-background">
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
                <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-12 h-12 mb-4 text-muted-foreground" />
                    <p className="mb-2 text-sm font-medium">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-muted-foreground">PDF files only (MAX. 10MB)</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    onChange={handleFileUpload}
                  />
                </label>
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
                    onClick={() => {
                      setUploadedFile(null)
                      setBenchmarkResponse(null)
                      setBenchmarkError(null)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

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
              {isBenchmarking ? "Extracting PDF…" : "Run extraction"}
            </Button>
            {!uploadedFile && <p className="text-sm text-muted-foreground">Upload a PDF to start extraction.</p>}
            {uploadedFile && selectedTools.length === 0 && (
              <p className="text-sm text-muted-foreground">Select at least one supported tool.</p>
            )}
            {benchmarkError && (
              <p role="alert" className="text-sm text-destructive">{benchmarkError}</p>
            )}
          </div>

          {/* Comparison Results */}
          {benchmarkResponse && (
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold">Extraction results</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {benchmarkResponse.filename} · {benchmarkResponse.results.length} tools · actual backend results
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {benchmarkResponse.results.map((result) => (
                  <Card key={result.tool}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-3">
                        <span>{result.tool}</span>
                        {result.error ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : (
                          <Badge variant="secondary">{result.execution_time_ms.toFixed(1)} ms</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {result.error ? (
                        <p role="alert" className="text-sm text-destructive">{result.error}</p>
                      ) : (
                        <>
                          <p className="mb-3 text-xs text-muted-foreground">
                            {result.extracted_text_length.toLocaleString()} characters extracted
                          </p>
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm font-mono">
                            {result.extracted_text || "No text was extracted from this PDF."}
                          </pre>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tool Selection Modal */}
      <ToolSelectionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selectedTools={selectedTools}
        onSelectTool={handleToolSelect}
        maxSelections={3}
      />
    </div>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ComparePageContent />
    </Suspense>
  )
}
