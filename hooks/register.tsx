import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Chat, Info, Stats, Tool } from '../types'

const PANE = 'dash'
const PICKER = 'dash-models'
const EFFORT = 'dash-effort'
const CHATS = 'dash-chats'
const FILES = 'dash-files'
const HELP = 'dash-help'

// (atajo, descripción, comando que corre al pulsar la fila; '' = solo informativo)
const MENU: [string, string, string][] = [
  ['COMANDOS', '', ''],
  ['/info', 'panel de info: sesión, contexto, turnos, actividad', 'info'],
  ['/model', 'selector de modelo (1-8)', 'model'],
  ['/effort', 'selector de esfuerzo (1-5)', 'effort'],
  ['/chats', 'conversaciones previas del proyecto; Enter retoma', 'chats'],
  ['/file [ruta]', 'explorador: pega la ruta en el prompt', 'file'],
  ['/ayuda', 'esta ayuda', ''],
  ['PANELES', '', ''],
  ['Tab  Enter', 'moverse entre elementos · activar', ''],
  ['1-9', 'atajo numérico en selectores', ''],
  ['Esc', 'cerrar el panel', ''],
  ['ctrl+x tab', 'cambiar entre paneles abiertos', ''],
  ['ctrl+x x  ×', 'cerrar el panel actual', ''],
  ['EXPLORADOR', '', ''],
  ['escribir', 'filtrar · o una ruta (/… ~/…) + Enter', ''],
  ['▸ carpeta', 'Enter entra', ''],
  ['archivo', 'Enter pega la ruta en el prompt', ''],
  ['● (esta carpeta)', 'pega la ruta de la carpeta actual', ''],
]
const LEVELS = [
  { id: 'low', note: 'rápido, poco razonamiento' },
  { id: 'medium', note: 'equilibrado' },
  { id: 'high', note: 'razona más' },
  { id: 'xhigh', note: 'razona mucho' },
  { id: 'max', note: 'máximo esfuerzo' },
]
// Modelos del selector: alias y nombre que se pasa a «/model <nombre>». Edita la lista a tu gusto.
const MODELS = [
  { id: 'default', label: 'default', note: 'el recomendado' },
  { id: 'opus', label: 'opus', note: 'más capaz' },
  { id: 'sonnet', label: 'sonnet', note: 'equilibrado' },
  { id: 'haiku', label: 'haiku', note: 'rápido' },
  { id: 'claude-fable-5-1', label: 'fable 5.1', note: 'claude-fable-5-1' },
  { id: 'claude-opus-5-5', label: 'opus 5.5', note: 'claude-opus-5-5' },
  { id: 'claude-sonnet-5-5', label: 'sonnet 5.5', note: 'claude-sonnet-5-5' },
  { id: 'claude-haiku-5-5', label: 'haiku 5.5', note: 'claude-haiku-5-5' },
]
// Tokens del diseño «LLM TUI»
const ACCENT = '#d7875f'
const TEAL = '#4fb3b3'
const CODE = '#d7af87'
const DIM = '#808080'
const LINE = '#3a3d42'
const BAD = '#d75f5f'
const WARN = CODE

const tools = atom({ plugin: 'lambda-deck', key: 'tools' } as const, [], { shape: 'tools-1' })
const stats = atom(
  { plugin: 'lambda-deck', key: 'stats' } as const,
  { turns: 0, lastMs: 0, totalMs: 0, tools: 0, outTokens: 0 },
  { shape: 'stats-1' },
)
// Último nivel elegido desde el selector (el motor no expone el actual).
const effort = atom({ plugin: 'lambda-deck', key: 'effort' } as const, '')
const chats = atom({ plugin: 'lambda-deck', key: 'chats' } as const, [], { shape: 'chats-3' })
const fdir = atom({ plugin: 'lambda-deck', key: 'fdir' } as const, '')
const fhid = atom({ plugin: 'lambda-deck', key: 'fhid' } as const, false)
const ffilter = atom({ plugin: 'lambda-deck', key: 'ffilter' } as const, '')
const hfilter = atom({ plugin: 'lambda-deck', key: 'hfilter' } as const, '')
const info = atom(
  { plugin: 'lambda-deck', key: 'info' } as const,
  { model: '', cwd: '', branch: '', ctxPercent: 0, ctxTokens: 0, ctxWindow: 0, usd: 0, limits: [] },
  { shape: 'info-1' },
)

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const k = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n))
const secs = (ms: number) => (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's')
const bar = (pct: number, w: number) => {
  const on = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  return '█'.repeat(on) + '░'.repeat(w - on)
}
const heat = (pct: number) => (pct >= 85 ? BAD : pct >= 60 ? WARN : TEAL)

