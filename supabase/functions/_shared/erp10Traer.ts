// supabase/functions/_shared/erp10Traer.ts
//
// X12 (20/11) · TRAER DE ERP10 POR LA CONEXIÓN. Una página de lo que «Traer de ERP10» (N07) lee
// hoy de los ficheros, leída de la API de ERP10 (apiCON), en la forma corta que necesita la
// pantalla. Puro: recibe un GET que contesta (el de ClienteErp10, con la lista cerrada y el NIF
// comprobado) y no escribe nada en ninguna parte.
//
// Lo medido en QBO Integrity el 20/11 (X11) manda la forma:
//   · los terceros son las subcuentas 40, 41, 43 y 44 (en una sociedad, /api/clientes y
//     /api/proveedores contestan 400): se leen con el plan, de una pasada;
//   · los asientos (8,5 s por página de 200) y las facturas (16,6 s por página) son lo que pesa:
//     se piden MES A MES y PÁGINA A PÁGINA, una por llamada a la función, para que ninguna pase
//     de un minuto y para seguir donde se quedó si se corta;
//   · el resumen de ERP10 (/api/apuntes/resumen) cuenta LÍNEAS por mes y tipo de introducción:
//     es la comprobación de que lo leído está entero.
//
// Las páginas, como en Diez: 200 como mucho, `$skip` cuenta páginas y, al pasarse del final,
// ERP10 devuelve la primera otra vez sin avisar. Cada página dice la clave de su primera fila
// para que quien pide note la repetición.
//
// Los importes, en CÉNTIMOS enteros; las fechas, como las da ERP10 (AAAAMMDD, número).
// Lo prueban tests/conta/erp10/traer.test.ts y tests/conta/x12/*.

import { limitesMes } from './diezCliente.ts'

export const POR_PAGINA = 200

export type QueTraer = 'subcuentas' | 'apuntes' | 'facturas' | 'resumen'
export const QUE_TRAER: readonly QueTraer[] = ['subcuentas', 'apuntes', 'facturas', 'resumen']

/** Una subcuenta (y, si es de un tercero, su ficha). */
export interface SubcuentaT {
  codigo: string; nombre: string; nombreComercial: string; nif: string
  direccion: string; codigoPostal: string; poblacion: string; provincia: string; pais: string
}
/** Un asiento, con sus líneas. `tipo` es su TipoAsiento. */
export interface ApunteT {
  serie: string; documento: number; fecha: number; tipo: number | null; concepto: string
  lineas: { cuenta: string; concepto: string; debe: number; haber: number }[]
}
/** Una factura de /api/facturas, con lo que lleva un libro de la AEAT. `serie`/`documento`: su asiento. */
export interface FacturaT {
  serie: string; documento: number; fecha: number; fechaFactura: number | null; fechaOperacion: number | null
  /** La cuenta del tercero (CuentaCliente: en una recibida, la del proveedor). */
  cuenta: string
  numero: string; nombre: string; nif: string
  /** ClaveTipoFactura (la del SII: F1, F2…) y TipoFactura (el código de ERP10, 1 a 13). */
  claveTipo: string | null; tipoErp: number | null
  tramos: { base: number; tipo: number | null; cuota: number }[]
  total: number
  retencion: { tipo: number | null; importe: number } | null
}
/** Una fila del resumen de ERP10: las LÍNEAS de un mes y un tipo de introducción. */
export interface ResumenT { ejercicio: number; mes: number; tipo: number | null; nombre: string; lineas: number }

export type FilaT = SubcuentaT | ApunteT | FacturaT | ResumenT

export interface PedirPagina { que: QueTraer; ejercicio: string; mes: string | null; pagina: number }
export interface Pagina {
  que: QueTraer; ejercicio: string; mes: string | null; pagina: number
  filas: FilaT[]
  /** ResultadosTotales de ERP10 (del mes, o del listado), si lo dice. */
  total: number | null
  /** La última página: con menos de 200, o con lo leído llegando al total. */
  ultima: boolean
  /** La clave de su primera fila: si es la de la página 0, ERP10 ha vuelto al principio. */
  primera: string | null
}

