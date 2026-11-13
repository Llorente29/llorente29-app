// src/modules/conta/lib/cierreSocio.ts
//
// S01p·18 · punto 4 (Julio, 12/11). El correo «Cierre del mes de …» del socio
// de marca trae sus cinco PDF. Desde la 0015 no entra en Compras: la puerta
// (conta-facturas-entrada) los deja en la bandeja como «liquidación», sin
// liquidación todavía, y aquí se juntan por correo para leerlos con su
// liquidación del mes (Ventas › Liquidaciones › Socios de marca). Sin React.

import { esCierreDelSocio } from '../../../../supabase/functions/_shared/queEs.ts'

export { esCierreDelSocio }

/** Una llegada de la bandeja (document_inbox), lo que hace falta de ella. */
export interface LlegadaCierre {
  id: string
  emailId: string
  asunto: string | null
  recibido: string | null
  nombre: string
  bucket: string
  ruta: string
}

/** Un cierre del socio que llegó por correo y aún no está con ninguna liquidación. */
export interface CierreDelCorreo {
  emailId: string
  asunto: string | null
  /** El día que llegó (AAAA-MM-DD). */
  recibido: string | null
  /** El mes que cierra (AAAA-MM-01). */
  mes: string
  ficheros: { nombre: string; bucket: string; ruta: string }[]
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const
const dos = (n: number) => String(n).padStart(2, '0')

/**
 * El mes que cierra: el que dice el asunto («Cierre del mes de octubre»), del año
 * en que llega (o del anterior, si el mes es posterior al de llegada: el de
 * diciembre llega en enero). Si el asunto no lo dice, el mes anterior al de llegada.
 */
export function mesDelCierre(asunto: string | null | undefined, recibido: string): string {
  const [a, m] = [Number(recibido.slice(0, 4)), Number(recibido.slice(5, 7))]
  const llano = (asunto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const dicho = MESES.findIndex((n) => new RegExp(`\\b(mes de |de )?${n}\\b`).test(llano)) + 1
  if (dicho > 0) return `${dicho > m ? a - 1 : a}-${dos(dicho)}-01`
  return m === 1 ? `${a - 1}-12-01` : `${a}-${dos(m - 1)}-01`
}

/** Las llegadas, juntas por correo; solo los correos que son el cierre del socio. Los más nuevos primero. */
export function cierresDelCorreo(xs: readonly LlegadaCierre[]): CierreDelCorreo[] {
  const porCorreo = new Map<string, LlegadaCierre[]>()
  for (const x of xs) porCorreo.set(x.emailId, [...(porCorreo.get(x.emailId) ?? []), x])
  const cierres: CierreDelCorreo[] = []
  for (const [emailId, ls] of porCorreo) {
    if (!esCierreDelSocio(ls.map((l) => l.nombre))) continue
    const recibido = ls.map((l) => l.recibido).filter((r): r is string => !!r).sort()[0]?.slice(0, 10) ?? null
    cierres.push({
      emailId, asunto: ls[0].asunto, recibido,
      mes: recibido ? mesDelCierre(ls[0].asunto, recibido) : '',
      ficheros: ls.map((l) => ({ nombre: l.nombre, bucket: l.bucket, ruta: l.ruta })).sort((x, y) => x.nombre.localeCompare(y.nombre)),
    })
  }
  return cierres.filter((c) => c.mes).sort((x, y) => (y.recibido ?? '').localeCompare(x.recibido ?? ''))
}

/** La frase del aviso: «El cierre de octubre llegó por correo el 05/11, con sus 5 PDF.» */
export function fraseCierre(c: Pick<CierreDelCorreo, 'mes' | 'recibido' | 'ficheros'>): string {
  const mes = MESES[Number(c.mes.slice(5, 7)) - 1] ?? 'su mes'
  const dia = c.recibido ? ` el ${c.recibido.slice(8, 10)}/${c.recibido.slice(5, 7)}` : ''
  const n = c.ficheros.length
  return `El cierre de ${mes} llegó por correo${dia}, con ${n === 1 ? 'su PDF' : `sus ${n} PDF`}.`
}
