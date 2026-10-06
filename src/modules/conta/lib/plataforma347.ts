// src/modules/conta/lib/plataforma347.ts
//
// C03 · Respuesta 2: el 347 de una plataforma de reparto según CÓMO vende,
// que lo dice su contrato. Folvy no lo asume: si no se ha dicho, lo pregunta.
//
// La norma (texto descargado en docs/conta/fuentes/textos/rd-1065-2007.txt,
// versión vigente desde el 01/01/2014):
//   · RD 1065/2007, art. 34.3, párrafo 1.º: «En las operaciones de mediación y
//     en las de agencia o comisión en las que el agente o comisionista actúe en
//     nombre ajeno, deberá declararse el importe total individualizado de las
//     contraprestaciones correspondientes a estas prestaciones de servicios».
//     → comisionista: la plataforma entra en el 347 como PROVEEDOR, por sus
//       comisiones (con su IVA, art. 34.2.a).
//   · Art. 34.3, párrafo 2.º: «Si el agente o comisionista actuase en nombre
//     propio, se entenderá que ha recibido y entregado o prestado por sí mismo
//     los correspondientes bienes o servicios» (y Ley 37/1992, art.
//     11.Dos.15.º). → revendedor: entra como CLIENTE, por las ventas.
//   · Art. 33.2.a: quedan fuera las operaciones por las que no se debió
//     «consignar los datos de identificación del destinatario»: las ventas a
//     consumidores con factura simplificada (ticket).
//
// El agente «Datos maestros e impuestos» aplica la misma regla
// (scripts/conta/lib/terceros.mjs, alcance347Plataforma); la prueba
// tests/conta/cumplimiento/terceros.test.ts comprueba que dicen lo mismo.

import { LIMITE_347 } from '@/modules/conta/lib/cuentasProveedor'
import { eurosExactos as euros } from '@/modules/conta/lib/formato'

export type ModeloPlataforma = 'comisionista' | 'revendedor'

export const MODELO_PLATAFORMA: Record<ModeloPlataforma, { corto: string; largo: string }> = {
  comisionista: { corto: 'Comisionista', largo: 'Vende en tu nombre: el pedido es entre tu restaurante y el cliente, y ella te cobra una comisión' },
  revendedor: { corto: 'Revendedor', largo: 'Te compra la comida y la revende en su nombre al cliente' },
}

export const CITA_347 = {
  comisionista: 'RD 1065/2007, art. 34.3 (comisionista en nombre ajeno: solo su comisión) y art. 33.2.a (tus ventas a consumidores, con ticket, no van)',
  revendedor: 'RD 1065/2007, art. 34.3, párrafo 2.º (en nombre propio: recibe y entrega por sí misma); Ley 37/1992, art. 11.Dos.15.º',
  sinDecir: 'RD 1065/2007, art. 34.3: depende de si actúa en nombre tuyo o en el suyo',
} as const

export type Alcance347 =
  | { como: 'sin_decir' }
  | { como: 'cliente'; entra: boolean; importe: number }
  | { como: 'proveedor'; entra: boolean | null; importe: number }

/**
 * A qué lado del 347 va una plataforma este año.
 * ventas: lo que vendió por ella (sus liquidaciones); comisiones: lo que le
 * cobró de comisión SIN IVA (lo que traen sus liquidaciones).
 * Comisionista: si la comisión sin IVA ya pasa del límite, entra; si con el IVA
 * general (21 %) podría pasar, «se ve con sus facturas» (entra = null).
 */
export function alcance347Plataforma(modelo: ModeloPlataforma | null, ventas: number, comisiones: number): Alcance347 {
  const centimos = (v: number) => Math.round(v * 100)
  if (!modelo) return { como: 'sin_decir' }
  if (modelo === 'revendedor') return { como: 'cliente', entra: centimos(ventas) > LIMITE_347, importe: ventas }
  const base = centimos(Math.abs(comisiones))
  const entra = base > LIMITE_347 ? true : Math.round(base * 1.21) > LIMITE_347 ? null : false
  return { como: 'proveedor', entra, importe: Math.abs(comisiones) }
}

/** La línea «347» de «Sus cuentas» para una plataforma: lo que dice, su cita, y si hay que preguntar. */
export function linea347Plataforma(modelo: ModeloPlataforma | null, ventas: number, comisiones: number): { texto: string; cita: string; pregunta: boolean } {
  const a = alcance347Plataforma(modelo, ventas, comisiones)
  if (a.como === 'sin_decir') {
    return { texto: 'Según su contrato: comisionista o revendedor. ¿Cuál es?', cita: CITA_347.sinDecir, pregunta: true }
  }
  if (a.como === 'cliente') {
    return {
      texto: a.entra ? `Entra en el 347 de ventas como cliente: ${euros(a.importe)} este año` : `No llega al 347 de ventas este año (${euros(a.importe)})`,
      cita: CITA_347.revendedor, pregunta: false,
    }
  }
  const texto = a.entra === true ? `Entra en el 347 como proveedor, por sus comisiones: ${euros(a.importe)} + IVA este año; tus ventas no`
    : a.entra === null ? `Puede entrar en el 347 como proveedor: ${euros(a.importe)} de comisiones + IVA; lo dirán sus facturas. Tus ventas no`
    : `No llega al 347 como proveedor (${euros(a.importe)} de comisiones + IVA); tus ventas no van`
  return { texto, cita: CITA_347.comisionista, pregunta: false }
}
