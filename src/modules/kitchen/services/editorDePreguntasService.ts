// src/modules/kitchen/services/editorDePreguntasService.ts
//
// La frontera de los tableros 5 (crear/editar una pregunta) y 3 (ponerla en
// platos). Cinco RPC y nada de lógica: las reglas viven en
// `lib/crearPreguntaDeCocina.ts`, probadas sin navegador, y los candados viven
// en la base, que es donde no se pueden esquivar.
//
// NO SE CALCULA NADA AQUÍ. Este fichero traduce nombres —`impact_type` a
// «qué lleva», `min_selections` a «obligatoria»— y ya. La tentación de meter
// «una reglita» en el servicio es cómo acaban dos pantallas contando distinto.

import { supabase } from '@/lib/supabase'
import type {
  QueLleva, TipoNuevaPregunta, UnaIgual, UnaQueQuedaFuera,
} from '@/modules/kitchen/lib/crearPreguntaDeCocina'

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

// ── Lo que llega de la base ────────────────────────────────────────────────

export interface MarcaElegible {
  id: string
  nombre: string
  cedida: boolean
  platos: number
}

export interface FichaDelEscandallo {
  id: string
  nombre: string
  unidad: string | null
}

export interface PlatoDeLaMarca {
  id: string
  nombre: string
  categoriaId: string | null
  categoria: string
  yaLaTiene: boolean
  cuantasPreguntas: number
}

export interface CategoriaDeLaMarca {
  id: string
  nombre: string
  cuantosPlatos: number
}

/** Una respuesta tal y como está guardada hoy. */
export interface RespuestaGuardada {
  id: string
  nombre: string
  precio: number
  queLleva: QueLleva | null
  fichaId: string | null
  fichaNombre: string | null
  cantidad: number | null
  unidad: string | null
  enCuantasPreguntas: number
}

export interface PreguntaGuardada {
  id: string
  nombre: string
  marcaId: string
  marcaNombre: string
  cedida: boolean
  tipo: TipoNuevaPregunta
  obligatoria: boolean
  max: number
  repetible: boolean
  etiquetaVieja: boolean
  platos: string[]
  respuestas: RespuestaGuardada[]
}

// ── Las traducciones, en un solo sitio ─────────────────────────────────────
// La pantalla no ve NUNCA estas palabras: por eso están aquí y no allí.

const DE_LA_BASE_A_QUE_LLEVA: Record<string, QueLleva> = {
  add_item: 'lleva', remove_item: 'quita', replace_item: 'cambia',
  multiply: 'multiplica', bundle: 'es_un_plato', none: 'no_lleva_nada',
}
const DE_LA_BASE_AL_TIPO: Record<string, TipoNuevaPregunta> = {
  choice: 'elige', extras: 'anade', side: 'anade',
  removal: 'quita', cross_sell: 'sugiere', info: 'elige',
}

// ── Lecturas ───────────────────────────────────────────────────────────────

