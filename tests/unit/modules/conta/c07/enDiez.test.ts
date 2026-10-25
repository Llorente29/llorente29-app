// tests/unit/modules/conta/c07/enDiez.test.ts
//
// C07 · El detalle junto al número (Julio, 22/10): «En Diez · 4/1.234» o «No
// enviado · motivo · Reintentar»; con «Enviar a Diez» apagado, nada. Datos
// inventados.

import { describe, expect, it } from 'vitest'
import { detalleDiez, fraseDiez, motivoEnPalabras, type EnvioAsiento } from '@/modules/conta/lib/enDiez'

const a = (o: Partial<{ id: string; estado: string; origen: string; anuladoCon: string | null; fecha: string }> = {}) => ({ id: 'e1', estado: 'validado', origen: 'bank', anuladoCon: null, ...o })
const envio = (o: Partial<EnvioAsiento> = {}): EnvioAsiento => ({ status: 'enviado', serie: '4', numero: 1234, intentos: 1, error: null, documento: null, siguiente: null, ...o })
const ON = { encendido: true, ahora: new Date('2026-10-22T08:00:00Z') }

describe('apagado, o lo que no va a Diez: nada', () => {
  it('con el interruptor apagado no se dice nada, ni de lo que está en Diez', () => {
    expect(detalleDiez(a(), envio(), { encendido: false })).toBeNull()
    expect(detalleDiez(a(), envio({ status: 'pendiente', numero: null, error: 'x' }), { encendido: false })).toBeNull()
  })
  it('lo propuesto, lo traído de Diez, la apertura y el cierre: nada', () => {
    expect(detalleDiez(a({ estado: 'propuesto' }), null, ON)).toBeNull()
    for (const origen of ['migrated', 'opening', 'closing', 'template']) expect(detalleDiez(a({ origen }), null, ON)).toBeNull()
  })
})

describe('validado', () => {
  it('en Diez: «En Diez · 4/1.234», en verde y sin botón', () => {
    expect(detalleDiez(a(), envio(), ON)).toEqual({ texto: 'En Diez · 4/1.234', motivo: null, tono: 'verde', reintentar: null, enDiez: true })
  })
  it('una venta en Diez sin su PDF: lo dice, en azul', () => {
    expect(detalleDiez(a({ origen: 'sales_day' }), envio({ serie: '1', documento: 'pendiente_diez' }), ON)?.texto).toBe('En Diez · 1/1.234 · PDF pendiente')
  })
  it('sin envío todavía: «No enviado», sale solo en unos minutos, y Reintentar', () => {
    expect(detalleDiez(a(), null, ON)).toMatchObject({ texto: 'No enviado', motivo: 'sale solo en unos minutos', reintentar: 'e1', enDiez: false })
  })
  it('falló: «No enviado · motivo · Reintentar», y cuándo lo vuelve a intentar el servidor', () => {
    const d = detalleDiez(a(), envio({ status: 'pendiente', numero: null, serie: null, error: 'la subcuenta 43000099 no está en Diez', siguiente: '2026-10-22T08:15:00Z' }), ON)!
    expect(d).toMatchObject({ texto: 'No enviado', tono: 'ambar', reintentar: 'e1' })
    expect(d.motivo).toBe('la subcuenta 43000099 no está en Diez · se vuelve a intentar a las 10:15')
    expect(fraseDiez(d)).toBe('No enviado · la subcuenta 43000099 no está en Diez · se vuelve a intentar a las 10:15')
  })
  it('con 3 intentos, sin Reintentar: lo mira una persona', () => {
    const d = detalleDiez(a(), envio({ status: 'pendiente', numero: null, error: 'Diez no ha aceptado el asiento', intentos: 3 }), ON)!
    expect(d.reintentar).toBeNull()
    expect(d.motivo).toMatch(/ya van 3 intentos/)
  })
  it('cortado a medias: en palabras, no «enviando»', () => {
    expect(motivoEnPalabras('enviando')).toMatch(/se cortó a medias/)
    expect(motivoEnPalabras('el envío empezó y no terminó: se cortó antes de escribir en Diez')).toMatch(/se cortó a medias/)
  })
})

describe('anulado', () => {
  it('anulado aquí y allí: «Anulado en Diez con 4/1.235»', () => {
    expect(detalleDiez(a({ estado: 'anulado', anuladoCon: 'r1' }), envio(), { ...ON, contraasiento: envio({ numero: 1235 }) })?.texto).toBe('Anulado en Diez con 4/1.235')
  })
  it('anulado aquí y no allí: lo dice, y Reintentar manda su contraasiento', () => {
    expect(detalleDiez(a({ estado: 'anulado', anuladoCon: 'r1' }), envio(), { ...ON, contraasiento: null })).toMatchObject({ texto: 'En Diez sigue 4/1.234 · falta anularlo', reintentar: 'r1', tono: 'ambar' })
  })
  it('anulado sin haber llegado nunca a Diez: nada que decir', () => {
    expect(detalleDiez(a({ estado: 'anulado', anuladoCon: 'r1' }), null, ON)).toBeNull()
  })
})

// C12 (24/10) · La empresa traspasa a Diez una vez al mes: nada se manda suelto.
describe('traspaso mensual', () => {
  const MES = { ...ON, mensual: true }
  // V01c (25/10): la misma pieza que Ventas › Facturas, con el mes de su fecha.
  it('validado y no en Diez: «En el traspaso de <mes>», en gris, sin «Reintentar», falle lo que falle antes', () => {
    const va = { texto: 'En el traspaso de octubre', motivo: null, tono: 'neutro', reintentar: null, enDiez: false }
    expect(detalleDiez(a({ fecha: '2026-10-24' }), null, MES)).toEqual(va)
    expect(detalleDiez(a({ fecha: '2026-10-24' }), envio({ status: 'pendiente', numero: null, error: 'Diez real está cerrado', intentos: 3 }), MES)).toEqual(va)
    expect(detalleDiez(a(), null, MES)?.texto).toBe('En el traspaso del mes')
  })
  it('lo que ya está en Diez, igual que antes', () => {
    expect(detalleDiez(a(), envio(), MES)?.texto).toBe('En Diez · 4/1.234')
  })
  it('anulado aquí y en Diez todavía: se anula en el traspaso, sin botón', () => {
    expect(detalleDiez(a({ estado: 'anulado', anuladoCon: 'r1' }), envio(), MES)).toEqual({ texto: 'En Diez sigue 4/1.234', motivo: 'se anula en el traspaso del mes', tono: 'neutro', reintentar: null, enDiez: true })
    expect(detalleDiez(a({ estado: 'anulado', anuladoCon: 'r1' }), envio(), { ...MES, contraasiento: envio({ numero: 1235 }) })?.texto).toBe('Anulado en Diez con 4/1.235')
  })
})
