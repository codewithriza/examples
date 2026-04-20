import { createHash } from 'node:crypto'

const NEON_API = 'https://console.neon.tech/api/v2'
const TOTAL_BUDGET_MS = 15_000
const MAX_RETRY_AFTER_MS = 4_000
const NEGATIVE_CACHE_MS = 30_000

interface NeonBranch {
  id: string
  primary?: boolean
  default?: boolean
  name?: string
}

interface NeonRole {
  name: string
  branch_id?: string
}

interface NeonDatabase {
  name: string
  owner_name?: string
}

interface NeonCallOptions {
  signal: AbortSignal
  allowRetry?: boolean
}

type CacheEntry =
  | { kind: 'pending'; promise: Promise<string | null> }
  | { kind: 'success'; url: string }
  | { kind: 'failure'; expiresAt: number }

const sessionCache = new Map<string, CacheEntry>()
let branchPromise: Promise<string> | null = null
let rolePromise: Promise<string> | null = null

export function databaseNameFor(sessionId: string): string {
  const digest = createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, 10)
  return `vibe_${digest}`
}

export function provisionDatabase(
  sessionId: string
): Promise<string | null> {
  if (!sessionId) return Promise.resolve(null)

  const entry = sessionCache.get(sessionId)
  if (entry) {
    if (entry.kind === 'success') return Promise.resolve(entry.url)
    if (entry.kind === 'pending') return entry.promise
    if (Date.now() < entry.expiresAt) return Promise.resolve(null)
    sessionCache.delete(sessionId)
  }

  const promise = runProvision(sessionId).then(
    (url) => {
      if (url) {
        sessionCache.set(sessionId, { kind: 'success', url })
      } else {
        sessionCache.set(sessionId, {
          kind: 'failure',
          expiresAt: Date.now() + NEGATIVE_CACHE_MS,
        })
      }
      return url
    },
    (err) => {
      sessionCache.set(sessionId, {
        kind: 'failure',
        expiresAt: Date.now() + NEGATIVE_CACHE_MS,
      })
      console.error('[neon] unexpected rejection in runProvision:', err)
      return null
    }
  )

  sessionCache.set(sessionId, { kind: 'pending', promise })
  return promise
}

export function __resetProvisionCache(): void {
  sessionCache.clear()
  branchPromise = null
  rolePromise = null
}

async function runProvision(sessionId: string): Promise<string | null> {
  const apiKey = process.env.NEON_API_KEY
  const projectId = process.env.NEON_PROJECT_ID
  if (!apiKey) {
    console.warn('[neon] NEON_API_KEY not configured; skipping JIT provisioning.')
    return null
  }
  if (!projectId) {
    console.warn('[neon] NEON_PROJECT_ID not configured; skipping JIT provisioning.')
    return null
  }

  const dbName = databaseNameFor(sessionId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS)
  const opts: NeonCallOptions = { signal: controller.signal }

  try {
    const [branchId, roleName] = await Promise.all([
      resolveBranchId(projectId, opts),
      resolveRoleName(projectId, opts),
    ])

    const exists = await databaseExists(projectId, branchId, dbName, opts)
    if (!exists) {
      await createDatabase(projectId, branchId, dbName, roleName, opts)
    }

    return await fetchPooledUri(projectId, dbName, roleName, opts)
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      console.error(
        `[neon] Provisioning timed out after ${TOTAL_BUDGET_MS}ms for session=${sessionId} db=${dbName}`
      )
    } else {
      console.error(
        `[neon] provisionDatabase failed for session=${sessionId} db=${dbName}:`,
        error
      )
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveBranchId(
  projectId: string,
  opts: NeonCallOptions
): Promise<string> {
  if (process.env.NEON_BRANCH_ID) return process.env.NEON_BRANCH_ID
  if (branchPromise) return branchPromise
  branchPromise = (async () => {
    const data = await neonRequest<{ branches?: NeonBranch[] }>(
      `/projects/${encodeURIComponent(projectId)}/branches`,
      { method: 'GET' },
      opts
    )
    const branches = data.branches ?? []
    const primary =
      branches.find((b) => b.primary) ??
      branches.find((b) => b.default) ??
      branches[0]
    if (!primary?.id) throw new Error('Neon master project has no branches')
    return primary.id
  })().catch((err) => {
    branchPromise = null
    throw err
  })
  return branchPromise
}

async function resolveRoleName(
  projectId: string,
  opts: NeonCallOptions
): Promise<string> {
  if (process.env.NEON_ROLE_NAME) return process.env.NEON_ROLE_NAME
  if (rolePromise) return rolePromise
  rolePromise = (async () => {
    const branchId = await resolveBranchId(projectId, opts)
    const data = await neonRequest<{ roles?: NeonRole[] }>(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/roles`,
      { method: 'GET' },
      opts
    )
    const role = data.roles?.[0]
    if (!role?.name) throw new Error('Neon master project has no roles')
    return role.name
  })().catch((err) => {
    rolePromise = null
    throw err
  })
  return rolePromise
}

async function databaseExists(
  projectId: string,
  branchId: string,
  dbName: string,
  opts: NeonCallOptions
): Promise<boolean> {
  const data = await neonRequest<{ databases?: NeonDatabase[] }>(
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/databases`,
    { method: 'GET' },
    opts
  )
  return (data.databases ?? []).some((d) => d.name === dbName)
}

async function createDatabase(
  projectId: string,
  branchId: string,
  dbName: string,
  ownerName: string,
  opts: NeonCallOptions
): Promise<void> {
  try {
    await neonRequest(
      `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/databases`,
      {
        method: 'POST',
        body: JSON.stringify({
          database: { name: dbName, owner_name: ownerName },
        }),
      },
      opts
    )
  } catch (err) {
    const msg = (err as Error)?.message ?? ''
    if (/already exists|409/i.test(msg)) return
    throw err
  }
}

async function fetchPooledUri(
  projectId: string,
  dbName: string,
  roleName: string,
  opts: NeonCallOptions
): Promise<string> {
  const query = new URLSearchParams({
    database_name: dbName,
    role_name: roleName,
    pooled: 'true',
  })
  const data = await neonRequest<{ uri?: string }>(
    `/projects/${encodeURIComponent(projectId)}/connection_uri?${query.toString()}`,
    { method: 'GET' },
    opts
  )
  if (!data.uri || !data.uri.includes('-pooler')) {
    throw new Error('Neon connection_uri endpoint did not return a pooled URI')
  }
  return data.uri
}

async function neonRequest<T>(
  path: string,
  init: RequestInit,
  opts: NeonCallOptions
): Promise<T> {
  const { signal, allowRetry = true } = opts
  const apiKey = process.env.NEON_API_KEY!

  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (res.status === 429 && allowRetry) {
    await delay(parseRetryAfter(res.headers.get('Retry-After')), signal)
    return neonRequest<T>(path, init, { ...opts, allowRetry: false })
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Neon ${init.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}${
        body ? ` — ${body.slice(0, 300)}` : ''
      }`
    )
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1_500
  const secs = Number(header)
  if (Number.isFinite(secs) && secs > 0) {
    return Math.min(secs * 1000, MAX_RETRY_AFTER_MS)
  }
  const httpDate = Date.parse(header)
  if (!Number.isNaN(httpDate)) {
    return Math.min(Math.max(httpDate - Date.now(), 0), MAX_RETRY_AFTER_MS)
  }
  return 1_500
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
