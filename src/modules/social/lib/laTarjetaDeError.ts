// src/modules/social/lib/laTarjetaDeError.ts
//
// LO QUE SE LE DICE AL DUEÑO DEL NEGOCIO CUANDO UNA PUBLICACIÓN NO SALE.
//
// Esto es lo que veía Julio en su pantalla hasta hoy, tal cual:
//
//   IG publish: {"message":"Media ID is not available","type":"OAuthException",
//   "code":9007,"error_subcode":2207027,"is_transient":false,
//   "error_user_title":"Cannot Publish", ... "fbtrace_id":"ALRlpRLSwaI4ndtlU9LeWVv"}
//
// El volcado en bruto de Meta, delante de los ojos del cliente. Y además no
// dice qué hacer. Esa tarjeta es exactamente lo que hace que una pantalla no
// se pueda enseñar.
//
// Aquí viven las frases. La base guarda una CLAVE (`error_kind`) y el volcado
// técnico (`last_error`); la frase la escribe este fichero y el volcado se va
// detrás de un «ver detalle»: que exista para quien lo arregla, no delante de
// quien no puede hacer nada con él.

/** Las claves que guarda `social_post.error_kind`. */
export type ClaseDeFallo =
  | 'esperando' | 'llave_caducada' | 'imagen_no_descargable' | 'rechazado' | 'otro'

export type TonoDeTarjeta = 'calma' | 'atencion' | 'malo'

export interface LaTarjeta {
  /** Lo que ha pasado, en una frase que se entiende sin preguntarle a nadie. */
  titulo: string
  /** Qué hacer. Vacío cuando no hay nada que hacer porque se arregla solo. */
  queHacer: string
  tono: TonoDeTarjeta
  /** Si es false, no es una avería: es una espera. Ni rojo ni alarma. */
  esUnFallo: boolean
  /** El único sitio al que ir, cuando lo hay. Uno, no tres. */
  aDonde: { texto: string; ruta: string } | null
}

/**
 * LA TARJETA, por clave.
 *
 * `esperando` va primero a propósito: es el caso que más veces se va a ver y
 * el único que NO es un problema. Diez publicaciones cayeron por esto desde el
 * 17/07 y nueve acabaron descartadas a mano — porque la pantalla las pintó
 * como averías cuando sólo había que esperar.
 */
export function laTarjetaDe(clase: ClaseDeFallo | null): LaTarjeta {
  switch (clase) {
    case 'esperando':
      return {
        titulo: 'Instagram aún estaba preparando la foto.',
        queHacer: 'Se reintenta solo en unos minutos.',
        tono: 'calma',
        esUnFallo: false,
        aDonde: null,
      }
    case 'llave_caducada':
      return {
        titulo: 'La conexión con Instagram ha caducado.',
        queHacer: 'Hay que renovarla.',
        tono: 'malo',
        esUnFallo: true,
        aDonde: { texto: 'Renovar la conexión', ruta: '/social/ajustes' },
      }
    case 'imagen_no_descargable':
      return {
        titulo: 'Instagram no ha podido descargar la imagen.',
        queHacer: 'Prueba a regenerar la imagen y vuelve a aprobar.',
        tono: 'atencion',
        esUnFallo: true,
        aDonde: null,
      }
    case 'rechazado':
      return {
        titulo: 'Instagram ha rechazado la publicación.',
        queHacer: 'Mira el detalle antes de reintentar: puede volver a pasar.',
        tono: 'atencion',
        esUnFallo: true,
        aDonde: null,
      }
    default:
      // `otro`, o una publicación vieja sin clave. No se le pone una etiqueta
      // bonita que no le toca: se dice que no se sabe, que es la verdad.
      return {
        titulo: 'La publicación no ha salido.',
        queHacer: 'Mira el detalle: ahí está lo que contestó Instagram.',
        tono: 'atencion',
        esUnFallo: true,
        aDonde: null,
      }
  }
}

