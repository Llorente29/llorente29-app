// src/modules/ventas/home/porqueSemana.ts
//
// LA LÍNEA DEL PORQUÉ de la tarjeta «Ventas · esta semana», y el sitio donde
// esta tarjeta puede mentir. Lo que sigue es lo que la regla HACE y, sobre
// todo, lo que NO se permite afirmar.
//
// ── LO QUE HAY EN LA BASE ──────────────────────────────────────────────────
// `availability_event` guarda cierres Y aperturas de marca con su instante, su
// origen y a veces su motivo. Con eso se pueden reconstruir intervalos.
//
// ── LOS TRES DEFECTOS QUE OBLIGAN A ACOTAR LA REGLA ────────────────────────
// Medidos el 02/09 sobre las dos últimas semanas de Foodint (28 eventos):
//
//   1. `location_id` viene NULO en 19 de los 28 — todos los del 27, 28 y 29 de
//      agosto. Sin local no se puede decir «en los dos locales»: habría que
//      suponer a cuáles afectó, y suponer es justo lo que no se hace. Esos
//      eventos se DESCARTAN, no se reparten.
//
//   2. Hay cierres de segundos. El 29/08 Meraki Pita se abrió y se cerró cinco
//      veces en catorce minutos, uno de ellos de 32 segundos. Eso es alguien
//      probando, no un cierre que explique unas ventas. Por eso hay un mínimo
//      de duración.
//
//   3. Un cierre COINCIDE con una bajada; no la CAUSA. La regla no tiene forma
//      de demostrar la causa, así que la frase enuncia un HECHO y deja la
//      conclusión a quien lee: «Meraki Pita lleva cerrada en Carabanchel desde
//      el martes», nunca «por eso bajaron las ventas».
//
// ── Y POR ESO LA LÍNEA SOLO SALE SI ────────────────────────────────────────
//   · el cierre tiene local conocido,
//   · duró al menos DOS HORAS dentro de la semana que se está mirando,
//   · y la semana va A LA BAJA. Un cierre no explica una subida, y ponerlo al
//     lado de un +12 % invitaría a leer una relación que no existe.
//
// Si no se cumple, NO SE PINTA NADA. La tarjeta da cifra y espejo, que es
// exactamente lo acordado: antes sin porqué que con un porqué inventado.

const DOS_HORAS_MS = 2 * 3600_000

export interface EventoDeMarca {
  marca: string
  locationId: string | null
  localNombre: string | null
  accion: 'open' | 'close'
  cuando: string          // ISO
}

export interface CierreReconstruido {
  marca: string
  locales: string[]
  desde: Date
  /** null = seguía cerrada al final de la ventana. */
  hasta: Date | null
  duracionMs: number
}

/**
 * Empareja cada `close` con el `open` siguiente de la MISMA marca y local.
 * Un cierre sin apertura posterior sigue vigente y se cierra en `finVentana`.
 */
export function reconstruyeCierres(
  eventos: EventoDeMarca[],
  finVentana: Date,
): CierreReconstruido[] {
  const porClave = new Map<string, EventoDeMarca[]>()
  for (const e of eventos) {
    // Sin local no se reparte ni se supone: se descarta (defecto 1).
    if (!e.locationId) continue
    const k = `${e.marca}|${e.locationId}`
    const arr = porClave.get(k) ?? []
    arr.push(e)
    porClave.set(k, arr)
  }

  const salida: CierreReconstruido[] = []
  for (const lista of porClave.values()) {
    const marca = lista[0].marca
    const local = lista[0].localNombre ?? 'un local'
    const ordenada = [...lista].sort((a, b) => a.cuando.localeCompare(b.cuando))
    let abiertoDesde: Date | null = null
    for (const e of ordenada) {
      if (e.accion === 'close' && abiertoDesde == null) {
        abiertoDesde = new Date(e.cuando)
      } else if (e.accion === 'open' && abiertoDesde != null) {
        salida.push({
          marca, locales: [local], desde: abiertoDesde, hasta: new Date(e.cuando),
          duracionMs: new Date(e.cuando).getTime() - abiertoDesde.getTime(),
        })
        abiertoDesde = null
      }
    }
    if (abiertoDesde != null) {
      salida.push({
        marca, locales: [local], desde: abiertoDesde, hasta: null,
        duracionMs: finVentana.getTime() - abiertoDesde.getTime(),
      })
    }
  }
  return salida
}

/** Junta los cierres de la misma marca que se solapan, para nombrar los locales juntos. */
function fusionaPorMarca(cierres: CierreReconstruido[]): CierreReconstruido[] {
  const porMarca = new Map<string, CierreReconstruido[]>()
  for (const c of cierres) {
    const arr = porMarca.get(c.marca) ?? []
    arr.push(c)
    porMarca.set(c.marca, arr)
  }
  const salida: CierreReconstruido[] = []
  for (const lista of porMarca.values()) {
    const ordenada = [...lista].sort((a, b) => a.desde.getTime() - b.desde.getTime())
    let actual = { ...ordenada[0], locales: [...ordenada[0].locales] }
    for (const c of ordenada.slice(1)) {
      const finActual = actual.hasta?.getTime() ?? Infinity
      if (c.desde.getTime() <= finActual) {
        for (const l of c.locales) if (!actual.locales.includes(l)) actual.locales.push(l)
        if (actual.hasta && (c.hasta === null || c.hasta > actual.hasta)) actual.hasta = c.hasta
        actual.duracionMs = Math.max(actual.duracionMs, c.duracionMs)
      } else {
        salida.push(actual)
        actual = { ...c, locales: [...c.locales] }
      }
    }
    salida.push(actual)
  }
  return salida
}

/** «martes», en hora del negocio. */
function nombreDelDia(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' })
}

/**
 * La frase, o null.
 *
 * `laSemanaBaja` manda: un cierre no explica una subida.
 */
export function frasePorque(
  eventos: EventoDeMarca[],
  finVentana: Date,
  laSemanaBaja: boolean,
): string | null {
  if (!laSemanaBaja) return null

  const candidatos = fusionaPorMarca(reconstruyeCierres(eventos, finVentana))
    .filter(c => c.duracionMs >= DOS_HORAS_MS)      // fuera el trasteo de segundos
    .sort((a, b) => b.duracionMs - a.duracionMs)

  const c = candidatos[0]
  if (!c) return null

  const locales = c.locales.length >= 2
    ? 'en los dos locales'
    : `en ${c.locales[0]}`

  // HECHO, no causa: «lleva cerrada desde el martes», nunca «por eso bajó».
  return c.hasta == null
    ? `${c.marca} lleva cerrada ${locales} desde el ${nombreDelDia(c.desde)}`
    : `El ${nombreDelDia(c.desde)} ${c.marca} estuvo cerrada ${locales}`
}
