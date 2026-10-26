// src/modules/conta/services/cobrosService.ts
//
// PC01 · Entrega 3 · Ventas › Cobros: lo que se lee y se escribe, todo por las
// funciones conta_* de la 2142 (dueño único, N8). Cada escritura devuelve la
// frase de lo que ha pasado (regla 8), escrita en la base.

import { rpc } from '@/modules/conta/services/bd'
import {
  filaCobro, type EstadoRemesaCobros, type FilaCobro, type RemesaCobrosParaCasar, type ReciboDevolvible,
} from '@/modules/conta/lib/cobros'
import type { DatosRemesaRecibos } from '@/modules/conta/lib/sepa'

type Fila = Record<string, unknown>
const num = (x: unknown) => (x === null || x === undefined || x === '' ? 0 : Number(x))
const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
const cent = (x: unknown) => Math.round(num(x) * 100)

export interface SinMandato { id: string; nombre: string; facturas: number; pendiente: number; correo: string | null; enviado: { at: string | null; a: string | null; ref: string } | null }
export interface DatosCobros { filas: FilaCobro[]; cobradoMes: number; cobradasMes: number; remesas: number; sinMandato: SinMandato[] }

export async function leerCobros(companyId: string, mes: string): Promise<DatosCobros> {
  const d = await rpc<Fila>('conta_cobros_lista', { p_company: companyId, p_mes: mes })
  return {
    filas: ((d?.filas as Fila[] | null) ?? []).map(filaCobro),
    cobradoMes: num(d?.cobrado_mes), cobradasMes: num(d?.cobradas_mes), remesas: num(d?.remesas),
    sinMandato: ((d?.sin_mandato as Fila[] | null) ?? []).map((s) => {
      const e = s.enviado as Fila | null
      return { id: String(s.id), nombre: String(s.nombre), facturas: num(s.facturas), pendiente: num(s.pendiente), correo: str(s.correo),
        enviado: e ? { at: str(e.at), a: str(e.a), ref: String(e.ref) } : null }
    }),
  }
}

interface Frase { frase: string }

export const crearRemesaCobros = (companyId: string, bancoId: string, fecha: string, facturas: readonly { id: string; importe?: number }[]) =>
  rpc<Frase & { remesa: string; codigo: string; recibos: number; primeros: number }>('conta_remesa_cobros_crear', { p_company: companyId, p_treasury: bancoId, p_fecha: fecha, p_facturas: facturas })
export const sacarRecibo = (lineaId: string) => rpc<Frase>('conta_remesa_cobros_linea_sacar', { p_linea: lineaId })
export const ficheroRecibosDescargado = (remesaId: string, sha256: string, recibos: number) =>
  rpc<Frase>('conta_remesa_cobros_descargada', { p_remesa: remesaId, p_sha256: sha256, p_recibos: recibos })
export const casarAbono = (movimientoId: string, remesaId: string, lineas: string[] | null) =>
  rpc<Frase & { casado: string; recibos: number; cobradas: number }>('conta_remesa_cobros_casar', { p_movement: movimientoId, p_remesa: remesaId, p_lineas: lineas })
export const reciboDevuelto = (lineaId: string, movimientoId: string, motivo: string) =>
  rpc<Frase & { casado: string; gastos: number }>('conta_recibo_devuelto', { p_linea: lineaId, p_movement: movimientoId, p_motivo: motivo })
export const prepararMandato = (companyId: string, clienteId: string, correo: string | null) =>
  rpc<Frase & { mandato: string; ref: string; token: string; enlace: string; correo: string | null; caduca: string }>('conta_mandato_preparar', { p_company: companyId, p_party: clienteId, p_correo: correo })

/** Los datos del fichero de recibos (lib/sepa.ts, ficheroRecibos). */
export async function datosFicheroRecibos(remesaId: string): Promise<DatosRemesaRecibos> {
  const d = await rpc<Fila>('conta_remesa_cobros_fichero_datos', { p_remesa: remesaId })
  const a = (d?.acreedor ?? {}) as Fila
  return {
    codigo: String(d?.codigo), fechaCargo: String(d?.fecha_cargo), creado: String(d?.creada),
    acreedor: { nombre: String(a.nombre ?? ''), nif: String(a.nif ?? ''), iban: String(a.iban ?? ''), bic: str(a.bic), sufijo: str(a.sufijo) },
    recibos: ((d?.recibos as Fila[] | null) ?? []).map((r) => ({
      id: String(r.id), importe: num(r.importe), iban: String(r.iban), bic: str(r.bic), nombre: String(r.nombre ?? ''),
      mandato: String(r.mandato), firmado: String(r.firmado), primero: r.primero === true, factura: str(r.factura), fechaFactura: str(r.fecha_factura),
    })),
  }
}

