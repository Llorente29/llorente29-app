// tests/unit/modules/conta/p01/resumenTrimestre.test.ts
//
// P01 · «Enviar resumen a los clientes», contra la respuesta REAL de
// conta_despacho_trimestre en staging (asesoría de demo, 3T de 2026, «hoy»
// 13/10, como Laura; fixtures/, regla 31): lo que recibe cada cliente, la
// plantilla resumen_trimestre de send-email y el freno, que la cierra también
// con Folvy hasta que Julio la abra.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  datosDelResumen, euros, importeParaElCliente, leerResumen, mensajeDelEnvio, nombreDelTrimestre,
  type ClienteDelTrimestre,
} from '../../../../../supabase/functions/_shared/resumenTrimestre'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'
import { PLANTILLAS_MARCA, cerrojoMarca } from '../../../../../supabase/functions/send-email/marca'

const T = JSON.parse(readFileSync(join(__dirname, 'fixtures/trimestre-staging-20261019.json'), 'utf8')) as { asesoria: string; clientes: ClienteDelTrimestre[] }
const de = (nombre: string) => {
  const c = T.clientes.find((x) => x.nombre.startsWith(nombre))
  if (!c) throw new Error(`no está ${nombre}`)
  return c
}
const resumen = (nombre: string) => datosDelResumen(T.asesoria, 2026, '3T', de(nombre))

describe('P01 · lo que recibe cada cliente', () => {
  it('Talleres: tres modelos revisados, en plazo, con su importe y el total', () => {
    const d = resumen('Talleres de Prueba Ruiz')
    expect(d.asesoria).toBe('Asesoría de Prueba Centro, S.L.')
    expect(d.cliente).toBe('Talleres de Prueba Ruiz, S.L.')
    expect(d.trimestre).toBe('3.er trimestre 2026')
    expect(d.filas.map((f) => f.modelo.split(' · ')[0])).toEqual(['303', '111', '115'])
    for (const f of d.filas) {
      expect(f.estado).toBe('Revisado; lo presentamos en plazo')
      expect(f.plazo).toBe('20/10')
      expect(f.importe).toMatch(/ € a ingresar$/)
    }
    expect(d.aIngresar).toBe('4.902,10 €')
    expect(d.aCompensar).toBeNull()
    expect(d.siguiente).toBe('Presentar 3 modelos')
  })
  it('Importaciones: los mensuales con su mes, presentados y sin plazo; lo compensado, aparte', () => {
    const d = resumen('Importaciones de Prueba Levante')
    expect(d.filas.map((f) => f.modelo)).toContain('303 · IVA de septiembre')
    const sep = d.filas.find((f) => f.modelo === '303 · IVA de septiembre')!
    expect(sep.estado).toMatch(/^Presentado/)
    expect(sep.plazo).toBe('—')
    expect(d.aCompensar).toBe('12.040,00 €')
  })
  it('Hostal: lo que aún se revisa se dice así, y el 202 con su pago', () => {
    const d = resumen('Hostal de Prueba Mayor')
    expect(d.filas[0]).toMatchObject({ modelo: '303 · IVA', estado: 'Lo estamos revisando', importe: '3.723,44 € a compensar' })
    expect(d.filas.some((f) => f.modelo === '202 · Pago fraccionado del Impuesto sobre Sociedades (2.º pago)' || /^202 · .*\(2\.º pago\)$/.test(f.modelo))).toBe(true)
  })
  it('todos los clientes de staging dan un resumen con filas y sin «undefined» ni «NaN»', () => {
    for (const c of T.clientes) {
      const d = datosDelResumen(T.asesoria, 2026, '3T', c)
      expect(d.filas.length).toBe(c.modelos.length)
      expect(JSON.stringify(d)).not.toMatch(/undefined|NaN|null €/)
    }
  })
  it('los importes, como la pantalla', () => {
    expect(euros(4902.1)).toBe('4.902,10 €')
    expect(euros(-3723.44)).toBe('3.723,44 €')
    expect(nombreDelTrimestre(2026, '4T')).toBe('4.º trimestre 2026')
    expect(importeParaElCliente({ modelo: '303', nombre: 'IVA', periodo: '3T', cadencia: 'quarterly', estado: 'presentado', resultado: 'zero', importe: 0, plazo_suyo: null, presentada: null })).toBe('Sin importe')
  })
})

