// src/shell/home/homeCatalog.ts
//
// EL CATÁLOGO DE TARJETAS DEL INICIO — 31/08/2026, sub-lote 2.
//
// EL CÓDIGO ES LA VERDAD (decisión de Julio, RECON del 30/08).
// Este fichero junta las tarjetas declaradas en código —las del propio shell y
// las que cada módulo aporta en `ModuleDefinition.homeCards`— y las cruza con
// lo que dice la base de datos, que es SOLO espejo e interruptor.
//
// LAS TRES REGLAS DEL CRUCE, y por qué cada una:
//
//   1. Una fila del espejo SIN componente en código NO SE PINTA. La BBDD no
//      puede inventar una tarjeta que nadie sabe renderizar. Es la deriva que
//      ha costado la semana entera (las tres funciones del 28/08, el vigía sin
//      desplegar): dos sitios que dicen cosas distintas y uno de los dos manda.
//
//   2. Pero NO SE DESCARTA EN SILENCIO. `resolverMosaico` devuelve las
//      huérfanas aparte, para que la pantalla pueda decir «esta tarjeta ya no
//      existe» en vez de que desaparezca sin explicación (regla 7: un umbral
//      ordena, no esconde; y aquí ni siquiera hay umbral, hay un dato ausente).
//
//   3. Una tarjeta en código que la cuenta ha APAGADO no se pinta y tampoco se
//      ofrece en el cajón. Eso sí es una decisión tomada a propósito, y el
//      interruptor está para respetarse.
//
// Funciones puras a propósito: sin React y sin red. La red vive en
// homeLayoutService; aquí solo se decide qué se ve, que es lo que hay que
// poder probar sin levantar la pantalla.

import { moduleRegistry } from '../moduleRegistry'
import { GRUPOS_DE_INICIO, type HomeCardDefinition, type ShellRole } from '../types'
import { SHELL_HOME_CARDS } from './cards/shellCards'

/** Una tarjeta del catálogo, con el módulo del que viene. */
export interface CatalogEntry extends HomeCardDefinition {
  /** Id del módulo, o 'shell' para las transversales del propio Inicio. */
  moduleId: string
  /** Nombre para agrupar en el cajón: «Folvy Sales», «Inicio»… */
  moduleName: string
}

/** Fila del espejo en BBDD. Solo las columnas que deciden algo. */
export interface CatalogMirrorRow {
  card_key: string
  active: boolean
}

/** Interruptor por cuenta. Fila ausente = vale lo que diga el espejo. */
export interface AccountSwitchRow {
  card_key: string
  active: boolean
}

/**
 * TODAS las tarjetas que el código sabe renderizar, vengan del shell o de un
 * módulo. Este es el catálogo de verdad; lo de la tabla es su reflejo.
 */
export function getHomeCatalog(): CatalogEntry[] {
  const shell: CatalogEntry[] = SHELL_HOME_CARDS.map(c => ({
    ...c, moduleId: 'shell', moduleName: 'Inicio',
  }))
  const deModulos: CatalogEntry[] = moduleRegistry.flatMap(m =>
    (m.homeCards ?? []).map(c => ({ ...c, moduleId: m.id, moduleName: m.name })),
  )
  return [...shell, ...deModulos]
}

/** ¿Puede este rol ver esta tarjeta? P1: el Inicio entero es solo de `admin`. */
export function rolPuedeVer(card: HomeCardDefinition, rol: ShellRole | null): boolean {
  if (!card.requiredRole) return true
  if (rol === 'admin') return true          // admin lo ve todo
  return rol === card.requiredRole
}

/**
 * Qué tarjetas están DISPONIBLES para esta cuenta y este rol: las que el código
 * sabe renderizar, menos las apagadas.
 *
 * `home_card_account` manda sobre `home_card_catalog`; y una tarjeta que no
 * está en el espejo todavía (recién añadida al código, antes de que el deploy
 * lo siembre) se considera ENCENDIDA. Si no, añadir una tarjeta al código no
 * la haría aparecer hasta el siguiente arranque, y la verificación 5 del
 * encargo —«añadir una homeCard la hace aparecer en el cajón»— sería mentira.
 */
export function catalogoDisponible(
  catalogo: CatalogEntry[],
  espejo: CatalogMirrorRow[],
  porCuenta: AccountSwitchRow[],
  rol: ShellRole | null,
): CatalogEntry[] {
  const espejoPorKey = new Map(espejo.map(r => [r.card_key, r.active]))
  const cuentaPorKey = new Map(porCuenta.map(r => [r.card_key, r.active]))
  return catalogo.filter(c => {
    if (!rolPuedeVer(c, rol)) return false
    const deCuenta = cuentaPorKey.get(c.key)
    if (deCuenta !== undefined) return deCuenta
    return espejoPorKey.get(c.key) ?? true
  })
}