// Resumen de una llamada a herramienta: lo más útil de sus argumentos.
const detail = (e: Record<string, unknown>) => {
  const v = (e.command ?? e.file_path ?? e.path ?? e.pattern ?? e.url ?? e.query ?? '') as string
  return String(v).replace(/\s+/g, ' ')
}

// Lista las conversaciones guardadas de este proyecto (~/.claude/projects/<carpeta>/*.jsonl),
// las más recientes primero; ignora las que no tienen ningún mensaje real.
const SCAN = [
  'import sys,os,json,glob',
  'out=[]',
  'for f in glob.glob(sys.argv[1]+"/*.jsonl"):',
  ' t=None;first=None',
  ' for l in open(f,errors="ignore"):',
  '  if \'"ai-title"\' in l:',
  '   try: t=json.loads(l).get("aiTitle") or t',
  '   except Exception: pass',
  '  elif first is None and \'"type":"user"\' in l:',
  '   try:',
  '    o=json.loads(l);c=o.get("message",{}).get("content")',
  '    if isinstance(c,str) and not c.startswith("<") and not o.get("isMeta"): first=c',
  '   except Exception: pass',
  ' if t or first: out.append({"id":os.path.basename(f)[:-6],"title":(t or first).strip().replace("\\n"," ")[:80],"mtime":int(os.path.getmtime(f)*1000)})',
  'out.sort(key=lambda x:-x["mtime"])',
  'print(json.dumps(out[:40]))',
].join('\n')

