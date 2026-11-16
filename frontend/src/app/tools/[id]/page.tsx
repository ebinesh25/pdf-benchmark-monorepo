"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, FileText, Loader2, Upload } from "lucide-react"
import { canonicalParserId, loadParserCatalog, type ParserCatalogEntry } from "@/lib/catalog"

type JobReceipt = { result_url: string }

export default function ToolDetailPage() {
  const router = useRouter()
  const params = useParams()
  const toolId = canonicalParserId(params.id as string)
  const [tools, setTools] = useState<ParserCatalogEntry[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const tool = tools.find((entry) => entry.id === toolId)

  useEffect(() => {
    const controller = new AbortController()
    loadParserCatalog(controller.signal).then(setTools).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load parser catalog."))
    return () => controller.abort()
  }, [])

  const submit = async () => {
    if (!file || !tool) return
    setSubmitting(true)
    setError(null)
    const form = new FormData()
    form.append("file", file)
    try {
      const response = await fetch(`/api/backend/api/v1/extract/${tool.id}`, { method: "POST", body: form })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail ?? "Could not queue extraction.")
      window.location.assign((payload as JobReceipt).result_url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not queue extraction.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!tool) return <main className="container mx-auto max-w-5xl px-4 py-12"><h1 className="text-3xl font-bold">{tools.length ? "Parser not found" : "Loading parser…"}</h1>{error && <p role="alert" className="mt-4 text-destructive">{error}</p>}</main>

  return <main className="container mx-auto max-w-5xl space-y-8 px-4 py-10">
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div className="flex items-start gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-muted"><FileText className="h-8 w-8 text-primary" aria-hidden="true" /></div><div><h1 className="text-3xl font-bold">{tool.name}</h1><p className="mt-2 text-muted-foreground">{tool.description}</p><div className="mt-3 flex gap-2"><Badge variant="secondary">{tool.category}</Badge><Badge variant="outline">{tool.package}</Badge></div></div></div>
      <div className="w-full md:w-64"><label className="mb-2 block text-sm font-medium">Switch parser</label><Select value={tool.id} onValueChange={(id) => router.push(`/tools/${id}`)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{tools.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <Card><CardHeader><CardTitle>Supported capabilities</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-3">{tool.features.map((feature) => <div key={feature} className="flex items-center gap-2 rounded-md border p-3"><CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /><span className="text-sm">{feature}</span></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Run an extraction</CardTitle><p className="text-sm text-muted-foreground">Upload a PDF to queue this parser. Results open in a private link and remain available for 24 hours after completion.</p></CardHeader><CardContent className="space-y-4">
      <label htmlFor="single-pdf-upload" className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center hover:bg-muted/50"><Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><span>{file?.name ?? "Choose a PDF (up to 10 MiB; 100 pages)"}</span><input id="single-pdf-upload" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => { const selected = event.currentTarget.files?.[0] ?? null; if (selected && selected.size > 10 * 1024 * 1024) { setError("PDF exceeds the 10 MiB upload limit."); setFile(null) } else { setError(null); setFile(selected) } event.currentTarget.value = "" }} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={!file || submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Queueing…</> : "Queue extraction"}</Button>
    </CardContent></Card>
  </main>
}
