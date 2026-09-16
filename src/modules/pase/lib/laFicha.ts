// src/modules/pase/lib/laFicha.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// LA HOJA DE DETALLE DEL PASE · 16/09/2026
// ─────────────────────────────────────────────────────────────────────────────
//
// Se decidió el 14/09 («La tablet del Pase») y se quedó fuera de la cola: la
// tarjeta salió a producción y la hoja no llegó a existir. Esto es la mitad
// que faltaba, y aquí vive SOLO lo que se puede razonar sin pintar: qué se
// puede llamar, qué no, y POR QUÉ no. El componente pinta; no decide.
//
// 🔴 LA REGLA QUE MANDA EN TODO EL FICHERO, y es la quinta de la maqueta:
// donde no hay dato, se escribe por qué. Ni un hueco. Un hueco en la tablet
// del pase se lee como «la tablet está rota» y el del pase deja de creérsela;
// una frase que diga «Glovo no nos manda el teléfono de su repartidor» se lee
// como lo que es, y nadie pierde dos minutos buscándolo.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUÉ HAY DE VERDAD EN CADA PEDIDO · medido el 16/09 sobre 14 días de Foodint,
// 1.669 ventas no anuladas. No es un reparto por canal a ojo: es el recuento.
//
//   origen · canal · servicio        n     tel.rider  tel.cli  código  dirección
//   ───────────────────────────────────────────────────────────────────────────
//   Last    · Glovo   · plataforma  844        0          0       0        0
//   Last    · Uber    · plataforma  350        0        350     350        0
//   HubRise · Glovo   · NUESTRO     222      215        221       0      218
//   HubRise · Uber    · plataforma  179        0        179     179        0
//   HubRise · Glovo   · plataforma   41        0          0       0        0
//   Last    · JustEat · plataforma   12        0         12      12        0
//   HubRise · JustEat · NUESTRO       6        6          6       6        6
//   Last    · JustEat · NUESTRO       4        0          4       4        4
//   recogidas (los tres canales)     11        0          6       6        0
//
// De ahí salen los cuatro casos de la hoja, y ninguno es una suposición:
//
//   1 · CENTRALITA CON CÓDIGO. Uber y JustEat, SIEMPRE: 350/350, 179/179,
//       12/12, 6/6, 4/4 y las 6 recogidas. El número es único para todos los
//       pedidos y lo que identifica al cliente es el código. Por eso el código
//       va ESCRITO Y GRANDE además de ir en la marcación: si la centralita no
//       traga los tonos, la persona lo teclea, y para eso tiene que verlo.
//   2 · GLOVO CUANDO REPARTE GLOVO: cero teléfono de cliente en 885 pedidos
//       (844 + 41). No es que falte: no nos lo mandan nunca.
//   3 · GLOVO/JUSTEAT CUANDO LO LLEVAMOS NOSOTROS: teléfono de verdad del
//       cliente (221 de 222) y dirección (218 de 222). Aquí sí se llama.
//   4 · EL REPARTIDOR ES NUESTRO O NO EXISTE: de 1.426 pedidos de plataforma,
//       CERO traen repartidor. De los 228 nuestros con flota, 221 traen
//       teléfono y 🔴 SIETE NO. Ese caso se dice --«lo lleva Marta, pero no
//       tenemos su teléfono»-- en vez de enseñar un botón muerto.
//
// ─────────────────────────────────────────────────────────────────────────────
// DÓNDE VIVE CADA COSA, y por qué no está todo en la RPC. El encargo pedía que
// `pase_ficha` devolviera también `quien_lo_lleva` y `cliente_explicacion`. No
// se hace, y es la misma razón que ya está escrita en `lasTresZonas.ts` para
// `quien_lo_lleva`: eso no son datos, son FRASES, y `quienLoLleva()` ya las
// arma desde canal + service_type + carrier_code. La misma regla en dos sitios
// es una regla que un día dice dos cosas: se cambia el texto en el front, la
// tarjeta y la hoja dicen cosas distintas del mismo pedido, y nadie sabe cuál
// creerse. La base manda DATOS (teléfono, código, marcación, horas); el front
// arma las frases, una sola vez, aquí.
//
// La marcación sí viaja armada desde la base, y no es una excepción caprichosa:
// `tel:+34910780961,,,38224128` no es una frase, es un identificador, y si un
// día lo arman dos sitios con pausas distintas la llamada falla en la mano de
// quien está sirviendo.

