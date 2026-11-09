// src/modules/conta/portal/formato.ts
//
// GP · Tarea 3 (Code 3, 09/11/2026) · Lo puro de las pantallas del portal del
// cliente: euros, fechas y meses en palabras, iniciales, el color de cada estado
// y cómo se lee un recibo de Code 1 (sus líneas y por qué cambia). Sin React ni
// red: lo prueban tests/unit/portal/formato.test.ts.
//
// Palabras de la calle: recibo, factura, pagar, devuelto. Nunca «mandato»,
// «payment» ni «SEPA».

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)

/** 15730 → «157,30 €». */
export const euros = (cent: number | null | undefined): string => (cent == null ? '—' : `${fmt.format(cent / 100)} €`)
/** 157.3 → «157,30 €» (lo que viene en euros de la base: facturas, impuestos). */
export const eurosDe = (e: number | string | null | undefined): string => (e == null || e === '' ? '—' : `${fmt.format(Number(e))} €`)

/** «2026-11-04» o una marca de tiempo → «4 de noviembre» (y el año si no es este). */
export function fecha(x: string | null | undefined, hoy: Date = new Date()): string {
  if (!x) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x)
  if (!m) return '—'
  const d = x.length > 10 ? new Date(x) : null
  const [a, mes, dia] = d && !Number.isNaN(d.getTime())
    ? madrid(d)
    : [Number(m[1]), Number(m[2]), Number(m[3])]
  return `${dia} de ${MESES[mes - 1]}${a !== madrid(hoy)[0] ? ` de ${a}` : ''}`
}