const txt = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim()
const cts = (x: unknown) => Math.round((Number(x) || 0) * 100)
const ent = (x: unknown): number | null => { const n = Number(x); return x == null || x === '' || !Number.isFinite(n) ? null : n }
const soloCifras = (x: unknown) => String(x ?? '').replace(/\D/g, '')
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

/** Lo que valida el cuerpo: qué, el ejercicio (AAAA), el mes (AAAA-MM, de ese ejercicio) y la página. */
export function pedidaDelCuerpo(b: Record<string, unknown>): PedirPagina | string {
  const que = QUE_TRAER.includes(b.que as QueTraer) ? b.que as QueTraer : null
  if (!que) return 'falta qué traer (subcuentas, apuntes, facturas o resumen)'
  const ejercicio = typeof b.ejercicio === 'string' && /^\d{4}$/.test(b.ejercicio) ? b.ejercicio : ''
  if (!ejercicio) return 'falta el ejercicio (AAAA)'
  const pagina = Number(b.pagina ?? 0)
  if (!Number.isInteger(pagina) || pagina < 0 || pagina > 4999) return 'la página no vale'
  if (que === 'apuntes' || que === 'facturas') {
    const mes = typeof b.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.mes) && b.mes.startsWith(ejercicio) ? b.mes : ''
    if (!mes) return 'falta el mes (AAAA-MM, del ejercicio)'
    return { que, ejercicio, mes, pagina }
  }
  return { que, ejercicio, mes: null, pagina: que === 'resumen' ? 0 : pagina }
}

/** La ruta de ERP10 de una página. */
export function rutaDe(p: PedirPagina): string {
  const pag = { $top: POR_PAGINA, $skip: p.pagina }
  switch (p.que) {
    case 'subcuentas': return `/api/subcuentas?${q(pag)}`
    case 'resumen': return `/api/apuntes/resumen?${q({ fechaInicio: `${p.ejercicio}0101`, fechaFinal: `${p.ejercicio}1231` })}`
    case 'apuntes':
    case 'facturas': {
      const [a, b] = limitesMes(String(p.mes).replace('-', ''))
      return `/api/${p.que}?${q({ $filter: `Fecha ge ${a} and Fecha le ${b}`, ...pag })}`
    }
  }
}

// ── De lo que da ERP10 a la forma corta ───────────────────────────────────────────────

export function subcuentaT(s: Record<string, unknown>): SubcuentaT {
  const via = [txt(s.TipoVia), txt(s.DireccionVia), txt(s.NumeroVia), txt(s.EscaleraVia), txt(s.PisoVia), txt(s.PuertaVia)].filter(Boolean).join(' ')
  return {
    codigo: soloCifras(s.Codigo), nombre: txt(s.Descripcion), nombreComercial: txt(s.NombreComercial), nif: txt(s.NIF),
    direccion: txt(s.DireccionCompleta) || via, codigoPostal: s.CodigoPostal ? String(s.CodigoPostal).padStart(5, '0') : '',
    poblacion: txt(s.Poblacion), provincia: txt(s.Provincia), pais: txt(s.Pais),
  }
}

export function apunteT(a: Record<string, unknown>): ApunteT {
  const detalles = Array.isArray(a.Detalles) ? a.Detalles as Record<string, unknown>[] : []
  return {
    serie: txt(a.Serie), documento: Number(a.Documento) || 0, fecha: Number(a.Fecha) || 0, tipo: ent(a.TipoAsiento), concepto: txt(a.Descripcion),
    lineas: detalles.map((l) => ({ cuenta: soloCifras(l.Cuenta), concepto: txt(l.Descripcion), debe: cts(l.Debe), haber: cts(l.Haber) })),
  }
}