export interface ReciboRemesa {
  id: string
  facturaId: string
  numero: string | null
  fecha: string | null
  importe: number
  estado: 'pendiente' | 'cobrado' | 'devuelto' | 'sacada'
  cliente: string
  clienteId: string | null
  cuenta: string | null
  iban4: string | null
  ibanPais: string | null
  mandato: string
  firmado: string
  primero: boolean
  abonado: string | null
  devuelto: string | null
  motivo: string | null
  gastos: number | null
  pendiente: number
  mandatoFicha: { ref: string; firmado: string | null; firmante: string | null; token: string } | null
  ultimoCobro: { fecha: string | null; estado: string } | null
}
export interface RemesaCobros {
  id: string
  codigo: string
  cargo: string
  estado: EstadoRemesaCobros
  total: number
  cobrado: number
  porAbonar: number
  vivos: number
  cobrados: number
  devueltos: number
  abonadaEl: string | null
  plazoHasta: string | null
  ficheroAt: string | null
  ficheroPor: string | null
  creada: string
  creadaPor: string | null
  empresa: string | null
  acreedor: string | null
  banco: { id: string; nombre: string; iban4: string | null; cuenta: string | null }
  cuentaGastos: string | null
  recibos: ReciboRemesa[]
  historial: { at: string; por: string | null; texto: string }[]
}

export async function leerRemesaCobros(remesaId: string): Promise<RemesaCobros> {
  const r = await rpc<Fila>('conta_remesa_cobros_ficha', { p_remesa: remesaId })
  const b = (r?.banco ?? {}) as Fila
  return {
    id: String(r?.id), codigo: String(r?.codigo), cargo: String(r?.cargo), estado: String(r?.estado) as EstadoRemesaCobros,
    total: num(r?.total), cobrado: num(r?.cobrado), porAbonar: num(r?.por_abonar), vivos: num(r?.recibos_vivos), cobrados: num(r?.cobrados),
    devueltos: num(r?.devueltos), abonadaEl: str(r?.abonada_el), plazoHasta: str(r?.plazo_hasta), ficheroAt: str(r?.fichero_at), ficheroPor: str(r?.fichero_por),
    creada: String(r?.creada), creadaPor: str(r?.creada_por), empresa: str(r?.empresa), acreedor: str(r?.acreedor),
    banco: { id: String(b.id ?? ''), nombre: String(b.nombre ?? ''), iban4: str(b.iban4), cuenta: str(b.cuenta) },
    cuentaGastos: str(r?.cuenta_gastos),
    recibos: ((r?.recibos as Fila[] | null) ?? []).map((l) => {
      const m = l.mandato_ficha as Fila | null
      const u = l.ultimo_cobro as Fila | null
      return {
        id: String(l.id), facturaId: String(l.factura_id), numero: str(l.numero), fecha: str(l.fecha), importe: num(l.importe),
        estado: String(l.estado) as ReciboRemesa['estado'], cliente: String(l.cliente ?? 'Sin cliente'), clienteId: str(l.cliente_id), cuenta: str(l.cuenta),
        iban4: str(l.iban4), ibanPais: str(l.iban_pais), mandato: String(l.mandato), firmado: String(l.firmado), primero: l.primero === true,
        abonado: str(l.abonado), devuelto: str(l.devuelto), motivo: str(l.motivo), gastos: l.gastos === null || l.gastos === undefined ? null : num(l.gastos),
        pendiente: num(l.pendiente),
        mandatoFicha: m ? { ref: String(m.ref), firmado: str(m.firmado), firmante: str(m.firmante), token: String(m.token) } : null,
        ultimoCobro: u ? { fecha: str(u.fecha), estado: String(u.estado) } : null,
      }
    }),
    historial: ((r?.historial as Fila[] | null) ?? []).map((h) => ({ at: String(h.at), por: str(h.por), texto: String(h.texto) })),
  }
}

export interface RemesaCobrosResumen { id: string; codigo: string; cargo: string; estado: EstadoRemesaCobros; total: number; cobrado: number; recibos: number; cobrados: number; devueltos: number; plazoHasta: string | null; banco: string | null }
export async function leerRemesasCobros(companyId: string): Promise<RemesaCobrosResumen[]> {
  const d = await rpc<Fila[]>('conta_remesas_cobros_lista', { p_company: companyId })
  return (d ?? []).map((r) => ({
    id: String(r.id), codigo: String(r.codigo), cargo: String(r.cargo), estado: String(r.estado) as EstadoRemesaCobros, total: num(r.total), cobrado: num(r.cobrado),
    recibos: num(r.recibos), cobrados: num(r.cobrados), devueltos: num(r.devueltos), plazoHasta: str(r.plazo_hasta), banco: str(r.banco),
  }))
}

/** Lo que Bancos ofrece: las remesas que esperan su abono y los recibos que aún pueden volver devueltos. */
export async function cobrosParaCasar(companyId: string): Promise<{ abonos: RemesaCobrosParaCasar[]; devoluciones: ReciboDevolvible[] }> {
  const d = await rpc<Fila>('conta_cobros_para_casar', { p_company: companyId })
  return {
    abonos: ((d?.abonos as Fila[] | null) ?? []).map((r) => ({
      id: String(r.id), codigo: String(r.codigo), cargo: String(r.cargo), porAbonarCent: cent(r.por_abonar),
      recibos: ((r.recibos as Fila[] | null) ?? []).map((x) => ({ id: String(x.id), importeCent: cent(x.importe), cliente: String(x.cliente ?? ''), factura: str(x.factura) })),
    })),
    devoluciones: ((d?.devoluciones as Fila[] | null) ?? []).map((x) => ({
      id: String(x.id), remesa: String(x.remesa), importeCent: cent(x.importe), cliente: String(x.cliente ?? ''), factura: str(x.factura), abonado: str(x.abonado),
    })),
  }
}