describe('P01 · la plantilla resumen_trimestre', () => {
  it('existe, con el asunto y el contenido del cliente, escapado', () => {
    const d = resumen('Talleres de Prueba Ruiz')
    const c = PLANTILLAS_MARCA.resumen_trimestre(MARCAS.sumied, { ...d, cliente: 'Talleres <b>Ruiz</b>' })
    expect(c.subject).toBe('Tus impuestos del 3.er trimestre 2026 · Talleres <b>Ruiz</b>')
    expect(c.html).toContain('Talleres &lt;b&gt;Ruiz&lt;/b&gt;')
    expect(c.html).not.toContain('<b>Ruiz</b>')
    expect(c.html).toContain('4.902,10 €')
    expect(c.text).toContain('A ingresar en total: 4.902,10 €.')
    expect(c.text).toContain('responde a este correo: le llega a Asesoría de Prueba Centro, S.L.')
  })
})

describe('P01 · el freno del resumen', () => {
  it('cerrado con Sumied si no se ha abierto, y abierto solo a quien diga Julio', () => {
    expect(cerrojoMarca(MARCAS.sumied, 'resumen_trimestre', 'cliente@x.test', undefined).abierto).toBe(false)
    expect(cerrojoMarca(MARCAS.sumied, 'resumen_trimestre', 'julio@x.test', 'resumen_trimestre:julio@x.test')).toEqual({ abierto: true })
    expect(cerrojoMarca(MARCAS.sumied, 'resumen_trimestre', 'cliente@x.test', 'resumen_trimestre:julio@x.test').abierto).toBe(false)
  })
  it('cerrado también con Folvy (es nuevo: nunca ha salido), sin cerrar lo de siempre de Folvy', () => {
    expect(cerrojoMarca(MARCAS.folvy, 'resumen_trimestre', 'cliente@x.test', undefined).abierto).toBe(false)
    expect(cerrojoMarca(MARCAS.folvy, 'invitacion_asesoria', 'asesoria@x.test', undefined)).toEqual({ abierto: true })
  })
})

describe('P01 · lo que ve la asesoría al terminar (regla 8)', () => {
  it('cerrado: lo dice, y que no ha salido nada', () => {
    const cerrado = 'Los correos «resumen_trimestre» de Sumied están cerrados hasta que Julio los abra. No se ha mandado nada.'
    const m = mensajeDelEnvio([{ cliente: 'Talleres', como: 'cerrado', motivo: cerrado }, { cliente: 'Bar', como: 'cerrado', motivo: cerrado }])
    expect(m.ok).toBe(false)
    expect(m.mensaje).toMatch(/^Los correos «resumen_trimestre» de Sumied están cerrados hasta que Julio los abra\. No se ha mandado nada\./)
  })
  it('con contenido: a quién, a quién no y por qué', () => {
    const m = mensajeDelEnvio([
      { cliente: 'Talleres', como: 'enviado', a: 1 },
      { cliente: 'Bar', como: 'enviado', a: 1 },
      { cliente: 'Hostal', como: 'sin_correo' },
    ], 1)
    expect(m.ok).toBe(false)
    expect(m.mensaje).toBe('Mandado el resumen a 2 clientes: Talleres y Bar. Sin nadie a quien mandárselo (su cuenta no tiene administración con correo): Hostal. Uno de los elegidos ya no te da permiso o no está en este trimestre: a ese no se les ha mandado.')
    expect(mensajeDelEnvio([{ cliente: 'Talleres', como: 'enviado', a: 1 }])).toEqual({ ok: true, mensaje: 'Mandado el resumen a 1 cliente: Talleres.' })
  })
  it('abierto solo para la prueba: dice a quién ha salido y a quién no, sin esconder ninguno', () => {
    const solo = 'Los correos «resumen_trimestre» de Sumied solo están abiertos para la prueba, no para bar@x.test. No se ha mandado nada.'
    const m = mensajeDelEnvio([{ cliente: 'Talleres', como: 'enviado', a: 1 }, { cliente: 'Bar', como: 'cerrado', motivo: solo }])
    expect(m.ok).toBe(false)
    expect(m.mensaje).toBe(`Mandado el resumen a 1 cliente: Talleres. Cerrado todavía para Bar: ${solo}`)
  })
  it('el pedido, validado antes de mirar nada', () => {
    const id = 'd5ac0000-0000-4000-8000-0000000000a0'
    expect(leerResumen({ cuenta: id, ejercicio: 2026, periodo: '3T', empresas: [id, id] })).toEqual({ ok: true, p: { cuenta: id, ejercicio: 2026, periodo: '3T', empresas: [id], hoy: null } })
    expect(leerResumen({ cuenta: id, ejercicio: 2026, periodo: '3T', empresas: [] })).toEqual({ ok: false, mensaje: 'Elige al menos un cliente.' })
    expect(leerResumen({ cuenta: id, ejercicio: 2026, periodo: '5T', empresas: [id] }).ok).toBe(false)
  })
})
