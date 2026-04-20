'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeftIcon, CheckIcon, SearchIcon } from 'lucide-react'

const CHAT_ID_STORAGE_KEY = 'vibe.chat.id'

interface Status {
  connected: boolean
  selection: { id: string; title: string; kind: 'page' | 'database' } | null
}

interface SearchHit {
  id: string
  title: string
  kind: 'page' | 'database'
}

function readSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(CHAT_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

export default function SettingsPage() {
  const [sid, setSid] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setSid(readSessionId())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const notion = params.get('notion')
    if (notion === 'connected') setMessage('Notion connected.')
    if (notion === 'error') setMessage('Notion connection failed. Try again.')
  }, [])

  const refreshStatus = useCallback(async () => {
    if (!sid) return
    const r = await fetch(
      `/api/settings/notion/status?sid=${encodeURIComponent(sid)}`
    )
    if (!r.ok) return
    setStatus(await r.json())
  }, [sid])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const connectHref = useMemo(
    () => (sid ? `/api/settings/notion/connect?sid=${encodeURIComponent(sid)}` : '#'),
    [sid]
  )

  const onDisconnect = useCallback(async () => {
    if (!sid) return
    await fetch('/api/settings/notion/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid }),
    })
    setResults([])
    setMessage('Notion disconnected.')
    refreshStatus()
  }, [sid, refreshStatus])

  const onSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!sid || !query.trim()) return
      setSearching(true)
      try {
        const r = await fetch(
          `/api/settings/notion/search?sid=${encodeURIComponent(
            sid
          )}&q=${encodeURIComponent(query)}`
        )
        if (!r.ok) {
          setResults([])
          return
        }
        const { hits } = (await r.json()) as { hits: SearchHit[] }
        setResults(hits ?? [])
      } finally {
        setSearching(false)
      }
    },
    [sid, query]
  )

  const onSelect = useCallback(
    async (hit: SearchHit) => {
      if (!sid) return
      await fetch('/api/settings/notion/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid, ...hit }),
      })
      setMessage(`Selected: ${hit.title}`)
      refreshStatus()
    },
    [sid, refreshStatus]
  )

  if (!sid) {
    return (
      <div className="mx-auto max-w-2xl p-6 font-mono text-sm">
        <p>Initializing session…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6 font-mono text-sm">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-secondary-foreground hover:text-primary"
        >
          <ArrowLeftIcon className="size-4" /> Back to chat
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight uppercase">Settings</h1>
        <p className="text-secondary-foreground text-xs">
          Connect Notion to give the agent background context while responding.
        </p>
      </header>

      {message && (
        <div className="rounded border border-border bg-secondary/40 px-3 py-2 text-xs">
          {message}
        </div>
      )}

      <section className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold uppercase text-xs tracking-wide">
              Notion MCP
            </h2>
            <p className="text-xs text-secondary-foreground mt-1">
              {status?.connected ? 'Connected' : 'Not connected'}
              {status?.selection ? (
                <>
                  {' · '}Context: <strong>{status.selection.title}</strong> ({status.selection.kind})
                </>
              ) : null}
            </p>
          </div>
          {status?.connected ? (
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : (
            <Button asChild size="sm">
              <a href={connectHref}>Connect Notion</a>
            </Button>
          )}
        </div>

        {status?.connected && (
          <>
            <form onSubmit={onSearch} className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your Notion pages/databases…"
                className="font-mono"
              />
              <Button type="submit" size="sm" disabled={searching || !query.trim()}>
                <SearchIcon className="size-4" />
                {searching ? 'Searching' : 'Search'}
              </Button>
            </form>

            {results.length > 0 && (
              <ul className="divide-y divide-border rounded border border-border">
                {results.map((hit) => {
                  const isSelected = status?.selection?.id === hit.id
                  return (
                    <li
                      key={hit.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{hit.title}</p>
                        <p className="text-xs text-secondary-foreground">
                          {hit.kind}
                        </p>
                      </div>
                      <Button
                        variant={isSelected ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => onSelect(hit)}
                      >
                        {isSelected ? (
                          <>
                            <CheckIcon className="size-4" /> Selected
                          </>
                        ) : (
                          'Use as context'
                        )}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <p className="text-xs text-secondary-foreground">
        Notion context is injected into the chat as background only. It does not
        override system instructions and is not used to generate persistent data
        schemas for your apps (Feature 1 handles that via Postgres).
      </p>
    </div>
  )
}
