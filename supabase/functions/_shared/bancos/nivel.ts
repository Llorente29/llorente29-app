// supabase/functions/_shared/bancos/nivel.ts
//
// B01·22 · El nivel y el porqué de cada propuesta del banco, en palabras de
// administrativo (Julio, B01r_22, 12/11; los cambios a la regla, 13/11):
//
//   · «Seguro · coincide al céntimo con la factura X»: UNA sola factura (nunca
//     un albarán ni un abono), aprobada, por el importe exacto y sin diferencia;
//     y si el banco nombra un número de factura, tiene que ser ésa.
//   · «Seguro · confirmado 3 veces»: solo lo que va contra una cuenta (no un
//     pago de factura): el mismo tercero, validado contra la misma cuenta las 3
//     últimas veces seguidas, sin corrección por medio. Una corrección pone el
//     contador a cero.
//   · «Míralo · 2 de 3»: en camino; o «Míralo» con lo que le falta para ser seguro.
//   · «Nunca sola»: nóminas, socios, impuestos y Seguridad Social, préstamos,
//     un mes cerrado, o más del límite de la empresa (1.000 € si no dice otro).
//   · «No lo sé»: no hay propuesta.
//
// Se calcula después del motor y se guarda con la propuesta (proposal.nivel).
// No casa nada: el interruptor de la empresa (bank_settings.seguro_solo) está
// apagado, y solo él dejaría casar sola una propuesta «Seguro».

import { contraparteDe, facturasEnConcepto, nombreCuenta, refEn, type Contexto, type Decision, type Destino, type FacturaPendiente, type Movimiento } from './conciliacion.ts'

export type ClaveNivel = 'centimo' | 'confirmado' | 'camino' | 'nunca' | 'nose'

export interface Nivel {
  clave: ClaveNivel
  /** Lo que se enseña en la fila: «Seguro · coincide al céntimo con la factura 24056932». */
  etiqueta: string
  /** El porqué, en una frase. */
  porque: string
  /** Solo «centimo» y «confirmado»: lo que el interruptor dejaría casar solo. */
  seguro: boolean
  /** «confirmado» y «camino» contra una cuenta: las validaciones seguidas que lleva. */
  veces?: number
}

/** Una factura pendiente, con lo que dice su ficha de qué documento es. */
export type FacturaConTipo = FacturaPendiente & { esFactura?: boolean }

export interface DatosNivel {
  facturas: readonly FacturaConTipo[]
  /** `${contraparte}|${cuentas}` → validaciones seguidas sin corrección (rachasDe). */
  rachas: ReadonlyMap<string, number>
  /** El límite de la empresa, en céntimos: por encima, nunca sola. */
  limiteCent: number
  /** `${cuentaBanco}|AAAA-MM` de los meses de banco cerrados. */
  mesesCerrados: ReadonlySet<string>
  nombres: Contexto['nombres']
}

export const LIMITE_POR_DEFECTO_CENT = 100_000
export const VECES_PARA_SEGURO = 3

/** «1.000 €», «110,87 €»: con el punto de los miles también en cuatro cifras (toLocaleString no lo pone). */
const eurosTexto = (c: number) => {
  // eslint-disable-next-line no-restricted-syntax -- cálculo local: `c` son céntimos ya calculados, nunca null.
  const [ent, dec] = (Math.abs(c) / 100).toFixed(2).split('.')
  return `${c < 0 ? '−' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : `,${dec}`} €`
}
const vez = (n: number) => (n === 1 ? '1 vez' : `${n} veces`)

/** Las cuentas de un destino «contra una cuenta», ordenadas y juntas: la clave de la racha. */
export function cuentasDe(d: Destino | null): string | null {
  if (!d || (d.tipo !== 'cuenta' && d.tipo !== 'anticipo')) return null
  const cs = [...new Set(d.lineas.map((l) => l.cuenta))].sort()
  return cs.length ? cs.join(',') : null
}

