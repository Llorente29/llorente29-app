// GBd · El plan B, en pruebas: la red de la «Cuota mensual» (conta-bitrix-pestana/red.ts)
// y la sección de la ficha común (seccion.ts). Empresas e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  correoDeLaRed, cuandoEnMadrid, decidirRed, DEVOLUCIONES_SEGUIDAS, enlaceDeLaFicha, notaDeLaRed, quienDeLaRed, redEnEstePortal, resultadoDelCorreo,
} from '../../../../../supabase/functions/conta-bitrix-pestana/red'
import { camposDeSumied, fichaComunConSumied, ponerSeccionSumied, SECCION_SUMIED } from '../../../../../supabase/functions/conta-bitrix-pestana/seccion'
import { PORTAL_DE_PRUEBAS } from '../../../../../supabase/functions/conta-bitrix-pestana/puro'

describe('GBd · qué hace la red con la cuota de Bitrix24', () => {
  it('distinta de la de Sumied: se devuelve; el importe se compara, no el texto', () => {
    expect(decidirRed({ actual: '999', sumiedCent: 20000, recientes: 0 })).toEqual({ hacer: 'devolver', antes: '999,00', despues: '200,00' })
    expect(decidirRed({ actual: '', sumiedCent: 20000, recientes: 0 })).toEqual({ hacer: 'devolver', antes: 'vacía', despues: '200,00' })
    for (const igual of ['200', '200,00', '200,00 €', '200|EUR']) expect(decidirRed({ actual: igual, sumiedCent: 20000, recientes: 0 }).hacer).toBe('nada')
  })
  it('nuestra propia escritura vuelve a avisar: ya coincide y no se hace nada (sin bucle)', () => {
    const d = decidirRed({ actual: '999', sumiedCent: 20000, recientes: 0 })
    expect(d.hacer === 'devolver' && decidirRed({ actual: d.despues, sumiedCent: 20000, recientes: 1 })).toEqual({ hacer: 'nada', porque: 'coincide con Sumied' })
  })
  it('si algo la cambia sin parar, se para a las tres devoluciones en 10 minutos', () => {
    expect(DEVOLUCIONES_SEGUIDAS).toBe(3)
    expect(decidirRed({ actual: '999', sumiedCent: 20000, recientes: 2 }).hacer).toBe('devolver')
    expect(decidirRed({ actual: '999', sumiedCent: 20000, recientes: 3 }).hacer).toBe('parar')
  })
  it('sin cuota en Sumied (no se sabe, o 0): no se toca', () => {
    expect(decidirRed({ actual: '999', sumiedCent: null, recientes: 0 }).hacer).toBe('nada')
    expect(decidirRed({ actual: '150', sumiedCent: 0, recientes: 0 }).hacer).toBe('nada')
  })
  it('solo en el Bitrix24 de pruebas', () => {
    expect(redEnEstePortal(PORTAL_DE_PRUEBAS)).toBe(true)
    for (const p of ['qbo.bitrix24.es', '', null]) expect(redEnEstePortal(p)).toBe(false)
  })
})

describe('GBd · la nota, el correo y quién', () => {
  it('la nota del historial, como la pide el encargo', () => {
    expect(notaDeLaRed('999,00', '200,00')).toBe('Sumied deshizo un cambio en la Cuota mensual: 999,00 € → 200,00 €. Se cambia en la pestaña Sumied.')
  })
  it('quién: el que diga Bitrix24; si no lo dice, «no se sabe»', () => {
    expect([quienDeLaRed('Equipo Prueba'), quienDeLaRed(null), quienDeLaRed('  ')]).toEqual(['Equipo Prueba', 'no se sabe', 'no se sabe'])
  })
  it('el correo: asunto, arriba qué ha pasado, «Lo que pusiste / Lo que queda», dónde se cambia y el botón; sin jerga', () => {
    const c = correoDeLaRed({ empresa: 'Bodegas Prueba, S.L.', antes: '999,00', despues: '200,00', quien: 'Equipo Prueba', cuando: '12/11/2026 a las 10:05',
      enlace: enlaceDeLaFicha(PORTAL_DE_PRUEBAS, '12') })
    expect(c.asunto).toBe('Cambio deshecho en Bodegas Prueba, S.L.')
    expect(c.texto).toBe([
      'Sumied ha vuelto a poner la Cuota mensual de Bodegas Prueba, S.L.: la cambió Equipo Prueba el 12/11/2026 a las 10:05, y esa cuota la pone Sumied.', '',
      'Lo que pusiste: 999,00 €', 'Lo que queda: 200,00 €', '', 'Si hay que cambiarla, se cambia en la pestaña Sumied de la ficha.', '',
      'Abrir la ficha: https://b24-s3mr2y.bitrix24.es/crm/company/details/12/'].join('\n'))
    expect(c.html).toContain('>Abrir la ficha</a>')
    expect(c.html).toContain('Lo que pusiste')
    for (const jerga of [/UF_CRM/, /webhook/i, /evento/i, /sincroniz/i, /aviso de cambios/i]) {
      expect(c.html).not.toMatch(jerga)
      expect(c.texto).not.toMatch(jerga)
    }
  })
  it('la hora, la de Madrid', () => {
    expect(cuandoEnMadrid(new Date('2026-11-12T09:05:00Z'))).toBe('12/11/2026 a las 10:05')
  })
  it('Resend: enviado, sin cupo (429) o no enviado; nunca en silencio', () => {
    expect(resultadoDelCorreo(200, { id: 'x' })).toEqual({ correo: 'enviado', porque: null })
    expect(resultadoDelCorreo(429, { message: 'Daily quota exceeded' })).toEqual({ correo: 'cupo', porque: 'Resend no deja mandar más correos ahora (429): Daily quota exceeded.' })
    expect(resultadoDelCorreo(422, { message: 'Invalid' })).toEqual({ correo: 'no_enviado', porque: 'Resend contestó 422: Invalid.' })
  })
})

