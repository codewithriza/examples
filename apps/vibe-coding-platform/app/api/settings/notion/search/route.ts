import { NextResponse } from 'next/server'
import { searchNotion } from '@/lib/infrastructure/notion-mcp'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sid = url.searchParams.get('sid')
  const q = url.searchParams.get('q') ?? ''
  if (!sid) {
    return NextResponse.json({ error: 'missing sid' }, { status: 400 })
  }
  const hits = await searchNotion(sid, url.origin, q)
  return NextResponse.json({ hits })
}
