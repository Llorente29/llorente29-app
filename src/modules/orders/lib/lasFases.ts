// src/modules/orders/lib/lasFases.ts
//
// LAS FASES DE UN PEDIDO · 15/09/2026
//
// Las pestañas de Pedidos y las zonas del Pase contestan a dos preguntas
// distintas y por eso no pueden ser la misma función:
//
//   El Pase pregunta  DÓNDE ESTÁ LA COMIDA   → `lasTresZonas.laZona`
//   Pedidos pregunta  DÓNDE ESTÁ EL PEDIDO   → `laFase`, aquí
//
// La diferencia no es de gusto, es medible: un pedido de Glovo cerrado en caja
// NO se pinta en el Pase --`laZona` devuelve `null`, porque nadie nos ha dicho
// que el cliente lo tenga-- y SÍ tiene que aparecer en «Terminados», porque
// para Pedidos el pedido está terminado. Si se forzara una sola función, una de
// las dos pantallas mentiría.
//
// 🔴 LO QUE SÍ ES UNA SOLA VEZ, que es lo que pide el encargo: los PREDICADOS.
// «Está marcado listo», «se torció», «lo reparte la plataforma», «lo recoge el
// cliente» y la SITUACIÓN entera se importan de `lasTresZonas.ts` y no se
// vuelven a escribir aquí. Esta fase es una capa encima de `laSituacion`, no
// una segunda taxonomía: si mañana cambia qué es «marcado listo», cambia en un
// fichero y las dos pantallas se enteran.
//
// ── POR QUÉ «TERMINADO» NO MIRA `closed_at` ───────────────────────────────
//
// El encargo lo define como `closed_at is not null or order_status='completed'`.
// Medido hoy contra la RPC: `orders_feed` y `orders_feed_by_token` construyen
// el JSON con `to_jsonb(t)` sobre su proyección final, y esa proyección lleva
// `accepted_at, ready_at, handed_to_courier_at, delivered_at, entro_at` --pero
// NO `closed_at` ni `sold_at`--. Las dos columnas se leen en el `where` y se
// quedan dentro. O sea: el dato no llega a la pantalla (regla 40: lo que viaja
// en el payload se comprueba, no se supone).
//
// Lo que sí llega es `status`. Y `status='closed'` sustituye a `closed_at` sin
// perder un pedido, medido sobre las 1.709 ventas de Foodint de 14 días:
//
//     discrepan (closed_at is not null) <> (status='closed')   8
//       de esas 8, con status='cancelled'                      8
//       cerradas sin sello                                     0
//
// Las ocho están canceladas, y las canceladas se resuelven ANTES como
// incidencia, así que no llegan nunca a esta pregunta. Reclasificadas las 1.709
// con la regla de abajo: **cero** acaban en otra fase que la del encargo.
// Por eso este encargo NO necesita tocar la base.

import {
  laSituacion, estaMarcadoListo, esRecogida, loRepartelaPlataforma, losMinutos,
  sabemosSuCiclo, MINUTOS_DE_MAS_EN_RUTA,
  type PedidoDelPase, type Situacion,
} from '@/modules/pase/lib/lasTresZonas'

/** Lo que hace falta para decidir la fase. `OrderFeedItem` lo cumple. */
export interface PedidoConFase extends PedidoDelPase {
  /** `sale.status`: 'open' | 'closed' | 'cancelled'. Sí viaja en el payload. */
  status?: string | null
  /** Autoaceptación. Arranca el reloj de cocina. */
  accepted_at?: string | null
  /** Lo que calcula la RPC: minutos desde que ENTRÓ. Sirve para «En curso». */
  minutos?: number | null
}

export type Fase = 'en_curso' | 'esperando' | 'en_ruta' | 'terminado' | 'incidencia'

/** El orden de las pestañas en pantalla. «En curso» abre por defecto. */
export const LAS_FASES: Fase[] = ['en_curso', 'esperando', 'en_ruta', 'terminado', 'incidencia']

