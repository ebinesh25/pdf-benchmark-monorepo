const backendOrigin = () => (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "")

export async function proxyBackend(request: Request, path: string) {
  const incoming = new URL(request.url)
  const target = `${backendOrigin()}/${path.replace(/^\//, "")}${incoming.search}`
  const headers = new Headers()
  for (const key of ["content-type", "authorization", "accept", "x-client-ip"]) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }
  if (!headers.has("x-client-ip")) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const real = request.headers.get("x-real-ip")
    if (real || forwarded) headers.set("x-client-ip", real ?? forwarded!)
  }
  const method = request.method.toUpperCase()
  try {
    const response = await fetch(target, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    })
    const responseHeaders = new Headers()
    for (const key of ["content-type", "content-disposition", "retry-after", "location"]) {
      const value = response.headers.get(key)
      if (value) responseHeaders.set(key, value)
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  } catch {
    return Response.json({ detail: "Could not reach the PDF extraction backend." }, { status: 502 })
  }
}
