// src/shell/home/drill.ts
//
// GARANTÍA (c) DEL ENCARGO: EL CLICK ATERRIZA FILTRADO.
//
// ── QUÉ HABÍA, Y ES LA LECCIÓN ─────────────────────────────────────────────
// El acta del 31/08 dijo: «Arreglado en el contrato: HomeCardProps lleva
// onDrill, que el Inicio ata por tarjeta desde su drillRoute». Lo que había:
//
//   onDrill={c.drillRoute ? () => onOpenModule?.(c.moduleId) : undefined}
//   getHomeCatalog(): ...c, moduleId: 'shell'
//
// La guarda miraba `drillRoute` y la acción usaba `moduleId`, que vale 'shell'
// para las siete tarjetas transversales. No existe ningún módulo con ese id, así
// que `goToKey('shell')` recorría sus tres ramas y no hacía NADA. Cuatro
// tarjetas pulsables que no llevaban a ninguna parte, durante dos días, con el
// arreglo declarado hecho en el registro. Por eso este fichero existe: para que
// el destino de una tarjeta sea un dato explícito y comprobable, y no un campo
// que se parece a otro.
//
// ── EL CONTRATO ────────────────────────────────────────────────────────────
// Un destino es una RUTA más unos FILTROS. Los filtros viajan como query params
// —no como estado en memoria— por tres motivos que se pagaron antes:
//   · la URL se puede pegar en un mensaje y el otro ve lo mismo;
//   · el botón «atrás» del navegador vuelve al filtro anterior, no al módulo
//     entero sin filtrar;
//   · y sobre todo: se puede VERIFICAR. La comprobación 2 del encargo pide
//     demostrar el drill «con la URL de destino, no con un “debería”».
//
// ── PARÁMETROS QUE ENTIENDE CADA DESTINO ───────────────────────────────────
// Esta tabla es el contrato. Quien añada una tarjeta nueva mira aquí; quien
// añada un parámetro nuevo lo escribe aquí Y lo lee en el destino, en el mismo
// lote. Un parámetro que solo existe en el emisor es un filtro que se pierde en
// silencio, que es la misma familia de fallo que el no-op de arriba.
//
//   /ventas                  desde, hasta   (ISO yyyy-mm-dd, [desde, hasta])
//   /ventas/tendencia        desde, hasta
//   /personal/ahora-mismo    local          (uuid; ausente = todos)
//   /personal/calendario     semana         (ISO del lunes), local
//   /kitchen/disponibilidad  local
//
// Los destinos leen sus parámetros en el sub-lote de la tarjeta que los manda:
// un filtro sin tarjeta que lo emita no se puede probar, y sin prueba no se
// declara hecho. Lo que ESTE fichero garantiza es que el enlace se construye,
// se ve y navega — no que el destino ya sepa leerlo.

/** Un destino de drill-through: a dónde va y con qué filtros. */
export interface DrillDestino {
  /** Ruta absoluta del Shell, sin query. Ej.: '/ventas', '/personal/calendario'. */
  ruta: string
  /**
   * Filtros que viajan en la URL. Solo strings: un filtro que no cabe en una
   * URL es un filtro que no se puede compartir ni verificar. Los valores nulos
   * o vacíos se omiten en vez de viajar como «null» literal.
   */
  filtros?: Record<string, string | null | undefined>
  /** El pie de la tarjeta, tal cual se lee: «Abrir Ventas →». */
  etiqueta: string
}

/**
 * La URL final. Es lo que se pega en la comprobación 2 del encargo, así que
 * tiene que salir de aquí y no de una plantilla escrita a mano en cada tarjeta.
 */
export function construyeUrl(destino: DrillDestino): string {
  const entradas = Object.entries(destino.filtros ?? {})
    .filter((e): e is [string, string] => e[1] != null && e[1] !== '')
  if (entradas.length === 0) return destino.ruta
  const q = new URLSearchParams(entradas)
  return `${destino.ruta}?${q.toString()}`
}

/** `yyyy-mm-dd` en hora LOCAL. `toISOString()` desplaza el día en Madrid. */
export function fechaISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
