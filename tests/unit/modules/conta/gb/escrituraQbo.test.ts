// tests/unit/modules/conta/gb/escrituraQbo.test.ts
//
// R18 (24/11) · En el Bitrix24 de QBO, Sumied solo ESCRIBE en la ficha de prueba (EMPRESA PRUEBA SUMIED,
// ID 1495) y solo con el interruptor «Actualizar Bitrix24» encendido (apagado de serie, lo enciende Julio).
// Toda llamada pasa por puro.ts · puedeLlamar antes de salir (conta-bitrix-pestana/index.ts: bitrix() y la red).

import { describe, expect, it } from 'vitest'
import { FICHAS_ESCRIBIBLES, PORTAL_DE_PRUEBAS, PORTAL_QBO, fichaDeLaLlamada, puedeLlamar } from '../../../../../supabase/functions/conta-bitrix-pestana/puro'

const actualizarCuota = (id: unknown) => ({ metodo: 'crm.company.update', cuerpo: { id, fields: { UF_CRM_CUOTA: '200,00' } } })
const nota = (id: unknown, tipo = 'company') => ({ metodo: 'crm.timeline.comment.add', cuerpo: { fields: { ENTITY_ID: id, ENTITY_TYPE: tipo, COMMENT: 'Sumied · prueba' } } })

describe('R18 · escribir en el Bitrix24 de QBO', () => {
  it('la única ficha en la que se puede escribir es la 1495, y solo en el portal de QBO', () => {
    expect(FICHAS_ESCRIBIBLES).toEqual({ [PORTAL_QBO]: ['1495'] })
  })

  it('con el interruptor encendido, la 1495 sí (la cuota y la nota del historial)', () => {
    expect(puedeLlamar({ portal: PORTAL_QBO, ...actualizarCuota('1495'), actualizar: true })).toEqual({ ok: true })
    expect(puedeLlamar({ portal: PORTAL_QBO, ...actualizarCuota(1495), actualizar: true })).toEqual({ ok: true })
    expect(puedeLlamar({ portal: PORTAL_QBO, ...nota(1495), actualizar: true })).toEqual({ ok: true })
  })

  it('cualquier otra ficha se rechaza, también con el interruptor encendido', () => {
    for (const id of ['1', '1494', '1496', '14950', '01495', 1, 2000]) {
      const r = puedeLlamar({ portal: PORTAL_QBO, ...actualizarCuota(id), actualizar: true })
      expect(r.ok, `ficha ${id}`).toBe(false)
      const n = puedeLlamar({ portal: PORTAL_QBO, ...nota(id), actualizar: true })
      expect(n.ok, `nota en ${id}`).toBe(false)
    }
    expect(puedeLlamar({ portal: PORTAL_QBO, ...actualizarCuota('1494'), actualizar: true })).toEqual({ ok: false, porque: 'la ficha 1494 no es la de prueba: no se toca' })
  })

  it('con el interruptor apagado no se escribe nada, ni en la 1495', () => {
    expect(puedeLlamar({ portal: PORTAL_QBO, ...actualizarCuota('1495'), actualizar: false }))
      .toEqual({ ok: false, porque: 'Bitrix24 no se actualiza: lo enciende Julio en Ajustes' })
    expect(puedeLlamar({ portal: PORTAL_QBO, ...nota('1495'), actualizar: false }).ok).toBe(false)
  })

  it('una escritura sin su ficha, o en un contacto con el mismo número, no sale', () => {
    expect(puedeLlamar({ portal: PORTAL_QBO, metodo: 'crm.company.update', cuerpo: { fields: {} }, actualizar: true }).ok).toBe(false)
    expect(puedeLlamar({ portal: PORTAL_QBO, metodo: 'crm.company.update', cuerpo: { id: '1495 OR 1' }, actualizar: true }).ok).toBe(false)
    expect(puedeLlamar({ portal: PORTAL_QBO, ...nota('1495', 'contact'), actualizar: true }).ok).toBe(false)
    // Lo que escribe y no es de una ficha (campos, secciones, tipos de campo): nunca.
    for (const metodo of ['crm.company.userfield.update', 'crm.company.details.configuration.set', 'userfieldtype.add', 'crm.company.add', 'crm.company.delete']) {
      expect(puedeLlamar({ portal: PORTAL_QBO, metodo, cuerpo: { id: '1495' }, actualizar: true }).ok, metodo).toBe(false)
    }
  })

  it('leer, siempre (en el portal de QBO); y enganchar la pestaña al reinstalar', () => {
    for (const metodo of ['app.info', 'user.current', 'crm.company.get', 'crm.company.fields', 'user.get']) {
      expect(puedeLlamar({ portal: PORTAL_QBO, metodo, cuerpo: { id: '7' }, actualizar: false })).toEqual({ ok: true })
    }
    expect(puedeLlamar({ portal: PORTAL_QBO, metodo: 'placement.bind', cuerpo: {}, actualizar: false })).toEqual({ ok: true })
  })

  it('en el portal de pruebas de antes, o en uno cualquiera, nada: ni leer', () => {
    for (const portal of [PORTAL_DE_PRUEBAS, 'servidor-ajeno.example.com', null]) {
      expect(puedeLlamar({ portal, metodo: 'crm.company.get', cuerpo: { id: '1495' }, actualizar: true })).toEqual({ ok: false, porque: 'portal no permitido' })
    }
  })

  it('de qué ficha es cada llamada que escribe', () => {
    expect(fichaDeLaLlamada('crm.company.update', { id: 1495 })).toEqual({ tipo: 'empresa', id: '1495' })
    expect(fichaDeLaLlamada('crm.timeline.comment.add', { fields: { ENTITY_ID: '1495', ENTITY_TYPE: 'COMPANY' } })).toEqual({ tipo: 'empresa', id: '1495' })
    expect(fichaDeLaLlamada('crm.timeline.comment.add', { fields: { ENTITY_ID: '9', ENTITY_TYPE: 'contact' } })).toEqual({ tipo: 'otra', id: '9' })
    expect(fichaDeLaLlamada('crm.company.add', { fields: {} })).toBeNull()
  })
})
