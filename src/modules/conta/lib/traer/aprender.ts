// src/modules/conta/lib/traer/aprender.ts
//
// N04 · Lo que Sumied aprende de las facturas del año (decisión 6 del N01), calculado y
// devuelto, sin guardar nada:
//   · para cada proveedor, su cuenta de gasto habitual, sus tipos de IVA y su retención,
//     sacados de sus asientos del diario (y de sus facturas del libro, si están casadas);
//   · para cada proveedor y cliente, lo que queda pendiente según su saldo, repartido
//     entre sus últimas facturas, de la más nueva a la más antigua (decisión 3 del N01):
//     si el saldo no cae justo en el borde de una factura, «no cuadra exacto».

import { cifra } from './excel'
import type { Asiento, DiarioLeido, Factura, Tercero } from './leer'
import type { FacturaCasada } from './comprobar'

export interface Aprendido {
  codigo: string
  nombre: string
  /** La cuenta a la que van sus gastos (la de más importe en sus facturas del diario). */
  gasto: { cuenta: string; nombre: string; facturas: number } | null
  /** Los tipos de IVA de sus facturas (de los libros), de menor a mayor. */
  tiposIva: number[]
  /** El % de retención, si se le retiene. */
  retencion: number | null
  facturas: number
  porque: string
}

const esGasto = (c: string) => /^(6|2[0-2])/.test(c)

/** Las facturas de un proveedor en el diario: sus asientos con su cuenta al haber. */
const susAsientos = (diario: DiarioLeido, codigo: string): Asiento[] =>
  diario.asientos.filter((a) => a.apuntes.some((x) => x.subcuenta === codigo && x.haber > 0 && x.debe === 0) && a.apuntes.some((x) => esGasto(x.subcuenta) && x.debe > 0))

export function aprenderProveedores(diario: DiarioLeido, proveedores: readonly Tercero[], casadas: readonly FacturaCasada[]): Aprendido[] {
  const out: Aprendido[] = []
  for (const p of proveedores) {
    const asientos = susAsientos(diario, p.codigo)
    if (!asientos.length) continue
    const porCuenta = new Map<string, { nombre: string; importe: number; facturas: number }>()
    let base = 0, retenido = 0
    for (const a of asientos) {
      for (const x of a.apuntes) {
        if (esGasto(x.subcuenta) && x.debe > 0) {
          const c = porCuenta.get(x.subcuenta) ?? { nombre: x.nombre, importe: 0, facturas: 0 }
          c.importe += x.debe; c.facturas++
          porCuenta.set(x.subcuenta, c)
          base += x.debe
        }
        if (x.subcuenta.startsWith('4751')) retenido += x.haber - x.debe
      }
    }
    const [cuenta, g] = [...porCuenta.entries()].sort((a, b) => b[1].importe - a[1].importe)[0]
    const suyas = casadas.filter((c) => asientos.includes(c.asiento)).map((c) => c.factura)
    const tiposIva = [...new Set(suyas.flatMap((f) => f.tramos.map((t) => t.tipo)).filter((t): t is number => t !== null))].sort((a, b) => a - b)
    const deLibro = suyas.find((f) => f.retencion?.tipo != null)?.retencion?.tipo ?? null
    const retencion = deLibro ?? (retenido > 0 && base > 0 ? Math.round((retenido / base) * 10000) / 100 : null)
    const n = asientos.length
    out.push({
      codigo: p.codigo, nombre: p.nombreFiscal, gasto: { cuenta, nombre: g.nombre, facturas: g.facturas }, tiposIva, retencion, facturas: n,
      porque: `${n === 1 ? 'Su factura' : `Sus ${n} facturas`} del diario ${n === 1 ? 'va' : 'van'} a ${g.nombre || cuenta} · ${cuenta}`
        + (tiposIva.length ? `, con IVA al ${tiposIva.join(' % y al ')} %` : '')
        + (retencion !== null ? ` y una retención del ${String(retencion).replace('.', ',')} %` : '') + '.',
    })
  }
  return out
}

export interface Pendiente {
  codigo: string
  nombre: string
  clase: 'proveedor' | 'cliente'
  /** Lo que se le debe (proveedor) o nos debe (cliente) según el diario; 0 si está a cero. */
  saldo: number
  /** Sus facturas pendientes, de la más nueva a la más antigua, con lo que queda de cada una. */
  facturas: { numero: string; fecha: string; pendiente: number }[]
  /** El saldo cae justo en el borde de sus facturas (o no hay saldo). */
  cuadraExacto: boolean
  frase: string
}

/** Lo que se debe de una factura: su total menos la retención (la retención no se paga al proveedor). */
const aPagar = (f: Factura) => f.total - (f.retencion?.importe ?? 0)

export function pendientesPorSaldo(diario: DiarioLeido, terceros: readonly { t: Tercero; clase: 'proveedor' | 'cliente' }[], facturas: readonly Factura[]): Pendiente[] {
  const saldos = new Map<string, number>()
  for (const a of diario.asientos) for (const x of a.apuntes) saldos.set(x.subcuenta, (saldos.get(x.subcuenta) ?? 0) + x.debe - x.haber)
  return terceros.map(({ t, clase }) => {
    const bruto = saldos.get(t.codigo)
    const saldo = (bruto === undefined ? 0 : clase === 'cliente' ? bruto : -bruto) || 0   // sin «-0»
    const suyas = facturas.filter((f) => f.nif && f.nif === t.nif).sort((a, b) => b.expedicion.localeCompare(a.expedicion))
    const pend: Pendiente['facturas'] = []
    let resto = saldo
    for (const f of suyas) {
      if (resto <= 0) break
      const p = Math.min(resto, aPagar(f))
      pend.push({ numero: f.numero, fecha: f.expedicion, pendiente: p })
      resto -= p
    }
    const ultima = pend[pend.length - 1]
    const cuadraExacto = saldo <= 0 || (resto === 0 && (!ultima || ultima.pendiente === aPagar(suyas[pend.length - 1])))
    const quien = `${t.codigo} · ${t.nombreFiscal}`
    const frase = bruto === undefined ? `${quien}: sin movimientos en el diario.`
      : saldo === 0 ? `${quien}: está a cero.`
      : saldo < 0 ? `${quien}: el saldo va al revés (${cifra(-saldo)} ${clase === 'cliente' ? 'a su favor' : 'a nuestro favor'}).`
      : `${quien}: ${clase === 'cliente' ? 'nos debe' : 'se le deben'} ${cifra(saldo)}`
        + (pend.length ? `, ${pend.length === 1 ? 'de la factura' : 'de las facturas'} ${pend.map((x) => x.numero).join(', ')}.` : ', y no hay facturas suyas en el libro para repartirlo.')
        + (cuadraExacto ? '' : ' No cuadra exacto con sus facturas: míralo.')
    return { codigo: t.codigo, nombre: t.nombreFiscal, clase, saldo, facturas: pend, cuadraExacto, frase }
  })
}
