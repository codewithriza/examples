import { EncryptJWT, jwtDecrypt } from 'jose'
import { createHash } from 'node:crypto'

const ENC_ALG = 'A256GCM'
const KEY_WRAP = 'dir'

let cachedKey: Uint8Array | null = null

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey
  const raw = process.env.NOTION_TOKEN_ENCRYPTION_KEY
  if (!raw || raw.length < 32) {
    throw new Error(
      'NOTION_TOKEN_ENCRYPTION_KEY is not configured (must be ≥32 chars).'
    )
  }
  cachedKey = createHash('sha256').update(raw).digest()
  return cachedKey
}

export async function encryptJson(payload: unknown): Promise<string> {
  return await new EncryptJWT({ d: payload as Record<string, unknown> })
    .setProtectedHeader({ alg: KEY_WRAP, enc: ENC_ALG })
    .setIssuedAt()
    .encrypt(getKey())
}

export async function decryptJson<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, getKey())
    return (payload.d ?? null) as T | null
  } catch {
    return null
  }
}

export function sessionFingerprint(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}
