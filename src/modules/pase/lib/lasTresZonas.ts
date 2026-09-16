// src/modules/pase/lib/lasTresZonas.ts
//
// EL PASE · LAS TRES ZONAS · 14/09/2026
//
// Todo el castellano y todas las decisiones del Pase viven aquí, no en la
// pantalla: así se pueden leer, discutir y probar sin abrir React.
//
// ── POR QUÉ EXISTE ESTA PANTALLA ──────────────────────────────────────────
//
// 185 clientes vieron «Pedido entregado» y se quedaron sin mapa mientras el
// rider seguía de camino. `track_by_token` pinta «entregado» en cuanto
// `order_status = 'completed'`, y cerrar es hoy un botón de cocina. El 75 % de
// los repartos propios se cierran antes de entregarse --de media 13,7 min
// antes-- y 27 clientes no recibieron su WhatsApp porque el pedido saltó de
// cocina a cerrado sin pasar por «en ruta».
//
// ── LA REGLA ──────────────────────────────────────────────────────────────
//
// En cocina se pulsa UNA vez en toda la vida del pedido: «Listo». Lo demás
// llega solo o NO SE PINTA. Cerrar deja de ser un botón de cocina.
//
// ── LAS TRES ZONAS DICEN DÓNDE ESTÁ LA COMIDA ─────────────────────────────
//
//   Sigue aquí  · por marcar · esperando al rider de plataforma · sin coger
//   En ruta     · SÓLO lo que sabemos que ha salido: reparto propio con flota
//   Entregados  · SÓLO lo que sabemos que ha llegado
//
// Y «lo que sabemos» es literal: se pregunta al EJE DE LA FLOTA
// (`delivery_state`, `handed_to_courier_at`, `delivered_at`), nunca al botón de
// cocina. Un pedido de plataforma no pasa por «En ruta» ni por «Entregados»
// porque Glovo no nos dice cuándo sale ni cuándo llega — y eso se escribe en la
// pantalla con esas palabras, en vez de inventarlo.

/** Lo que el Pase necesita de un pedido. Subconjunto de `OrderFeedItem`. */
export interface PedidoDelPase {
  sale_id: string
  /** Puede venir en null: 23 ventas de los ultimos 90 dias lo tienen asi. */
  order_status: string | null
  service_type: string | null
  /** ¿Hay repartidor asignado? Lo dice el eje de la flota. */
  has_courier: boolean | null
  /** 'catcher' | 'jelp' | … ; null = sin transportista propio. */
  carrier_code: string | null
  /** Estado del broker: created/assigned/picked_up/in_delivery/delivered… */
  delivery_state: string | null
  /** Hito de cocina. Un solo escritor en toda la base: `tg_sale_seal_kpi_hitos`. */
  ready_at: string | null
  handed_to_courier_at: string | null
  delivered_at: string | null
  channel: string | null
  /** Por dónde entró: 'lastapp' | 'hubrise' | … Decide si sabemos su ciclo. */
  source?: string | null
  /** Cuándo entró el pedido. El reloj de los que aún no tienen sello. */
  entro_at?: string | null
  /**
   * EL REPARTIDOR NUESTRO, cuando lo hay. Medido en 14 días de Foodint: de 245
   * repartos propios, 231 tienen flota y los 231 traen nombre Y teléfono; cero
   * con flota y sin nombre, cero con nombre y sin flota. Y de 1.424 pedidos de
   * plataforma, CERO traen nombre: Glovo y Uber no nos dicen quién lo lleva.
   *
   * 🔴 Es el teléfono del REPARTIDOR, no el del cliente. El del cliente no
   * viaja en el tablero --se pide en bucle, y en 1.685 pedidos sólo 229 traen
   * uno de verdad-- y va en la ficha, a la carta.
   */
  repartidor_nombre?: string | null
  repartidor_telefono?: string | null
}

export type Zona = 'sigue_aqui' | 'en_ruta' | 'entregados'

/**
 * LO QUE SE FUE POR LO MALO. No se pinta en ninguna zona: un pedido cancelado o
 * con el reparto fallido no está «en cocina», ni «en ruta», ni «entregado».
 *
 * 🔴 MEDIDO, y por eso esta comprobación va ANTES que todas: en 90 días hay
 * TRES ventas `cancelled` con `delivery_state = 'delivered'` y `delivered_at`
 * sellado. Sin esta raya, un pedido cancelado aparecería en «Entregados».
 */
