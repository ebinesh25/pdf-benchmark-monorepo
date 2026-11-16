"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { AlertCircle, FileText, Loader2 } from "lucide-react"

type ParserResult = {
  id: string
  sequence: number
  document_id?: string
  filename: string
  parser_id: string
  parser_version: string
  configuration: Record<string, unknown>
  elapsed_ms: number
  queue_wait_ms?: number | null
  status: "completed" | "failed"
  metrics: { character_error_rate?: number | null }
  output_length: number
  error_type?: string | null
  error?: string | null
  full_output_url: string
}

type JobPayload = {
  job_id: string
  kind: string
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed"
  completed_work: number
  total_work: number
  failed_work: number
  filename: string
  dataset_id?: string | null
  dataset_revision?: number | null
  results: ParserResult[]
}

export default function JobPage() {
  const params = useParams()
  const jobId = params.id as string
  const [token, setToken] = useState("")
  const [job, setJob] = useState<JobPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedOutputs, setLoadedOutputs] = useState<Record<string, string>>({})
  const [loadingOutputs, setLoadingOutputs] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const progress = job?.total_work ? Math.round((job.completed_work / job.total_work) * 100) : 0

  useEffect(() => {
    setToken(window.location.hash.slice(1))
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal): Promise<JobPayload | undefined> => {
    if (!token) return
    const response = await fetch(`/api/backend/api/v1/jobs/${jobId}?offset=0&limit=100`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.detail ?? "Could not load this private job.")
    setJob(payload as JobPayload)
    setError(null)
    return payload as JobPayload
  }, [jobId, token])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const updated = await refresh(controller.signal)
        if (!controller.signal.aborted && updated && ["queued", "running"].includes(updated.status)) timer = setTimeout(poll, 2000)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this private job.")
      }
    }
    poll()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [refresh, token])

  const groupedResults = useMemo(() => {
    if (!job) return []
    const groups = new Map<string, ParserResult[]>()
    for (const result of job.results) {
      const key = result.document_id ?? "upload"
      groups.set(key, [...(groups.get(key) ?? []), result])
    }
    return [...groups.entries()]
  }, [job])

  const loadOutput = async (result: ParserResult) => {
    setLoadingOutputs((items) => [...items, result.id])
    try {
      const response = await fetch(`/api/backend${result.full_output_url}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error("Parser output is unavailable.")
      const content = await response.text()
      setLoadedOutputs((values) => ({ ...values, [result.id]: content }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load parser output.")
    } finally {
      setLoadingOutputs((items) => items.filter((id) => id !== result.id))
    }
  }

  const previewPdf = async (documentId: string) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const response = await fetch(`/api/backend/api/v1/jobs/${jobId}/documents/${encodeURIComponent(documentId)}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) { setError("PDF preview is unavailable."); return }
    setPreviewUrl(URL.createObjectURL(await response.blob()))
  }

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  if (!token) return <main className="container mx-auto max-w-5xl px-4 py-12"><h1 className="text-2xl font-bold">Private result link required</h1><p className="mt-2 text-muted-foreground">Open the full result link to restore this job.</p></main>

  return <main className="container mx-auto max-w-7xl space-y-8 px-4 py-10">
    <header><p className="text-sm text-muted-foreground">Private job</p><h1 className="mt-1 text-3xl font-bold">{job?.filename ?? "Loading results…"}</h1>{job?.dataset_id && <p className="mt-2 text-muted-foreground">{job.dataset_id} · revision {job.dataset_revision}</p>}</header>
    {error && <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>}
    {job && <Card><CardContent className="space-y-3 pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={job.status === "completed" ? "default" : job.status === "completed_with_errors" || job.status === "failed" ? "destructive" : "secondary"}>{job.status.replaceAll("_", " ")}</Badge><span className="text-sm text-muted-foreground">{job.completed_work} / {job.total_work} parser tasks · {job.failed_work} failed</span></div><span className="text-sm font-medium">{progress}%</span></div><Progress value={progress} aria-label={`Job progress ${progress}%`} />{job.status === "queued" || job.status === "running" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />The worker is processing this job. This page checks for updates every two seconds.</p> : null}</CardContent></Card>}
    {job && groupedResults.map(([documentId, results]) => <section key={documentId} className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{results[0]?.filename}</h2><Button variant="outline" size="sm" onClick={() => previewPdf(documentId)}><FileText className="mr-2 h-4 w-4" />Preview PDF</Button></div><div className="grid gap-4 lg:grid-cols-2">{results.map((result) => <Card key={result.id}><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span>{result.parser_id} <span className="font-normal text-muted-foreground">v{result.parser_version}</span></span><Badge variant={result.status === "completed" ? "secondary" : "destructive"}>{result.status === "completed" ? `${result.elapsed_ms.toFixed(1)} ms parser time` : result.error_type ?? "failed"}</Badge></CardTitle></CardHeader><CardContent className="space-y-3">{result.queue_wait_ms != null && <p className="text-xs text-muted-foreground">Queue wait: {result.queue_wait_ms.toFixed(1)} ms</p>}{result.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}{result.metrics.character_error_rate !== null && result.metrics.character_error_rate !== undefined && <p className="text-sm">Character error rate: {(result.metrics.character_error_rate * 100).toFixed(2)}%</p>}{result.status === "completed" && (loadedOutputs[result.id] !== undefined ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{loadedOutputs[result.id] || "No text was extracted."}</pre> : <Button variant="outline" disabled={loadingOutputs.includes(result.id)} onClick={() => loadOutput(result)}>{loadingOutputs.includes(result.id) ? "Loading output…" : `Load parser output (${result.output_length.toLocaleString()} characters)`}</Button>)}</CardContent></Card>)}</div></section>)}
    {previewUrl && <Card><CardHeader><CardTitle>PDF preview</CardTitle></CardHeader><CardContent><iframe title="PDF preview" src={previewUrl} className="h-[70vh] w-full rounded border" /></CardContent></Card>}
  </main>
}
