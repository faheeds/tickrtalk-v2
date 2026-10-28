import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGO  = 'aes-256-gcm'
// Use a dedicated ENCRYPTION_KEY so the cipher key never changes when Supabase keys rotate.
// Generate once with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function cipherKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw || raw.length < 32) throw new Error('A dedicated ENCRYPTION_KEY of at least 32 characters is required.')
  return scryptSync(raw.slice(0, 32), 'tickrtalk-salt', 32)
}

export function encrypt(text: string): string {
  const iv     = randomBytes(12)
  const cipher = createCipheriv(ALGO, cipherKey(), iv)
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':')
  const decipher = createDecipheriv(ALGO, cipherKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()])
  return dec.toString('utf8')
}