import {
  esRecogida, loRepartelaPlataforma, loRepartimosConFlota, quienReparte,
  type PedidoDelPase,
} from './lasTresZonas'

/**
 * Lo que devuelve `pase_ficha(token, venta)`. Extiende al pedido de la tarjeta
 * a propósito: las frases de quién lo lleva salen de los MISMOS campos en la
 * tarjeta y en la hoja, así que no pueden discrepar.
 */
export interface FichaDelPase extends PedidoDelPase {
  codigo: string | null
  marca: string | null
  marca_logo_url: string | null
  /** El del cliente. Nunca el del repartidor: son dos botones distintos. */
  cliente_nombre: string | null
  cliente_telefono: string | null
  /** El código de la centralita, tal y como lo manda el conector. */
  cliente_codigo: string | null
  /** `tel:` con las pausas ya puestas. Armado en la base (ver arriba). */
  cliente_marcacion: string | null
  accepted_at: string | null
  direccion: string | null
  notas: string | null
  /**
   * LO QUE SE FUE DE LA TARJETA Y TIENE QUE APARECER AQUÍ (17/09). Se quitaron
   * de la tarjeta porque son datos de CONSULTA --compiten por el sitio con lo
   * que se mira de lejos-- pero quitarlos de los dos sitios sería esconderlos,
   * que es justo lo que prohíbe la regla 7. Bajan de zona, no desaparecen.
   */
  bolsa?: { estado: 'hecha' | 'esperando' | 'rota' | 'sin_pedir'; cuando: string | null; intentos: number } | null
  /** 'flota' | 'persona' | 'foto'. Cómo avanzó, no quién pulsó. */
  avanzo_por?: string | null
  avanzo_quien?: string | null
}

/**
 * EL CÓDIGO DE LA CENTRALITA, LEGIBLE EN GRUPOS · 17/09/2026.
 *
 * El encargo pedía «de tres en tres en los dos». MEDIDO sobre 30 días, 1.061
 * códigos, resulta que no se puede, y el número manda sobre la instrucción:
 *
 *   Uber ..... 987 códigos · TODOS de 8 dígitos · TODOS ya agrupados «325 19 763»
 *   JustEat ...  74 códigos · TODOS de 9 dígitos · NINGUNO agrupado «464322807»
 *
 * Ocho dígitos no se parten en treses. Forzarlo daría «567 303 08», que es un
 * ritmo que Uber no usa en ningún sitio: quien esté comparando la tablet con
 * otra pantalla vería dos agrupaciones distintas del mismo número, que es
 * exactamente cómo se teclea un dígito de menos.
 *
 * Así que la regla es: **se respeta la agrupación que manda el conector, y al
 * que no manda ninguna se le pone de tres en tres**. Con los datos de hoy eso
 * deja Uber «567 30 308» y JustEat «878 795 717» --que es el 3-3-3 que pedía el
 * encargo, porque nueve dígitos sí se parten-- y los dos se leen en grupos.
 *
 * Queda dicho en el parte para que Julio decida si prefiere el otro reparto.
 */
export function elCodigoAgrupado(codigo: string | null | undefined): string | null {
  const c = (codigo ?? '').trim()
  if (!c) return null
  // Ya viene agrupado: no se toca. Es lo que enseña el canal en sus pantallas.
  if (/\s/.test(c)) return c
  if (!/^\d+$/.test(c)) return c
  return c.replace(/(\d{3})(?=\d)/g, '$1 ')
}

// ═════════════════════════════════════════════════════════════════════════════
// EL CÓDIGO DE LA ESQUINA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * El código corto para la esquina de la tarjeta. `J191403139` en crudo ocupa
 * media tarjeta y no se lee de un vistazo; `…3139` sí.
 *
 * 🔴 Y el largo NO se pierde: va entero en la cabecera de la hoja. Acortar en
 * la tarjeta es ordenar; acortar en los dos sitios sería esconder, que es
 * justo lo que prohíbe la regla 7.
 *
 * Medido sobre los códigos de 14 días: Glovo y Uber por Last son de 4 a 6
 * caracteres y salen enteros; los de Uber por HubRise, 6; los de JustEat, 10.
 */