const NUNCA: [RegExp, string][] = [
  [/^(465|640|641|642)/, 'nóminas'],
  [/^(551|553)/, 'socios'],
  [/^(473|475|476|477|4750|4751)/, 'impuestos o Seguridad Social'],
  [/^(170|171|520|521|662)/, 'préstamos'],
]

/** Por qué una propuesta no se puede casar nunca sola, o null. */
function nuncaSola(d: Decision, m: Movimiento, datos: DatosNivel): { etiqueta: string; porque: string } | null {
  const imp = Math.abs(m.importeCent)
  if (datos.mesesCerrados.has(`${m.cuentaId}|${m.fecha.slice(0, 7)}`))
    return { etiqueta: 'Nunca sola · mes cerrado', porque: 'El mes de este movimiento está cerrado en este banco: lo que se apunte en él lo decides tú.' }
  if (d.origen === 'nomina') return { etiqueta: 'Nunca sola · nóminas', porque: 'Es una nómina: aunque cuadre, la miras tú.' }
  if (d.origen === 'impuesto') return { etiqueta: 'Nunca sola · impuestos o Seguridad Social', porque: 'Es un pago a Hacienda o a la Seguridad Social: aunque cuadre, lo miras tú.' }
  if (d.origen === 'contrato' || d.destino?.tipo === 'contrato') return { etiqueta: 'Nunca sola · préstamos', porque: 'Es la cuota de un préstamo: aunque cuadre, la miras tú.' }
  const lineas = d.destino && 'lineas' in d.destino ? d.destino.lineas : []
  for (const [re, que] of NUNCA) {
    if (lineas.some((l) => re.test(l.cuenta))) return { etiqueta: `Nunca sola · ${que}`, porque: `Va contra una cuenta de ${que}: aunque cuadre, lo miras tú.` }
  }
  if (imp > datos.limiteCent) return { etiqueta: `Nunca sola · más de ${eurosTexto(datos.limiteCent)}`, porque: `Pasa del límite de la empresa (${eurosTexto(datos.limiteCent)}): aunque esté claro, lo miras tú.` }
  return null
}

/** El nivel de una propuesta del motor. */
export function nivelDe(d: Decision, m: Movimiento, datos: DatosNivel): Nivel {
  if (!d.destino || d.confianza === 'duda') {
    return { clave: 'nose', etiqueta: 'No lo sé', seguro: false, porque: d.falta ? `Me falta ${d.falta}.` : 'No tengo con qué proponerlo.' }
  }
  const nunca = nuncaSola(d, m, datos)
  if (nunca) return { clave: 'nunca', seguro: false, ...nunca }

  const dest = d.destino
  if (dest.tipo === 'factura_recibida') {
    const pago = Math.abs(m.importeCent)
    if (dest.facturas.length !== 1) return { clave: 'camino', seguro: false, etiqueta: `Míralo · son ${dest.facturas.length} facturas`, porque: 'Junta varias facturas para llegar al importe: confirma que son éstas.' }
    const f = datos.facturas.find((x) => x.id === dest.facturas[0].id)
    const num = f?.numero ?? 'sin número'
    if (!f || f.esFactura === false) return { clave: 'camino', seguro: false, etiqueta: 'Míralo · no es una factura', porque: `El documento ${num} no es una factura (un albarán o un abono no cuentan): confírmalo tú.` }
    if (f.aprobada === false) return { clave: 'camino', seguro: false, etiqueta: 'Míralo · factura sin aprobar', porque: `La factura ${num} está en revisión: apruébala o confírmalo tú.` }
    const queda = f.totalCent - f.pagadoCent
    if (dest.diferencia || Math.round(dest.facturas[0].importe * 100) !== pago || queda !== pago)
      return { clave: 'camino', seguro: false, etiqueta: 'Míralo · no coincide al céntimo', porque: `La factura ${num} pide ${eurosTexto(queda)} y el banco dice ${eurosTexto(pago)}.` }
    const refs = facturasEnConcepto(m.concepto)
    if (refs.length && !(f.numero && refs.some((r) => refEn(r, f.numero!))))
      return { clave: 'camino', seguro: false, etiqueta: `Míralo · el banco dice la factura ${refs[0]}`, porque: `El banco nombra la factura ${refs[0]} y propongo la ${num}: confirma cuál es.` }
    return { clave: 'centimo', seguro: true, etiqueta: `Seguro · coincide al céntimo con la factura ${num}`,
      porque: `La factura ${num} de ${f.proveedor} pide justo ${eurosTexto(pago)}, lo mismo que dice el banco.` }
  }

  const cuentas = cuentasDe(dest)
  const cp = contraparteDe(m)
  if (cuentas && cp) {
    const veces = datos.rachas.get(`${cp}|${cuentas}`) ?? 0
    const contra = cuentas.split(',').map((c) => nombreCuenta({ nombres: datos.nombres }, c)).join(' y ')
    if (veces >= VECES_PARA_SEGURO)
      return { clave: 'confirmado', seguro: true, veces, etiqueta: 'Seguro · confirmado 3 veces',
        porque: `Las ${VECES_PARA_SEGURO} últimas veces de ${cp} las validaste contra ${contra} sin cambiarlas.` }
    return { clave: 'camino', seguro: false, veces, etiqueta: `Míralo · ${veces} de ${VECES_PARA_SEGURO}`,
      porque: veces ? `Lo has validado ${vez(veces)} seguida${veces === 1 ? '' : 's'} contra ${contra}: a la tercera sin cambios, es seguro.`
        : `Es la primera vez que lo propongo contra ${contra}, o la última vez lo cambiaste: confírmalo y empiezo a contar.` }
  }
  return { clave: 'camino', seguro: false, etiqueta: 'Míralo', porque: d.porque }
}