async function loadChats($: any) {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const dir = `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
  const ran = await $.process.run(['python3', '-c', SCAN, dir], { timeoutMs: 8000 }).catch(() => null)
  let list: Chat[] = []
  try {
    list = ran && ran.exitCode === 0 ? JSON.parse(ran.stdout) : []
  } catch {
    list = []
  }
  await update($, chats, () => list)
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 1 ? 'ahora' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'
}

const bytes = (n: number) => (n < 1024 ? n + 'B' : n < 1048576 ? Math.round(n / 1024) + 'K' : (n / 1048576).toFixed(1) + 'M')
const quote = (p: string) => (/\s/.test(p) ? `"${p}"` : p)

// Pega una ruta en el prompt, en el cursor, sin tocar lo que ya había escrito.
async function insertPath($: any, path: string) {
  await $.ui.close({ id: FILES })
  await $.prompt.fill({ text: quote(path) + ' ', mode: 'insert' })
}

function open($: any) {
  return $.ui.open({ id: PANE, title: 'info' })
}

// Relee modelo, contexto, coste y límites; los pone en el panel y en la status line.
async function refresh($: any) {
  const [model, cwd, u] = await Promise.all([$.session.model(), $.session.cwd(), $.session.usage()])
  const git = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 2000 }).catch(() => null)
  const branch = git && git.exitCode === 0 ? git.stdout.trim() : ''
  const pct = Math.round(u.context.percent ?? 0)
  await update($, info, () => ({
    model,
    cwd,
    branch,
    ctxPercent: pct,
    ctxTokens: u.context.tokens ?? 0,
    ctxWindow: u.context.window,
    usd: u.cost?.usd ?? 0,
    limits: u.rateLimits.map((r: any) => ({ kind: r.kind, percent: Math.round(r.percentUsed) })),
  }))
  $.ui.status(`${model} · ctx ${pct}%${branch ? ' · ' + branch : ''}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dash', description: 'Abrir el panel info (dashboard)' })
    await $.command.register({ name: 'ayuda', description: 'Ayuda: comandos y atajos del mod' })
    await $.command.register({ name: 'file', description: 'Explorador: elige un archivo o carpeta y pega su ruta', argumentHint: '[ruta]' })
    await $.command.register({ name: 'chats', description: 'Ver las conversaciones previas y retomar una' })
    await $.command.register({ name: 'info', description: 'Abrir el panel info (dashboard)' })
    void open($)
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'info' }, async $ => {
    await open($)
    return { text: 'Panel info abierto.' }
  })

  on('command.run', { command: 'dash' }, async $ => {
    await open($)
    return { text: 'Panel info abierto.' }
  })

  // /model sin argumentos abre el selector; con argumentos corre el comando original.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    if (e.args.trim() !== '') return next(e)
    await $.ui.open({ id: PICKER, title: 'modelo', focus: true, closeOnEscape: true })
    return { text: 'Selector de modelo abierto (1-8, o Tab/Enter; Esc cierra).' }
  })

  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = (await $.session.model()).toLowerCase()
    // Un id completo se marca por igualdad; un alias solo si ningún id completo coincide.
    const hasFull = MODELS.some(m => m.id.startsWith('claude-') && m.id === current)
    const isCurrent = (id: string) =>
      id.startsWith('claude-') ? id === current : !hasFull && id !== 'default' && current.includes(id)
    const pick = async (id: string) => {
      await $.ui.close({ id: PICKER })
      await $.command.run({ command: 'model', args: id })
      void refresh($)
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={ACCENT}>{'─ modelos '}</Text>
          <Text color={LINE}>{'─'.repeat(Math.max(2, e.props.bodyColumns - 14))}</Text>
        </Box>
        {MODELS.map((m, n) => (
          <Button key={m.id} hotkey={String(n + 1)} onPress={() => pick(m.id)}>
            <Text color={isCurrent(m.id) ? TEAL : undefined} bold={isCurrent(m.id)}>
              {isCurrent(m.id) ? '● ' : '○ '}{m.label.padEnd(12)}
            </Text>
            <Text color={DIM}>{m.note}</Text>
          </Button>
        ))}
        <Text color={DIM}>{' '}</Text>
        <Text color={DIM}>actual: {current || '—'} · Esc cierra</Text>
      </Box>
    )
  })

  // /effort sin argumentos abre el selector; con argumentos corre el comando original.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    if (e.args.trim() !== '') return next(e)
    await $.ui.open({ id: EFFORT, title: 'esfuerzo', focus: true, closeOnEscape: true })
    return { text: 'Selector de esfuerzo abierto (1-5, o Tab/Enter; Esc cierra).' }
  })

  on('ui.render', { component: 'Pane', requestId: EFFORT }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, effort)
    const pick = async (id: string) => {
      await $.ui.close({ id: EFFORT })
      await update($, effort, () => id)
      await $.command.run({ command: 'effort', args: id })
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={ACCENT}>{'─ esfuerzo '}</Text>
          <Text color={LINE}>{'─'.repeat(Math.max(2, e.props.bodyColumns - 15))}</Text>
        </Box>
        {LEVELS.map((l, n) => (
          <Button key={l.id} hotkey={String(n + 1)} onPress={() => pick(l.id)}>
            <Text color={current === l.id ? TEAL : undefined} bold={current === l.id}>
              {current === l.id ? '● ' : '○ '}{l.id.padEnd(8)}
            </Text>
            <Text color={DIM}>{l.note}</Text>
          </Button>
        ))}
        <Text color={DIM}>{' '}</Text>
        <Text color={DIM}>{current ? 'elegido aquí: ' + current : 'nivel actual desconocido hasta que elijas uno'} · Esc cierra</Text>
      </Box>
    )
  })

  // /chats abre la lista de conversaciones previas; elegir una ejecuta /resume <id>.
  on('command.run', { command: 'chats' }, async $ => {
    await loadChats($)
    await $.ui.open({ id: CHATS, title: 'chats', focus: true, closeOnEscape: true })
    return { text: 'Panel de chats abierto: elige una conversación previa (1-9, o Tab/Enter; Esc cierra).' }
  })

  on('ui.render', { component: 'Pane', requestId: CHATS }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, chats)
    const now = await $.clock.now()
    const w = Math.max(16, e.props.bodyColumns - 4)
    const resume = async (id: string) => {
      await $.ui.close({ id: CHATS })
      await $.command.run({ command: 'resume', args: id }).catch(() => {
        $.ui.toast(`Retómalo con: claude --resume ${id}`)
      })
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={ACCENT}>{'─ chats '}</Text>
          <Text color={LINE}>{'─'.repeat(Math.max(2, w - 8))}</Text>
          <Text color={DIM}> {list.length}</Text>
        </Box>
        {list.length === 0 && <Text color={DIM}>sin conversaciones previas en este proyecto</Text>}
        {list.map((c, n) => (
          <Button key={c.id} hotkey={n < 9 ? String(n + 1) : undefined} onPress={() => resume(c.id)}>
            <Text color={n === 0 ? ACCENT : undefined}>{n === 0 ? '● ' : '  '}{short(c.title, w - 14).padEnd(Math.min(w - 14, 38))}</Text>
            <Text color={DIM}> {ago(now - c.mtime)}</Text>
          </Button>
        ))}
        <Text color={DIM}>{' '}</Text>
        <Text color={DIM}>Enter retoma · Esc cierra</Text>
      </Box>
    )
  })

  // /file [ruta] abre el explorador; elegir un archivo o carpeta pega su ruta en el prompt.
  on('command.run', { command: 'file' }, async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    const arg = e.args.trim().replace(/^~/, home)
    const start = arg !== '' ? arg : (await read($, fdir)) || (await $.session.cwd())
    await update($, fdir, () => start)
    await update($, ffilter, () => '')
    await $.ui.open({ id: FILES, title: 'archivos', focus: true, closeOnEscape: true })
    return { text: 'Explorador abierto: Tab/Enter navega, escribe para filtrar, Esc cierra.' }
  })

  on('ui.render', { component: 'Pane', requestId: FILES }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const home = (await $.env.get('HOME')) ?? ''
    const dir = (await read($, fdir)) || (await $.session.cwd())
    const showHidden = await read($, fhid)
    const filter = await read($, ffilter)
    const w = Math.max(16, e.props.bodyColumns - 4)
    const rows = e.viewport?.rows ?? 30
    const all = (await $.fs.list(dir).catch(() => [])) as any[]
    const ents = all
      .filter(x => (showHidden || !x.name.startsWith('.')) && x.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || a.name.localeCompare(b.name))
    const room = Math.max(5, rows - 12)
    const go = (path: string) => async () => {
      await update($, fdir, () => path)
      await update($, ffilter, () => '')
    }
    const parent = dir.replace(/\/[^/]*\/?$/, '') || '/'
    const pretty = (p: string) => (home !== '' && p.startsWith(home) ? '~' + p.slice(home.length) : p)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={ACCENT}>{'─ archivos '}</Text>
          <Text color={DIM}>{short(pretty(dir), w - 12)}</Text>
        </Box>
        <Input
          key="filter"
          placeholder="filtra, o escribe una ruta y Enter"
          value={filter}
          autoFocus
          onInput={v => void update($, ffilter, () => v)}
          onSubmit={async v => {
            const typed = v.trim().replace(/^~/, home)
            if (!typed.startsWith('/')) return
            const st = await $.fs.stat(typed).catch(() => null)
            if (st === null) return
            if (st.kind === 'dir') await go(typed)()
            else await insertPath($, typed)
          }}
        />
        <Button key="up" onPress={go(parent)}>
          <Text color={DIM}>{'↑ ..'}</Text>
        </Button>
        <Button key="here" onPress={() => insertPath($, dir)}>
          <Text color={ACCENT}>{'● (esta carpeta) '}</Text>
          <Text color={DIM}>pega la ruta</Text>
        </Button>
        {ents.slice(0, room).map(x => {
          const path = `${dir.replace(/\/$/, '')}/${x.name}`
          return x.kind === 'dir' ? (
            <Button key={x.name} onPress={go(path)}>
              <Text color={TEAL} bold>{'▸ ' + short(x.name, w - 12) + '/'}</Text>
            </Button>
          ) : (
            <Button key={x.name} onPress={() => insertPath($, path)}>
              <Text>{'  ' + short(x.name, w - 18)}</Text>
              <Text color={DIM}>{' ' + bytes(x.size)}</Text>
            </Button>
          )
        })}
        {ents.length > room && <Text color={DIM}>… {ents.length - room} más: filtra para acotar</Text>}
        {ents.length === 0 && <Text color={DIM}>sin resultados</Text>}
        <Text> </Text>
        <Button key="hid" onPress={() => update($, fhid, h => !h)}>
          <Text color={DIM}>ocultos: {showHidden ? 'sí' : 'no'}</Text>
        </Button>
        <Text color={DIM}>Enter en archivo/carpeta pega la ruta · Esc cierra</Text>
      </Box>
    )
  })

  // /ayuda: lista de comandos y atajos; pulsar una fila de comando la ejecuta.
  on('command.run', { command: 'ayuda' }, async $ => {
    await update($, hfilter, () => '')
    await $.ui.open({ id: HELP, title: 'ayuda', focus: true, closeOnEscape: true })
    return { text: 'Ayuda abierta: escribe para filtrar, Enter ejecuta un comando, Esc cierra.' }
  })

  on('ui.render', { component: 'Pane', requestId: HELP }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const filter = (await read($, hfilter)).toLowerCase()
    const w = Math.max(16, e.props.bodyColumns - 4)
    const run = (cmd: string) => async () => {
      await $.ui.close({ id: HELP })
      await $.command.run({ command: cmd })
    }
    // Una sección se muestra si su cabecera o alguna de sus filas coincide con el filtro.
    const sections: { head: string; rows: [string, string, string][] }[] = []
    for (const r of MENU) {
      if (r[1] === '' && r[2] === '') sections.push({ head: r[0], rows: [] })
      else sections[sections.length - 1].rows.push(r)
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={ACCENT}>{'─ ayuda '}</Text>
          <Text color={LINE}>{'─'.repeat(Math.max(2, w - 8))}</Text>
        </Box>
        <Input key="filter" placeholder="filtrar…" value={filter} autoFocus onInput={v => void update($, hfilter, () => v)} onSubmit={() => {}} />
        {sections.map(sec => {
          const rows = sec.rows.filter(r => filter === '' || (r[0] + ' ' + r[1]).toLowerCase().includes(filter))
          if (rows.length === 0) return null
          return (
            <Box flexDirection="column">
              <Text> </Text>
              <Text color={ACCENT} bold>{sec.head}</Text>
              {rows.map(r =>
                r[2] !== '' ? (
                  <Button key={r[0]} onPress={run(r[2])}>
                    <Text color={TEAL} bold>{r[0].padEnd(16)}</Text>
                    <Text color={DIM}>{short(r[1], Math.max(4, w - 26))}</Text>
                  </Button>
                ) : (
                  <Box key={'i-' + r[0]}>
                    <Text color={TEAL} bold>{r[0].padEnd(17)}</Text>
                    <Text color={DIM}>{short(r[1], Math.max(4, w - 18))}</Text>
                  </Box>
                ),
              )}
            </Box>
          )
        })}
        <Text> </Text>
        <Text color={DIM}>Enter sobre un comando lo ejecuta · Esc cierra</Text>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const t: Tool = { id: e.tool_use_id ?? String(Math.random()), name: e.tool, detail: detail(e as any), isDone: false, ms: 0 }
    const t0 = await $.clock.now()
    await update($, tools, l => [...l, t].slice(-30))
    await update($, stats, s => ({ ...s, tools: s.tools + 1 }))
    const ran = await next(e)
    const ms = (await $.clock.now()) - t0
    await update($, tools, l => l.map(x => (x.id === t.id ? { ...x, isDone: true, ms } : x)))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await update($, stats, s => ({
      ...s,
      turns: s.turns + 1,
      lastMs: e.durationMs,
      totalMs: s.totalMs + e.durationMs,
      outTokens: s.outTokens + (e.usage?.output_tokens ?? 0),
    }))
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [i, s, list] = await Promise.all([read($, info), read($, stats), read($, tools)])
    const w = Math.max(16, e.props.bodyColumns - 4)
    const rows = e.viewport?.rows ?? 30
    const shown = list.slice(-Math.max(3, rows - 28)).reverse()

    // Cabecera de sección: «─ título ─────────»
    const Head = ({ title }: { title: string }) => (
      <Box>
        <Text color={ACCENT}>{'─ ' + title + ' '}</Text>
        <Text color={LINE}>{'─'.repeat(Math.max(2, w - title.length - 3))}</Text>
      </Box>
    )
    const Row = ({ k: key, v, c, b }: { k: string; v: string; c?: string; b?: boolean }) => (
      <Box>
        <Text color={DIM}>{key.padEnd(10)}</Text>
        <Text color={c} bold={b}>{short(v, w - 10)}</Text>
      </Box>
    )
    const Gap = () => <Text> </Text>

    return (
      <Box flexDirection="column" paddingX={1}>
        <Row k="modelo" v={i.model || '—'} c={TEAL} b />
        <Row k="carpeta" v={i.cwd.replace(/^\/home\/[^/]+/, '~')} />
        {i.branch !== '' && <Row k="rama" v={i.branch} c={CODE} />}
        {i.usd > 0 && <Row k="coste" v={'$' + i.usd.toFixed(2)} />}
        <Row k="estado" v={list.some(t => !t.isDone) ? '⠹ trabajando' : 'listo'} c={list.some(t => !t.isDone) ? ACCENT : undefined} />
        <Gap />
        <Head title="contexto" />
        <Text color={heat(i.ctxPercent)}>{bar(i.ctxPercent, w - 6)} {i.ctxPercent}%</Text>
        <Text color={DIM}>{k(i.ctxTokens)} / {k(i.ctxWindow)} tokens</Text>
        {i.limits.length > 0 && (
          <Box flexDirection="column">
            <Gap />
            <Head title="límites" />
            {i.limits.map(l => (
              <Text color={heat(l.percent)}>{short(l.kind, 8).padEnd(9)}{bar(l.percent, w - 14)} {l.percent}%</Text>
            ))}
          </Box>
        )}
        <Gap />
        <Head title="turnos" />
        <Row k="turnos" v={String(s.turns)} />
        <Row k="último" v={secs(s.lastMs)} />
        <Row k="tools" v={String(s.tools)} />
        <Row k="salida" v={k(s.outTokens) + ' tok'} />
        <Gap />
        <Head title="actividad" />
        {shown.length === 0 && <Text color={DIM}>sin herramientas aún</Text>}
        {shown.map(t => (
          <Box>
            <Text color={t.isDone ? TEAL : ACCENT}>{t.isDone ? '● ' : '⠹ '}</Text>
            <Text color={t.isDone ? TEAL : ACCENT} bold>{t.name} </Text>
            <Text color={DIM}>{short(t.detail, Math.max(4, w - t.name.length - 11))}</Text>
            {t.isDone && <Text color={DIM}> {secs(t.ms)}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