describe('GBd · la ficha común con la sección de Sumied', () => {
  const MAPA = { campos: [{ campo: 'cuota_referencia', codigo: 'UF_CRM_CUOTA_MENSUAL', etiqueta: 'Tarifa recurrente' }, { campo: 'cuota_referencia', codigo: 'UF_CRM_CUOTA_MENSUAL', etiqueta: 'Cuota mensual' }, { campo: 'nif', codigo: 'UF_CRM_NIF' }] }
  const MEDIDOS = { UF_CRM_TRABAJADORES: { formLabel: 'Trabajadores' }, UF_CRM_ESTADO_COBRO: { listLabel: 'Estado del cobro' }, UF_CRM_NIF: { formLabel: 'NIF' } }
  it('los campos de Sumied: la cuota del mapa, Trabajadores y Estado del cobro; el NIF no', () => {
    expect(camposDeSumied(MAPA, MEDIDOS)).toEqual(['UF_CRM_CUOTA_MENSUAL', 'UF_CRM_TRABAJADORES', 'UF_CRM_ESTADO_COBRO'])
    expect(camposDeSumied(null, null)).toEqual([])
  })
  it('van a su sección, la segunda; el resto, igual; dos veces da lo mismo que una', () => {
    const antes = [
      { name: 'main', title: 'Acerca de la compañía', type: 'section', elements: [{ name: 'TITLE' }, { name: 'UF_CRM_CUOTA_MENSUAL' }, { name: 'PHONE' }] },
      { name: 'additional', title: 'Más', type: 'section', elements: [{ name: 'UF_CRM_TRABAJADORES' }, { name: 'ASSIGNED_BY_ID' }] },
    ]
    const una = fichaComunConSumied(antes, ['UF_CRM_CUOTA_MENSUAL', 'UF_CRM_TRABAJADORES'])
    expect(una).toEqual([
      { name: 'main', title: 'Acerca de la compañía', type: 'section', elements: [{ name: 'TITLE' }, { name: 'PHONE' }] },
      { name: SECCION_SUMIED.name, title: 'Cuota y facturación (la pone Sumied)', type: 'section', elements: [{ name: 'UF_CRM_CUOTA_MENSUAL', optionFlags: 1 }, { name: 'UF_CRM_TRABAJADORES', optionFlags: 1 }] },
      { name: 'additional', title: 'Más', type: 'section', elements: [{ name: 'ASSIGNED_BY_ID' }] },
    ])
    expect(fichaComunConSumied(una, ['UF_CRM_CUOTA_MENSUAL', 'UF_CRM_TRABAJADORES'])).toEqual(una)
  })
  it('en cualquier otro portal (el real de QBO incluido): ninguna llamada a Bitrix24', async () => {
    for (const portal of ['qbo.bitrix24.es', '', null]) {
      const pedidas: string[] = []
      expect(await ponerSeccionSumied(portal, ['UF_CRM_CUOTA_MENSUAL'], async (m) => { pedidas.push(m); return { result: true } })).toEqual([])
      expect(pedidas).toEqual([])
    }
  })
  it('en el de pruebas: lee la ficha común, la guarda con la sección y pone la ayuda en cada campo', async () => {
    const pedidas: { m: string; c: Record<string, unknown> }[] = []
    const contesta: Record<string, unknown> = {
      'crm.company.details.configuration.get': { result: [{ name: 'main', title: 'Acerca de', type: 'section', elements: [{ name: 'TITLE' }, { name: 'UF_CRM_CUOTA_MENSUAL' }] }] },
      'crm.company.userfield.list': { result: [{ ID: '41' }] },
    }
    const fallos = await ponerSeccionSumied(PORTAL_DE_PRUEBAS, ['UF_CRM_CUOTA_MENSUAL'], async (m, c) => { pedidas.push({ m, c }); return contesta[m] ?? { result: true } })
    expect(fallos).toEqual([])
    expect(pedidas.map((p) => p.m)).toEqual(['crm.company.details.configuration.get', 'crm.company.details.configuration.set', 'crm.company.userfield.list', 'crm.company.userfield.update'])
    expect(pedidas[1].c.scope).toBe('C')
    expect((pedidas[3].c.fields as { HELP_MESSAGE: Record<string, string> }).HELP_MESSAGE.la).toBe('Lo pone Sumied. Se cambia en la pestaña Sumied.')
  })
  it('sin ficha común en Bitrix24: lo dice y no guarda nada', async () => {
    const pedidas: string[] = []
    expect(await ponerSeccionSumied(PORTAL_DE_PRUEBAS, ['UF_CRM_CUOTA_MENSUAL'], async (m) => { pedidas.push(m); return { result: [] } }))
      .toEqual(['ficha común: Bitrix24 no la ha dado'])
    expect(pedidas).toEqual(['crm.company.details.configuration.get'])
  })
})
