// src/modules/conta/lib/fichaLiquidacion.ts
//
// S01j·2 · Lo que no es pantalla de la ficha de una liquidación (maqueta 3):
// el título, de dónde salió y si sus cifras suman. Si no suman, se dice con
// los números (regla 7): la pantalla no rellena lo que falta.

import { eurosExactos } from '@/modules/conta/lib/formato'

export interface FichaLiquidacion {
  id: string; plataforma: string | null; canal_id: string; marca: string | null; local: string | null; local_id: string | null
  tienda: string | null; referencia: string | null
  desde: string | null; hasta: string | null; sin_periodo: boolean; origen: string | null
  pedidos: number | null; ventas: number | null; comision: number | null; otros: number | null; neto: number | null
  pago_el: string | null; cobrado_el: string | null; cobrado: number | null
  factura: { id: string; codigo: string | null; numero: string | null; fecha: string | null; base: number | null; iva: number | null; total: number | null; estado: string | null; en_revision: boolean | null } | null
  correo: { email_id: string; fecha: string; de: string | null; asunto: string | null; a: string | null; adjuntos: { nombre: string; porque?: string }[]; company_id: string | null } | null
  revisar: string | null
}

const n = (x: unknown): number | null => (x == null || x === '' ? null : Number(x))
/** Lo que devuelve la base, con los números como números. */
export function deLaBase(j: Record<string, unknown>): FichaLiquidacion {
  const f = j.factura as Record<string, unknown> | null
  return {
    ...(j as unknown as FichaLiquidacion),
    pedidos: n(j.pedidos), ventas: n(j.ventas), comision: n(j.comision), otros: n(j.otros), neto: n(j.neto), cobrado: n(j.cobrado),
    factura: f ? { ...(f as unknown as NonNullable<FichaLiquidacion['factura']>), base: n(f.base), iva: n(f.iva), total: n(f.total) } : null,
    correo: (j.correo as FichaLiquidacion['correo']) ?? null,
  }
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** «Glovo · Bendito Burrito · Camichi · del 01/10 al 15/10/2026», o con «sin periodo». */
export function tituloFicha(f: FichaLiquidacion): string {
  const quien = [f.plataforma ?? 'Liquidación', f.marca ?? f.tienda, f.local].filter(Boolean).join(' · ')
  if (f.sin_periodo || !f.desde || !f.hasta) return `${quien} · sin periodo`
  return `${quien} · del ${dm(f.desde)} al ${dma(f.hasta)}`
}

/** Si ventas + comisión + otros dan lo que te ingresa. Si falta alguna cifra, no se puede saber, y se dice. */
export function sumaFicha(f: FichaLiquidacion): { suma: boolean | null; texto: string | null } {
  if (f.ventas == null || f.neto == null) return { suma: null, texto: null }
  const calc = Math.round((f.ventas + (f.comision ?? 0) + (f.otros ?? 0)) * 100) / 100
  if (Math.abs(calc - f.neto) < 0.005) return { suma: true, texto: null }
  return {
    suma: false,
    texto: `Las cifras no suman: ventas ${eurosExactos(f.ventas)}, comisión ${eurosExactos(f.comision ?? 0)} y otros ${eurosExactos(f.otros ?? 0)} dan ${eurosExactos(calc)}, y la liquidación dice ${eurosExactos(f.neto)}. Míralo en su correo.`,
  }
}

/** De dónde salió: su correo (con sus adjuntos), o un fichero de antes, sin periodo. */
export function deDondeSalio(f: FichaLiquidacion): string {
  if (f.correo) {
    const excel = f.correo.adjuntos.find((a) => /\.xlsx?$/i.test(a.nombre))
    return `Del correo «${f.correo.asunto ?? 'sin asunto'}» que llegó${f.correo.a ? ` a ${f.correo.a}` : ''} de ${f.correo.de ?? 'alguien'}.`
      + (excel ? ` Su Excel ${excel.nombre} se quedó sin leer al llegar: vuelve a leer el correo.` : '')
  }
  if (f.sin_periodo) return 'Sin periodo: vino de un fichero antiguo (el CSV de antes). Cuando llegue el correo con este número, se le pone su periodo, su marca y su local; si no llega, se queda así.'
  return 'Se subió a mano: no salió de ningún correo.'
}