export function elCodigoCorto(codigo: string | null | undefined): string | null {
  const c = (codigo ?? '').trim()
  if (!c) return null
  if (c.length <= 7) return c
  return `…${c.slice(-4)}`
}

// ═════════════════════════════════════════════════════════════════════════════
// LA PASTILLA DE QUIÉN LO LLEVA · va en la tarjeta, al lado del nombre
// ═════════════════════════════════════════════════════════════════════════════

export type TonoPastilla = 'nuestro' | 'plataforma' | 'aviso' | 'cliente'

export interface Pastilla { texto: string; tono: TonoPastilla }

/**
 * Corta, de una palabra si se puede: la tarjeta tiene que leerse de lejos y
 * con las manos ocupadas. La frase larga («Nuestro · Marta · en camino al
 * local») se queda para la hoja, que se abre a propósito.
 */
export function laPastilla(p: PedidoDelPase): Pastilla {
  if (esRecogida(p)) return { texto: 'Cliente', tono: 'cliente' }
  if (loRepartelaPlataforma(p)) return { texto: quienReparte(p), tono: 'plataforma' }
  if (loRepartimosConFlota(p)) return { texto: 'Nosotros', tono: 'nuestro' }
  if ((p.service_type ?? '').toLowerCase() === 'own_delivery') {
    return { texto: 'Sin coger', tono: 'aviso' }
  }
  return { texto: 'Sin saber', tono: 'aviso' }
}

// ═════════════════════════════════════════════════════════════════════════════
// LOS DOS BOTONES DE LLAMAR
// ═════════════════════════════════════════════════════════════════════════════

export interface Llamada {
  /** true = hay a quién llamar y el botón se pinta. */
  hay: boolean
  /** A quién, para el rótulo del botón. `null` = no lo sabemos. */
  nombre: string | null
  /** Lo que se marca. `null` cuando `hay` es false. */
  marcacion: string | null
  /** El número tal cual, para enseñarlo escrito debajo del botón. */
  numero: string | null
  /** El código de la centralita, escrito y grande. `null` = no hay centralita. */
  codigo: string | null
  /** La nota de la centralita, o el porqué de que no haya teléfono. Nunca vacío. */
  explicacion: string | null
}

/**
 * LLAMAR AL REPARTIDOR. Tres desenlaces, los tres medidos:
 *   · nuestro con teléfono ......... 221 de 228 → botón
 *   · nuestro con nombre y sin tel. ... 7 de 228 → se dice, sin botón
 *   · plataforma ................... 1.426 de 1.426 sin nada → se dice por qué
 */
export function llamarAlRepartidor(f: FichaDelPase): Llamada {
  const nombre = f.repartidor_nombre?.trim() || null
  const tel = f.repartidor_telefono?.trim() || null

  if (esRecogida(f)) {
    return {
      hay: false, nombre: null, marcacion: null, numero: null, codigo: null,
      explicacion: 'Este pedido lo recoge el cliente en el mostrador: no hay repartidor.',
    }
  }

  if (loRepartelaPlataforma(f)) {
    const quien = quienReparte(f)
    return {
      hay: false, nombre: null, marcacion: null, numero: null, codigo: null,
      explicacion: `${quien} no nos da el nombre ni el teléfono de su repartidor. `
                 + 'No es un fallo de la tablet: no nos lo mandan nunca.',
    }
  }

  if (tel) {
    return {
      hay: true, nombre, marcacion: `tel:${tel.replace(/\s+/g, '')}`, numero: tel,
      codigo: null, explicacion: null,
    }
  }

  if (nombre) {
    // 🔴 Siete en catorce días. Antes esto habría pintado un botón que no marca
    // nada, o peor, un hueco: se dice el nombre y se dice que falta el teléfono.
    return {
      hay: false, nombre, marcacion: null, numero: null, codigo: null,
      explicacion: `Lo lleva ${nombre}, pero de este pedido no nos ha llegado su teléfono. `
                 + 'Está en la ficha del repartidor, en la oficina.',
    }
  }

  return {
    hay: false, nombre: null, marcacion: null, numero: null, codigo: null,
    explicacion: 'No hay repartidor asignado, así que no hay a quién llamar. '
               + 'Lo marca quien se lo lleve, desde su móvil.',
  }
}

