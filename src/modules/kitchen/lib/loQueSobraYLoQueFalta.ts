// src/modules/kitchen/lib/loQueSobraYLoQueFalta.ts
//
// EL CASTELLANO Y LAS REGLAS de la mitad que limpia. Encargo de Julio, 13/09.
//
// El gestor servía para construir y corregir. No servía para LIMPIAR, que era
// la otra mitad de «lo que le falte O LE SOBRE». Aquí viven las palabras de los
// dos montones, de la ficha de una respuesta y del diálogo de retirar.
//
// Vive en `lib/` y no en la página por lo de siempre: se lee y se prueba sin
// abrir un navegador, y no exporta componentes, que es lo que enfada al lint.

// ── Lo que llega de la base ────────────────────────────────────────────────

/** Una fila del montón de lo que FALTA. Va por NOMBRE, no por fila. */
export interface UnNombreSinDecidir {
  nombre: string
  /** En cuántas respuestas vive ese nombre sin decidir. */
  cuantas: number
  /** De ésas, cuántas están en marca propia y se pueden tocar. */
  alcanzables: number
  marcas: string[]
  /** El id por el que se entra a resolverlas todas. */
  entrarPor: string
}

/** Una fila del montón de lo que SOBRA. Va por FILA: retirar es de una fila. */
export interface UnaQueNadiePide {
  id: string
  nombre: string
  pregunta: string
  preguntaId: string
  marca: string
  cedida: boolean
  precio: number
  /** Pedidos ANULADOS en la ventana. El 0 de ventas nunca va solo. */
  pedidosAnulados: number
  ultimaVenta: string | null
  diasSinVenderse: number | null
  decidida: boolean
  decididaAt: string | null
  /** Decidida dentro de la ventana: baja al final, no se esconde. */
  decididaReciente: boolean
}

export interface LosDosMontones {
  dias: number
  falta: {
    respuestas: number
    alcanzables: number
    nombres: number
    filas: UnNombreSinDecidir[]
  }
  sobra: {
    respuestas: number
    candidatas: number
    alcanzables: number
    decididasHacePoco: number
    cedidas: number
    preguntas: number
    conPedidoAnulado: number
    filas: UnaQueNadiePide[]
  }
}

// ── LOS DOS MONTONES ───────────────────────────────────────────────────────

/**
 * El rótulo de cada montón. No son dos cifras de adorno: se pincha y se entra
 * a trabajar, así que el rótulo dice qué se va a hacer, no qué hay.
 */
export function tituloDeLoQueFalta(n: number): string {
  if (n === 0) return 'Todas dicen qué llevan'
  return n === 1 ? 'Le falta decir qué lleva · 1' : `Le falta decir qué lleva · ${n}`
}

export function tituloDeLoQueSobra(candidatas: number): string {
  if (candidatas === 0) return 'Todo lo de la carta se pide'
  return candidatas === 1 ? 'No lo pide nadie · 1' : `No lo pide nadie · ${candidatas}`
}

/**
 * La frase de debajo del montón que falta: por dónde empezar y cuánto rinde.
 *
 * El orden del montón es CUÁNTAS VECES SE REPITE EL NOMBRE, no el alfabético:
 * resolver «Salsa Harissa» resuelve 7 de una vez. Decirlo es lo que hace que
 * alguien empiece por ahí en vez de por la primera que ve.
 */
export function porDondeEmpezarLoQueFalta(filas: UnNombreSinDecidir[]): string | null {
  if (filas.length === 0) return null
  const p = filas[0]
  if (p.cuantas === 1) {
    return `Empezando por «${p.nombre}». Cada una se dice una vez.`
  }
  return `Empezando por «${p.nombre}», que está en ${p.cuantas} preguntas`
    + ` y se resuelve de una vez.`
}

/**
 * La frase de debajo del montón que sobra. Dice los TRES escalones, porque
 * ninguno se esconde (regla 7) y porque el total sin desglosar asusta sin
 * informar: de 123, sólo 52 son candidatas de verdad.
 */
export function elDesgloseDeLoQueSobra(
  s: LosDosMontones['sobra'] & { dias: number },
): string {
  const partes: string[] = []
  if (s.decididasHacePoco > 0) {
    partes.push(s.decididasHacePoco === 1
      ? '1 se decidió hace poco y está más abajo'
      : `${s.decididasHacePoco} se decidieron hace poco y están más abajo`)
  }
  if (s.cedidas > 0) {
    partes.push(s.cedidas === 1
      ? '1 es de una marca que manda Last'
      : `${s.cedidas} son de marcas que manda Last`)
  }
  if (partes.length === 0) return `Sin una sola venta en ${s.dias} días.`
  return `Sin una sola venta en ${s.dias} días. Además, ${partes.join(' y ')}.`
}

