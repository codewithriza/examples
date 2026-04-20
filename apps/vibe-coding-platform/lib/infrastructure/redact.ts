const MIN_SECRET_LENGTH = 8

export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | null | undefined>
): string {
  if (!text) return text
  let out = text
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_LENGTH) continue
    if (out.includes(secret)) {
      out = out.split(secret).join('[REDACTED]')
    }
    const encoded = encodeURIComponent(secret)
    if (encoded !== secret && encoded.length >= MIN_SECRET_LENGTH && out.includes(encoded)) {
      out = out.split(encoded).join('[REDACTED]')
    }
    try {
      const parsed = new URL(secret)
      if (parsed.password && parsed.password.length >= MIN_SECRET_LENGTH && out.includes(parsed.password)) {
        out = out.split(parsed.password).join('[REDACTED]')
      }
    } catch {
      // not a URL; skip the sub-secret pass
    }
  }
  return out
}
