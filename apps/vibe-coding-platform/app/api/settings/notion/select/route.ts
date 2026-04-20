import { NextResponse } from 'next/server'
import { resolveNotionByUrlOrId } from '@/lib/infrastructure/notion-mcp'
import { setSelection } from '@/lib/infrastructure/notion-settings-store'

interface Body {
  sid?: string
  id?: string
  title?: string
  kind?: 'page' | 'database'
  urlOrId?: string
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.sid) {
    return NextResponse.json({ error: 'missing sid' }, { status: 400 })
  }

  if (body.urlOrId && body.urlOrId.trim()) {
    const origin = new URL(req.url).origin
    const resolved = await resolveNotionByUrlOrId(body.sid, origin, body.urlOrId)
    if (!resolved) {
      return NextResponse.json(
        { error: 'Could not resolve that Notion URL or ID. Confirm the page is shared with your Notion MCP connection.' },
        { status: 400 }
      )
    }
    await setSelection(body.sid, {
      id: resolved.id,
      title: resolved.title,
      kind: resolved.kind,
    })
    return NextResponse.json({ ok: true, selection: resolved })
  }

  if (!body.id || !body.title) {
    return NextResponse.json(
      { error: 'missing id, title, or urlOrId' },
      { status: 400 }
    )
  }
  const kind: 'page' | 'database' = body.kind === 'database' ? 'database' : 'page'
  await setSelection(body.sid, { id: body.id, title: body.title, kind })
  return NextResponse.json({ ok: true })
}