/**
 * 🔴 LOS RÓTULOS, UNA SOLA VEZ EN TODA LA APLICACIÓN (§3 del encargo).
 *
 * «Pase» lo llaman así en Foodint; otro cliente dirá «embolsado», y a un local
 * con sala no le sirve «Esperando repartidor». Hoy no se construye ajuste de
 * nombres --sería resolver un problema que todavía no tenemos-- pero el día que
 * haya cliente 2 esto es un objeto que se cambia, no una búsqueda por toda la
 * aplicación.
 *
 * 🔴 «TERMINADOS», NO «ENTREGADOS», y la diferencia es de honradez: de los
 * 1.822 pedidos de reparto de 14 días, sólo en los 225 de flota propia sabemos
 * que llegó al cliente. En el 87,7 % restante lo único que sabemos es que la
 * comanda se cerró. Llamarlo «Entregados» sería afirmar algo que no hemos
 * medido (regla 32).
 */
export const ROTULO: Record<Fase, string> = {
  en_curso: 'En curso',
  esperando: 'Esperando repartidor',
  en_ruta: 'En ruta',
  terminado: 'Terminados',
  incidencia: 'Incidencias',
}

/** La frase de la pestaña vacía. También una sola vez. */
export const ROTULO_VACIO: Record<Fase, string> = {
  en_curso: 'Nada en cocina ahora mismo.',
  esperando: 'Nada hecho esperando a que se lo lleven.',
  en_ruta: 'Nada de camino ahora mismo.',
  terminado: 'Todavía no se ha terminado ningún pedido.',
  incidencia: 'Ninguna incidencia. Es la buena noticia del día.',
}

/**
 * 🔴 LAS HORAS QUE LA TABLET TIENE DELANTE, Y DE DÓNDE SALE ESTE 2.
 *
 * No es una preferencia de pantalla: es lo que `orders_feed_by_token` decide
 * traer. Su `where` termina así, literal:
 *
 *     or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at)
 *          >= now() - interval '2 hours'
 *
 * Medido el 15/09 a las 23:05 en Alcalá: de 35 pedidos terminados en el día, la
 * tablet descargaba 23. Los otros 12 no estaban filtrados por la pantalla: no
 * habían llegado.
 *
 * ⚠️ SI ALGÚN DÍA SE CAMBIA ESE `interval` EN LA RPC, SE CAMBIA ESTE NÚMERO. Es
 * la cara visible del mismo dato, y son dos ficheros: no hay forma de que el
 * compilador lo ate (regla 40: lo que vive dentro de una cadena de SQL no lo
 * mira nadie). Por eso está escrito aquí el `where` entero, para que quien
 * toque uno encuentre el otro.
 *
 * La oficina no pasa este número: `orders_feed` trae el día de negocio entero.
 */
export const HORAS_QUE_TRAE_LA_TABLET = 2

/**
 * EL RÓTULO, CON SU ALCANCE DENTRO CUANDO LO TIENE.
 *
 * «Terminados» a secas, en una pantalla que sólo tiene dos horas delante, es la
 * pantalla que PARECE completa y no lo está --que es exactamente lo que prohíbe
 * la regla 7--. «Terminados · últimas 2 h» no esconde nada: declara lo que
 * cubre, y quien busca el pedido de hace tres horas sabe que tiene que mirar en
 * la oficina en vez de concluir que se ha perdido.
 *
 * `horasDeVentana = null` --la oficina-- deja el rótulo tal cual: ahí el día
 * entero SÍ está, así que no hay alcance que declarar.
 *
 * Y sólo lo lleva «Terminados»: las otras tres no se recortan por ventana
 * ninguna. Un pedido abierto viaja siempre, lo diga el reloj lo que diga.
 */
export function elRotulo(fase: Fase, horasDeVentana: number | null = null): string {
  if (fase !== 'terminado' || horasDeVentana == null) return ROTULO[fase]
  return `${ROTULO[fase]} · últimas ${horasDeVentana} h`
}

