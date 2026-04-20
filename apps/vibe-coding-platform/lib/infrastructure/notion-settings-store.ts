import { cookies } from 'next/headers'
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from '@ai-sdk/mcp'
import { decryptJson, encryptJson, sessionFingerprint } from './crypto'

const COOKIE_PREFIX = 'vibe.notion'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

interface NotionStoreShape {
  tokens?: OAuthTokens
  clientInfo?: OAuthClientInformation
  codeVerifier?: string
  state?: string
  selectedId?: string
  selectedTitle?: string
  selectedKind?: 'page' | 'database'
}

function cookieName(sessionId: string): string {
  return `${COOKIE_PREFIX}.${sessionFingerprint(sessionId)}`
}

async function readStore(sessionId: string): Promise<NotionStoreShape> {
  const jar = await cookies()
  const token = jar.get(cookieName(sessionId))?.value
  if (!token) return {}
  return (await decryptJson<NotionStoreShape>(token)) ?? {}
}

async function writeStore(
  sessionId: string,
  update: Partial<NotionStoreShape>
): Promise<void> {
  const current = await readStore(sessionId)
  const next = { ...current, ...update }
  const encrypted = await encryptJson(next)
  const jar = await cookies()
  jar.set(cookieName(sessionId), encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearStore(sessionId: string): Promise<void> {
  const jar = await cookies()
  jar.delete(cookieName(sessionId))
}

export async function getSelection(
  sessionId: string
): Promise<Pick<NotionStoreShape, 'selectedId' | 'selectedTitle' | 'selectedKind'>> {
  const s = await readStore(sessionId)
  return {
    selectedId: s.selectedId,
    selectedTitle: s.selectedTitle,
    selectedKind: s.selectedKind,
  }
}

export async function setSelection(
  sessionId: string,
  selection: { id: string; title: string; kind: 'page' | 'database' }
): Promise<void> {
  await writeStore(sessionId, {
    selectedId: selection.id,
    selectedTitle: selection.title,
    selectedKind: selection.kind,
  })
}

export async function isConnected(sessionId: string): Promise<boolean> {
  const s = await readStore(sessionId)
  return Boolean(s.tokens?.access_token)
}

interface ProviderOptions {
  sessionId: string
  redirectUri: string
}

export function createNotionAuthProvider(
  opts: ProviderOptions
): OAuthClientProvider {
  const { sessionId, redirectUri } = opts

  const metadata: OAuthClientMetadata = {
    client_name: 'Vibe Coding Platform',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }

  return {
    get redirectUrl() {
      return redirectUri
    },
    get clientMetadata() {
      return metadata
    },
    async tokens() {
      const s = await readStore(sessionId)
      return s.tokens
    },
    async saveTokens(tokens) {
      await writeStore(sessionId, { tokens })
    },
    async clientInformation() {
      const s = await readStore(sessionId)
      return s.clientInfo
    },
    async saveClientInformation(clientInfo) {
      await writeStore(sessionId, { clientInfo })
    },
    async codeVerifier() {
      const s = await readStore(sessionId)
      if (!s.codeVerifier) throw new Error('No stored PKCE verifier')
      return s.codeVerifier
    },
    async saveCodeVerifier(verifier) {
      await writeStore(sessionId, { codeVerifier: verifier })
    },
    async state() {
      const { randomBytes } = await import('node:crypto')
      const value = randomBytes(24).toString('base64url')
      await writeStore(sessionId, { state: value })
      return value
    },
    async saveState(value) {
      await writeStore(sessionId, { state: value })
    },
    async storedState() {
      const s = await readStore(sessionId)
      return s.state
    },
    async redirectToAuthorization(url) {
      pendingRedirects.set(sessionId, url.toString())
    },
    async invalidateCredentials(scope) {
      if (scope === 'all') {
        await clearStore(sessionId)
        return
      }
      const keyMap: Partial<Record<typeof scope, keyof NotionStoreShape>> = {
        tokens: 'tokens',
        client: 'clientInfo',
        verifier: 'codeVerifier',
      }
      const key = keyMap[scope]
      if (!key) return
      const current = await readStore(sessionId)
      delete current[key]
      await writeStore(sessionId, current)
    },
  }
}

const pendingRedirects = new Map<string, string>()

export function takePendingRedirect(sessionId: string): string | undefined {
  const v = pendingRedirects.get(sessionId)
  if (v) pendingRedirects.delete(sessionId)
  return v
}