/** El botón que abre el volcado. Nunca enseña el volcado sin pedirlo. */
export function textoDelDetalle(abierto: boolean): string {
  return abierto ? 'Ocultar detalle' : 'Ver detalle'
}

/**
 * EL PESO DE CADA BOTÓN. Reintentar es lo normal; descartar es la excepción y
 * tiene que notarse con la vista, sin leer.
 *
 * Y cuando sólo hay que esperar no se ofrece ninguno de los tres: ofrecer
 * «Reintentar» ahí invita a pelearse con algo que se arregla solo, y ofrecer
 * «Descartar» es justo cómo se perdieron las nueve.
 */
export type PesoDeBoton = 'principal' | 'normal' | 'discreto'
export interface BotonDeLaTarjeta { id: 'reintentar' | 'editar' | 'descartar'; texto: string; peso: PesoDeBoton }

export function losBotones(clase: ClaseDeFallo | null): BotonDeLaTarjeta[] {
  if (clase === 'esperando') return []
  return [
    { id: 'reintentar', texto: 'Reintentar',  peso: 'principal' },
    { id: 'editar',     texto: 'Editar',      peso: 'normal' },
    { id: 'descartar',  texto: 'Descartar',   peso: 'discreto' },
  ]
}

/**
 * ⚠️ LA QUE SE ESTÁ PUBLICANDO, Y LA QUE SE QUEDÓ ATASCADA.
 *
 * Hasta hoy la pantalla pintaba «Publicándose…» y NI UN BOTÓN para cualquier
 * fila en ese estado. Y `publishing` no tenía salida: ninguna función de la
 * base la devolvía a la cola, así que una publicación que se quedara ahí se
 * quedaba para siempre — visible, tranquilizadora y muerta. No es que
 * desapareciera: es que la pantalla decía algo bueno sobre una fila que ya no
 * iba a moverse. Misma familia que el «sin alertas» de Alcalá.
 *
 * Desde la v22 el publicador rescata solo las que lleven más de diez minutos
 * paradas. Esto es la otra mitad: que quien lo esté mirando lo VEA, y pueda
 * devolverla a la cola sin esperar al rescate.
 */
export interface LoQueSePublica {
  texto: string
  /** Si es true, la pantalla ofrece devolverla a la cola. */
  atascada: boolean
}

/** Lo que se considera «lleva demasiado». El publicador usa el mismo número. */
export const DEMASIADO_PUBLICANDOSE_MIN = 10

export function loQueSePublica(desdeIso: string | null, ahora: Date = new Date()): LoQueSePublica {
  if (!desdeIso) return { texto: 'Publicándose…', atascada: false }
  const min = Math.floor((ahora.getTime() - new Date(desdeIso).getTime()) / 60000)
  if (!Number.isFinite(min) || min < DEMASIADO_PUBLICANDOSE_MIN) {
    return { texto: 'Publicándose…', atascada: false }
  }
  return {
    texto: `Lleva ${min} minutos publicándose: eso es que se cortó a medias. `
      + 'Vuelve sola a la cola en la próxima pasada, o la devuelves tú ahora.',
    atascada: true,
  }
}

/**
 * Y CUÁNDO SE HA INTENTADO YA DEMASIADO. A los 5 intentos no la recoge nadie,
 * y eso hoy no se dice en ningún sitio: la publicación se queda quieta y quien
 * mira no sabe por qué.
 */
export function loDeLosIntentos(intentos: number, tope = 5): string | null {
  if (intentos <= 0) return null
  if (intentos < tope) {
    const quedan = tope - intentos
    return quedan === 1
      ? `Intentado ${intentos} veces. Queda 1 intento automático.`
      : `Intentado ${intentos} veces. Quedan ${quedan} intentos automáticos.`
  }
  return `Intentado ${intentos} veces: ya no se reintenta solo. Hay que darle a Reintentar.`
}
