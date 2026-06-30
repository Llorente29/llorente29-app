// src/modules/kds/kdsUtils.ts
//
// Utilidades de presentación del KDS (solo formato/redondeo en cliente; ningún
// cálculo de negocio aquí — eso vive en las RPC). El redondeo de cantidades del
// escandallo es la única "transformación" permitida en cliente (deuda declarada:
// la RPC trae decimales largos del escandallo, p.ej. "Lima 7.7566…g").

/** Redondea una cantidad para mostrar. Entero si es grande, 1 decimal si <10,
 *  sin ceros sobrantes. Pensado para gramajes del escandallo. */
export function roundQty(n: number): string {
  if (!isFinite(n)) return '0'
  const abs = Math.abs(n)
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const r = Number(n.toFixed(decimals))
  return String(r)
}

/** Semáforo de tiempo. Umbral provisional (deuda: configurable por servicio).
 *  <5 verde, 5–10 ámbar, >10 rojo. */
export type TimeLevel = 'fresh' | 'warn' | 'late'
export function timeLevel(minutos: number): TimeLevel {
  if (minutos < 5) return 'fresh'
  if (minutos <= 10) return 'warn'
  return 'late'
}

/** Clases Tailwind del chip de tiempo (tema oscuro). Verde/ámbar/rojo de MARCA
 *  (#1F9D6B / #C2890F / #E0492E), con texto aclarado para legibilidad sobre
 *  fondo oscuro y buen contraste a distancia (cohesión con el feed de Pedidos). */
export function timeChipClasses(level: TimeLevel): string {
  switch (level) {
    case 'fresh':
      return 'bg-[#1F9D6B]/20 text-[#5FD3A0] ring-1 ring-[#1F9D6B]/40'
    case 'warn':
      return 'bg-[#C2890F]/20 text-[#E8B84B] ring-1 ring-[#C2890F]/45'
    case 'late':
      return 'bg-[#E0492E]/25 text-[#F4856E] ring-1 ring-[#E0492E]/55 animate-pulse'
  }
}

/** Código corto del ticket para la cabecera de la tarjeta. Prioriza el tab
 *  (identidad de agrupación KDS) y cae al bill. Recorta a los últimos 5. */
export function ticketCode(externalTabRef: string | null, externalRef: string | null): string {
  const raw = externalTabRef || externalRef || ''
  if (!raw) return '—'
  const tail = raw.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase()
  return tail ? `#${tail}` : '—'
}

/** Etiqueta legible del canal. */
export function channelLabel(channel: string | null): string | null {
  if (!channel) return null
  const map: Record<string, string> = {
    glovo: 'Glovo',
    uber: 'Uber Eats',
    justeat: 'Just Eat',
  }
  return map[channel] ?? channel
}

// ── Logo + nombre de plataforma (bucket público connector-logos) ─────────────
const LOGO_BASE =
  'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/connector-logos'

/** Devuelve logo (URL completa o null), color de plataforma y etiqueta para el
 *  badge de canal del KDS. Mismo mapeo que el feed de Pedidos (consistencia). */
export function channelBadge(channel: string | null): { logo: string | null; color: string; label: string } | null {
  if (!channel) return null
  const s = channel.toLowerCase()
  if (s.includes('glovo')) return { logo: `${LOGO_BASE}/glovo.png`,    color: '#FFC244', label: 'Glovo' }
  if (s.includes('uber'))  return { logo: `${LOGO_BASE}/ubereats.png`, color: '#06C167', label: 'Uber Eats' }
  if (s.includes('just'))  return { logo: `${LOGO_BASE}/justeat.png`,  color: '#FF8000', label: 'Just Eat' }
  if (s.includes('shop') || s.includes('folvy') || s.includes('tienda'))
    return { logo: null, color: '#1F9D6B', label: 'Folvy Shop' }
  return { logo: null, color: '#9CA0A6', label: channel }
}

/** Beep corto vía WebAudio para avisar de un ticket nuevo. Silencioso si el
 *  navegador bloquea el audio (sin gesto previo) — se traga el error. */
export function playNewTicketSound(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.36)
    osc.onended = () => { void ctx.close() }
  } catch {
    /* audio bloqueado: sin sonido, sin romper */
  }
}
