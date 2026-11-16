"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ParserCatalogEntry, loadParserCatalog } from "@/lib/catalog"

type Dataset = { dataset_id: string; revision: number; title: string; description: string; document_count: number; categories: string[]; scoring_version: string }
type Report = { job_id: string; dataset_id: string; dataset_revision: number; scoring_version: string; comparable_group: string; parser_ids: string[]; metrics: Record<string, Record<string, { value: number | null; numerator: number; denominator: number }>>; published_at: string }
type Receipt = { result_url: string }

export default function BenchmarksPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [parsers, setParsers] = useState<ParserCatalogEntry[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [selectedDataset, setSelectedDataset] = useState("")
  const [selectedParsers, setSelectedParsers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetch("/api/backend/api/v1/datasets", { cache: "no-store", signal: controller.signal }).then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load datasets."))),
      loadParserCatalog(controller.signal),
      fetch("/api/backend/api/v1/reports", { cache: "no-store", signal: controller.signal }).then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load reports."))),
    ]).then(([datasetData, parserData, reportData]) => {
      setDatasets(datasetData)
      setParsers(parserData)
      setReports(reportData)
      if (datasetData[0]) setSelectedDataset(`${datasetData[0].dataset_id}@${datasetData[0].revision}`)
      setSelectedParsers(parserData.map((parser: ParserCatalogEntry) => parser.id))
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load benchmark data.") })
    return () => controller.abort()
  }, [])

  const selected = useMemo(() => {
    const [datasetId, revision] = selectedDataset.split("@")
    return datasets.find((dataset) => dataset.dataset_id === datasetId && dataset.revision === Number(revision))
  }, [datasets, selectedDataset])

  const toggleParser = (id: string) => setSelectedParsers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])

  const run = async () => {
    if (!selected || !selectedParsers.length) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/backend/api/v1/datasets/${encodeURIComponent(selected.dataset_id)}/runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: selected.revision, parsers: selectedParsers }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail ?? "Could not queue corpus run.")
      window.location.assign((payload as Receipt).result_url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not queue corpus run.")
    } finally {
      setSubmitting(false)
    }
  }

  const reportGroups = useMemo(() => {
    const groups = new Map<string, Report[]>()
    for (const report of reports) groups.set(report.comparable_group, [...(groups.get(report.comparable_group) ?? []), report])
    return [...groups.values()]
  }, [reports])

  return <main className="container mx-auto max-w-7xl space-y-10 px-4 py-10">
    <header><h1 className="text-3xl font-bold">Benchmark corpus</h1><p className="mt-2 max-w-3xl text-muted-foreground">Run the supported parsers against the same frozen corpus revision. Scoring uses page-level reference text and reports availability with each metric.</p></header>
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    <Card><CardHeader><CardTitle>Start a corpus run</CardTitle></CardHeader><CardContent className="space-y-5">
      <label className="block space-y-2 text-sm font-medium">Published dataset revision<select className="w-full rounded-md border bg-background p-2" value={selectedDataset} onChange={(event) => setSelectedDataset(event.target.value)}>{datasets.map((dataset) => <option key={`${dataset.dataset_id}-${dataset.revision}`} value={`${dataset.dataset_id}@${dataset.revision}`}>{dataset.title} · r{dataset.revision} · {dataset.document_count} PDFs</option>)}</select></label>
      {selected && <div><p className="text-sm text-muted-foreground">{selected.description}</p><div className="mt-2 flex flex-wrap gap-2">{selected.categories.map((category) => <Badge key={category} variant="outline">{category}</Badge>)}<Badge variant="secondary">{selected.scoring_version}</Badge></div></div>}
      <div className="space-y-2"><p className="text-sm font-medium">Parsers</p>{parsers.map((parser) => <label key={parser.id} className="flex items-center gap-3 rounded-md border p-3"><Input type="checkbox" className="h-4 w-4" checked={selectedParsers.includes(parser.id)} onChange={() => toggleParser(parser.id)} /><span className="flex-1">{parser.name}</span><code className="text-xs text-muted-foreground">{parser.id}</code></label>)}</div>
      <Button onClick={run} disabled={!selected || !selectedParsers.length || submitting}>{submitting ? "Queueing run…" : "Queue benchmark run"}</Button>
    </CardContent></Card>
    <section className="space-y-5"><div><h2 className="text-2xl font-bold">Published benchmark reports</h2><p className="mt-1 text-sm text-muted-foreground">Reports in a group share dataset revision, scoring version, and execution profile.</p></div>
      {reportGroups.length === 0 && <p className="text-sm text-muted-foreground">No published corpus reports yet.</p>}
      {reportGroups.map((group) => <Card key={group[0].comparable_group}><CardHeader><CardTitle className="text-lg">{group[0].dataset_id} · revision {group[0].dataset_revision}</CardTitle><p className="text-sm text-muted-foreground">Scoring {group[0].scoring_version} · {group.length} comparable runs</p></CardHeader><CardContent className="space-y-4">{group.map((report) => <div key={report.job_id} className="rounded-md border p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Run {report.job_id.slice(0, 8)} · {new Date(report.published_at).toLocaleString()}</p><a href={`/reports/${report.job_id}`} className="text-sm font-medium text-primary underline">Open report and document results</a></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-2">Parser</th><th>Character error rate</th><th>Parse time</th><th>Success rate</th><th>Empty output</th></tr></thead><tbody>{report.parser_ids.map((id) => { const metrics = report.metrics[id]; const fmt = (metric?: { value: number | null; numerator: number; denominator: number }, percent = false) => metric?.value === null || metric?.value === undefined ? `Unscored (${metric?.numerator ?? 0}/${metric?.denominator ?? 0})` : `${percent ? (metric.value * 100).toFixed(1) + "%" : metric.value.toFixed(1) + " ms"} (${metric.numerator}/${metric.denominator})`; return <tr key={id} className="border-b last:border-0"><th className="py-2 font-medium">{id}</th><td>{fmt(metrics.character_error_rate, true)}</td><td>{fmt(metrics.parse_time_ms)}</td><td>{fmt(metrics.success_rate, true)}</td><td>{fmt(metrics.empty_output_rate, true)}</td></tr> })}</tbody></table></div></div>)}</CardContent></Card>)}
    </section>
  </main>
}