const SE_TORCIO = ['rejected', 'cancelled', 'delivery_failed']

export type Situacion =
  | 'por_marcar'                    // sigue aquí, sin sello de cocina
  | 'esperando_rider_plataforma'    // sigue aquí, lo reparte la plataforma
  | 'esperando_que_lo_cojan'        // sigue aquí, propio SIN flota: nadie lo ha cogido
  | 'listo_sin_salir'               // sigue aquí, propio CON flota, aún no ha salido
  | 'lo_recoge_el_cliente'          // sigue aquí, viene el cliente a por ello
  | 'en_ruta'                       // ha salido de verdad
  | 'entregado'                     // ha llegado de verdad

/** ¿Lo reparte una plataforma? Se mira el tipo de servicio, no el canal de venta. */
export function loRepartelaPlataforma(p: PedidoDelPase): boolean {
  return (p.service_type ?? '').toLowerCase().includes('platform')
}

/** ¿Lo repartimos nosotros CON flota? Sin flota no hay quien avise de nada. */
export function loRepartimosConFlota(p: PedidoDelPase): boolean {
  if (loRepartelaPlataforma(p)) return false
  return p.has_courier === true || (p.carrier_code ?? '') !== ''
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * ¿SABEMOS SU CICLO? EL GRUPO 1 Y EL GRUPO 2, EN UN SOLO SITIO · 16/09/2026
 * ─────────────────────────────────────────────────────────────────────────
 *
 * De unos pedidos nos llega la recogida y la entrega, y de otros no nos llega
 * NADA después del «Listo». De eso depende media pantalla: quién puede estar en
 * «Esperando repartidor», quién pasa por «En ruta» y quién se va a Terminados
 * en cuanto cocina termina. Por eso se decide aquí, una vez, y lo usan igual
 * Pedidos y el Pase.
 *
 * 🔴 NO ES UNA SUPOSICIÓN POR CANAL: está contado. Avisos de HubRise de 7 días
 * y ventas de 14, el 16/09:
 *
 *   flota nuestra (Catcher) ............ 213 de 224 con recogida Y entrega
 *   Uber Eats por HubRise .............. 71 de 71 con `in_delivery`,
 *                                        69 de 71 con `completed`
 *   ─────────────────────────────────── el resto, cero de cero:
 *   Glovo por HubRise (lo reparte Glovo)  133 avisos en 7 días, TODOS `new`
 *   cualquier cosa por Last ............ 1.197 pedidos, 0 recogidas, 0 entregas
 *   las recogidas de mostrador ......... nadie las marca nunca: no hay app
 *
 * Los 208 «con recogida» de la fila de Glovo por HubRise NO son de Glovo: son
 * de Catcher, porque ésos los repartimos nosotros. Mirar solo el canal habría
 * puesto a Glovo en el grupo 1 por un dato que no manda Glovo.
 *
 * ⚠️ LO QUE PASA SI SE CLASIFICA MAL, y por eso va medido y no a ojo: un grupo
 * 2 marcado como 1 se queda esperando para siempre a un aviso que no va a
 * llegar; un grupo 1 marcado como 2 se va a Terminados con el rider todavía en
 * la puerta. Los dos errores se ven en pantalla, y ninguno se corrige solo.
 *
 * ⚠️ Y SI MAÑANA UN CONECTOR EMPIEZA O DEJA DE MANDAR EL CICLO, esto se queda
 * mintiendo en silencio. Hoy no hay tabla de configuración por conector y no se
 * construye una para dos casos; la señal de que hay que volver aquí es un
 * «Esperando repartidor» que no se vacía nunca, o un Terminados con pedidos
 * que luego resultan tener recogida.
 */
export function sabemosSuCiclo(p: PedidoDelPase): boolean {
  // 1 · Lo llevamos nosotros: el ciclo lo manda Catcher, pedido a pedido.
  if (loRepartimosConFlota(p)) return true
  // 2 · Uber por HubRise. Las dos mitades cuentan: por Last, el MISMO canal no
  //     manda nada (349 pedidos, 0 recogidas), así que el canal solo no basta.
  const canal = (p.channel ?? '').trim().toLowerCase()
  const porHubrise = (p.source ?? '').trim().toLowerCase() === 'hubrise'
  if (porHubrise && (canal === 'uber' || canal === 'uber eats' || canal === 'ubereats')) return true
  return false
}

/**
 * ¿Lo recoge el cliente? Medido en 90 días: 63 ventas `pickup`, y las 63 sin
 * `delivery_state` y sin `delivered_at`. Nadie las va a marcar nunca, porque no
 * hay app de repartidor de por medio: el cliente viene al mostrador.
 */
export function esRecogida(p: PedidoDelPase): boolean {
  return (p.service_type ?? '').toLowerCase() === 'pickup'
}

/** ¿Tiene sello de cocina? El hito, no el estado: un solo escritor. */
export function estaMarcadoListo(p: PedidoDelPase): boolean {
  return p.ready_at != null
}

/**
 * EN QUÉ SITUACIÓN ESTÁ, que es lo que decide zona, palabras y si hay botón.
 *
 * El orden importa y es de fuera hacia dentro: primero lo que SABEMOS que pasó
 * (llegó, salió) y sólo al final lo que está esperando. Preguntar antes por el
 * botón de cocina es como se acaba pintando «entregado» sobre un pedido que
 * sigue en la moto.
 */
export function laSituacion(p: PedidoDelPase): Situacion {
  // 1 · ¿Ha llegado? Lo dice la flota.
  //
  // Se preguntan las DOS cosas. El sello sólo se escribe cuando el estado
  // CAMBIA (`new.delivery_state is distinct from old.delivery_state`), así que
  // una fila que nace ya entregada no lo lleva.
  //
  // 🔴 Y AQUÍ VA DICHO LO QUE ESTO CUBRE DE VERDAD, que es menos de lo que yo
  // escribí primero. De las 43 filas así que hay en 90 días, LAS 43 están
  // `completed` y ninguna tiene sello, handoff ni entrega: nacieron cerradas y
  // no pasaron por cocina. `pase_board` no manda una venta cerrada sin ningún
  // instante --no habría reloj que pintar-- así que por el tablero no llega ni
  // una. Esto es una DEFENSA para el día que un broker mande «entregada y
  // todavía abierta», no una rama que se recorra hoy.
  if (p.delivered_at != null || p.delivery_state === 'delivered' || p.delivery_state === 'finish') {
    return 'entregado'
  }
  // 2 · ¿Ha salido? También la flota. `order_status` no sabe esto.
  if (p.delivery_state === 'in_delivery' || p.delivery_state === 'picked_up' || p.handed_to_courier_at != null) {
    return 'en_ruta'
  }
  // 3 · Sigue en el local. ¿Está marcado?
  if (!estaMarcadoListo(p)) return 'por_marcar'
  // 🔴 La recogida, antes que las esperas de reparto. Sin esta raya un `pickup`
  // marcado caía en «esperando_que_lo_cojan» --no tiene flota-- y la tarjeta
  // decía «Lo marca quien se lo lleve, desde su móvil», que en una recogida no
  // es nadie: el cliente no tiene app. Son 12 pedidos en 14 días diciendo algo
  // que no pasa.
  if (esRecogida(p)) return 'lo_recoge_el_cliente'
  if (loRepartelaPlataforma(p)) return 'esperando_rider_plataforma'
  if (!loRepartimosConFlota(p)) return 'esperando_que_lo_cojan'
  return 'listo_sin_salir'
}

/**
 * LA ZONA. Tres, y cada una dice dónde está la comida.
 *
 * `null` = esta tarjeta no se pinta. Un pedido de plataforma cerrado se va sin
 * pasar por «Entregados», porque nunca supimos que llegara: lo único que pasó
 * es que se cerró la comanda en caja.
 */
export function laZona(p: PedidoDelPase): Zona | null {
  // 🔴 Lo que se torció, primero y sin excepción. Ver `SE_TORCIO`: hay pedidos
  // cancelados con el reparto marcado como entregado, y no son «Entregados».
  if (SE_TORCIO.includes(p.order_status ?? '')) return null

  const s = laSituacion(p)
  if (s === 'entregado') return 'entregados'
  if (s === 'en_ruta') return 'en_ruta'

  // Cerrado sin que la flota diga que llegó: se va SIN pasar por «Entregados».
  // Es el caso de la plataforma --se cerró la comanda en caja, que no es que el
  // cliente lo tenga-- y también el del reparto propio sin flota que nadie
  // marcó. Enseñarlo como entregado sería repetir la mentira que venimos a
  // quitar de la pantalla del cliente.
  if (p.order_status === 'completed') return null

  return 'sigue_aqui'
}

/** ¿Se pulsa algo en esta tarjeta? Sólo una cosa, y sólo en un sitio. */
export function tieneBotonDeListo(p: PedidoDelPase): boolean {
  return laZona(p) === 'sigue_aqui' && laSituacion(p) === 'por_marcar'
}

/**
 * ¿SE PUEDE DECIR «SE LO HA LLEVADO»? · 16/09/2026
 *
 * La bolsa está hecha, sigue aquí y nadie ha escrito todavía la recogida. El
 * del pase VE la bolsa salir por la puerta: es la única persona del sistema que
 * lo sabe en ese instante, y hasta hoy no tenía dónde decirlo.
 *
 * 🔴 SE OFRECE TAMBIÉN EN EL GRUPO 1, y es a propósito. Ahí la recogida suele
 * llegar sola --71 de 71 en Uber por HubRise-- pero «suele» no es «siempre», y
 * cuando el aviso tarda, el del pase lo sabe antes que el sistema. La RPC
 * escribe sólo si está vacío, así que pulsar cuando ya había hora no pisa nada:
 * manda el primero que lo supo, no el último que pulsó.
 *
 * No aparece en una recogida de mostrador: ahí no se lo lleva un repartidor, y
 * el botón diría algo que no pasa.
 */
export function tieneBotonDeRecogida(p: PedidoDelPase): boolean {
  if (laZona(p) !== 'sigue_aqui') return false
  if (esRecogida(p)) return false
  return estaMarcadoListo(p) && p.handed_to_courier_at == null
}

// ── LAS PALABRAS ──────────────────────────────────────────────────────────
//
// Valen más que un estado. Donde no sabemos, se dice que no sabemos.

/** El nombre de quien reparte, para la frase. «Glovo», «Uber», «nosotros». */
export function quienReparte(p: PedidoDelPase): string {
  if (loRepartelaPlataforma(p)) return p.channel?.trim() || 'la plataforma'
  return 'nosotros'
}

/**
 * La línea bajo el nombre de la marca: canal y quién lo lleva.
 *
 * 🔴 SIN DECIR DOS VECES LO MISMO (16/09). Antes salía «Uber · lo reparte
 * Uber», y debajo `loQuePasa` remataba con «Esperando al rider de Uber»: tres
 * veces la palabra Uber en una tarjeta de cinco líneas. Cuando el que reparte
 * ES el canal --que es el caso de Glovo y Uber, o sea la inmensa mayoría-- el
 * canal solo ya lo dice, y la frase de estado dice el resto. Se deja el «lo
 * reparte X» únicamente cuando X no es el canal, que es cuando aporta algo.
 */
export function elSubtitulo(p: PedidoDelPase, donde: 'pase' | 'pedidos' = 'pase'): string {
  const canal = p.channel?.trim() || 'sin canal'
  if (esRecogida(p)) return `${canal} · lo recoge el cliente`
  if (loRepartimosConFlota(p)) return `${canal} · reparto nuestro`
  if (loRepartelaPlataforma(p)) {
    // 🔴 EL GRUPO, DENTRO DE LA ETIQUETA (16/09). «Glovo» a secas no decía
    // quién reparte, y en Pedidos G292 y G941 se leían igual que un Glovo de
    // plataforma aunque los lleve nuestra flota.
    //
    // Y las dos pantallas dicen lo MISMO con palabras distintas a propósito,
    // porque preguntan cosas distintas: el Pase mira la bolsa que tiene
    // delante --«lo recoge su repartidor», o sea, va a venir alguien a por
    // ella-- y Pedidos mira el pedido entero --«sin seguimiento», o sea, de
    // aquí en adelante no vamos a saber nada--. El predicado es uno solo;
    // lo que cambia es la palabra.
    if (!sabemosSuCiclo(p)) {
      return donde === 'pedidos' ? `${canal} · sin seguimiento`
                                 : `${canal} · lo recoge su repartidor`
    }
    return `${canal} · lo reparte ${quienReparte(p)}`
  }
  return `${canal} · lo lleva alguien de casa`
}

/** La frase del estado, la que se lee de un vistazo. */
export function loQuePasa(p: PedidoDelPase, minutos: number | null): string {
  switch (laSituacion(p)) {
    case 'por_marcar':
      return 'En cocina'
    case 'esperando_rider_plataforma':
      // Los minutos van DENTRO de la frase, como en las otras esperas: sin
      // ellos, una bolsa hecha hace media hora se lee igual que una recién
      // hecha, que es lo que pasaba el 16/09.
      return minutos == null ? `Esperando al rider de ${quienReparte(p)}`
                             : `Esperando al rider de ${quienReparte(p)} · ${minutos} min`
    case 'esperando_que_lo_cojan':
      return minutos == null ? 'Esperando a que alguien lo coja'
                             : `Esperando a que alguien lo coja · ${minutos} min`
    case 'listo_sin_salir':
      return minutos == null ? 'Listo, esperando al repartidor'
                             : `Listo, esperando al repartidor · ${minutos} min`
    case 'lo_recoge_el_cliente':
      return minutos == null ? 'Listo, esperando a que lo recojan'
                             : `Listo, esperando a que lo recojan · ${minutos} min`
    case 'en_ruta':
      return minutos == null ? 'Salió hace un momento' : `Salió hace ${minutos} min`
    case 'entregado':
      return minutos == null ? 'Entregado' : `Entregado hace ${minutos} min`
  }
}

/**
 * LO QUE NO SABEMOS, DICHO. Sólo aparece donde de verdad no lo sabemos.
 *
 * Y la palabra de la plataforma es «se cierra la comanda en caja», no
 * «entregado» ni «completado por Glovo»: ese `completed` lo escribe
 * `lastapp-webhook` cuando el local cierra la comanda --mediana 6,4 min en
 * Glovo desde el «Listo»--, y no es la plataforma diciendo que el cliente lo
 * tiene.
 */
export function loQueNoSabemos(p: PedidoDelPase): string | null {
  switch (laSituacion(p)) {
    case 'esperando_rider_plataforma':
      // 🔴 Dos correcciones del 16/09, las dos porque la frase había dejado de
      // ser verdad:
      //
      // 1 · SOLO si de verdad no lo sabemos. Uber por HubRise sí manda la
      //     recogida --71 de 71-- desde que se desplegó el sello. A U8C4DE le
      //     salía «Uber no nos dice cuándo sale» mientras Uber nos lo estaba
      //     diciendo. Ahora lo decide `sabemosSuCiclo`, no el tipo de reparto.
      // 2 · FUERA «la tarjeta se va sola cuando se cierre la comanda en caja»:
      //     ese cierre ya no es un botón de cocina y la frase describía un
      //     mundo que ya no existe. Una nota de pantalla que envejece mal es
      //     peor que ninguna, porque el operario deja de creerse las demás.
      if (sabemosSuCiclo(p)) return null
      return `${quienReparte(p)} no nos dice cuándo sale ni cuándo llega.`
    case 'esperando_que_lo_cojan':
      return 'Lo marca quien se lo lleve, desde su móvil. Aquí no se toca.'
    case 'lo_recoge_el_cliente':
      return 'Viene el cliente a por ello. Nadie lo va a marcar.'
    default:
      return null
  }
}

/** El tono del renglón de estado. Ámbar avisa; no hay rojos parpadeando. */
export type Tono = 'neutro' | 'bien' | 'aviso' | 'mal'

/** A partir de estos minutos, el renglón se pone ámbar. Medido: 15 min de media. */
export const MINUTOS_DE_MAS_EN_RUTA = 30
export const MINUTOS_DE_MAS_SIN_COGER = 15
/**
 * Lo que ya está HECHO y espera a que se lo lleven. Decisión de Julio, 16/09.
 * No es el semáforo de cocina: aquí no se cocina, se espera.
 *
 * 🔴 Vive aquí y no en `lasFases` --donde estaba-- porque el Pase lo necesita
 * igual: U8C4DE llevaba 24 minutos hecho y la bolsa no se ponía ámbar. Un
 * número en dos ficheros es un número que un día dice dos cosas.
 */
export const MINUTOS_DE_ESPERA_EN_AMBAR = 20

/**
 * ─────────────────────────────────────────────────────────────────────────
 * A LOS 30 MINUTOS, LA BOLSA DEL GRUPO 2 SE VA SOLA · 16/09/2026
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Decisión de Julio al ver la maqueta: G265 llevaba 39 minutos desde el «Listo»
 * y U511 31, y los dos seguían en «Sigue aquí» sin que nadie pudiera hacer nada
 * con ellos. De un pedido del grupo 2 no va a llegar ningún aviso NUNCA, así
 * que la tarjeta no espera nada: sólo ocupa sitio delante de las que sí.
 *
 * 🔴 NO ESCRIBE NADA EN LA VENTA. Irse de la pantalla no es un hecho del
 * pedido: es que esta pantalla ya no tiene nada que decir de él. En Pedidos
 * sigue estando, en Terminados, con su «Listo HH:MM · sin seguimiento».
 *
 * 🔴 Y NO SE VA EN SILENCIO (regla 7). El pie de la zona cuenta cuántas se han
 * ido solas y deja ver cuáles. Un umbral ordena; no esconde. Si desapareciera
 * sin decirlo, el del pase aprendería que las bolsas se evaporan, y a partir de
 * ahí dejaría de creerse la pantalla entera.
 *
 * Sólo el grupo 2: una del grupo 1 se queda hasta que llegue su recogida, que
 * es lo que estamos esperando.
 */
export const MINUTOS_PARA_IRSE_SOLA = 30

/** ¿Esta bolsa ya no pinta nada en el Pase? Ver `MINUTOS_PARA_IRSE_SOLA`. */
export function seVaSola(p: PedidoDelPase, ahora: Date = new Date()): boolean {
  if (laZona(p) !== 'sigue_aqui') return false
  if (sabemosSuCiclo(p)) return false
  if (!estaMarcadoListo(p)) return false
  const min = losMinutos(p, ahora)
  return min != null && min >= MINUTOS_PARA_IRSE_SOLA
}

/**
 * DESDE CUÁNDO SE CUENTA, que no es lo mismo en cada zona.
 *
 * 🔴 Esto vive aquí y no en la RPC a propósito. El reloj que toca depende de la
 * SITUACIÓN, y la situación se decide en este fichero: si la base calculara los
 * minutos tendría que decidir la situación otra vez, y una regla en dos sitios
 * es una regla que un día dice dos cosas.
 *
 * La base manda los instantes en crudo; aquí se elige cuál.
 *
 * Y el de «en ruta» tiene truco medido: `handed_to_courier_at` viene en NULL
 * muchas veces --Catcher casi nunca lo manda-- así que el respaldo es
 * `ready_at`, que es lo que ya hace la fila de reparto de la tarjeta de hoy.
 */
export function losMinutos(p: PedidoDelPase, ahora: Date = new Date()): number | null {
  const desde = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return null
    return Math.max(0, Math.round((ahora.getTime() - t) / 60_000))
  }
  switch (laSituacion(p)) {
    case 'entregado':
      return desde(p.delivered_at)
    case 'en_ruta':
      return desde(p.handed_to_courier_at) ?? desde(p.ready_at)
    case 'esperando_que_lo_cojan':
    case 'esperando_rider_plataforma':
    case 'listo_sin_salir':
    case 'lo_recoge_el_cliente':
      return desde(p.ready_at)
    case 'por_marcar':
      return desde(p.entro_at)
  }
}

