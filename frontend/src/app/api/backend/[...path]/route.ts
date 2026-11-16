import { proxyBackend } from "@/lib/backend-proxy"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ path: string[] }> }

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params
  return proxyBackend(request, path.join("/"))
}

export const GET = forward
export const POST = forward
