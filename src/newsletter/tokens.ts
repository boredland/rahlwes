/**
 * Verify and unsubscribe tokens are bearer credentials: whoever holds one can
 * confirm or cancel that subscription. 256 bits from the CSPRNG puts guessing
 * out of reach, and hex keeps them safe in a URL without escaping.
 */
export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Tokens only ever come back to us through a URL, so reject anything not shaped like one. */
export function isToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
