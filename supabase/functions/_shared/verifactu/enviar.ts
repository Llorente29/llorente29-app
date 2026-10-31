// supabase/functions/_shared/verifactu/enviar.ts
//
// V03 · E1 · UNA VUELTA DE LA COLA: toma lo que el control de flujo deja enviar
// (verifactu_cola_tomar), lo manda a Hacienda con el certificado y guarda lo que
// contesta (verifactu_cola_respuesta) o que no se pudo (verifactu_cola_fallo).
//
// Reglas (Orden HAC/1177/2024 y la respuesta 1 de Julio):
//   · como mucho 1.000 registros por envío, de un solo obligado, en el orden de
//     la cadena (lo garantiza la base al tomarlos);
//   · el siguiente envío del mismo NIF espera el TiempoEsperaEnvio que dijo
//     Hacienda (empieza en 60 s), salvo que haya 1.000 esperando (art. 16.2);
//   · si no se puede enviar, vuelve a la cola y se reintenta, como tarde, cada
//     hora (art. 16.4): lo hace verifactu_cola_fallo;
//   · nada se da por enviado sin su respuesta: lo que Hacienda no contesta
//     vuelve a la cola (lo hace verifactu_cola_respuesta).
//
// Un envío entero rechazado (Fault, los 4xxx) NO marca los registros como
// incorrectos: suele ser del certificado o del mensaje, no de la factura, y
// marcarlos obligaría a subsanar algo que no está mal. Vuelve a la cola, con su
// texto guardado, y si sigue así lo caza el aviso de atascados.
//
// En el registro de la función: solo recuentos y estados. Nunca el XML, ni el
// certificado, ni el CSV, ni un NIF.
//
// Núcleo sin Deno: la función conta-verifactu le pasa las piezas.

import type { MaterialCertificado } from '../certificados/mtls.ts'
import { EN_LA_DEMO } from '../puerta.ts'
import { EnvioRechazado, leerRespuesta, RespuestaIlegible } from './respuesta.ts'
import { type Registro, RegistroNoValido, sobreEnvio, type SistemaInformatico } from './xml.ts'

export type Entorno = 'pruebas' | 'real'

export interface Lote {
  envio_id: string
  entorno: Entorno
  nif_emisor: string
  company_id: string
  registros: Registro[]
}

export interface RespuestaHttp {
  status: number
  cuerpo: string
  ms: number
}

export interface Piezas {
  tomar: (entorno: Entorno, max: number) => Promise<Lote | null>
  responder: (envioId: string, p: Record<string, unknown>) => Promise<unknown>
  fallar: (envioId: string, error: string) => Promise<unknown>
  /** El certificado con el que se envía ese lote. Lanza si no lo hay o no es de ese NIF. */
  material: (lote: Lote) => Promise<MaterialCertificado>
  /** POST del sobre con el certificado (llamarConCertificado, con su tiempo límite). */
  llamar: (url: string, xml: string, material: MaterialCertificado) => Promise<RespuestaHttp>
  sistema: SistemaInformatico
  url: string
  /**
   * DM1 · PR 2a: ¿es de una cuenta de demo? (cuentaPuedeSalir, _shared/puerta.ts).
   * Si lo es, el lote NO va a Hacienda: se apunta como correcto, sin CSV y con
   * «En la demo no se envía de verdad», para que la pantalla lo enseñe hecho y
   * la cola no lo vuelva a intentar.
   */
  enLaDemo?: (lote: Lote) => Promise<boolean>
}

/** Lo que se apunta de un lote de demo: correcto, sin CSV y dicho. Nunca sale a Hacienda. */
export function respuestaDeLaDemo(lote: Lote): Record<string, unknown> {
  return {
    http_status: 200, estado_envio: 'Correcto', tiempo_espera_s: null, csv: null, respuesta: EN_LA_DEMO,
    registros: lote.registros.map((x) => ({ id: x.id, estado: 'Correcto', codigo: null, descripcion: EN_LA_DEMO })),
  }
}

export interface Resumen {
  envios: number
  registros: number
  correctos: number
  con_errores: number
  incorrectos: number
  vuelven: number
  fallos: { envio_id: string; motivo: string }[]
  /** DM1: lotes de demo, apuntados sin salir. */
  en_la_demo: number
}

/** Lo que se guarda de un fallo: el motivo y su texto, recortado (sin el material). */
function motivo(e: unknown): { clave: string; texto: string } {
  if (e instanceof EnvioRechazado) return { clave: `rechazado_${e.codigo ?? 'sin_codigo'}`, texto: `Hacienda rechazó el envío entero${e.codigo ? ` (${e.codigo})` : ''}: ${e.message}` }
  if (e instanceof RespuestaIlegible) return { clave: 'ilegible', texto: e.message }
  if (e instanceof RegistroNoValido) return { clave: 'registro_no_valido', texto: `El registro ${e.registroId}: ${e.message}` }
  const m = e instanceof Error ? e.message : String(e)
  const nombre = e instanceof Error ? e.name : 'Error'
  return { clave: nombre === 'LlamadaFallida' ? `llamada_${(e as { motivo?: string }).motivo ?? 'fallo'}` : nombre.toLowerCase(), texto: m }
}

/** Una vuelta: como mucho `maxEnvios` envíos (uno por NIF y flujo abierto). */
export async function unaVuelta(p: Piezas, entorno: Entorno, maxEnvios = 10): Promise<Resumen> {
  const r: Resumen = { envios: 0, registros: 0, correctos: 0, con_errores: 0, incorrectos: 0, vuelven: 0, fallos: [], en_la_demo: 0 }
  for (let i = 0; i < maxEnvios; i++) {
    const lote = await p.tomar(entorno, 1000)
    if (!lote || !lote.registros?.length) break
    r.envios++
    r.registros += lote.registros.length
    try {
      if (p.enLaDemo && await p.enLaDemo(lote)) {
        await p.responder(lote.envio_id, respuestaDeLaDemo(lote))
        r.en_la_demo++
        r.correctos += lote.registros.length
        continue
      }
      const obligado = { nombre: lote.registros[0].nombre_emisor, nif: lote.nif_emisor }
      const xml = sobreEnvio(obligado, lote.registros, p.sistema)
      const material = await p.material(lote)
      const http = await p.llamar(p.url, xml, material)
      const leido = leerRespuesta(http.cuerpo, lote.registros)
      await p.responder(lote.envio_id, {
        http_status: http.status, estado_envio: leido.estado_envio, tiempo_espera_s: leido.tiempo_espera_s,
        csv: leido.csv, respuesta: http.cuerpo, registros: leido.registros,
      })
      for (const l of leido.registros) {
        if (l.estado === 'Correcto') r.correctos++
        else if (l.estado === 'AceptadoConErrores') r.con_errores++
        else r.incorrectos++
      }
      r.vuelven += lote.registros.length - leido.registros.length
    } catch (e) {
      const m = motivo(e)
      await p.fallar(lote.envio_id, m.texto.slice(0, 2000))
      r.vuelven += lote.registros.length
      r.fallos.push({ envio_id: lote.envio_id, motivo: m.clave })
    }
  }
  return r
}
