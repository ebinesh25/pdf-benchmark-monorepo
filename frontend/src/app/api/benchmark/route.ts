const SUPPORTED_TOOLS = new Set(["pymupdf", "pdfplumber", "pypdf", "pdfminer"])

export async function POST(request: Request) {
  const incoming = await request.formData()
  const file = incoming.get("file")
  const tools = new URL(request.url).searchParams.getAll("tools")

  if (!(file instanceof File)) {
    return Response.json({ detail: "A PDF file is required." }, { status: 400 })
  }

  if (tools.length === 0 || tools.some((tool) => !SUPPORTED_TOOLS.has(tool))) {
    return Response.json({ detail: "Select at least one supported extraction tool." }, { status: 400 })
  }

  const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "")
  const query = new URLSearchParams()
  tools.forEach((tool) => query.append("tools", tool))

  const backendForm = new FormData()
  backendForm.append("file", file, file.name)

  try {
    const response = await fetch(`${backendUrl}/api/v1/benchmark?${query}`, {
      method: "POST",
      body: backendForm,
      cache: "no-store",
    })

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    })
  } catch {
    return Response.json(
      { detail: "Could not reach the PDF extraction backend." },
      { status: 502 },
    )
  }
}
