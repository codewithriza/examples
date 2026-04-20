import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { completeAuthFlow } from '@/lib/infrastructure/notion-mcp'

const PENDING_SID_COOKIE = 'vibe.notion.pending_sid'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const sid = jar.get(PENDING_SID_COOKIE)?.value

  if (!code || !state || !sid) {
    return NextResponse.redirect(`${url.origin}/settings?notion=error`)
  }

  try {
    await completeAuthFlow(sid, url.origin, code, state)
  } catch (err) {
    console.error('[notion] callback failed:', err)
    return NextResponse.redirect(`${url.origin}/settings?notion=error`)
  } finally {
    jar.delete(PENDING_SID_COOKIE)
  }

  return NextResponse.redirect(`${url.origin}/settings?notion=connected`)
}