/** «4 dic». */
export function fechaCorta(x: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x ?? '')
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1].slice(0, 3)}` : '—'
}

/** La hora de un mensaje: «hoy 9:14», «ayer 17:02» o «3 de noviembre 17:02». */
export function cuando(x: string, ahora: Date = new Date()): string {
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return ''
  const hm = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', minute: '2-digit' }).format(d)
  const dia = (y: Date) => madrid(y).join('-')
  if (dia(d) === dia(ahora)) return `hoy ${hm}`
  if (dia(d) === dia(new Date(ahora.getTime() - 86_400_000))) return `ayer ${hm}`
  return `${fecha(x, ahora)} ${hm}`
}

function madrid(d: Date): [number, number, number] {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number)
  return [p[0], p[1], p[2]]
}

/** «2026-11» → «Noviembre» (con el año si no es este). */
export function mes(m: string | null | undefined, hoy: Date = new Date()): string {
  const x = /^(\d{4})-(\d{2})$/.exec(m ?? '')
  if (!x) return m ?? ''
  const n = MESES[Number(x[2]) - 1]
  return `${n[0].toUpperCase()}${n.slice(1)}${Number(x[1]) !== madrid(hoy)[0] ? ` de ${x[1]}` : ''}`
}

/** «Gestoría Demo» → «GD»; «Antonio Ruiz» → «AR». */
export function iniciales(n: string | null | undefined): string {
  const p = (n ?? '').replace(/[,.]/g, ' ').split(/\s+/).filter((w) => w && !/^(s\.?l\.?|s\.?a\.?|de|del|la|el|y)$/i.test(w))
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·'
}

/** El nombre de pila para el saludo: «Antonio Ruiz» → «Antonio»; un correo, nada. */
export const nombreDePila = (n: string | null | undefined): string => (n && !n.includes('@') ? n.trim().split(/\s+/)[0] : '')

export type Tono = 'ok' | 'mal' | 'info' | 'gris' | 'aviso'
export const TONOS: Record<Tono, { fondo: string; tinta: string }> = {
  ok: { fondo: '#E6F5EE', tinta: '#0B6B4F' },
  mal: { fondo: '#FDE8E7', tinta: '#A11B12' },
  info: { fondo: '#E3ECFD', tinta: '#1747AE' },
  gris: { fondo: '#EEF1F6', tinta: '#33445E' },
  aviso: { fondo: '#FFF1DE', tinta: '#8A4B08' },
}

/** El tono de cada estado que enseña el portal. */
export function tonoDe(estado: string): Tono {
  if (/^(Pagad|Cobrad|De alta|Hecha|Firmad|Pagado después)/.test(estado)) return 'ok'
  if (/^(Devuelt|Rechazad|Error)/.test(estado)) return 'mal'
  if (/^(Próximo|En el banco|Alta nueva|Pedida|Pendiente)/.test(estado)) return 'info'
  return 'gris'
}

// ── El recibo de Code 1 ────────────────────────────────────────────────────

export interface LineaVista { texto: string; importe: string; detalle: string | null }

/** Las líneas guardadas por el cobro (LineaDeRecibo: texto, importeCent, cuenta, trabajadores). */
export function lineasDelRecibo(lineas: unknown): LineaVista[] {
  if (!Array.isArray(lineas)) return []
  return lineas.map((l) => {
    const x = l as { texto?: unknown; importeCent?: unknown; importe_cent?: unknown; cuenta?: unknown; trabajadores?: unknown }
    const cent = x.importeCent ?? x.importe_cent
    const trab = Array.isArray(x.trabajadores) ? x.trabajadores.map((t) => String((t as { nombre?: unknown })?.nombre ?? t)).filter(Boolean) : []
    return {
      texto: String(x.texto ?? 'Servicio'),
      importe: typeof cent === 'number' ? euros(cent) : 'Sin precio',
      detalle: trab.length ? trab.join(', ') : (typeof x.cuenta === 'string' && x.cuenta ? x.cuenta : null),
    }
  })
}

/** Por qué cambia el recibo, en una frase: los textos de sus cambios. */
export function porQueCambia(cambios: unknown): string | null {
  if (!Array.isArray(cambios) || !cambios.length) return null
  const t = cambios.map((c) => String((c as { texto?: unknown; t?: unknown })?.texto ?? (c as { t?: unknown })?.t ?? '')).filter(Boolean)
  return t.length ? t.join(' · ') : null
}

/** «Sube 24,20 €» / «Baja 10,00 €» / null si es igual o no hay anterior. */
export function diferencia(total: number, anterior: number | null | undefined): { texto: string; tono: Tono } | null {
  if (anterior == null || anterior === total) return null
  const d = total - anterior
  return d > 0 ? { texto: `Sube ${euros(d)}`, tono: 'aviso' } : { texto: `Baja ${euros(-d)}`, tono: 'ok' }
}

/** Los últimos dígitos de la cuenta, como en la maqueta: «ES•• •••• •••• •••• •••• 4821». */
export function cuentaEnmascarada(pais: string | null | undefined, final: string | null | undefined): string | null {
  const f = (final ?? '').replace(/\D/g, '')
  if (!f) return null
  return `${(pais || 'ES').toUpperCase()}•• •••• •••• •••• •••• ${f.slice(-4)}`
}

/** El nombre de un fichero para guardarlo: el mismo criterio que el servidor (sin carpetas ni raros). */
export function nombreSeguro(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  const limpio = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return (limpio || 'documento').slice(-80)
}

export const TIPOS_SUBIDA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const BYTES_SUBIDA = 15 * 1024 * 1024

/** Si un fichero se puede subir, y si no, por qué (en palabras). */
export function puedeSubirse(f: { type: string; size: number; name: string }): string | null {
  const tipo = f.type || (/\.heic$/i.test(f.name) ? 'image/heic' : '')
  if (!TIPOS_SUBIDA.includes(tipo)) return `«${f.name}» no se puede subir: solo PDF y fotos (JPG, PNG, WEBP o HEIC).`
  if (f.size > BYTES_SUBIDA) return `«${f.name}» pasa de 15 MB.`
  if (f.size <= 0) return `«${f.name}» está vacío.`
  return null
}

/** El DNI o NIE como lo guarda la base: sin espacios, puntos ni guiones, en mayúsculas. Null si no tiene su forma. */
export function documentoLimpio(x: string): string | null {
  const d = x.toUpperCase().replace(/[\s.-]/g, '')
  return /^[0-9XYZ][0-9]{7}[A-Z]$/.test(d) ? d : null
}

/** Qué es cada impuesto, para el cliente. */
export function nombreImpuesto(modelo: string, periodo: string | null, ejercicio: number | null, hoy: Date = new Date()): string {
  const que: Record<string, string> = { '303': 'IVA', '111': 'Retenciones', '115': 'Retenciones del alquiler', '130': 'Pago a cuenta del IRPF', '202': 'Pago a cuenta de sociedades', '200': 'Impuesto de sociedades', '390': 'Resumen anual del IVA', '190': 'Resumen anual de retenciones', '180': 'Resumen anual del alquiler', '347': 'Operaciones con terceros', '100': 'Renta' }
  const nombre = que[modelo] ?? `Modelo ${modelo}`
  // Lo anual, como en la maqueta: «Impuesto de sociedades 2025», sin el modelo.
  if (!periodo || periodo === '0A') return `${nombre}${ejercicio ? ` ${ejercicio}` : ''}`
  const a = ejercicio && ejercicio !== madrid(hoy)[0] ? ` de ${ejercicio}` : ''
  const ord = ['1.er', '2.º', '3.er', '4.º']
  const p = /^[1-4]T$/.test(periodo) ? ` del ${ord[Number(periodo[0]) - 1]} trimestre${a}`
    : /^(0[1-9]|1[0-2])$/.test(periodo) ? ` de ${MESES[Number(periodo) - 1]}${a}`
    : /^[1-3]P$/.test(periodo) ? `, ${ord[Number(periodo[0]) - 1]} pago${a}` : ` ${periodo}`
  return `${nombre}${p}${que[modelo] ? ` (modelo ${modelo})` : ''}`
}
