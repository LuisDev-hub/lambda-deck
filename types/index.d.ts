export type Tool = { id: string; name: string; detail: string; isDone: boolean; ms: number }
export type Stats = { turns: number; lastMs: number; totalMs: number; tools: number; outTokens: number }
export type Chat = { id: string; title: string; mtime: number; kind: 'cc' | 'llm' }
export type Info = {
  model: string
  cwd: string
  branch: string
  ctxPercent: number
  ctxTokens: number
  ctxWindow: number
  usd: number
  limits: { kind: string; percent: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'lambda-deck': { tools: Shaped<Tool[]>; stats: Shaped<Stats>; info: Shaped<Info>; effort: string; chats: Shaped<Chat[]>; viewing: string; fdir: string; fhid: boolean; ffilter: string; hfilter: string }
  }
}