export function facturaT(f: Record<string, unknown>): FacturaT {
  const tramos: FacturaT['tramos'] = []
  for (let i = 1; i <= 8; i++) {
    const base = cts(f[`BaseImponible${i}`]), cuota = cts(f[`CuotaIVA${i}`])
    if (base || cuota) tramos.push({ base, tipo: ent(f[`PorcentajeIVA${i}`]), cuota })
  }
  const ret = cts(f.CuotaRetencion)
  return {
    serie: txt(f.Serie), documento: Number(f.Documento) || 0, fecha: Number(f.Fecha) || 0,
    fechaFactura: ent(f.FechaFactura) || null, fechaOperacion: ent(f.FechaOperacion) || null,
    cuenta: soloCifras(f.CuentaCliente), numero: txt(f.NumeroFactura), nombre: txt(f.NombreCliente), nif: txt(f.CifCliente),
    claveTipo: txt(f.ClaveTipoFactura) || null, tipoErp: ent(f.TipoFactura),
    tramos, total: cts(f.TotalFactura), retencion: ret ? { tipo: ent(f.PorcentajeRetencion), importe: ret } : null,
  }
}

export function resumenT(x: Record<string, unknown>): ResumenT {
  return { ejercicio: Number(x.Ejercicio) || 0, mes: Number(x.Mes) || 0, tipo: ent(x.TipoIntroduccion), nombre: txt(x.DescripcionTipoIntroduccion), lineas: Number(x.Numero) || 0 }
}

/** La clave de una fila (para notar que ERP10 ha vuelto a la primera página). */
export function claveDe(que: QueTraer, x: FilaT): string {
  if (que === 'subcuentas') return (x as SubcuentaT).codigo
  if (que === 'resumen') { const r = x as ResumenT; return `${r.ejercicio}-${r.mes}-${r.tipo}` }
  const a = x as ApunteT | FacturaT
  return `${a.serie}/${a.documento}/${a.fecha}`
}

const datosDe = (j: unknown): unknown[] | null => Array.isArray(j) ? j : Array.isArray((j as { Datos?: unknown })?.Datos) ? (j as { Datos: unknown[] }).Datos : null

export class FalloAlTraer extends Error {
  readonly status: number
  constructor(m: string, status: number) { super(m); this.name = 'FalloAlTraer'; this.status = status }
}

/** Una página: la pide, la pasa a la forma corta y dice si es la última. */
export async function traerUnaPagina(get: (ruta: string) => Promise<{ status: number; json: unknown; txt?: string }>, p: PedirPagina): Promise<Pagina> {
  const r = await get(rutaDe(p))
  if (r.status !== 200) {
    const m = typeof r.json === 'string' ? r.json : txt((r.json as { Message?: unknown })?.Message ?? r.txt)
    throw new FalloAlTraer(`ERP10 contesta ${r.status} al leer ${p.que === 'apuntes' ? 'los asientos' : p.que === 'facturas' ? 'las facturas' : p.que === 'resumen' ? 'su resumen' : 'las cuentas'}${m ? `: ${m.slice(0, 160)}` : ''}`, r.status)
  }
  const d = datosDe(r.json)
  if (!d) throw new FalloAlTraer('ERP10 ha contestado algo que no es una lista', 200)
  const crudas = d as Record<string, unknown>[]
  const filas: FilaT[] = p.que === 'subcuentas' ? crudas.map(subcuentaT)
    : p.que === 'apuntes' ? crudas.map(apunteT)
    : p.que === 'facturas' ? crudas.map(facturaT)
    : crudas.map(resumenT)
  const total = typeof (r.json as { ResultadosTotales?: unknown })?.ResultadosTotales === 'number' ? (r.json as { ResultadosTotales: number }).ResultadosTotales : null
  const ultima = p.que === 'resumen' || filas.length < POR_PAGINA || (total != null && (p.pagina + 1) * POR_PAGINA >= total)
  return { ...p, filas, total, ultima, primera: filas.length ? claveDe(p.que, filas[0]) : null }
}
