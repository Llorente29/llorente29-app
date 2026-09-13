// src/modules/kitchen/services/gestorDeLaCartaService.ts
//
// La frontera de las dos piezas que faltaban del gestor: mirar un plato desde
// dentro, y buscar por lo que las cosas LLEVAN.
//
// Tres RPC y NADA de lógica. Las reglas viven en `lib/desdeElPlato.ts` y
// `lib/laBusqueda.ts`, probadas sin navegador; los candados viven en la base,
// que es donde no se pueden esquivar. Aquí sólo se traducen nombres:
// `snake_case` de la base a `camelCase` del cliente.

import { supabase } from '@/lib/supabase'
import type {
  LoQuePreguntaElPlato, LoQueSeHaQuitado, PreguntaDelPlato,
} from '@/modules/kitchen/lib/desdeElPlato'
import type {
  LoEncontrado, PorQueHaSalido, UnaPreguntaEncontrada,
  UnaRespuestaEncontrada, UnPlatoEncontrado,
} from '@/modules/kitchen/lib/laBusqueda'
import type { Pregunta } from '@/modules/kitchen/lib/preguntasDeCocina'

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

type Fila = Record<string, unknown>
const n = (x: unknown, si = 0) => Number(x ?? si)
const s = (x: unknown, si = '') => (x as string | null) ?? si
const b = (x: unknown, si = false) => (x == null ? si : Boolean(x))

// ── Desde el plato ─────────────────────────────────────────────────────────

export async function getLoQuePreguntaElPlato(
  accountId: string, menuItemId: string,
): Promise<LoQuePreguntaElPlato> {
  const d = await rpc<Fila>('kitchen_preguntas_de_un_plato', {
    p_account: accountId, p_menu_item_id: menuItemId,
  })
  const p = (d.plato ?? {}) as Fila
  return {
    plato: {
      id: s(p.id),
      nombre: s(p.nombre),
      precio: n(p.precio),
      marca: s(p.marca, 'Sin marca'),
      marcaId: (p.marca_id as string | null) ?? null,
      cedida: b(p.cedida),
      activo: b(p.activo, true),
      archivado: b(p.archivado),
    },
    preguntas: ((d.preguntas as Fila[]) ?? []).map((x): PreguntaDelPlato => ({
      id: s(x.id),
      nombre: s(x.nombre),
      tipo: (x.tipo as Pregunta['tipo']) ?? 'elige',
      min: n(x.min),
      max: n(x.max, 1),
      obligatoria: b(x.obligatoria),
      repetible: b(x.repetible),
      dePago: b(x.de_pago),
      activa: b(x.activa, true),
      posicion: n(x.posicion),
      respuestas: n(x.respuestas),
      sinDecidir: n(x.sin_decidir),
      otrosPlatos: n(x.otros_platos),
      sePuedeQuitar: b(x.se_puede_quitar),
      porQueNo: (x.por_que_no as string | null) ?? null,
    })),
    cuantas: n(d.cuantas),
  }
}

export async function quitarPreguntaDelPlato(a: {
  accountId: string
  groupId: string
  menuItemId: string
  actor: string
}): Promise<LoQueSeHaQuitado> {
  const d = await rpc<Fila>('kitchen_quitar_pregunta_de_plato', {
    p_account: a.accountId, p_group_id: a.groupId,
    p_menu_item_id: a.menuItemId, p_actor: a.actor,
  })
  return {
    pregunta: s(d.pregunta),
    plato: s(d.plato),
    marca: s(d.marca, 'Sin marca'),
    leQuedan: n(d.le_quedan),
    sigueEnPlatos: n(d.sigue_en_platos),
  }
}

// ── Buscar ─────────────────────────────────────────────────────────────────

export async function buscar(
  accountId: string, texto: string, tope = 12,
): Promise<LoEncontrado> {
  const d = await rpc<Fila>('kitchen_buscar', {
    p_account: accountId, p_texto: texto, p_tope: tope,
  })
  const c = (d.cuantas ?? {}) as Fila
  const porque = (x: unknown, si: PorQueHaSalido): PorQueHaSalido =>
    (x as PorQueHaSalido | null) ?? si

  return {
    texto: s(d.texto),
    corto: b(d.corto),
    tope: n(d.tope, tope),
    cuantas: {
      fichas: n(c.fichas),
      preguntas: n(c.preguntas),
      respuestas: n(c.respuestas),
      respuestasDistintas: n(c.respuestas_distintas),
      platos: n(c.platos),
    },
    fichas: ((d.fichas as Fila[]) ?? []).map((x) => ({
      id: s(x.id), nombre: s(x.nombre),
    })),
    preguntas: ((d.preguntas as Fila[]) ?? []).map((x): UnaPreguntaEncontrada => ({
      id: s(x.id),
      nombre: s(x.nombre),
      marca: s(x.marca, 'Sin marca'),
      cedida: b(x.cedida),
      activa: b(x.activa, true),
      respuestas: n(x.respuestas),
      porque: porque(x.porque, 'se_llama_asi'),
      cuantasRespuestasSalen: n(x.cuantas_respuestas_salen),
    })),
    respuestas: ((d.respuestas as Fila[]) ?? []).map((x): UnaRespuestaEncontrada => ({
      id: s(x.id),
      nombre: s(x.nombre),
      copias: n(x.copias),
      preguntas: n(x.preguntas),
      marcas: n(x.marcas),
      marca: s(x.marca, 'Sin marca'),
      algunaActiva: b(x.alguna_activa, true),
      todasActivas: b(x.todas_activas, true),
      ficha: (x.ficha as string | null) ?? null,
      porque: porque(x.porque, 'se_llama_asi'),
    })),
    platos: ((d.platos as Fila[]) ?? []).map((x): UnPlatoEncontrado => ({
      id: s(x.id),
      nombre: s(x.nombre),
      marca: s(x.marca, 'Sin marca'),
      cedida: b(x.cedida),
      porque: porque(x.porque, 'se_llama_asi'),
      cuantasPreguntasSalen: n(x.cuantas_preguntas_salen),
    })),
  }
}