/** Lo mismo para la frase de la pestaña vacía: si hay alcance, se dice. */
export function elRotuloVacio(fase: Fase, horasDeVentana: number | null = null): string {
  if (fase !== 'terminado' || horasDeVentana == null) return ROTULO_VACIO[fase]
  return `Nada terminado en las últimas ${horasDeVentana} horas.`
}

/**
 * A PARTIR DE CUÁNTAS HORAS abierto un pedido pasa a ser incidencia.
 *
 * Medido el 15/09 en Foodint: hay 13 pedidos `cancelled` que siguen con
 * `status='open'` --el más viejo del 02/09-- y 3 `delivery_failed` abiertos, el
 * más viejo del 10/09. Están sumando en los contadores de las pestañas vivas
 * desde hace dos semanas.
 */
export const HORAS_PARA_SER_INCIDENCIA = 6

function edadEnHoras(p: PedidoConFase, ahora: Date): number | null {
  const iso = p.entro_at ?? null
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (ahora.getTime() - t) / 3_600_000
}

/**
 * ¿SE TORCIÓ O SE QUEDÓ COLGADO? Se pregunta LA PRIMERA, y ahí está el único
 * arreglo que le hago al encargo.
 *
 * Con las cuatro condiciones tal como venían escritas, «Terminados» e
 * «Incidencias» se solapan: un pedido cancelado Y cerrado cumple las dos.
 * Medido sobre 1.709 ventas de 14 días: 0 sin fase, **5 en dos fases a la vez**,
 * y las 5 son exactamente ese cruce. El §5.4 del encargo --que la suma de los
 * contadores dé el total-- fallaba por 5 mientras el orden no estuviera fijado.
 *
 * Preguntar por la incidencia primero lo cierra: las fases pasan a ser
 * excluyentes por construcción y los contadores suman.
 *
 * `rejected` entra con `cancelled` y `delivery_failed`: es lo que ya hacía la
 * pantalla y lo que dice `SE_TORCIO` en el Pase. Son 2 en 90 días, así que no
 * mueve ningún número; se deja por no tener dos listas de «lo que se torció».
 */
export function esIncidencia(p: PedidoConFase, ahora: Date = new Date()): boolean {
  const s = (p.order_status ?? '').toLowerCase()
  if (s === 'cancelled' || s === 'delivery_failed' || s === 'rejected') return true
  // 🔴 LA VENTA CANCELADA, AUNQUE EL PEDIDO DIGA «completed». Esto NO estaba en
  // el encargo y lo añado a propósito, porque lo encontré al medir: hay 5
  // ventas de 14 días con `order_status='completed'` y `status='cancelled'`.
  // Por la letra del encargo irían a «Terminados», y «Terminados» le dice a
  // quien mira que ese pedido salió bien. Una venta cancelada no salió bien.
  // Van a Incidencias, que es donde alguien puede hacer algo con ellas
  // (regla 39), y va dicho en el parte por si se prefiere al revés.
  if ((p.status ?? '') === 'cancelled') return true
  if ((p.status ?? '') !== 'open') return false
  const horas = edadEnHoras(p, ahora)
  return horas != null && horas > HORAS_PARA_SER_INCIDENCIA
}

/**
 * ¿Está terminado? Ver arriba por qué se mira `status` y no `closed_at`.
 *
 * 🔴 Y LO ENTREGADO TAMBIÉN, aunque la venta siga abierta (URGENTE del 16/09).
 *
 * Esto es el fallo que estaba en producción: un pedido de nuestra flota
 * entregado a las 15:29 seguía con `status='open'` y `order_status='awaiting_collection'`
 * --porque el cierre al entregar no existía-- así que no era «terminado», la
 * pregunta seguía bajando y caía en «esperando» por tener `ready_at`. La
 * tarjeta decía «Entregado» dentro de «Esperando repartidor». G231 llevaba
 * 146′ en rojo y G764 107′.
 *
 * La entrega no se pregunta aquí: se pregunta a `laSituacion`, que ya mira el
 * eje de la flota (`delivered_at`, `delivery_state`) y es la misma que usa el
 * Pase. Una regla, un sitio.
 *
 * Y va ANTES que el cierre a propósito: entregado es terminado aunque nadie
 * haya cerrado todavía, que es justo lo que el encargo pide enseñar.
 */