export async function getParaEditar(
  accountId: string, groupId: string | null,
): Promise<{ marcas: MarcaElegible[]; pregunta: PreguntaGuardada | null }> {
  const d = await rpc<{ marcas: unknown[]; pregunta: unknown }>(
    'kitchen_pregunta_para_editar', { p_account: accountId, p_group_id: groupId })

  const marcas = (d.marcas as Array<Record<string, unknown>>).map((m) => ({
    id: m.id as string,
    nombre: (m.nombre as string) ?? '',
    cedida: m.cedida === true,
    platos: Number(m.platos ?? 0),
  }))

  const p = d.pregunta as Record<string, unknown> | null
  if (!p) return { marcas, pregunta: null }

  const respuestas = ((p.respuestas as Array<Record<string, unknown>>) ?? []).map((r) => {
    const ef = r.efecto as Record<string, unknown> | null
    return {
      id: r.id as string,
      nombre: (r.nombre as string) ?? '',
      precio: Number(r.precio ?? 0),
      // `null` = nadie lo ha decidido. Un tipo desconocido también cuenta como
      // no decidido: preferimos volver a preguntar antes que pintar una palabra
      // que no sabemos traducir.
      queLleva: ef ? (DE_LA_BASE_A_QUE_LLEVA[String(ef.tipo)] ?? null) : null,
      fichaId: (ef?.ficha as string | null) ?? null,
      fichaNombre: (ef?.ficha_nombre as string | null) ?? null,
      cantidad: ef?.cantidad == null ? null : Number(ef.cantidad),
      unidad: (ef?.unidad as string | null) ?? null,
      enCuantasPreguntas: Number(r.en_cuantas_preguntas ?? 1),
    }
  })

  return {
    marcas,
    pregunta: {
      id: p.id as string,
      nombre: (p.nombre as string) ?? '',
      marcaId: p.marca_id as string,
      marcaNombre: (p.marca_nombre as string) ?? '',
      cedida: p.cedida === true,
      tipo: DE_LA_BASE_AL_TIPO[String(p.tipo)] ?? 'elige',
      obligatoria: p.obligatoria === true,
      max: Number(p.max ?? 1),
      repetible: p.repetible === true,
      etiquetaVieja: p.etiqueta_vieja === true,
      platos: ((p.platos as string[]) ?? []),
      respuestas,
    },
  }
}

export async function getPlatosDeLaMarca(
  accountId: string, brandId: string, groupId: string | null,
): Promise<{ platos: PlatoDeLaMarca[]; categorias: CategoriaDeLaMarca[] }> {
  const d = await rpc<{ platos: unknown[]; categorias: unknown[] }>(
    'kitchen_platos_de_la_marca',
    { p_account: accountId, p_brand_id: brandId, p_group_id: groupId })
  return {
    platos: (d.platos as Array<Record<string, unknown>>).map((x) => ({
      id: x.id as string,
      nombre: (x.nombre as string) ?? '',
      categoriaId: (x.categoria_id as string | null) ?? null,
      categoria: (x.categoria as string) ?? 'Sin categoría',
      yaLaTiene: x.ya_la_tiene === true,
      cuantasPreguntas: Number(x.cuantas_preguntas ?? 0),
    })),
    categorias: (d.categorias as Array<Record<string, unknown>>).map((c) => ({
      id: c.id as string,
      nombre: (c.nombre as string) ?? '',
      cuantosPlatos: Number(c.cuantos_platos ?? 0),
    })),
  }
}

export async function buscarFicha(
  accountId: string, texto: string,
): Promise<FichaDelEscandallo[]> {
  const d = await rpc<Array<Record<string, unknown>>>(
    'kitchen_buscar_ficha', { p_account: accountId, p_texto: texto })
  return d.map((f) => ({
    id: f.id as string,
    nombre: (f.nombre as string) ?? '',
    unidad: (f.unidad as string | null) ?? null,
  }))
}

// ── Escrituras ─────────────────────────────────────────────────────────────

export interface RespuestaAGuardar {
  /** null = nueva. La base exige efecto en las nuevas y no en las viejas. */
  id: string | null
  nombre: string
  precio: number
  /** null = no se toca lo que hubiera. Prohibido en las nuevas. */
  efecto: { tipo: string; ficha: string | null; cantidad: number | null; unidad: string | null } | null
}

export interface ResultadoDeGuardar {
  preguntaId: string
  nombre: string
  creada: boolean
  respuestasCreadas: number
  respuestasActualizadas: number
  respuestasRetiradas: number
  efectosEscritos: number
  etiquetaViejaLimpiada: boolean
}

