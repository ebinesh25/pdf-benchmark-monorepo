export type ParserCatalogEntry = {
  id: string
  name: string
  description: string
  category: string
  features: string[]
  package: string
  enabled: boolean
}

export function canonicalParserId(id: string) {
  return id === "pypdf2" ? "pypdf" : id
}

export async function loadParserCatalog(signal?: AbortSignal): Promise<ParserCatalogEntry[]> {
  const response = await fetch("/api/backend/api/v1/parsers", { cache: "no-store", signal })
  if (!response.ok) throw new Error("Could not load the parser catalog.")
  return response.json()
}
