// tests/unit/modules/conta/portal/avisos.test.ts
//
// GP · Tarea 4 · Los cinco avisos por correo del portal (lo puro de
// supabase/functions/_shared/portal/avisos.ts). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { avisados, correoAviso, enlaceAviso, euros, eurosDe, fechaLarga, nombreMes, type Pendiente } from '../../../../../supabase/functions/_shared/portal/avisos'

const marca = { empresa: 'Gestoría Ejemplo', color: '#172443', logo: null, cliente: 'Cliente Ejemplo, S.L.', portal: 'https://app.sumied.com/', hoy: new Date('2026-11-09T10:00:00Z') }
const base = { clave: 'k', acceso_id: 'a', account_id: 'c', party_id: 'p', para: 'persona@ejemplo.invalid', nombre: 'Ana Ejemplo', permiso: 'todo' as const }
const fila = (tipo: Pendiente['tipo'], datos: Record<string, unknown>): Pendiente => ({ ...base, tipo, datos })
const PROHIBIDAS = /mandat|payment|sepa|papel/i

describe('los avisos del portal', () => {
  it('euros, meses y fechas, como en el portal', () => {
    expect(euros(18150)).toBe('181,50 €')
    expect(euros(123456789)).toBe('1.234.567,89 €')
    expect(eurosDe(181.5)).toBe('181,50 €')
    expect(nombreMes('2026-11', marca.hoy)).toBe('noviembre')
    expect(nombreMes('2025-12', marca.hoy)).toBe('diciembre de 2025')
    expect(fechaLarga('2026-11-05')).toBe('5 de noviembre')
  })

  it('cada botón va a su pestaña', () => {
    expect(enlaceAviso('https://app.sumied.com/', 'factura')).toBe('https://app.sumied.com/portal.html#facturas')
    expect(enlaceAviso('https://app.sumied.com', 'mensaje')).toBe('https://app.sumied.com/portal.html#mensajes')
    expect(enlaceAviso('https://app.sumied.com', 'devuelto')).toBe('https://app.sumied.com/portal.html#inicio')
  })

  it('factura nueva: número, fecha e importe', () => {
    const c = correoAviso(fila('factura', { numero: 'F-2026-0001', fecha: '2026-11-03', total: 181.5 }), marca)
    expect(c.asunto).toBe('Tienes una factura nueva de Gestoría Ejemplo (F-2026-0001)')
    expect(c.texto).toContain('Factura F-2026-0001 · 3 de noviembre · 181,50 €')
    expect(c.texto).toContain('Hola, Ana:')
    expect(c.html).toContain('Ver mis facturas')
    expect(c.html).toContain('Funciona con Sumied')
  })

  it('recibo próximo: el desglose, el total, cuándo se carga, por qué cambia y «No estoy de acuerdo»', () => {
    const c = correoAviso(fila('recibo_proximo', {
      mes: '2026-11', total_cent: 18150, anterior_cent: 15730, cargo_el: '2026-11-05',
      lineas: [{ texto: 'Contabilidad', importeCent: 12000 }, { texto: 'Nóminas', importe_cent: 6150 }],
      cambios: [{ texto: 'Un trabajador más' }],
    }), marca)
    expect(c.asunto).toBe('Tu recibo de noviembre: 181,50 €')
    expect(c.texto).toContain('se carga en tu cuenta el 5 de noviembre')
    expect(c.texto).toContain('Contabilidad · 120,00 €')
    expect(c.texto).toContain('Nóminas · 61,50 €')
    expect(c.texto).toContain('Total · 181,50 €')
    expect(c.texto).toContain('sube 24,20 €. Por qué cambia: Un trabajador más.')
    expect(c.texto).toContain('«No estoy de acuerdo»')
  })

  it('devuelto: cuánto y pagar', () => {
    const c = correoAviso(fila('devuelto', { mes: '2026-10', importe_cent: 18150 }), marca)
    expect(c.asunto).toBe('Tu recibo de octubre no se ha podido cobrar')
    expect(c.texto).toContain('de 181,50 €')
    expect(c.html).toContain('Pagar el recibo')
  })

  it('mensaje: quién y el principio, recortado', () => {
    const c = correoAviso(fila('mensaje', { cuantos: 2, autor: 'Laura Ejemplo', texto: 'x'.repeat(400), ids: ['m1', 'm2'] }), marca)
    expect(c.asunto).toBe('Gestoría Ejemplo te ha escrito 2 mensajes')
    expect(c.texto).toContain('Laura Ejemplo, de Gestoría Ejemplo, te ha escrito (2 mensajes):')
    expect(c.texto).toContain('x'.repeat(239) + '…')
    expect(avisados(fila('mensaje', { ids: ['m1', 'm2'] }))).toEqual({ mensajes: ['m1', 'm2'], peticiones: [] })
  })

  it('petición: qué, para cuándo y su botón', () => {
    const c = correoAviso(fila('peticion', { id: 'q1', tipo: 'firmar', titulo: 'Contrato de servicios', detalle: null, fecha_limite: '2026-11-15' }), marca)
    expect(c.asunto).toBe('Gestoría Ejemplo te pide que firmes: Contrato de servicios')
    expect(c.texto).toContain('Para el 15 de noviembre.')
    expect(c.html).toContain('>Firmar<')
    expect(avisados(fila('peticion', { id: 'q1' }))).toEqual({ mensajes: [], peticiones: ['q1'] })
    expect(avisados(fila('factura', { id: 'f1' }))).toEqual({ mensajes: [], peticiones: [] })
  })

  it('ninguno dice «mandato», «payment», «SEPA» ni «papel», y un tipo raro no sale', () => {
    const todos = [
      fila('factura', { numero: 'F1', total: 1 }), fila('recibo_proximo', { mes: '2026-11', total_cent: 1 }), fila('devuelto', { mes: '2026-11', importe_cent: 1 }),
      fila('mensaje', { texto: 'hola' }), fila('peticion', { tipo: 'subir', titulo: 'El modelo 036' }), fila('peticion', { tipo: 'contestar', titulo: 'Una duda' }),
    ]
    for (const p of todos) { const c = correoAviso(p, marca); expect(c.asunto + c.texto).not.toMatch(PROHIBIDAS) }
    expect(() => correoAviso(fila('otro' as Pendiente['tipo'], {}), marca)).toThrow()
  })
})
