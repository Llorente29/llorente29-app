// supabase/functions/_shared/certificados/mtls.ts
//
// I01a · 4 · UNA LLAMADA CON CERTIFICADO DE CLIENTE (mTLS), QUE TERMINA SIEMPRE.
//
// La prueba mTLS del 17/10 (docs/conta/i01/I01_prueba_mtls.md, rama
// conta/i01-prueba-mtls) dejó dos cosas para la versión de verdad:
//   1. Un tiempo límite en toda llamada con certificado: con una clave mala la
//      función se quedó colgada ~60 s sin contestar ni dejar rastro. Aquí, si no
//      contesta a tiempo, falla con un mensaje que se enseña (regla 8), y el
//      cliente se cierra pase lo que pase.
//   2. Validar el certificado y la clave al subirlos: eso es leerP12.ts.
//
// Sin certificado, el otro lado contesta HTTP (badssl daba 400): no es una
// excepción, es una respuesta, y la trata quien llama.
//
// Núcleo sin Deno: quien llama pasa cómo crear el cliente (en la función,
// Deno.createHttpClient). Nunca se escribe en el registro nada del material,
// ni las cabeceras ni el cuerpo: solo lo devuelve.

export interface MaterialCertificado {
  cert: string
  key: string
}

/** Lo que hace falta de Deno.HttpClient: cerrarlo. */
export interface ClienteHttp {
  close(): void
}

export interface Opciones {
  /** Deno.createHttpClient({ cert, key }) en la función; un doble en las pruebas. */
  crearCliente: (m: MaterialCertificado) => ClienteHttp
  /** fetch con { client }; en la función, el de Deno. */
  pedir: (url: string, init: RequestInit & { client: ClienteHttp }) => Promise<Response>
  /** Milisegundos antes de darla por perdida. */
  limiteMs?: number
}

export interface Respuesta {
  status: number
  cuerpo: string
  tipo: string | null
  ms: number
}

export type MotivoFallo = 'tiempo' | 'conexion' | 'certificado'

export class LlamadaFallida extends Error {
  readonly motivo: MotivoFallo
  readonly ms: number
  constructor(motivo: MotivoFallo, mensaje: string, ms: number) {
    super(mensaje)
    this.name = 'LlamadaFallida'
    this.motivo = motivo
    this.ms = ms
  }
}

export const LIMITE_MS = 30_000

/**
 * Hace la llamada con el certificado y devuelve la respuesta, o lanza
 * LlamadaFallida con un mensaje para la pantalla. El material no sale de aquí.
 */
export async function llamarConCertificado(material: MaterialCertificado, url: string, init: RequestInit, o: Opciones): Promise<Respuesta> {
  const limite = o.limiteMs ?? LIMITE_MS
  const empieza = Date.now()
  const n = Math.max(1, Math.round(limite / 1000))
  const segundos = `${n} ${n === 1 ? 'segundo' : 'segundos'}`
  let cliente: ClienteHttp | null = null
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    try {
      cliente = o.crearCliente(material)
    } catch {
      throw new LlamadaFallida('certificado', 'No se ha podido preparar la conexión con este certificado. Vuelve a subirlo; si se repite, puede que esté dañado.', Date.now() - empieza)
    }
    const corte = new AbortController()
    // Dos frenos: el de la propia petición y uno por fuera, por si lo que se
    // cuelga no escucha la señal (lo que pasó en la prueba mTLS).
    const plazo = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => {
        corte.abort()
        rechazar(new LlamadaFallida('tiempo', `Hacienda no ha contestado en ${segundos}. No sabemos si ha llegado: compruébalo antes de repetir.`, Date.now() - empieza))
      }, limite)
    })
    const peticion = (async () => {
      let r: Response
      try {
        r = await o.pedir(url, { ...init, client: cliente as ClienteHttp, signal: corte.signal })
      } catch (e) {
        if (e instanceof LlamadaFallida) throw e
        if (corte.signal.aborted) throw new LlamadaFallida('tiempo', `Hacienda no ha contestado en ${segundos}. No sabemos si ha llegado: compruébalo antes de repetir.`, Date.now() - empieza)
        throw new LlamadaFallida('conexion', 'Se ha cortado la conexión con Hacienda. Compruébalo antes de repetir.', Date.now() - empieza)
      }
      const cuerpo = await r.text()
      return { status: r.status, cuerpo, tipo: r.headers.get('content-type'), ms: Date.now() - empieza }
    })()
    // La que pierde la carrera no puede quedar rechazada sin recoger: en Deno tumba la función.
    peticion.catch(() => {})
    return await Promise.race([peticion, plazo])
  } finally {
    if (reloj !== undefined) clearTimeout(reloj)
    try { cliente?.close() } catch { /* cerrado ya */ }
  }
}