export interface MosaicoResuelto {
  /** Lo que se pinta, EN ORDEN. */
  tarjetas: CatalogEntry[]
  /**
   * Claves guardadas en el layout del usuario que ya no existen en el código.
   * No se pintan (regla 1) y no se callan (regla 2): la pantalla las dice y
   * ofrece limpiarlas.
   */
  huerfanas: string[]
}

/**
 * El mosaico: las claves guardadas, en su orden, convertidas en tarjetas.
 *
 * El ORDEN de la lista es el orden en pantalla — por eso `cards` es una lista
 * y no un objeto: un objeto no tiene orden garantizado y acabaría necesitando
 * una columna `position` que se puede desincronizar de sí misma.
 *
 * Una clave repetida se pinta una vez: dos tarjetas idénticas no son dos datos.
 */
export function resolverMosaico(
  claves: string[],
  disponibles: CatalogEntry[],
): MosaicoResuelto {
  const porKey = new Map(disponibles.map(c => [c.key, c]))
  const tarjetas: CatalogEntry[] = []
  const huerfanas: string[] = []
  const vistas = new Set<string>()
  for (const k of claves) {
    if (vistas.has(k)) continue
    vistas.add(k)
    const c = porKey.get(k)
    if (c) tarjetas.push(c)
    else huerfanas.push(k)
  }
  return { tarjetas, huerfanas }
}

/**
 * El catálogo agrupado por GRUPO DE NEGOCIO, para el cajón «Personalizar».
 *
 * (02/09) Sustituye a la agrupación por módulo. Los seis grupos aprobados
 * —Ventas, Team, Cocina, Almacén, Canales, Agentes— son el idioma con el que
 * se habla del negocio; «Folvy Kitchen» es el nombre con el que hablamos
 * nosotros del código. El cajón lo abre alguien que quiere ver sus ventas, no
 * alguien que quiere ver el módulo de ventas.
 *
 * Los grupos salen SIEMPRE en el orden aprobado, y los vacíos no se pintan. Al
 * final, «Otras»: si ahí aparece algo es que a alguien se le olvidó declarar el
 * grupo, y se ve a la primera en vez de quedar escondido bajo un módulo.
 */
export interface GrupoDelCajon {
  grupo: string
  tarjetas: CatalogEntry[]
}

export function agrupadoPorGrupo(disponibles: CatalogEntry[]): GrupoDelCajon[] {
  const porGrupo = new Map<string, CatalogEntry[]>()
  for (const c of disponibles) {
    const g = c.grupo ?? 'Otras'
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), c])
  }
  const salida: GrupoDelCajon[] = []
  for (const g of GRUPOS_DE_INICIO) {
    const t = porGrupo.get(g)
    if (t && t.length > 0) salida.push({ grupo: g, tarjetas: t })
  }
  const otras = porGrupo.get('Otras')
  if (otras && otras.length > 0) salida.push({ grupo: 'Otras', tarjetas: otras })
  return salida
}

/**
 * Las tarjetas que EXISTEN y que este usuario NO tiene en su Inicio.
 *
 * ── POR QUÉ ESTO TIENE QUE EXISTIR ─────────────────────────────────────────
 * Un layout personalizado es del usuario y no se toca. Pero eso tiene una
 * consecuencia que nadie ve venir: una tarjeta nueva NO entra en un layout
 * existente, así que quien más ha usado el producto es exactamente quien deja
 * de ver lo que se añade. Al revés de como debería ser.
 *
 * El aviso de huérfanas ya sabía hablar de lo que SE FUE; esta es su simétrica,
 * la que habla de lo que HA LLEGADO. Sale de la misma comparación, en el mismo
 * momento y sin ninguna tabla nueva.
 *
 * `descartadas` son las que el usuario ya dijo que no quiere. Sin recordarlo, el
 * aviso reaparecería en cada carga y a la tercera se ignoraría — y con él se
 * ignoraría el de huérfanas, que sí importa.
 */
export function novedades(
  claves: string[],
  disponibles: CatalogEntry[],
  descartadas: string[] = [],
): CatalogEntry[] {
  const tengo = new Set(claves)
  const noQuiero = new Set(descartadas)
  return disponibles.filter(c => !tengo.has(c.key) && !noQuiero.has(c.key))
}

/** Sube o baja una clave una posición. Devuelve una lista NUEVA. */
export function mover(claves: string[], key: string, dir: 'arriba' | 'abajo'): string[] {
  const i = claves.indexOf(key)
  if (i < 0) return claves
  const j = dir === 'arriba' ? i - 1 : i + 1
  if (j < 0 || j >= claves.length) return claves
  const out = [...claves]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Añade al final si no estaba; quitar es quitar. */
export function alternar(claves: string[], key: string): string[] {
  return claves.includes(key) ? claves.filter(k => k !== key) : [...claves, key]
}
