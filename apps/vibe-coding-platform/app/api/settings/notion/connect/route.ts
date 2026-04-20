import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { startAuthFlow } from '@/lib/infrastructure/notion-mcp'

const PENDING_SID_COOKIE = 'vibe.notion.pending_sid'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sid = url.searchParams.get('sid')
  if (!sid) {
    return NextResponse.json({ error: 'missing sid' }, { status: 400 })
  }

  const authorizeUrl = await startAuthFlow(sid, url.origin)
  const jar = await cookies()
  jar.set(PENDING_SID_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  })
  return NextResponse.redirect(authorizeUrl)
}