export function elTono(p: PedidoDelPase, minutos: number | null): Tono {
  const s = laSituacion(p)
  if (s === 'entregado') return 'bien'
  if (s === 'en_ruta') {
    return minutos != null && minutos > MINUTOS_DE_MAS_EN_RUTA ? 'aviso' : 'bien'
  }
  if (s === 'esperando_que_lo_cojan' || s === 'lo_recoge_el_cliente') {
    return minutos != null && minutos > MINUTOS_DE_MAS_SIN_COGER ? 'aviso' : 'neutro'
  }
  // 🔴 LO QUE ESPERA A UN RIDER TAMBIÉN AVISA (16/09). Antes devolvía 'neutro'
  // siempre, así que una bolsa podía llevar media hora hecha sin que la pantalla
  // lo dijera. U8C4DE llevaba 24 minutos y estaba en gris.
  if (s === 'esperando_rider_plataforma' || s === 'listo_sin_salir') {
    return minutos != null && minutos > MINUTOS_DE_ESPERA_EN_AMBAR ? 'aviso' : 'neutro'
  }
  return 'neutro'
}

// ── QUIÉN LO LLEVA ────────────────────────────────────────────────────────
//
// La pregunta que hace el pase en voz alta cuando suena el timbre: «¿este de
// quién es?». Hoy la tarjeta no la contesta, y la contesta mal quien adivina.
//
// 🔴 VIVE AQUÍ Y NO EN `pase_board` A PROPÓSITO, por lo mismo que `losMinutos`:
// es una FRASE derivada de canal + `service_type` + `carrier_code`, no un dato.
// La base ya manda los tres en crudo. Escribirla también en SQL sería la misma
// regla en dos sitios, y una regla en dos sitios es una regla que un día dice
// dos cosas. Lo único que la base tiene y el front no tenía es el TELÉFONO del
// repartidor: eso sí es un campo nuevo, y ése sí se añade.

