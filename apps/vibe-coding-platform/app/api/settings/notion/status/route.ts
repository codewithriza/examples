import { NextResponse } from 'next/server'
import { getSelection, isConnected } from '@/lib/infrastructure/notion-settings-store'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sid = url.searchParams.get('sid')
  if (!sid) {
    return NextResponse.json(
      { connected: false, error: 'missing sid' },
      { status: 400 }
    )
  }
  const [connected, selection] = await Promise.all([
    isConnected(sid),
    getSelection(sid),
  ])
  return NextResponse.json({
    connected,
    selection: selection.selectedId
      ? {
          id: selection.selectedId,
          title: selection.selectedTitle ?? 'Untitled',
          kind: selection.selectedKind ?? 'page',
        }
      : null,
  })
}
