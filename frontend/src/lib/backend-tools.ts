export const BACKEND_TOOL_IDS = {
  pypdf2: "pypdf",
  pdfplumber: "pdfplumber",
  pdfminer: "pdfminer",
} as const

export type FrontendToolId = keyof typeof BACKEND_TOOL_IDS

export function isBackendSupportedTool(toolId: string): toolId is FrontendToolId {
  return Object.prototype.hasOwnProperty.call(BACKEND_TOOL_IDS, toolId)
}
