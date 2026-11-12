// supabase/functions/_shared/cobro/facturaSumiedDatos.ts
//
// G05 · Tarea 4 · Los datos del modelo de factura «Sumied» de una factura que
// sale de un recibo, a partir de lo ya leído (no lee nada). Lo usan la ficha
// (ventasService.datosSumied, en el navegador) y el servidor al emitir
// (cobro/facturaRecibo.ts): el mismo PDF en los dos sitios.
// Lo prueba tests/unit/modules/conta/gestoria/g05/facturaSumiedDatos.test.ts.

import { cuentaEnmascarada, QUE_INCLUYE_POR_DEFECTO, type DatosFacturaSumied } from '../facturaSumiedPdf.ts'

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

/** Lo que hace falta de la factura emitida (customer_invoice y sus líneas). */
export interface FacturaParaSumied {
  numero: string | null
  fecha: string
  base: number; iva: number; retencion: number; total: number
  cliente: { nombre: string | null; nif: string | null; calle: string | null; cp: string | null; ciudad: string | null; provincia: string | null }
  lineas: { tipo: number; importe: number; cuota: number | null }[]
}

export interface EntradaSumied {
  factura: FacturaParaSumied
  /** conta_recibo: el mes, sus líneas (factura->lineas) y el día del cobro. */
  recibo: { mes: string; factura: Fila | null; confirmado_el: string | null }
  /** company: nombre, NIF, dirección fiscal y contacto. */
  empresa: Fila
  codigoCliente: number | null
  /** conta_consulta_asignacion (id, servicio_id, nivel_id, paquete_id), conta_servicio_nivel (id, incluye), conta_servicio (id, clave, incluye), conta_paquete (id, descripcion). */
  asignaciones: Fila[]; niveles: Fila[]; servicios: Fila[]; paquetes: Fila[]
  /** conta_gc_mandato: los últimos dígitos y el país de la cuenta. */
  cuenta: { pais: string | null; final: string | null } | null
  logo: DatosFacturaSumied['emisor']['logo']
  demo: boolean
  verifactu: DatosFacturaSumied['verifactu']
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const fechaLargaSumied = (iso: string, conAnio = true) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}${conAnio ? ` de ${iso.slice(0, 4)}` : ''}`
const cent = (x: number) => Math.round(x * 100)

/** Por tipo de IVA: la base y el IVA guardados (la cuota de cada línea si la tiene; si no, la base por el tipo). */
export function porTipoGuardado(lineas: FacturaParaSumied['lineas']): { tipo: number; baseCent: number; ivaCent: number }[] {
  const tipos = [...new Set(lineas.map((l) => l.tipo))].sort((a, b) => b - a)
  return tipos.map((tipo) => {
    const del = lineas.filter((l) => l.tipo === tipo)
    const baseCent = del.reduce((t, l) => t + cent(l.importe), 0)
    const ivaCent = del.every((l) => l.cuota !== null) ? del.reduce((t, l) => t + cent(l.cuota ?? 0), 0) : Math.round(baseCent * tipo / 100)
    return { tipo, baseCent, ivaCent }
  })
}

export function montarDatosSumied(e: EntradaSumied): DatosFacturaSumied {
  const f = e.factura
  const mes = String(e.recibo.mes)
  const lineasRecibo = Array.isArray(e.recibo.factura?.lineas) ? (e.recibo.factura!.lineas as Fila[]) : []
  const enLista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1].charAt(0).toLowerCase()}${xs[xs.length - 1].slice(1)}`)
  const queIncluye = (asignacionId: string | null): string | null => {
    const a = e.asignaciones.find((x) => String(x.id) === asignacionId)
    if (!a) return null
    // Por orden: lo que incluye su nivel, lo del servicio, la descripción del paquete y, si no, el de siempre del catálogo.
    const n = e.niveles.find((x) => String(x.id) === s(a.nivel_id))
    if (n && Array.isArray(n.incluye) && n.incluye.length) return enLista((n.incluye as unknown[]).map(String).slice(0, 3))
    const sv = e.servicios.find((x) => String(x.id) === s(a.servicio_id))
    if (s(sv?.incluye)) return s(sv?.incluye)
    const p = e.paquetes.find((x) => String(x.id) === s(a.paquete_id))
    if (s(p?.descripcion)) return s(p?.descripcion)
    return QUE_INCLUYE_POR_DEFECTO[String(sv?.clave ?? '')] ?? null
  }
  const desde = (iso: string | null) => (!iso ? null : iso.slice(0, 7) === mes ? `Alta el ${fechaLargaSumied(iso)}` : `Desde el ${fechaLargaSumied(iso)}`)
  const lineas = lineasRecibo.map((l) => {
    const m = String(l.concepto ?? '').match(/^(.*?)\s*·\s*(\d+ trabajador(?:es)?)$/)
    const nombre = m ? m[1] : String(l.concepto ?? '')
    const incluye = queIncluye(s(l.asignacionId))
    const trabajadores = Array.isArray(l.trabajadores) ? (l.trabajadores as Fila[]).map((t) => ({ nombre: String(t.nombre ?? ''), desde: desde(s(t.desde)) })) : null
    return {
      concepto: nombre, explicacion: [incluye, m ? m[2] : null].filter(Boolean).join(' · ') || null,
      cantidad: Number(l.cantidad ?? 1), precioCent: Number(l.precioCent ?? 0), importeCent: Number(l.baseCent ?? 0),
      trabajadores, trabajadoresEn: (l.trabajadoresEn === 'linea' || l.trabajadoresEn === 'hoja' ? l.trabajadoresEn : null) as 'linea' | 'hoja' | null,
    }
  })
  const emp = e.empresa
  const calle = [s(emp.fiscal_street_type), s(emp.fiscal_street), s(emp.fiscal_number), s(emp.fiscal_extra)].filter(Boolean).join(' ')
  const direccionEmisor = [calle, [s(emp.fiscal_postal_code), s(emp.fiscal_city)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  const contacto = [s(emp.email), s(emp.phone)].filter(Boolean).join(' · ')
  const pagada = s(e.recibo.confirmado_el)
  const [anio, m] = mes.split('-')
  const retPct = f.base === 0 ? 0 : Math.round(f.retencion / f.base * 10000) / 100
  const cli = f.cliente
  return {
    emisor: { nombre: String(s(emp.trade_name) ?? s(emp.legal_name) ?? ''), nif: String(emp.tax_id ?? ''), lineas: [direccionEmisor, contacto].filter(Boolean), logo: e.logo },
    numero: f.numero ?? '', fecha: f.fecha, pagadaEl: pagada, periodo: `Servicios de ${MESES[Number(m) - 1]} de ${anio}`,
    cliente: { nombre: cli.nombre ?? '', nif: cli.nif ?? '', codigo: e.codigoCliente,
      direccion: [[cli.calle].filter(Boolean).join(''), [cli.cp, cli.ciudad].filter(Boolean).join(' ') + (cli.provincia && cli.provincia !== cli.ciudad ? ` (${cli.provincia})` : '')].filter(Boolean).join(' · ') || null },
    pago: { forma: 'Domiciliación SEPA', cuenta: cuentaEnmascarada(e.cuenta?.pais ?? null, e.cuenta?.final ?? null), texto: pagada ? `Cargada el ${fechaLargaSumied(pagada, false)} · pagada` : 'Pendiente de cargo' },
    lineas,
    porTipo: porTipoGuardado(f.lineas),
    baseCent: cent(f.base), ivaCent: cent(f.iva), retencion: f.retencion ? { pct: retPct, cent: cent(f.retencion) } : null, totalCent: cent(f.total),
    verifactu: e.verifactu ?? null, demo: e.demo,
  }
}