export async function guardarPregunta(a: {
  accountId: string
  groupId: string | null
  brandId: string
  nombre: string
  tipoEnLaBase: string
  obligatoria: boolean
  max: number
  repetible: boolean
  respuestas: RespuestaAGuardar[]
  actor: string
}): Promise<ResultadoDeGuardar> {
  const d = await rpc<Record<string, unknown>>('kitchen_guardar_pregunta', {
    p_account: a.accountId,
    p_group_id: a.groupId,
    p_brand_id: a.brandId,
    p_nombre: a.nombre,
    p_tipo: a.tipoEnLaBase,
    p_obligatoria: a.obligatoria,
    p_max: a.max,
    p_repetible: a.repetible,
    p_respuestas: a.respuestas.map((r) => ({
      id: r.id, nombre: r.nombre, precio: r.precio,
      efecto: r.efecto === null ? null : {
        tipo: r.efecto.tipo,
        ficha: r.efecto.ficha,
        cantidad: r.efecto.cantidad == null ? null : String(r.efecto.cantidad),
        unidad: r.efecto.unidad,
      },
    })),
    p_actor: a.actor,
  })
  return {
    preguntaId: d.pregunta_id as string,
    nombre: (d.nombre as string) ?? '',
    creada: d.creada === true,
    respuestasCreadas: Number(d.respuestas_creadas ?? 0),
    respuestasActualizadas: Number(d.respuestas_actualizadas ?? 0),
    respuestasRetiradas: Number(d.respuestas_retiradas ?? 0),
    efectosEscritos: Number(d.efectos_escritos ?? 0),
    etiquetaViejaLimpiada: d.etiqueta_vieja_limpiada === true,
  }
}

export interface ResultadoDePlatos {
  pregunta: string
  marca: string
  puestos: number
  quitados: number
  total: number
}

export async function ponerEnPlatos(a: {
  accountId: string
  groupId: string
  platos: string[]
  actor: string
}): Promise<ResultadoDePlatos> {
  const d = await rpc<Record<string, unknown>>('kitchen_poner_pregunta_en_platos', {
    p_account: a.accountId, p_group_id: a.groupId,
    p_platos: a.platos, p_actor: a.actor,
  })
  return {
    pregunta: (d.pregunta as string) ?? '',
    marca: (d.marca as string) ?? '',
    puestos: Number(d.puestos ?? 0),
    quitados: Number(d.quitados ?? 0),
    total: Number(d.total ?? 0),
  }
}

// ── Decidir una vez para todas las iguales ─────────────────────────────────

export async function getLasIguales(
  accountId: string, optionId: string,
): Promise<{ iguales: UnaIgual[]; fuera: UnaQueQuedaFuera[] }> {
  const d = await rpc<{ iguales: unknown[]; fuera: unknown[] }>(
    'kitchen_las_iguales', { p_account: accountId, p_option_id: optionId })
  return {
    iguales: (d.iguales as Array<Record<string, unknown>>).map((x) => ({
      id: x.id as string,
      nombre: (x.nombre as string) ?? '',
      pregunta: (x.pregunta as string) ?? '',
      marca: (x.marca as string) ?? 'Sin marca',
    })),
    fuera: (d.fuera as Array<Record<string, unknown>>).map((x) => ({
      id: x.id as string,
      pregunta: (x.pregunta as string) ?? '',
      marca: (x.marca as string) ?? 'Sin marca',
      motivo: (x.motivo as UnaQueQuedaFuera['motivo']) ?? 'apagada',
    })),
  }
}

export async function aplicarALasIguales(a: {
  accountId: string
  opciones: string[]
  efecto: { tipo: string; ficha: string | null; cantidad: number | null; unidad: string | null }
  actor: string
}): Promise<{ resueltas: number; donde: string[] }> {
  const d = await rpc<Record<string, unknown>>('kitchen_aplicar_a_las_iguales', {
    p_account: a.accountId,
    p_opciones: a.opciones,
    p_efecto: {
      tipo: a.efecto.tipo,
      ficha: a.efecto.ficha,
      cantidad: a.efecto.cantidad == null ? null : String(a.efecto.cantidad),
      unidad: a.efecto.unidad,
    },
    p_actor: a.actor,
  })
  return {
    resueltas: Number(d.resueltas ?? 0),
    donde: ((d.donde as string[]) ?? []),
  }
}