export interface QuienLoLleva {
  /** 🔴 NUNCA vacío (regla 32): si no se determina, se dice que no se sabe. */
  texto: string
  /** El nombre suelto, para la ficha. `null` = no lo tenemos. */
  nombre: string | null
  /** El teléfono del REPARTIDOR. `null` = no lo tenemos. Nunca el del cliente. */
  telefono: string | null
  /** true = esto no es un dato, es un aviso: se pinta en ámbar. */
  esAviso: boolean
}

/**
 * QUIÉN LO LLEVA, con las palabras que se usan en el pase.
 *
 * Los casos son los MEDIDOS (regla 31), 14 días de Foodint, 1.681 ventas:
 *
 *   1.424  plataforma           → «Lo reparte Glovo» · sin nombre ni teléfono
 *     231  propio con flota     → «Nuestro · Marta» · con nombre Y teléfono
 *      14  propio sin nadie     → AVISO: «Nuestro, y todavía no lo ha cogido…»
 *      12  recogida             → «Lo recoge el cliente»
 *       0  flota sin nombre     → «Nuestro, ya asignado» (no pasa hoy; no revienta)
 *
 * Y el último renglón es el que importa de verdad: hoy no ocurre, pero si un
 * día Catcher manda la asignación sin el nombre, la tarjeta dice lo que sabe
 * --que es nuestro y que hay alguien-- en vez de quedarse en blanco.
 */