/** El rótulo del grupo de las que bajan. Con su número, no «algunas». */
export function rotuloDeLasDecididasHacePoco(n: number, dias: number): string {
  return n === 1
    ? `Decidida hace poco, aunque todavía no se pide — 1`
    : `Decididas en los últimos ${dias} días, aunque todavía no se piden — ${n}`
}

export const ROTULO_DE_LAS_CEDIDAS =
  'De marcas que manda Last: se ven y no se tocan'

/**
 * El día que las dos estén a cero, el gestor ha hecho su trabajo. Y esa frase
 * tiene que poder leerse EN LA PANTALLA, no sólo en el encargo.
 */
export function elDiaQueEsteTodoHecho(falta: number, candidatas: number): string | null {
  if (falta > 0 || candidatas > 0) return null
  return 'Las dos listas a cero: todas las respuestas dicen qué llevan y todas se piden.'
}

// ── UNA FILA DE LO QUE SOBRA ───────────────────────────────────────────────

/**
 * Cuánto lleva sin venderse, en palabras. Y el caso que importa: la que NO SE
 * HA VENDIDO NUNCA no es «hace 0 días», es otra cosa y se dice distinto.
 */
export function loQueLlevaSinVenderse(f: UnaQueNadiePide): string {
  if (f.diasSinVenderse === null) return 'Nunca se ha vendido'
  if (f.diasSinVenderse === 0) return 'La última vez, hoy'
  if (f.diasSinVenderse === 1) return 'La última vez, ayer'
  if (f.diasSinVenderse < 60) return `La última vez, hace ${f.diasSinVenderse} días`
  const meses = Math.round(f.diasSinVenderse / 30)
  return `La última vez, hace ${meses} meses`
}

/**
 * EL CERO NUNCA VA SOLO. Si hubo pedidos y se anularon, se dice: si no, quien
 * mire concluye que nadie la pidió jamás, y no es verdad.
 *
 * Es la diferencia entre los 86 del encargo y los 93 medidos: siete respuestas
 * cuya única actividad en 30 días es UNA comanda de HubRise anulada el 29/08.
 */
export function loDeLosPedidosAnulados(f: UnaQueNadiePide): string | null {
  if (f.pedidosAnulados === 0) return null
  return f.pedidosAnulados === 1
    ? 'Hubo 1 pedido con ella, y se anuló: no cuenta como venta'
    : `Hubo ${f.pedidosAnulados} pedidos con ella, y se anularon: no cuentan como ventas`
}