/**
 * LLAMAR AL CLIENTE. El discriminador de la centralita es TENER CÓDIGO, no ser
 * Uber: hoy coinciden --22 de 22 JustEat y 529 de 529 Uber traen código, y
 * Glovo ninguno de 1.107-- pero el día que Glovo empiece a dar centralita, o
 * que Uber deje de darla, el dato manda y la frase no se queda mintiendo.
 */
export function llamarAlCliente(f: FichaDelPase): Llamada {
  // 🔴 AQUÍ MANDA EL CANAL, NO QUIEN REPARTE, y lo cazó la prueba escrita
  // contra la población real (regla 31). `J191403139` es de JustEat y lo
  // llevamos NOSOTROS: con `quienReparte()` la frase salía «nosotros da un
  // número único para todos», que además de mal escrito es falso — la
  // centralita es de JustEat. Los 22 JustEat y los 529 Uber del periodo son de
  // su canal, repártalos quien los reparta.
  const canal = f.channel?.trim() || 'el canal'
  const nombre = f.cliente_nombre?.trim() || null
  const tel = f.cliente_telefono?.trim() || null
  const codigo = f.cliente_codigo?.trim() || null
  const marcacion = f.cliente_marcacion?.trim() || (tel ? `tel:${tel.replace(/\s+/g, '')}` : null)

  if (tel && codigo) {
    const agrupado = elCodigoAgrupado(codigo) ?? codigo
    return {
      hay: true, nombre, marcacion, numero: tel, codigo: agrupado,
      explicacion: `${canal} da un número único para todos y un código por pedido `
                 + `— éste es ${agrupado}. La tablet marca los dos seguidos. `
                 + 'El código caduca al entregarse el pedido.',
    }
  }

  if (tel) return { hay: true, nombre, marcacion, numero: tel, codigo: null, explicacion: null }

  // 885 pedidos en 14 días, todos de Glovo repartido por Glovo.
  return {
    hay: false, nombre, marcacion: null, numero: null, codigo: null,
    explicacion: `De este pedido ${canal} tampoco nos da el teléfono del cliente. `
               + `Si hay que avisarle, se hace desde el portal de ${canal}.`,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// LA LISTA DE DATOS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * La dirección, o por qué no la hay. Medido: de 1.426 pedidos de plataforma,
 * CERO traen dirección --la lleva la plataforma, que es quien reparte-- y de
 * los 228 nuestros, 228 la traen.
 */
export function laDireccion(f: FichaDelPase): string {
  const d = f.direccion?.trim()
  if (d) return d
  if (esRecogida(f)) return 'No hay dirección: el cliente viene a por ello.'
  if (loRepartelaPlataforma(f)) return `La dirección la lleva ${quienReparte(f)}.`
  return 'No nos ha llegado la dirección de este pedido.'
}

export interface Instante { etiqueta: string; hora: string | null }

/**
 * LOS CINCO TIEMPOS, en el orden en que pasan. Se devuelven TODOS, con los que
 * falten en `null`: un hueco con nombre («salió —») dice que ese hito no ha
 * pasado; una lista que se salta los vacíos deja creer que el pedido va más
 * adelantado de lo que va.
 */
export function losCincoTiempos(f: FichaDelPase, hhmm: (iso: string) => string): Instante[] {
  const h = (iso: string | null | undefined) => (iso ? hhmm(iso) : null)
  return [
    { etiqueta: 'Entró',     hora: h(f.entro_at) },
    { etiqueta: 'Aceptado',  hora: h(f.accepted_at) },
    { etiqueta: 'Listo',     hora: h(f.ready_at) },
    { etiqueta: 'Salió',     hora: h(f.handed_to_courier_at) },
    { etiqueta: 'Entregado', hora: h(f.delivered_at) },
  ]
}
