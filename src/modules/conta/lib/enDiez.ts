// src/modules/conta/lib/enDiez.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · EL DETALLE JUNTO AL
// NÚMERO. Puro: lo usan el Libro diario (su fila) y la pantalla del asiento.
//
// Lo que pidió Julio: «el estado del envío es un detalle pequeño junto al
// número del asiento («En Diez · 0001234» o «No enviado · Reintentar»), no una
// sección»; «si un envío falla, el asiento queda validado y sale un aviso
// claro: No se ha enviado a Diez · motivo · Reintentar. Nada se pierde en
// silencio»; y con «Enviar a Diez» apagado, nada que hable de Diez.
//
// Por eso:
//   · apagado, o lo que no va a Diez (propuesto, traído de Diez, apertura,
//     cierre, plantillas): null, y no se pinta nada;
//   · validado y en Diez: «En Diez · 4/1.234» (con «· PDF pendiente» si la
//     factura va sin su PDF);
//   · validado y no en Diez: «No enviado» con su motivo y «Reintentar», o
//     «sale en unos minutos» si aún no lo ha intentado nadie;
//   · anulado: «Anulado en Diez con 4/1.235», o «En Diez sigue 4/1.234 · falta
//     anularlo» con «Reintentar» (que manda su contraasiento).
//   · C12 (24/10), la empresa traspasa una vez al mes: lo que no está en Diez
//     «Va en el traspaso del mes», sin «Reintentar» (no se manda nada suelto).
//     Lo que ya está, igual que antes.

import { miles } from '@/modules/conta/ui/tabla/tablaDensa'

/** Lo que se lee de external_send de un asiento. */
export interface EnvioAsiento {
  status: 'pendiente' | 'enviado' | 'enlazado' | 'rechazado'
  serie: string | null
  numero: number | null
  intentos: number
  error: string | null
  documento: 'pendiente' | 'adjunto' | 'fallo' | 'pendiente_diez' | null
  /** next_try_at: cuándo lo vuelve a intentar el servidor. */
  siguiente: string | null
}

export interface DetalleDiez {
  /** Lo corto, junto al número: «En Diez · 4/1.234», «No enviado». */
  texto: string
  /** El motivo, si no ha llegado (va al lado, en pequeño, y entero en el title). */
  motivo: string | null
  tono: 'verde' | 'azul' | 'ambar' | 'neutro'
  /** ¿Lleva «Reintentar»? Y qué asiento se manda al pulsarlo (el contraasiento, si falta anularlo). */
  reintentar: string | null
  enDiez: boolean
}

/** Los orígenes que no van nunca a Diez (diezApunte.ts, NO_VAN). */
const NO_VAN = new Set(['migrated', 'opening', 'closing', 'template'])
const MAX_INTENTOS = 3

const llego = (e: EnvioAsiento | null | undefined): boolean => !!e && (e.status === 'enviado' || e.status === 'enlazado') && e.numero != null
/** «4/1.234»: la serie siempre (las de Diez son 1, 2, 4 y 9: sin ella no se encuentra). */
export const numeroDiez = (e: { serie: string | null; numero: number | null }) => `${e.serie ?? '1'}/${miles(Number(e.numero))}`
const hora = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** Lo que dice el envío en palabras, sin las marcas internas. */
export function motivoEnPalabras(error: string | null): string | null {
  if (!error) return null
  if (error === 'enviando' || error.startsWith('el envío empezó y no terminó')) return 'el envío se cortó a medias: al reintentar se busca antes en Diez y no se manda otro'
  return error.replace(/\.$/, '')
}

export function detalleDiez(
  a: { id: string; estado: string; origen: string; anuladoCon?: string | null },
  envio: EnvioAsiento | null | undefined,
  o: { encendido: boolean; mensual?: boolean; contraasiento?: EnvioAsiento | null; ahora?: Date },
): DetalleDiez | null {
  if (!o.encendido) return null
  if (NO_VAN.has(a.origen)) return null
  if (a.estado === 'propuesto' || a.estado === 'borrador') return null

  if (a.estado === 'anulado') {
    if (!envio || !llego(envio)) return null
    const c = o.contraasiento
    if (c && llego(c)) return { texto: `Anulado en Diez con ${numeroDiez(c)}`, motivo: null, tono: 'neutro', reintentar: null, enDiez: true }
    if (o.mensual) return { texto: `En Diez sigue ${numeroDiez(envio)}`, motivo: 'se anula en el traspaso del mes', tono: 'neutro', reintentar: null, enDiez: true }
    const motivo = motivoEnPalabras(c?.error ?? null) ?? 'falta mandar su contraasiento'
    return { texto: `En Diez sigue ${numeroDiez(envio)} · falta anularlo`, motivo, tono: 'ambar', reintentar: a.anuladoCon ?? null, enDiez: true }
  }

  if (envio && llego(envio)) {
    if (envio.documento === 'pendiente_diez') return { texto: `En Diez · ${numeroDiez(envio)} · PDF pendiente`, motivo: null, tono: 'azul', reintentar: null, enDiez: true }
    if (envio.documento === 'fallo' || envio.documento === 'pendiente') {
      return { texto: 'No enviado', motivo: `la factura está en Diez (${numeroDiez(envio)}) pero falta su documento`, tono: 'ambar', reintentar: a.id, enDiez: false }
    }
    return { texto: `En Diez · ${numeroDiez(envio)}`, motivo: null, tono: 'verde', reintentar: null, enDiez: true }
  }

  if (o.mensual) return { texto: 'Va en el traspaso del mes', motivo: null, tono: 'neutro', reintentar: null, enDiez: false }
  const motivo = motivoEnPalabras(envio?.error ?? null)
  if (!envio || !motivo) {
    return { texto: 'No enviado', motivo: 'sale solo en unos minutos', tono: 'azul', reintentar: a.id, enDiez: false }
  }
  const agotado = envio.intentos >= MAX_INTENTOS
  const luego = !agotado && envio.siguiente && new Date(envio.siguiente) > (o.ahora ?? new Date()) ? ` · se vuelve a intentar a las ${hora(envio.siguiente)}` : ''
  return {
    texto: 'No enviado',
    motivo: agotado ? `${motivo} · ya van ${envio.intentos} intentos: míralo antes de reintentar` : `${motivo}${luego}`,
    tono: 'ambar', reintentar: agotado ? null : a.id, enDiez: false,
  }
}

/** La frase entera, para el title y el lector de pantalla. */
export const fraseDiez = (d: DetalleDiez) => (d.motivo ? `${d.texto} · ${d.motivo}` : d.texto)
