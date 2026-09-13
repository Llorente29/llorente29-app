// src/modules/kitchen/services/limpiarLaCartaService.ts
//
// La frontera de la mitad que limpia: los dos montones, la ficha de una
// respuesta y retirar. Tres RPC y NADA de lógica — las reglas viven en
// `lib/loQueSobraYLoQueFalta.ts`, probadas sin navegador, y los candados viven
// en la base, que es donde no se pueden esquivar.
//
// Aquí solo se traducen nombres: `snake_case` de la base a `camelCase` del
// cliente. La tentación de meter «una reglita» en el servicio es cómo acaban
// dos pantallas contando distinto.

import { supabase } from '@/lib/supabase'
import type {
  LosDosMontones, UnNombreSinDecidir, UnaQueNadiePide, DondeVive,
} from '@/modules/kitchen/lib/loQueSobraYLoQueFalta'

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const call = (supabase.rpc as unknown as (
    f: string, a: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>).bind(supabase)
  return call(fn, args).then(({ data, error }) => {
    if (error) throw new Error(error.message)
    return data as T
  })
}

const n = (x: unknown, si = 0) => Number(x ?? si)
const s = (x: unknown, si = '') => (x as string | null) ?? si

export async function getLosDosMontones(
  accountId: string, dias = 30,
): Promise<LosDosMontones> {
  const d = await rpc<Record<string, unknown>>(
    'kitchen_para_trabajar', { p_account: accountId, p_dias: dias })

  const falta = d.le_falta_decir_que_lleva as Record<string, unknown>
  const sobra = d.no_lo_pide_nadie as Record<string, unknown>

  return {
    dias: n(d.dias, 30),
    falta: {
      respuestas: n(falta.respuestas),
      alcanzables: n(falta.alcanzables),
      nombres: n(falta.nombres),
      filas: ((falta.filas as Array<Record<string, unknown>>) ?? []).map((f): UnNombreSinDecidir => ({
        nombre: s(f.nombre),
        cuantas: n(f.cuantas),
        alcanzables: n(f.alcanzables),
        marcas: ((f.marcas as string[]) ?? []),
        entrarPor: s(f.entrar_por),
      })),
    },
    sobra: {
      respuestas: n(sobra.respuestas),
      candidatas: n(sobra.candidatas),
      alcanzables: n(sobra.alcanzables),
      decididasHacePoco: n(sobra.decididas_hace_poco),
      cedidas: n(sobra.cedidas),
      preguntas: n(sobra.preguntas),
      conPedidoAnulado: n(sobra.con_pedido_anulado),
      filas: ((sobra.filas as Array<Record<string, unknown>>) ?? []).map((f): UnaQueNadiePide => ({
        id: s(f.id),
        nombre: s(f.nombre),
        pregunta: s(f.pregunta),
        preguntaId: s(f.pregunta_id),
        marca: s(f.marca, 'Sin marca'),
        cedida: f.cedida === true,
        precio: n(f.precio),
        pedidosAnulados: n(f.pedidos_anulados),
        ultimaVenta: (f.ultima_venta as string | null) ?? null,
        diasSinVenderse: f.dias_sin_venderse == null ? null : n(f.dias_sin_venderse),
        decidida: f.decidida === true,
        decididaAt: (f.decidida_at as string | null) ?? null,
        decididaReciente: f.decidida_reciente === true,
      })),
    },
  }
}

export interface FichaDeRespuesta {
  id: string
  nombre: string
  precio: number
  activa: boolean
  retiradaAt: string | null
  retiradaPor: string | null
  cedida: boolean
  marca: string
  pregunta: string
  preguntaId: string
  efecto: {
    tipo: string
    ficha: string | null
    fichaNombre: string | null
    cantidad: number | null
    unidad: string | null
    quien: string | null
    cuando: string | null
    descuentaAlgo: boolean
  } | null
  dondeEsta: DondeVive[]
  ventas: {
    dias: number
    ventas: number
    anuladas: number
    ultimas: Array<{ cuando: string; total: number; anulada: boolean; canal: string }>
  }
  ultimaVenta: string | null
}

export async function getFichaDeRespuesta(
  accountId: string, optionId: string, dias = 30,
): Promise<FichaDeRespuesta | null> {
  const d = await rpc<Record<string, unknown> | null>(
    'kitchen_ficha_de_respuesta',
    { p_account: accountId, p_option_id: optionId, p_dias: dias })
  if (!d) return null

  const ef = d.efecto as Record<string, unknown> | null
  const v = (d.ventas as Record<string, unknown>) ?? {}

  return {
    id: s(d.id),
    nombre: s(d.nombre),
    precio: n(d.precio),
    activa: d.activa === true,
    retiradaAt: (d.retirada_at as string | null) ?? null,
    retiradaPor: (d.retirada_por as string | null) ?? null,
    cedida: d.cedida === true,
    marca: s(d.marca, 'Sin marca'),
    pregunta: s(d.pregunta),
    preguntaId: s(d.pregunta_id),
    efecto: ef ? {
      tipo: s(ef.tipo),
      ficha: (ef.ficha as string | null) ?? null,
      fichaNombre: (ef.ficha_nombre as string | null) ?? null,
      cantidad: ef.cantidad == null ? null : n(ef.cantidad),
      unidad: (ef.unidad as string | null) ?? null,
      quien: (ef.quien as string | null) ?? null,
      cuando: (ef.cuando as string | null) ?? null,
      descuentaAlgo: ef.descuenta_algo === true,
    } : null,
    dondeEsta: ((d.donde_esta as Array<Record<string, unknown>>) ?? []).map((x): DondeVive => ({
      id: s(x.id),
      pregunta: s(x.pregunta),
      preguntaId: s(x.pregunta_id),
      marca: s(x.marca, 'Sin marca'),
      cedida: x.cedida === true,
      activa: x.activa === true,
      esEsta: x.es_esta === true,
      platos: n(x.platos),
      decidida: x.decidida === true,
    })),
    ventas: {
      dias: n(v.dias, dias),
      ventas: n(v.ventas),
      anuladas: n(v.anuladas),
      ultimas: ((v.ultimas as Array<Record<string, unknown>>) ?? []).map((u) => ({
        cuando: s(u.cuando),
        total: n(u.total),
        anulada: u.anulada === true,
        canal: s(u.canal),
      })),
    },
    ultimaVenta: (d.ultima_venta as string | null) ?? null,
  }
}

export interface ResultadoDeRetirar {
  encendido: boolean
  respuestas: number
  preguntas: number
  pregunta: string | null
  actor: string | null
}

export async function retirar(a: {
  accountId: string
  opciones?: string[]
  preguntaId?: string
  actor: string
  encender?: boolean
}): Promise<ResultadoDeRetirar> {
  const d = await rpc<Record<string, unknown>>('kitchen_retirar', {
    p_account: a.accountId,
    p_opciones: a.opciones ?? null,
    p_pregunta: a.preguntaId ?? null,
    p_actor: a.actor,
    p_encender: a.encender === true,
  })
  return {
    encendido: d.encendido === true,
    respuestas: n(d.respuestas),
    preguntas: n(d.preguntas),
    pregunta: (d.pregunta as string | null) ?? null,
    actor: (d.actor as string | null) ?? null,
  }
}
