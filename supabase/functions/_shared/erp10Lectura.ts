// supabase/functions/_shared/erp10Lectura.ts
//
// X10c (19/11) · Lo que devuelven las funciones de la salida a ERP10 de la base
// (conta_erp10_por_salir, conta_erp10_recibidas_por_salir, conta_erp10_emitidas_por_salir,
// conta_erp10_asientos_por_salir, conta_erp10_dias_tpv_por_salir), leído en sus tipos. Puro:
// lo usan el navegador (src/modules/conta/services/erp10Service.ts, que lo vuelve a exportar)
// y el servidor (conta-erp10-escribir), para que los dos lean exactamente lo mismo.

import type { AsientoParaErp10, CuentaContado, DiaParaErp10, EmitidaParaErp10, LineaRecibida, Operacion, OperacionEmitida } from './erp10Ficheros.ts'

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))

export interface PartidaPorSalir {
  entryId: string
  serie: number
  numero: number | null
  fecha: string
  concepto: string
  origen: string
  clase: 'recibida' | 'emitida' | 'asiento'
  importe: number
  numeroFactura: string | null
  nif: string | null
  tercero: string | null
  tienePdf: boolean
  deOtroMes: boolean
  sale: boolean
  avisos: string[]
}
export interface CuentaNuevaPorSalir { codigo: string; nombre: string; codigoErp10: string | null; cabe: boolean; aviso: string | null }
export interface PorSalir { mes: string; desde: string; codigo: string; largo: number; partidas: PartidaPorSalir[]; cuentasNuevas: CuentaNuevaPorSalir[] }

export function aPorSalir(r: Record<string, unknown>): PorSalir {
  const ps = (r.partidas ?? []) as Record<string, unknown>[]
  const cs = (r.cuentas_nuevas ?? []) as Record<string, unknown>[]
  return {
    mes: String(r.mes), desde: String(r.desde), codigo: String(r.codigo), largo: Number(r.largo),
    partidas: ps.map((p) => ({
      entryId: String(p.entry_id), serie: n(p.serie), numero: p.numero == null ? null : Number(p.numero), fecha: String(p.fecha), concepto: String(p.concepto ?? ''),
      origen: String(p.origen), clase: String(p.clase) as PartidaPorSalir['clase'], importe: n(p.importe), numeroFactura: s(p.numero_factura),
      nif: s(p.nif), tercero: s(p.tercero), tienePdf: p.tiene_pdf === true, deOtroMes: p.de_otro_mes === true, sale: p.sale === true,
      avisos: Array.isArray(p.avisos) ? (p.avisos as unknown[]).map(String) : [],
    })),
    cuentasNuevas: cs.map((c) => ({ codigo: String(c.codigo), nombre: String(c.nombre ?? ''), codigoErp10: s(c.codigo_erp10), cabe: c.cabe === true, aviso: s(c.aviso) })),
  }
}

export interface RecibidaDeLaBase {
  entryId: string
  fecha: string
  factura: { numero: string | null; fecha: string }
  proveedor: { nombre: string; nif: string | null }
  operacion: Operacion
  lineas: (LineaRecibida & { plantilla: string })[]
  tienePdf: boolean
  pdf: { ruta: string; nombre: string } | null
}
export interface CuentaDeLaBase { codigo: string; plantilla: string; nombre: string; nif: string | null; gastoHabitual: string | null }
export interface RecibidasPorSalir { recibidas: RecibidaDeLaBase[]; cuentas: CuentaDeLaBase[]; yaSalidas: Map<string, string> }

