import { NextResponse } from 'next/server'
import { clearStore } from '@/lib/infrastructure/notion-settings-store'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sid?: string }
  if (!body.sid) {
    return NextResponse.json({ error: 'missing sid' }, { status: 400 })
  }
  await clearStore(body.sid)
  return NextResponse.json({ ok: true })
}
