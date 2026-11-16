"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type DocumentResult = { document_id: string; filename: string; parser_id: string; parser_version: string; status: string; elapsed_ms: number; queue_wait_ms?: number | null; output_length: number; metrics: { character_error_rate?: number | null }; error_type?: string | null; error?: string | null }
type Report = { job_id: string; dataset_id: string; dataset_revision: number; scoring_version: string; execution_profile: Record<string, unknown>; parser_ids: string[]; document_results: DocumentResult[] }
type DatasetDocument = { _id: string; filename: string; category: string; tags: string[]; source: string; license: string; sha256: string; page_count: number; annotation_coverage: number }

function inlineDiff(before: string, after: string) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return {
    sharedStart: before.slice(0, prefix),
    removed: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
    sharedEnd: suffix ? before.slice(before.length - suffix) : "",
  }
}

export default function ReportPage() {
  const params = useParams()
  const reportId = params.id as string
  const [report, setReport] = useState<Report | null>(null)
  const [documents, setDocuments] = useState<DatasetDocument[]>([])
  const [output, setOutput] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/backend/api/v1/reports/${reportId}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail ?? "Could not load report.")
      setReport(data)
      const docs = await fetch(`/api/backend/api/v1/datasets/${encodeURIComponent(data.dataset_id)}/revisions/${data.dataset_revision}/documents`, { cache: "no-store", signal: controller.signal })
      if (!docs.ok) throw new Error("Could not load published corpus documents.")
      setDocuments(await docs.json())
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load report.") })
    return () => controller.abort()
  }, [reportId])

  const byDocument = useMemo(() => {
    const groups = new Map<string, DocumentResult[]>()
    for (const result of report?.document_results ?? []) groups.set(result.document_id, [...(groups.get(result.document_id) ?? []), result])
    return groups
  }, [report])

  const loadOutput = async (documentId: string, parserId: string) => {
    const key = `${documentId}:${parserId}`
    setLoading((current) => [...current, key])
    try {
      const response = await fetch(`/api/backend/api/v1/reports/${reportId}/documents/${encodeURIComponent(documentId)}/results/${encodeURIComponent(parserId)}/output`)
      if (!response.ok) throw new Error("Published parser output unavailable.")
      const content = await response.text()
      setOutput((current) => ({ ...current, [key]: content }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load parser output.")
    } finally {
      setLoading((current) => current.filter((value) => value !== key))
    }
  }

  const preview = async (documentId: string) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const response = await fetch(`/api/backend/api/v1/datasets/${encodeURIComponent(report!.dataset_id)}/revisions/${report!.dataset_revision}/documents/${encodeURIComponent(documentId)}/pdf`)
    if (!response.ok) { setError("Published PDF preview is unavailable."); return }
    setPreviewUrl(URL.createObjectURL(await response.blob()))
  }

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  return <main className="container mx-auto max-w-7xl space-y-8 px-4 py-10">
    <header><p className="text-sm text-muted-foreground">Published benchmark report</p><h1 className="mt-1 text-3xl font-bold">{report?.dataset_id ?? "Loading report…"} · revision {report?.dataset_revision}</h1>{report && <p className="mt-2 text-sm text-muted-foreground">Scoring {report.scoring_version} · execution profile {JSON.stringify(report.execution_profile)}</p>}</header>
    {error && <p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    {documents.map((document) => { const rows = byDocument.get(document._id) ?? []; const loaded = rows.filter((row) => output[`${document._id}:${row.parser_id}`] !== undefined); return <Card key={document._id}><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{document.filename}</CardTitle><div className="mt-2 flex flex-wrap gap-2"><Badge variant="secondary">{document.category}</Badge><Badge variant="outline">{document.page_count} pages</Badge><Badge variant="outline">{(document.annotation_coverage * 100).toFixed(0)}% annotated</Badge></div><p className="mt-2 text-xs text-muted-foreground">SHA-256 {document.sha256} · {document.license} · {document.source}</p></div><Button variant="outline" size="sm" onClick={() => preview(document._id)}>Preview PDF</Button></div></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2">{rows.map((result) => { const key = `${document._id}:${result.parser_id}`; return <div key={result.parser_id} className="space-y-3 rounded-md border p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{result.parser_id} <span className="font-normal text-muted-foreground">v{result.parser_version}</span></p><Badge variant={result.status === "completed" ? "secondary" : "destructive"}>{result.status === "completed" ? `${result.elapsed_ms.toFixed(1)} ms parser time` : result.error_type ?? "failed"}</Badge></div>{result.queue_wait_ms != null && <p className="text-xs text-muted-foreground">Queue wait: {result.queue_wait_ms.toFixed(1)} ms</p>}{result.metrics.character_error_rate !== null && result.metrics.character_error_rate !== undefined && <p className="text-sm">Character error rate {(result.metrics.character_error_rate * 100).toFixed(2)}%</p>}{result.error && <p className="text-sm text-destructive">{result.error}</p>}{output[key] !== undefined ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{output[key] || "Empty output"}</pre> : result.status === "completed" && <Button variant="outline" size="sm" disabled={loading.includes(key)} onClick={() => loadOutput(document._id, result.parser_id)}>{loading.includes(key) ? "Loading…" : `Load output (${result.output_length.toLocaleString()} characters)`}</Button>}</div> })}</div>{loaded.length >= 2 && <div className="space-y-3 rounded-md border bg-muted/30 p-4"><h3 className="font-semibold">Output difference: {loaded[0].parser_id} vs {loaded[1].parser_id}</h3>{(() => { const diff = inlineDiff(output[`${document._id}:${loaded[0].parser_id}`], output[`${document._id}:${loaded[1].parser_id}`]); return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs"><span>{diff.sharedStart}</span><del className="bg-red-200 text-red-950 dark:bg-red-950 dark:text-red-100">{diff.removed}</del><ins className="bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-100">{diff.inserted}</ins><span>{diff.sharedEnd}</span></pre> })()}</div>}</CardContent></Card> })}
    {previewUrl && <Card><CardHeader><CardTitle>Corpus PDF preview</CardTitle></CardHeader><CardContent><iframe title="Corpus PDF preview" src={previewUrl} className="h-[70vh] w-full rounded border" /></CardContent></Card>}
  </main>
}