export function estaTerminado(p: PedidoConFase): boolean {
  if (laSituacion(p) === 'entregado') return true
  return (p.status ?? '') === 'closed' || (p.order_status ?? '') === 'completed'
}

/**
 * LA FASE. Cuatro, excluyentes, y en este orden.
 *
 * El «esperando» no pregunta por `order_status` sino por el SELLO DE COCINA,
 * igual que el Pase: `ready_at` lo escribe un solo disparador en toda la base
 * y `order_status` lo mueven cuatro caminos distintos. La misma razón por la
 * que `laSituacion` no lo mira.
 */
export function laFase(p: PedidoConFase, ahora: Date = new Date()): Fase {
  if (esIncidencia(p, ahora)) return 'incidencia'

  // 🔴 LO ENTREGADO, PRIMERO. Llegó: no está de camino ni esperando a nadie.
  if (laSituacion(p) === 'entregado') return 'terminado'

  // 🔴 «EN RUTA» (16/09). Decisión de Julio al ver la pantalla con cuatro
  // pestañas: «¿de esperando pasa a terminado? ¿y lo que ocurre entre medias?».
  //
  // El 15/09 no se hizo pestaña porque solo el 12 % de los pedidos traía el
  // dato, y una pestaña que unas veces recibe y otras no es una pestaña que no
  // se mira. Con la opción A eso deja de pasar: a «Esperando» y a «En ruta»
  // solo entran los del grupo 1, y de ésos SÍ sabemos la recogida. La pestaña
  // siempre recibe lo que le toca.
  //
  // Y NO SE QUEDA ETERNA, que es el riesgo de una fase que espera un aviso:
  // con la comanda ya cerrada se va a Terminados aunque no haya llegado la
  // entrega. Si Catcher o Uber se comen el aviso de entrega, el pedido no se
  // queda «de camino» toda la noche diciendo una hora que crece sin parar.
  const cerrada = (p.status ?? '') === 'closed' || (p.order_status ?? '') === 'completed'
  if (laSituacion(p) === 'en_ruta' && !cerrada) return 'en_ruta'

  if (estaTerminado(p)) return 'terminado'

  // 🔴 LA OPCIÓN A. Lo que está hecho y de lo que NO vamos a saber nada más no
  // se queda esperando a un aviso que no existe: termina aquí, y la tarjeta lo
  // dice con esas palabras («Listo HH:MM · sin seguimiento») en vez de fingir
  // que sigue pasando algo. Es la misma honradez que hizo que «Terminados» no
  // se llame «Entregados».
  //
  // Antes del 16/09 estos 1.197 pedidos de 14 días --todo lo de Last, Glovo
  // repartido por Glovo, las recogidas-- se amontonaban en «Esperando
  // repartidor» hasta que alguien cerraba la comanda. Ahí es donde la pestaña
  // dejaba de significar nada.
  if (estaMarcadoListo(p)) return sabemosSuCiclo(p) ? 'esperando' : 'terminado'

  return 'en_curso'
}

/**
 * LO QUE PONE EN LA TARJETA DE «TERMINADOS», que no es lo mismo para todos.
 *
 * Un pedido del grupo 1 terminó porque LLEGÓ, y se dice la hora de entrega. Uno
 * del grupo 2 terminó porque cocina acabó, y de ahí en adelante no sabemos
 * nada: se dice la hora del «Listo» Y se dice que no hay seguimiento. Escribir
 * «Entregado» ahí sería la mentira que esta pantalla vino a quitar.
 *
 * `null` = no hay hora que pintar; la tarjeta ya sabe qué hacer con eso.
 */