/** Una validación de la historia: el concepto del banco, las cuentas del asiento, cuándo y si se corrigió. */
export interface Validacion { concepto: string; contraparte?: string | null; cuentas: string; validado: string; corregido: boolean }

/**
 * Las rachas: por cada contraparte, cuántas de sus últimas validaciones seguidas
 * fueron contra las mismas cuentas sin corrección. Se corta en la primera
 * corrección o en la primera validación contra otras cuentas.
 */
export function rachasDe(historial: readonly Validacion[]): Map<string, number> {
  const porCp = new Map<string, Validacion[]>()
  for (const v of historial) {
    const cp = contraparteDe({ concepto: v.concepto, contraparte: v.contraparte ?? null })
    if (!cp || !v.cuentas) continue
    porCp.set(cp, [...(porCp.get(cp) ?? []), v])
  }
  const out = new Map<string, number>()
  for (const [cp, vs] of porCp) {
    const orden = [...vs].sort((a, b) => b.validado.localeCompare(a.validado))
    const cuentas = orden[0].cuentas
    let n = 0
    for (const v of orden) {
      if (v.cuentas !== cuentas || v.corregido) break
      n++
    }
    out.set(`${cp}|${cuentas}`, n)
  }
  return out
}

/** Si lo casado es lo propuesto: el mismo tipo y lo mismo dentro (las facturas, las cuentas, la liquidación, la pareja). */
export function mismoDestino(a: Destino | null | undefined, b: Destino | null | undefined): boolean {
  if (!a || !b || a.tipo !== b.tipo) return false
  const ids = (xs: { id: string }[] | undefined) => (xs ?? []).map((x) => x.id).sort().join(',')
  switch (a.tipo) {
    case 'factura_recibida': return ids(a.facturas) === ids((b as typeof a).facturas)
    case 'liquidacion': return a.liquidacion_id === (b as typeof a).liquidacion_id
    case 'traspaso': return a.otro_movimiento_id === (b as typeof a).otro_movimiento_id
    case 'asiento': return a.entry_id === (b as typeof a).entry_id
    case 'cuenta': case 'anticipo': case 'contrato': case 'factura_emitida':
      return cuentasDe({ ...a, tipo: 'cuenta' }) === cuentasDe({ ...(b as typeof a), tipo: 'cuenta' })
    default: return JSON.stringify(a) === JSON.stringify(b)
  }
}
