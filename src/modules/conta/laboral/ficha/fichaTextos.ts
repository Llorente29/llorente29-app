// src/modules/conta/laboral/ficha/fichaTextos.ts
//
// N1 · PR 2 · Paso 1 (02/11/2026) · Las frases de la ficha, sin pantalla
// (para probarlas solas). Reglas de Julio del 02/11:
//   · primero la palabra de la calle; el nombre oficial, después y en pequeño;
//   · el código va delante y se ve siempre: «100 · Indefinido a jornada
//     completa», «Grupo 4 · Ayudantes sin título», «1 · Sin pareja…»; los
//     países, sin código;
//   · lo que falta se dice («Falta»), nunca se inventa ni se esconde.

import type { Catalogado, Concepto, Ficha } from './fichaService'

const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' })
const PCT = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const euros = (n: number | null | undefined) => (n == null ? '—' : EUROS.format(n))
export const porcentaje = (n: number | null | undefined) => (n == null ? '—' : `${PCT.format(n)} %`)

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** Años cumplidos el día `hoy` (AAAA-MM-DD). */
export function edad(nacimiento: string, hoy: string): number {
  const [a1, m1, d1] = nacimiento.slice(0, 10).split('-').map(Number)
  const [a2, m2, d2] = hoy.slice(0, 10).split('-').map(Number)
  return a2 - a1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0)
}

/** «100 · Indefinido a jornada completa». Sin palabra de la calle, el texto oficial; con prefijo («Grupo»), delante del código. */
export function conCodigo(c: Catalogado | null | undefined, prefijo = ''): string {
  if (!c) return ''
  const texto = c.calle ?? c.oficial ?? 'código que no está en la tabla oficial'
  return `${prefijo ? `${prefijo} ` : ''}${c.codigo} · ${texto}`
}

/** El texto oficial, para enseñarlo pequeño debajo; vacío si es igual a lo que ya se ve. */
export function oficialSiDistinto(c: Catalogado | null | undefined): string {
  if (!c?.oficial || !c.calle) return ''
  return c.oficial.toLowerCase() === c.calle.toLowerCase() ? '' : c.oficial
}

/** Un país: sin código (Julio, 02/11). */
export const pais = (c: Catalogado | null | undefined) => c?.calle ?? c?.oficial ?? null

export function jornada(ct: NonNullable<Ficha['contrato']>): string {
  if (ct.jornada === 'parcial') {
    const pct = ct.coef_parcial != null ? Math.round((ct.coef_parcial <= 1 ? ct.coef_parcial * 100 : ct.coef_parcial / 10)) : null
    return pct != null ? `a tiempo parcial (${pct} % de la jornada)` : 'a tiempo parcial'
  }
  return ct.jornada === 'completa' ? 'a jornada completa' : ''
}

/** La persona en una frase (pantalla 1). Solo lo que se sabe; lo que falta no se rellena. */
export function fraseResumen(f: Ficha): string {
  const p = f.persona, ct = f.contrato
  const partes: string[] = []
  const quien = [p.puesto, p.local?.nombre ? `en ${p.local.nombre}` : ''].filter(Boolean).join(' ')
  if (quien) partes.push(quien)
  if (ct) {
    const tipo = ct.tipo?.calle ? ct.tipo.calle.toLowerCase() : 'contrato'
    partes.push(`${tipo.startsWith('indefinido') || tipo.startsWith('temporal') || tipo.startsWith('fijo') ? `contrato ${tipo}` : tipo}${ct.desde ? ` desde el ${fecha(ct.desde)}` : ''}`)
    if (ct.convenio?.nombre) partes.push(`convenio ${ct.convenio.nombre}${ct.grupo ? `, grupo ${ct.grupo.codigo}` : ''}`)
  }
  if (f.salario?.bruto_mes != null) partes.push(`cobra ${euros(f.salario.bruto_mes)} brutos al mes en ${f.salario.pagas} pagas`)
  if (f.irpf?.pct != null) partes.push(`le retenemos el ${porcentaje(f.irpf.pct)} de IRPF`)
  return partes.join(' · ')
}

export const DE_DONDE: Record<Concepto['origen'], string> = { convenio: 'Convenio', pactado: 'Pactado con la persona' }