export function loQueDiceTerminados(p: PedidoConFase): { hora: string | null; sinSeguimiento: boolean } {
  if (laSituacion(p) === 'entregado') return { hora: p.delivered_at ?? null, sinSeguimiento: false }
  if (sabemosSuCiclo(p)) return { hora: p.delivered_at ?? p.ready_at ?? null, sinSeguimiento: false }
  return { hora: p.ready_at ?? null, sinSeguimiento: true }
}

/**
 * DESDE CUÁNDO SE ORDENA CADA PESTAÑA. El más viejo arriba en las dos primeras
 * --que es la pregunta de cocina: «¿qué llevo esperando más?»-- y el más
 * reciente arriba en Terminados, que es la pregunta contraria.
 *
 * El encargo pide ordenar «En curso» por `coalesce(accepted_at, sold_at)`.
 * `sold_at` no viaja en el payload (ver la cabecera); lo que sí viaja es
 * `entro_at`, que la propia RPC calcula como
 * `coalesce(opened_at, sold_at, created_at)` --o sea, lo mismo y con dos
 * respaldos más--. Se usa ése.
 */
export function elRelojDeLaFase(p: PedidoConFase, fase: Fase): string | null {
  if (fase === 'esperando') return p.ready_at ?? p.entro_at ?? null
  // «En ruta» se ordena por la RECOGIDA: el que salió antes lleva más tiempo
  // fuera, que es lo que se pregunta mirando esa pestaña.
  if (fase === 'en_ruta') return p.handed_to_courier_at ?? p.ready_at ?? p.entro_at ?? null
  return p.accepted_at ?? p.entro_at ?? null
}

/**
 * A PARTIR DE CUÁNTOS MINUTOS SE PONE ÁMBAR lo que ya está hecho y espera.
 * Decisión de Julio, 16/09. No es el semáforo de cocina: aquí no se está
 * cocinando nada, se está esperando a que alguien lo recoja.
 */
export const MINUTOS_DE_ESPERA_EN_AMBAR = 20

/**
 * EL NÚMERO GRANDE DE LA TARJETA, y desde cuándo cuenta.
 *
 * 🔴 El fallo que arregla (URGENTE §3.3): `order.minutos` lo calcula la RPC
 * SIEMPRE desde que entró el pedido. En «En curso» es lo que hay que ver. En
 * «Esperando repartidor» no: ahí la pregunta es «cuánto lleva HECHO esperando»,
 * y un pedido que entró a las 15:00 y se marcó listo a las 17:10 no lleva 146
 * minutos esperando, lleva 16.
 *
 * Y para lo que ya salió, el reloj es otro todavía: `losMinutos` de
 * `lasTresZonas` elige por SITUACIÓN --recogido cuenta desde la recogida,
 * entregado desde la entrega-- y es el mismo que usa el Pase. No se reescribe
 * aquí: se llama.
 *
 * `null` = no hay reloj que pintar. Nunca 0, que se leería como «recién hecho».
 */
export function losMinutosDeLaTarjeta(
  p: PedidoConFase, fase: Fase, ahora: Date = new Date(),
): number | null {
  if (fase === 'en_curso') return p.minutos ?? losMinutos(p, ahora)
  return losMinutos(p, ahora)
}

/**
 * EL COLOR DE ESE NÚMERO. Tres niveles, los que ya pinta la tarjeta.
 *
 * En «En curso» manda el semáforo de cocina, que no se toca: es el que lleva
 * los umbrales del local. En las demás fases el reloj mide otra cosa --espera,
 * no cocción-- y el umbral es el de Julio: ámbar a los 20 minutos.
 *
 * Lo que ya salió o llegó no se pinta en rojo nunca: un pedido en la moto no es
 * una avería de cocina, y el ámbar de «lleva mucho en ruta» ya lo decide
 * `lasTresZonas` con su propio umbral.
 */