/** Cuándo se decidió, dicho con palabras y no con una fecha ISO. */
export function cuandoSeDecidio(f: UnaQueNadiePide, ahora = new Date()): string | null {
  if (!f.decidida || f.decididaAt === null) return null
  const horas = (ahora.getTime() - new Date(f.decididaAt).getTime()) / 3_600_000
  if (!Number.isFinite(horas) || horas < 0) return 'Alguien dijo qué lleva'
  if (horas < 1) return 'Alguien dijo qué lleva hace menos de una hora'
  if (horas < 24) {
    const h = Math.round(horas)
    return `Alguien dijo qué lleva hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  }
  const d = Math.round(horas / 24)
  return `Alguien dijo qué lleva hace ${d} ${d === 1 ? 'día' : 'días'}`
}

// ── RETIRAR: LA VERDAD DELANTE ─────────────────────────────────────────────

export interface LoQueSeVaARetirar {
  nombre: string
  /** En cuántas preguntas vive (contando ésta). */
  preguntas: number
  /** En cuántos platos aparece, sumando los de todas sus preguntas. */
  platos: number
  ventas: number
  dias: number
  cedida: boolean
  marca: string
}

/**
 * Lo que se dice ANTES de retirar. No es un «¿seguro?»: son los números.
 *
 * Julio, §3: «Retirar no es un botón rojo con un "¿seguro?". Antes de retirar,
 * la pantalla dice lo que va a pasar, con los números delante.»
 */
export function loQuePasaSiRetiras(x: LoQueSeVaARetirar): string {
  const donde = x.preguntas === 1 ? 'en 1 pregunta' : `en ${x.preguntas} preguntas`
  const platos = x.platos === 1 ? 'en 1 plato' : `en ${x.platos} platos`
  const pedida = x.ventas === 0
    ? `No se ha pedido ni una vez en ${x.dias} días.`
    : x.ventas === 1
      ? `Se ha pedido 1 vez en ${x.dias} días.`
      : `Se ha pedido ${x.ventas} veces en ${x.dias} días.`
  return `«${x.nombre.trim()}» está ${donde} y ${platos}. ${pedida}`
    + ' Si la retiras, desaparece de la carta en Glovo, Uber y la web'
    + ' con la próxima publicación.'
}

/**
 * SI SE HA VENDIDO, SE DICE MÁS FUERTE. No se impide —puede haber un motivo—
 * pero no puede costar lo mismo que retirar algo que nadie pide.
 */
export function elAvisoDeQueSeVende(x: LoQueSeVaARetirar): string | null {
  if (x.ventas === 0) return null
  return x.ventas === 1
    ? `Ojo: esto se pidió una vez este mes. Retirarlo se lo quita a quien lo pida.`
    : `Ojo: esto se pidió ${x.ventas} veces este mes. Retirarlo se lo quita a quien lo pida.`
}

/** En cedidas no se retira nada, y se dice con estas palabras. */
export function porQueNoSePuedeRetirar(x: { cedida: boolean; marca: string }): string | null {
  if (!x.cedida) return null
  return `La carta de ${x.marca} la manda Last y la reescribe cada noche:`
    + ' lo que retirases aquí volvería a las 03:20. Se cambia en Last.'
}

/** El botón, que dice lo que hace y a cuántas (regla 8). */
export function textoDelBotonDeRetirar(cuantas: number): string {
  if (cuantas <= 1) return 'Retirar de la carta'
  return `Retirar las ${cuantas} de la carta`
}

/** La confirmación: con contenido, no un visto. */
export function laConfirmacionDeRetirar(
  r: { respuestas: number; preguntas: number; pregunta: string | null; encendido: boolean },
): string {
  const q = r.respuestas === 1 ? '1 respuesta' : `${r.respuestas} respuestas`
  if (r.encendido) {
    return r.preguntas > 0 && r.pregunta
      ? `«${r.pregunta}» vuelve a la carta con ${q}. Sale con la próxima publicación.`
      : `${q} vuelve${r.respuestas === 1 ? '' : 'n'} a la carta. Sale con la próxima publicación.`
  }
  const base = r.preguntas > 0 && r.pregunta
    ? `«${r.pregunta}» retirada entera, con ${q}`
    : `${q} retirada${r.respuestas === 1 ? '' : 's'}`
  return `${base}. Queda con quién y cuándo, y se puede volver a encender.`
    + ' Desaparece de la carta con la próxima publicación.'
}

// ── LA FICHA DE UNA RESPUESTA ──────────────────────────────────────────────

export interface DondeVive {
  id: string
  pregunta: string
  preguntaId: string
  marca: string
  cedida: boolean
  activa: boolean
  esEsta: boolean
  platos: number
  decidida: boolean
}

/** «En 7 preguntas» — y se pincha, que es lo que lo separa de un adorno. */
export function laLineaDeDondeEsta(sitios: DondeVive[]): string {
  if (sitios.length <= 1) return 'Solo está en esta pregunta'
  const marcas = [...new Set(sitios.map((s) => s.marca))]
  const donde = sitios.length === 1 ? '1 pregunta' : `${sitios.length} preguntas`
  return marcas.length === 1
    ? `Está en ${donde} de ${marcas[0]}`
    : `Está en ${donde} de ${marcas.length} marcas: ${marcas.join(', ')}`
}

/** Cuántas de ésas siguen sin decir qué llevan: es lo que se puede resolver. */
export function cuantasDeAhiSiguenSinDecidir(sitios: DondeVive[]): number {
  return sitios.filter((s) => !s.decidida && !s.cedida).length
}

/** La línea de las ventas de la ficha. El 0 nunca va solo. */
export function laLineaDeCuantoSePide(
  v: { ventas: number; anuladas: number; dias: number },
): string {
  const base = v.ventas === 0
    ? `No se ha pedido en ${v.dias} días`
    : v.ventas === 1 ? `Se ha pedido 1 vez en ${v.dias} días`
    : `Se ha pedido ${v.ventas} veces en ${v.dias} días`
  if (v.anuladas === 0) return base
  const a = v.anuladas === 1 ? '1 pedido anulado' : `${v.anuladas} pedidos anulados`
  return `${base} · ${a}, que no cuenta${v.anuladas === 1 ? '' : 'n'} como venta`
}
