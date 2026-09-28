import crypto from 'crypto'

/**
 * In Mídia: a ponte do WhatsApp se identifica com o cabeçalho
 * x-crm-segredo, igual ao valor de WAHA_WEBHOOK_SECRET na Vercel.
 * Sem o segredo configurado no servidor, recusa tudo.
 */
export function segredoDaPonteConfere(recebido: string | null): boolean {
  const esperado = process.env.WAHA_WEBHOOK_SECRET
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
