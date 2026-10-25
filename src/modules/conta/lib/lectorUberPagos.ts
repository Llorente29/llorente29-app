// src/modules/conta/lib/lectorUberPagos.ts
//
// V02 · Entrega 2 · EL LECTOR DEL INFORME «DETALLES DEL PAGO» DE UBER EATS
// MANAGER (el agregado por tienda: Informes › Detalles del pago, exportado en
// CSV). Puro: ni red ni base. Lo que devuelve va, tienda a tienda, a
// conta_liquidacion_registrar (origen «informe»), la misma función que el
// correo semanal: la misma tienda y la misma semana no se duplican.
//
// La forma, medida en el informe de Julio (25/10, exportado del 24/10):
//   · dos filas de cabecera: una larga que explica cada columna y otra con su
//     nombre corto («Fecha de inicio», «Nombre de la tienda», «UUID del
//     negocio», «Pago total»…); se lee por el nombre corto, nunca por la posición;
//   · una fila por tienda y periodo (el del informe);
//   · la tienda se reconoce por «UUID del negocio» (su ID en Uber), NUNCA por su
//     nombre: el nombre va solo para enseñarlo y aprenderlo;
//   · los importes, con punto decimal y su signo: lo que Uber se queda, en negativo.
// Comprobado al céntimo en las 9 tiendas: Ventas (IVA incluido) + contracargo
// (IVA incluido) + promociones en artículos (IVA incluido) + comisión por canje
// de ofertas + su IVA + tasa de mercado después del descuento (IVA incluido) +
// otros pagos (IVA incluido) + … = Pago total.
//
// Lo que se registra de cada fila:
//   · ventas: total (IVA incluido), base e IVA;
//   · comision: lo que Uber cobra por su servicio (la tasa de mercado y la
//     comisión por canje de ofertas, con su IVA), en positivo;
//   · otros: todo lo demás que mueve el pago (promociones, contracargos,
//     anuncios, ajustes…), con su signo: así ventas − comisión + otros = neto;
//   · neto: «Pago total».
// La factura de comisión de Uber llega aparte, cada semana y para toda la
// cuenta (D07): aquí no se propone ninguna.

import { partirCsvPuntoYComa } from './lectorLiquidaciones'

export class NoEsInformeUber extends Error {}

export interface FilaInformeUber {
  desde: string
  hasta: string
  tienda: string
  tiendaId: string
  pedidos: number
  ventas: { total: number; base: number; iva: number }
  comision: number
  otros: number
  neto: number
}

/** Lo que va a conta_liquidacion_registrar. */
export interface DatosRegistrar {
  proveedor: string
  origen: string
  tienda: string | null
  tienda_id: string | null
  desde: string
  hasta: string
  pedidos: number | null
  ventas: { total: number; base?: number | null; iva?: number | null }
  comision: number
  otros: number
  neto: number
  referencia?: string | null
  pago_el?: string | null
  factura?: { numero: string | null; base: number; iva: number; total: number } | null
  intermediario?: { nombre: string; nif: string | null } | null
  avisos?: string[]
}

const r2 = (x: number): number => Math.round(x * 100) / 100
const quitar = (s: string): string => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

/** Las columnas que se leen, por su nombre corto (sin tildes ni espacios de más). */
const COL = {
  desde: 'fecha de inicio',
  hasta: 'fecha de finalización',
  tienda: 'nombre de la tienda',
  uuid: 'uuid del negocio',
  pedidos: 'pedidos reservados',
  base: 'ventas (iva no incluido)',
  total: 'ventas (iva incluido)',
  tasa: 'tasa de mercado después del descuento (iva incluido)',
  canje: 'comisión por canje de ofertas',
  ivaCanje: 'iva sobre la comisión por canje de ofertas',
  pago: 'pago total',
} as const

/** ¿Es el informe? Por los nombres cortos de su segunda fila. */
export function esInformeUber(texto: string): boolean {
  const cabecera = quitar(texto.replace(/^\uFEFF/, '').slice(0, 12000))
  return cabecera.includes(COL.uuid) && cabecera.includes(COL.pago) && cabecera.includes(COL.tienda)
}

const num = (v: string | undefined): number => {
  const t = (v ?? '').trim()
  if (!t) return 0
  const n = Number(t.replace(/\s/g, ''))
  if (!Number.isFinite(n)) throw new NoEsInformeUber(`«${t}» no es un importe.`)
  return n
}

/** Lee el CSV del informe: una fila por tienda. */
export function leerInformeUber(texto: string): FilaInformeUber[] {
  const limpio = texto.replace(/^\uFEFF/, '')
  if (!esInformeUber(limpio)) throw new NoEsInformeUber('No es el informe «Detalles del pago» de Uber Eats Manager.')
  // Dos filas de cabecera: la de las explicaciones (con saltos de línea dentro
  // de las comillas) y la de los nombres cortos, que es la que vale.
  const filasBrutas = partirCsvPuntoYComa(limpio, ',')
  const iCab = filasBrutas.findIndex((r) => r.some((c) => quitar(c) === COL.uuid) && r.some((c) => quitar(c) === COL.pago))
  if (iCab < 0) throw new NoEsInformeUber('No es el informe «Detalles del pago» de Uber Eats Manager.')
  const cab = filasBrutas[iCab].map(quitar)
  const out: FilaInformeUber[] = []
  for (const r of filasBrutas.slice(iCab + 1)) {
    const f: Record<string, string> = Object.fromEntries(cab.map((h, i) => [h, (r[i] ?? '').trim()]))
    const tiendaId = (f[COL.uuid] ?? '').trim()
    if (!tiendaId) continue
    const desde = (f[COL.desde] ?? '').trim(); const hasta = (f[COL.hasta] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new NoEsInformeUber(`La tienda ${tiendaId} no trae su periodo.`)
    const total = num(f[COL.total]); const base = num(f[COL.base])
    const comision = r2(-(num(f[COL.tasa]) + num(f[COL.canje]) + num(f[COL.ivaCanje])))
    const neto = num(f[COL.pago])
    out.push({
      desde, hasta, tienda: (f[COL.tienda] ?? '').trim(), tiendaId, pedidos: Math.round(num(f[COL.pedidos])),
      ventas: { total: r2(total), base: r2(base), iva: r2(total - base) },
      comision, otros: r2(neto - total + comision), neto: r2(neto),
    })
  }
  if (!out.length) throw new NoEsInformeUber('El informe no trae ninguna tienda.')
  return out
}

/** Cada tienda del informe, como la registra la base. */
export const paraRegistrarInforme = (f: FilaInformeUber): DatosRegistrar => ({
  proveedor: 'uber', origen: 'informe', tienda: f.tienda || null, tienda_id: f.tiendaId, desde: f.desde, hasta: f.hasta,
  pedidos: f.pedidos, ventas: f.ventas, comision: f.comision, otros: f.otros, neto: f.neto,
})
