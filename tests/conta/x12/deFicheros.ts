// tests/conta/x12/deFicheros.ts — X12 · Los ficheros de prueba del N07 (tests/conta/fixtures/importar/erp10,
// datos inventados: T11) puestos en un ERP10 simulado con la forma de lo medido en QBO Integrity (X11):
// las subcuentas con sus fichas (los terceros, también subcuentas), los asientos con sus líneas y las
// facturas de /api/facturas con su asiento (serie y documento), la cuenta del tercero y sus tramos.
// Para la regla 31: el mismo ejercicio por fichero y por la conexión tiene que dejar lo mismo.

import { readFileSync, readdirSync } from 'node:fs'
import { abrirExcel, leerCarga, type Carga } from '@/modules/conta/lib/traer'
import type { EmpresaSimulada } from '../erp10/simulado'

export const D = 'tests/conta/fixtures/importar/erp10'
export const FICHEROS = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort()
export const abrir = (nombres: readonly string[]) => nombres.map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))
/** Lo que deja «Traer» con los ficheros (sin el inmovilizado, que la conexión no trae). */
export const cargaDeLosFicheros = (): Carga => leerCarga(abrir(FICHEROS.filter((f) => f !== 'inmovilizado.xlsx')))

const eur = (c: number) => Math.round(c) / 100
const num = (iso: string | null) => (iso ? Number(iso.replace(/-/g, '')) : null)

/** El ERP10 de una empresa con lo de los ficheros: el mismo ejercicio, como lo daría la API. */
export function erp10DeLosFicheros(c: Carga, cif = 'B00000000'): EmpresaSimulada {
  const terceros = new Map([...(c.proveedores?.terceros ?? []), ...(c.clientes?.terceros ?? [])].map((t) => [t.codigo, t]))
  const fichas = new Map<string, Record<string, unknown>>()
  for (const s of c.plan?.subcuentas ?? []) fichas.set(s.codigo, { Codigo: s.codigo, Descripcion: s.nombre })
  for (const t of terceros.values()) {
    fichas.set(t.codigo, { ...(fichas.get(t.codigo) ?? { Codigo: t.codigo, Descripcion: t.nombreFiscal }), NombreComercial: t.nombreComercial, NIF: t.nif ?? '', Poblacion: t.poblacion, Pais: 'ES' })
  }
  const casadas = c.comprobado.facturas?.casadas ?? []
  const deFactura = new Set(casadas.map((x) => `${x.asiento.clave}|${x.asiento.fecha}`))
  const apuntes = (c.diario?.asientos ?? []).map((a) => ({
    Serie: a.serie, Documento: Number(a.documento), TipoAsiento: deFactura.has(`${a.clave}|${a.fecha}`) ? 1 : 0, Fecha: num(a.fecha) as number,
    Descripcion: a.apuntes[0]?.concepto ?? '',
    Detalles: a.apuntes.map((x) => ({ Cuenta: x.subcuenta, Debe: eur(x.debe), Haber: eur(x.haber), Descripcion: x.concepto })),
  }))
  const facturas = casadas.map(({ factura: f, asiento: a }) => {
    const cuenta = a.apuntes.map((x) => x.subcuenta).find((k) => /^4[0134]/.test(k) && terceros.has(k)) ?? ''
    const x: Record<string, unknown> = {
      Ejercicio: a.fecha.slice(0, 4), Serie: a.serie, Documento: Number(a.documento), TipoAsiento: 1, Fecha: num(a.fecha),
      FechaFactura: num(f.expedicion), FechaOperacion: num(f.operacion), CuentaCliente: cuenta, NumeroFactura: f.numero,
      NombreCliente: f.nombre, CifCliente: f.nif ?? '', ClaveTipoFactura: f.tipoFactura ?? '', TipoFactura: 1, TotalFactura: eur(f.total),
    }
    f.tramos.forEach((t, i) => { x[`BaseImponible${i + 1}`] = eur(t.base); x[`PorcentajeIVA${i + 1}`] = t.tipo; x[`CuotaIVA${i + 1}`] = eur(t.cuota) })
    if (f.retencion) { x.CuotaRetencion = eur(f.retencion.importe); x.PorcentajeRetencion = f.retencion.tipo; x.BaseRetencion = eur(f.base) }
    return x
  })
  return { cif, apuntes, fichas: [...fichas.values()].sort((p, q) => String(p.Codigo).localeCompare(String(q.Codigo))), facturas }
}
