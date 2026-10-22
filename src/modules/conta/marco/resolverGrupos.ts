// src/modules/conta/marco/resolverGrupos.ts
//
// S02 · Las acciones del catálogo de una página (esqueleto/ordenes.ts), con lo
// que la pantalla sabe de ellas (sus números, sus avisos, sus entradas: los
// bancos), ya resueltas a dónde llevan o qué hacen. De aquí salen la fila de
// acciones de serie y el «Más acciones» del encabezado. Núcleo puro.

import { rutaConta } from '@/config/navegacion'
import { conConsulta, esLaActual, type GrupoDeCinta, type Orden } from '@/modules/conta/esqueleto/ordenes'
import type { DatosCinta, EntradasCinta } from '@/modules/conta/marco/nuevo/contexto'
import type { Accion, GrupoDeAcciones } from './acciones'

/** Los grupos del catálogo de una página, con lo que la pantalla sabe de ellos, ya resueltos. */
export function resolverGrupos(grupos: readonly GrupoDeCinta[], o: {
  datos: DatosCinta | null; entradas: EntradasCinta | null; pathname: string; search: string; abrirBuscador: () => void
}): GrupoDeAcciones[] {
  return grupos.map((g): GrupoDeAcciones => {
    if (g.dePantalla) {
      const acciones = (o.entradas?.[g.dePantalla] ?? []).map((e): Accion => ({
        id: e.id, etiqueta: e.etiqueta, a: e.a, alPulsar: e.alPulsar, numero: e.numero, aviso: e.aviso,
        dato: e.titulo ?? e.dato, actual: e.actual, principal: e.principal, grupo: g.titulo,
      }))
      return { titulo: g.titulo, acciones, ver: g.ver }
    }
    const acciones = g.ordenes.map((x: Orden): Accion => {
      const d = o.datos?.[x.id]
      return {
        id: x.id, etiqueta: x.etiqueta,
        a: 'ruta' in x.a ? conConsulta(rutaConta(x.a.ruta), o.search) : undefined,
        alPulsar: 'accion' in x.a ? o.abrirBuscador : undefined,
        numero: d?.numero, aviso: d?.aviso, dato: d?.dato,
        actual: g.ver ? esLaActual(x, o.pathname, o.search) : undefined,
        principal: x.principal, grupo: g.titulo,
      }
    })
    return { titulo: g.titulo, acciones, ver: g.ver }
  }).filter((g) => g.acciones.length > 0)
}

