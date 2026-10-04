// src/modules/conta/lib/repetidas.ts
//
// C01b §4 · Factura REPETIDA: una factura del mismo proveedor con el mismo
// número e importe que otra se marca «¿Repetida?» y NO se apunta (no cuenta en
// «Le debes», «Le has comprado», próximo pago…) hasta que la persona decide.
//
// Por qué número E importe, y no solo número (población real, regla 31: los
// 179 números de albarán de Foodint, tests/unit/modules/conta/datos/):
//   · Hay proveedores que repiten número de verdad («T2826/1092», «AV260559511»
//     salen dos veces) y otros que ponen «0», «01» o «sn» en todos.
//   · Un número que no es número («0», «sn», «s/n», «-») no sirve para casar
//     nada: con esos, nunca se marca repetida solo por el número.
// La normalización es CONSERVADORA: mayúsculas y espacios. No quita barras ni
// guiones («03-140726» y «03 12 06 2026» son de verdad distintos), porque
// casar dos facturas distintas como repetidas es peor que no ver una repetida:
// la segunda deja de apuntarse en silencio.
//
// SEGUNDO NIVEL (respuesta 2, punto 2): «¿Posible repetida?». Mismo proveedor,
// misma FECHA de factura y mismo importe, con OTRO número. Es la factura que
// vuelve con el número mal leído o tecleado. La misma decisión humana que la
// repetida: no se apunta hasta que la persona dice «no es repetida».
// Medido contra los 179 albaranes reales de Foodint, con su fecha y su importe
// (datos/albaranes-fecha-importe-foodint-20261004.json): 0 posibles repetidas.
// La fecha es la que lo sostiene: sin ella, el mismo importe se repite en 4
// proveedores (un fijo de 191,00 € cuatro veces en dos meses). Un importe 0 no
// casa nada: no dice nada de la factura.

export interface FacturaParaRepetida {
  id: string
  number: string | null
  total: number | null
  status: string
  /** Cuándo entró en Folvy: la primera es la buena. */
  createdAt: string
  /** Fecha de la factura (AAAA-MM-DD). Para el segundo nivel. */
  fecha?: string | null
  /** La persona dijo «no es repetida»: no se vuelve a marcar. */
  noRepetidaConfirmada?: boolean
}

export type NivelRepetida = 'repetida' | 'posible'

export interface Repetida {
  /** La factura que estaba antes, con la que coincide. */
  deId: string
  /** «repetida»: número e importe. «posible»: fecha e importe, otro número. */
  nivel: NivelRepetida
  explicacion: string
}

export const EXPLICACION_REPETIDA = 'Mismo número e importe que la de arriba. No la he apuntado.'

/** «Misma fecha e importe que la F-123, con otro número. No la he apuntado.» */
export function explicacionPosible(numeroDeLaOtra: string | null, ningunaTraeNumero = false): string {
  if (ningunaTraeNumero) return 'Misma fecha e importe que la de arriba, y ninguna de las dos trae número. No la he apuntado.'
  const n = (numeroDeLaOtra ?? '').trim()
  return `Misma fecha e importe que la ${n === '' ? 'de arriba' : n}, con otro número. No la he apuntado.`
}

export const ETIQUETA_REPETIDA: Record<NivelRepetida, string> = {
  repetida: '¿Repetida?',
  posible: '¿Posible repetida?',
}

const SIN_NUMERO = /^(s\s*\/?\s*n|sin\s+n[uú]mero|-+|0+)$/i

/** El número para comparar, o null si no es un número de verdad. */
export function claveNumero(numero: string | null | undefined): string | null {
  const t = (numero ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (t === '' || SIN_NUMERO.test(t) || !/[0-9A-Z]/.test(t)) return null
  return t
}

const centimos = (x: number | null): number | null =>
  x === null || !Number.isFinite(x) ? null : Math.round(x * 100)

const FECHA = /^\d{4}-\d{2}-\d{2}/

/**
 * Las repetidas de UN proveedor: id → con cuál coincide y a qué nivel. Las
 * anuladas no cuentan ni como original ni como repetida. Primero el número;
 * solo si no casa por número se mira la fecha.
 */
export function detectarRepetidas(facturas: readonly FacturaParaRepetida[]): Map<string, Repetida> {
  const res = new Map<string, Repetida>()
  const vivas = facturas
    .filter((f) => f.status !== 'anulada')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const porNumero = new Map<string, FacturaParaRepetida>()
  const porFecha = new Map<string, FacturaParaRepetida>()
  for (const f of vivas) {
    const clave = claveNumero(f.number)
    const c = centimos(f.total)
    if (c === null) continue
    const kn = clave === null ? null : `${clave}|${c}`
    const kf = c !== 0 && f.fecha && FECHA.test(f.fecha) ? `${f.fecha.slice(0, 10)}|${c}` : null

    const mismoNumero = kn === null ? undefined : porNumero.get(kn)
    const mismaFecha = kf === null ? undefined : porFecha.get(kf)
    if (!f.noRepetidaConfirmada && mismoNumero) {
      res.set(f.id, { deId: mismoNumero.id, nivel: 'repetida', explicacion: EXPLICACION_REPETIDA })
      continue
    }
    // Con el mismo número ya habría casado arriba: aquí el número es otro, o
    // ninguna de las dos lo trae («0», «sn»).
    if (!f.noRepetidaConfirmada && mismaFecha) {
      const sinNumero = clave === null && claveNumero(mismaFecha.number) === null
      res.set(f.id, { deId: mismaFecha.id, nivel: 'posible', explicacion: explicacionPosible(mismaFecha.number, sinNumero) })
      continue
    }
    // Se apunta: es la original para las que vengan detrás.
    if (kn !== null && !porNumero.has(kn)) porNumero.set(kn, f)
    if (kf !== null && !porFecha.has(kf)) porFecha.set(kf, f)
  }
  return res
}