export function elNivelDeLaTarjeta(
  p: PedidoConFase, fase: Fase, minutos: number | null,
): 'fresh' | 'warn' | null {
  // `null` = «aquí no mando yo»: en «En curso» el color lo decide el semáforo de
  // cocina, con los umbrales del local. Decirlo con null y no con un valor
  // inventado es lo que impide que este fichero pise aquello sin querer.
  if (fase === 'en_curso') return null
  if (minutos == null) return 'fresh'
  const s = laSituacion(p)
  if (s === 'entregado') return 'fresh'
  if (s === 'en_ruta') return minutos > MINUTOS_DE_MAS_EN_RUTA ? 'warn' : 'fresh'
  return minutos > MINUTOS_DE_ESPERA_EN_AMBAR ? 'warn' : 'fresh'
}

const AL_FINAL = Number.MAX_SAFE_INTEGER

function instante(iso: string | null): number {
  if (!iso) return AL_FINAL          // sin reloj, al final: nunca arriba por azar
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? AL_FINAL : t
}

/** Comparador de una pestaña. `terminado` invierte; las demás, el viejo arriba. */
export function ordenDeLaFase(fase: Fase) {
  const masRecienteArriba = fase === 'terminado'
  return (a: PedidoConFase, b: PedidoConFase): number => {
    const ta = instante(elRelojDeLaFase(a, fase))
    const tb = instante(elRelojDeLaFase(b, fase))
    if (ta === tb) return 0
    if (masRecienteArriba) {
      // Los sin reloj se quedan abajo también aquí, no arriba del todo.
      if (ta === AL_FINAL) return 1
      if (tb === AL_FINAL) return -1
      return tb - ta
    }
    return ta - tb
  }
}

// ── EL DISTINTIVO DEL RIDER, SÓLO EN «ESPERANDO REPARTIDOR» ───────────────

/**
 * QUÉ SABEMOS DEL REPARTIDOR, y sólo donde lo sabemos.
 *
 * `null` = no se pinta nada. Y eso es el 87,7 % de los pedidos: medido sobre
 * 1.822 repartos de 14 días, sólo los 225 de flota propia tienen un momento
 * «el rider lo recoge» (`handed_to_courier_at` en 219, `delivery_state` en
 * 225). Para Glovo, Uber por Last y Just Eat el dato NO EXISTE EN ORIGEN: no es
 * que no lo leamos.
 *
 * Por eso «En ruta» es un distintivo de la tarjeta y no una pestaña. Una
 * pestaña por la que 8 de cada 10 pedidos no pasan nunca es una pestaña que el
 * cocinero deja de mirar --y con ella deja de creerse las demás (regla 7)--.
 * Aquí, donde hay dato se ve y donde no lo hay no hay hueco que explicar.
 */
export function elDistintivoDelRider(p: PedidoConFase): { texto: string; esAviso: boolean } | null {
  if (loRepartelaPlataforma(p)) return null       // no lo sabemos: no se dice nada
  const s: Situacion = laSituacion(p)
  // 🔴 «Recogido · en ruta» SE RETIRA (16/09). Existía porque un pedido ya
  // recogido se quedaba dentro de «Esperando repartidor» y había que avisar de
  // que en realidad ya iba de camino. Ahora eso es una PESTAÑA: repetirlo en
  // el distintivo sería decir dos veces lo mismo, y el sitio donde está la
  // tarjeta ya lo dice mejor que una etiqueta.
  if (s === 'en_ruta') return null
  if (s === 'lo_recoge_el_cliente' || esRecogida(p)) {
    return { texto: 'Lo recoge el cliente', esAviso: false }
  }
  if (s === 'esperando_que_lo_cojan') {
    return { texto: 'Buscando repartidor', esAviso: true }
  }
  if (s === 'listo_sin_salir') {
    const nombre = p.repartidor_nombre?.trim()
    return { texto: nombre ? `${nombre} en camino` : 'Repartidor asignado', esAviso: false }
  }
  return null
}