/** Lo que dice la tarjeta del mínimo del convenio. Sin categoría, que no se puede calcular y por qué (Julio, 02/11). */
export function frasesMinimo(s: NonNullable<Ficha['salario']>): { tono: 'seguro' | 'duda' | 'falta'; titulo: string; texto: string } {
  if (s.minimo_convenio == null) {
    const porque = s.minimo_porque === 'sin_categoria' ? 'le falta la categoría del convenio. Ponla arriba, en «Convenio y jornada»'
      : s.minimo_porque === 'sin_convenio' ? 'su convenio no está cargado en Sumied'
      : 'las tablas de su convenio no tienen importes para su categoría'
    return { tono: 'duda', titulo: 'No se puede saber si cobra por encima del mínimo del convenio', texto: `No se puede calcular: ${porque}.` }
  }
  const bruto = s.bruto_mes ?? 0
  const dif = bruto - s.minimo_convenio
  return dif >= 0
    ? { tono: 'seguro', titulo: 'Cobra por encima del mínimo del convenio', texto: `El mínimo para su categoría es ${euros(s.minimo_convenio)} al mes. Cobra ${euros(dif)} más.` }
    : { tono: 'falta', titulo: 'Cobra por debajo del mínimo del convenio', texto: `El mínimo para su categoría es ${euros(s.minimo_convenio)} al mes. Le faltan ${euros(-dif)}.` }
}

/** Cuándo cumple su primer trienio (3 años de antigüedad), si es después de hoy. */
export function proximoTrienio(antiguedad: string | null | undefined, hoy: string): string | null {
  if (!antiguedad) return null
  const [a, m, d] = antiguedad.slice(0, 10).split('-').map(Number)
  let n = 3
  while (true) {
    const t = `${a + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (t > hoy) return t
    n += 3
  }
}

/** Un IBAN, como se enseña: por grupos de cuatro, y tapado salvo el final si se pide. */
export function ibanBonito(iban: string | null | undefined, tapado = false): string {
  if (!iban) return ''
  const v = iban.replace(/\s+/g, '').toUpperCase()
  return tapado ? `${v.slice(0, 4)} …${v.slice(-4)}` : v.replace(/(.{4})/g, '$1 ').trim()
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El mes de una paga extra del convenio, leído del texto de Cegid («PAGA DE JUNIO, pago 20/06…» → «junio»). */
export function mesDePaga(texto: string | null | undefined): string | null {
  if (!texto) return null
  const t = texto.toLowerCase()
  return MESES.find((m) => new RegExp(`\\b${m}\\b`).test(t)) ?? null
}

/** «junio y diciembre», con los meses de las pagas del convenio; null si no se saben los dos. */
export function mesesDePagas(conv: NonNullable<Ficha['contrato']>['convenio'] | null | undefined): string | null {
  const a = mesDePaga(conv?.paga_13), b = mesDePaga(conv?.paga_14)
  return a && b ? `${a} y ${b}` : null
}

/** Las vacaciones del convenio, sin el detalle de cómo se pagan («30 días naturales; importe = …» → «30 días naturales»). */
export const vacacionesDelConvenio = (texto: string | null | undefined) => (texto ? texto.split(';')[0].trim() || null : null)

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Cuándo acaba (o acabó) su periodo de prueba, contado en días naturales desde el alta. */
export function finDePrueba(ct: NonNullable<Ficha['contrato']>, hoy: string): { fecha: string; superado: boolean; texto: string } | null {
  if (!ct.desde || !ct.prueba_dias) return null
  const fin = sumarDias(ct.desde, ct.prueba_dias)
  const superado = fin < hoy
  return { fecha: fin, superado, texto: superado ? `prueba superada el ${fecha(fin)}` : `la prueba acaba el ${fecha(fin)}` }
}

/** Los avisos de arriba de la ficha (pantalla 1), sacados de sus datos: nada inventado. */
export function avisosDeLaFicha(f: Ficha, hoy: string): { clave: string; tono: 'duda' | 'neutro'; texto: string }[] {
  const ct = f.contrato
  const avisos: { clave: string; tono: 'duda' | 'neutro'; texto: string }[] = []
  if (!ct || ct.baja) return avisos
  const limite = sumarDias(hoy, 60)
  const prueba = finDePrueba(ct, hoy)
  if (prueba && !prueba.superado && prueba.fecha <= limite) {
    avisos.push({ clave: 'prueba', tono: 'duda', texto: `Su periodo de prueba acaba el ${fecha(prueba.fecha)}. Hasta ese día, el contrato se puede terminar sin preaviso.` })
  }
  if (ct.hasta && ct.hasta >= hoy && ct.hasta <= limite) {
    avisos.push({ clave: 'fin', tono: 'duda', texto: `Su contrato acaba el ${fecha(ct.hasta)}. Decide si se renueva antes de esa fecha.` })
  }
  const trienio = proximoTrienio(ct.antiguedad, hoy)
  if (trienio && trienio <= limite) {
    const anios = Number(trienio.slice(0, 4)) - Number((ct.antiguedad ?? '').slice(0, 4))
    avisos.push({ clave: 'trienio', tono: 'neutro', texto: `El ${fecha(trienio)} cumple ${anios} años en la empresa a efectos de antigüedad: mira lo que le sube su convenio por el trienio.` })
  }
  return avisos
}