export function quienLoLleva(p: PedidoDelPase): QuienLoLleva {
  const nombre = p.repartidor_nombre?.trim() || null
  const telefono = p.repartidor_telefono?.trim() || null

  if (esRecogida(p)) {
    return { texto: 'Lo recoge el cliente', nombre: null, telefono: null, esAviso: false }
  }

  if (loRepartelaPlataforma(p)) {
    // Medido: de 1.424 pedidos de plataforma, CERO traen nombre de repartidor.
    // Glovo y Uber no nos lo dicen, así que la tarjeta tampoco se lo inventa.
    return { texto: `Lo reparte ${quienReparte(p)}`, nombre, telefono, esAviso: false }
  }

  if (loRepartimosConFlota(p)) {
    // 🔴 «Nuestro, ya asignado» no decía QUIÉN (16/09). Cuando hay nombre se
    // pone, y mientras no haya recogido se dice hacia dónde va: el que está en
    // el pase necesita saber si el de la moto viene o ya se fue.
    const viene = p.handed_to_courier_at == null && p.delivered_at == null
    if (nombre) {
      return { texto: viene ? `Nuestro · ${nombre} · en camino al local` : `Nuestro · ${nombre}`,
               nombre, telefono, esAviso: false }
    }
    return { texto: 'Nuestro, ya asignado', nombre, telefono, esAviso: false }
  }

  if ((p.service_type ?? '').toLowerCase() === 'own_delivery') {
    // 14 en 14 días. No es un fallo del Pase: es un pedido nuestro que nadie ha
    // cogido, y el pase tiene que saberlo ANTES de que el cliente llame.
    return {
      texto: 'Nuestro, y todavía no lo ha cogido nadie',
      nombre: null, telefono: null, esAviso: true,
    }
  }

  // 🔴 EL SUELO DE LA REGLA 32. Hoy no se pisa --en 90 días `service_type` sólo
  // vale platform_delivery, own_delivery o pickup, y nunca null-- pero el día
  // que entre un cuarto valor la tarjeta dirá que no lo sabe, no una frase
  // bonita que resulte ser falsa.
  return { texto: 'No sabemos quién lo lleva', nombre, telefono, esAviso: true }
}
