import { NextResponse } from 'next/server'
import { setSelection } from '@/lib/infrastructure/notion-settings-store'

interface Body {
  sid?: string
  id?: string
  title?: string
  kind?: 'page' | 'database'
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.sid || !body.id || !body.title) {
    return NextResponse.json(
      { error: 'missing sid, id, or title' },
      { status: 400 }
    )
  }
  const kind: 'page' | 'database' = body.kind === 'database' ? 'database' : 'page'
  await setSelection(body.sid, { id: body.id, title: body.title, kind })
  return NextResponse.json({ ok: true })
}