export function aRecibidas(r: Record<string, unknown>): RecibidasPorSalir {
  const rs = (r.recibidas ?? []) as Record<string, unknown>[]
  return {
    recibidas: rs.map((x) => {
      const f = (x.factura ?? {}) as Record<string, unknown>
      const p = (x.proveedor ?? {}) as Record<string, unknown>
      const pdf = x.pdf as Record<string, unknown> | null
      return {
        entryId: String(x.entryId), fecha: String(x.fecha), factura: { numero: s(f.numero), fecha: String(f.fecha) },
        proveedor: { nombre: String(p.nombre ?? ''), nif: s(p.nif) }, operacion: String(x.operacion) as Operacion,
        lineas: ((x.lineas ?? []) as Record<string, unknown>[]).map((l) => ({
          cuenta: String(l.cuenta), plantilla: String(l.plantilla), debe: n(l.debe), haber: n(l.haber),
          tipoIva: l.tipoIva == null ? null : Number(l.tipoIva), baseIva: l.baseIva == null ? null : Number(l.baseIva),
          deducible: (s(l.deducible) as LineaRecibida['deducible']) ?? null, recargo: l.recargo == null ? null : Number(l.recargo),
          modeloRetencion: (s(l.modeloRetencion) as LineaRecibida['modeloRetencion']) ?? null,
        })),
        tienePdf: x.tienePdf === true, pdf: pdf ? { ruta: String(pdf.ruta), nombre: String(pdf.nombre) } : null,
      }
    }),
    cuentas: ((r.cuentas ?? []) as Record<string, unknown>[]).map((c) => ({
      codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? ''), nif: s(c.nif), gastoHabitual: s(c.gastoHabitual),
    })),
    yaSalidas: new Map(Object.entries((r.yaSalidas ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }
}

export interface EmitidaDeLaBase extends EmitidaParaErp10 {
  /** De dónde viene: customer_invoice.origin (a_mano, recurrente, cierre_dia…), o nulo si es un asiento a mano. */
  origen: string | null
  lineas: (EmitidaParaErp10['lineas'][number] & { plantilla: string })[]
  pdf: { ruta: string; nombre: string } | null
}
/** Una emitida que salió y después se corrigió con una rectificativa: ERP10 tiene la de antes. */
export interface Corregida { entryId: string; numero: string; rectificativa: string; fecha: string; queHacer: string }
export interface EmitidasPorSalir { emitidas: EmitidaDeLaBase[]; cuentas: CuentaDeLaBase[]; yaSalidas: Map<string, string>; corregidas: Corregida[] }

export function aEmitidas(r: Record<string, unknown>): EmitidasPorSalir {
  const es = (r.emitidas ?? []) as Record<string, unknown>[]
  return {
    emitidas: es.map((x) => {
      const f = (x.factura ?? {}) as Record<string, unknown>
      const c = (x.cliente ?? {}) as Record<string, unknown>
      const pdf = x.pdf as Record<string, unknown> | null
      return {
        entryId: String(x.entryId), fecha: String(x.fecha), factura: { numero: s(f.numero), fecha: String(f.fecha) },
        cliente: { nombre: String(c.nombre ?? ''), nif: s(c.nif) }, origen: s(x.origen), rectificativa: x.rectificativa === true,
        tipoFactura: s(x.tipoFactura), operacion: String(x.operacion) as OperacionEmitida, recargo: n(x.recargo), retencion: n(x.retencion),
        lineas: ((x.lineas ?? []) as Record<string, unknown>[]).map((l) => ({
          cuenta: String(l.cuenta), plantilla: String(l.plantilla), debe: n(l.debe), haber: n(l.haber),
          tipoIva: l.tipoIva == null ? null : Number(l.tipoIva), baseIva: l.baseIva == null ? null : Number(l.baseIva),
        })),
        tienePdf: x.tienePdf === true, pdf: pdf ? { ruta: String(pdf.ruta), nombre: String(pdf.nombre) } : null,
      }
    }),
    cuentas: ((r.cuentas ?? []) as Record<string, unknown>[]).map((c) => ({
      codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? ''), nif: s(c.nif), gastoHabitual: s(c.gastoHabitual),
    })),
    yaSalidas: new Map(Object.entries((r.yaSalidas ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
    corregidas: ((r.corregidas ?? []) as Record<string, unknown>[]).map((x) => ({
      entryId: String(x.entryId), numero: String(x.numero ?? ''), rectificativa: String(x.rectificativa ?? ''), fecha: String(x.fecha), queHacer: String(x.queHacer),
    })),
  }
}

export interface AsientoDeLaBase extends AsientoParaErp10 { origen: string; lineas: (AsientoParaErp10['lineas'][number] & { plantilla: string })[] }
export interface AsientosPorSalir { asientos: AsientoDeLaBase[]; cuentas: CuentaDeLaBase[]; yaSalidas: Map<string, string> }
export const SIN_ASIENTOS: AsientosPorSalir = { asientos: [], cuentas: [], yaSalidas: new Map() }

export function aAsientos(r: Record<string, unknown>): AsientosPorSalir {
  return {
    asientos: ((r.asientos ?? []) as Record<string, unknown>[]).map((a) => ({
      entryId: String(a.entryId), serie: n(a.serie), numero: a.numero == null ? null : Number(a.numero), fecha: String(a.fecha), concepto: String(a.concepto ?? ''), origen: String(a.origen ?? ''),
      lineas: ((a.lineas ?? []) as Record<string, unknown>[]).map((l) => ({
        cuenta: String(l.cuenta), plantilla: String(l.plantilla), nombre: String(l.nombre ?? ''), concepto: s(l.concepto), debe: n(l.debe), haber: n(l.haber),
      })),
    })),
    cuentas: ((r.cuentas ?? []) as Record<string, unknown>[]).map((c) => ({
      codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? ''), nif: s(c.nif), gastoHabitual: null,
    })),
    yaSalidas: new Map(Object.entries((r.yaSalidas ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }
}

export interface DiasPorSalir { dias: DiaParaErp10[]; contado: CuentaContado[]; cuentas: CuentaDeLaBase[]; yaSalidas: Map<string, string> }
export const SIN_DIAS: DiasPorSalir = { dias: [], contado: [], cuentas: [], yaSalidas: new Map() }

export function aDias(r: Record<string, unknown>): DiasPorSalir {
  const o = (x: unknown) => (x === 'revo' || x === 'folvy' ? x : null)
  const num = (x: unknown) => (x == null ? null : Number(x))
  return {
    dias: ((r.dias ?? []) as Record<string, unknown>[]).map((d) => ({
      entryId: String(d.entryId), serie: n(d.serie), numero: num(d.numero), fecha: String(d.fecha), concepto: String(d.concepto ?? ''),
      origen: o(d.origen), local: s(d.local), localId: s(d.localId), primero: s(d.primero), ultimo: s(d.ultimo),
      facturas: num(d.facturas), contadores: num(d.contadores),
      lineas: ((d.lineas ?? []) as Record<string, unknown>[]).map((l) => ({
        cuenta: String(l.cuenta), plantilla: String(l.plantilla), nombre: String(l.nombre ?? ''), debe: n(l.debe), haber: n(l.haber),
        tipoIva: num(l.tipoIva), baseIva: num(l.baseIva), libro: s(l.libro),
      })),
    })),
    contado: ((r.contado ?? []) as Record<string, unknown>[]).map((c) => ({ codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? '') })),
    cuentas: ((r.cuentas ?? []) as Record<string, unknown>[]).map((c) => ({
      codigo: String(c.codigo), plantilla: String(c.plantilla), nombre: String(c.nombre ?? ''), nif: s(c.nif), gastoHabitual: null,
    })),
    yaSalidas: new Map(Object.entries((r.yaSalidas ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }
}
