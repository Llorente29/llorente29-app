// B01 Revolut · PR 2c-2 · Lo que no es pantalla de «Pagar con Revolut»
// (src/modules/conta/pagos/pagarService.ts): lo que llega de la base, el titular
// y lo que dice la ficha de cada pago. Con lo que devuelven de verdad
// conta_pago_preparar y conta_pago_lote_ver (la 1234). Todo inventado (T11).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lineaDelPago, loteDe, preparadoDe, textoTitular } from '@/modules/conta/pagos/pagarService'

describe('preparadoDe', () => {
  it('lee el panel tal como lo devuelve conta_pago_preparar', () => {
    const p = preparadoDe({
      se_puede: true, porque: null, factura: 'f-1', numero: 'A-2026/0412', beneficiario: 'Suministros Norte S.L.', iban4: '1234', iban_check: 'primer_pago',
      iban_nota: null, importe: 1028.5, pendiente: 1028.5, concepto: 'A-2026/0412', motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'],
      salida: { proveedor: 'revolut', banco: 'Revolut', puede: true, porque: null },
      quien: { yo_puedo: true, soy_admin: true, n: 1, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: true }] },
    })
    expect(p).toMatchObject({ sePuede: true, importe: 1028.5, iban4: '1234', ibanCheck: 'primer_pago', motivosTexto: ['IBAN nuevo'] })
    expect(p.quien).toEqual({ yoPuedo: true, soyAdmin: true, segunda: 'la_misma', personas: [{ nombre: 'Persona Prueba', yo: true }] })
  })
  it('sin poder pagar, el porqué de la base, tal cual', () => {
    const p = preparadoDe({ se_puede: false, porque: 'Suministros Norte S.L. no tiene un IBAN válido en su ficha: pónselo antes de pagar.', salida: {}, quien: {} })
    expect(p.sePuede).toBe(false)
    expect(p.porque).toMatch(/no tiene un IBAN válido/)
    expect(p.quien.segunda).toBe('la_misma')
  })
})

describe('textoTitular (maqueta v2, pantallas 3 y 5)', () => {
  it('coincide, se parece con el nombre real, no coincide sin el nombre real', () => {
    expect(textoTitular({ resultado: 'coincide' }, 'Suministros Norte S.L.')).toEqual({ tono: 'ok', texto: '✓ Revolut dice que coincide' })
    expect(textoTitular({ resultado: 'se_parece', nombreReal: 'Suministros Norte SL' }, 'Suministros Norte S.L.').texto).toMatch(/«Suministros Norte SL»/)
    const no = textoTitular({ resultado: 'no_coincide' }, 'Carnes Inventadas S.A.')
    expect(no.tono).toBe('falta')
    expect(no.texto).toMatch(/^No se ha pagado: el titular de esa cuenta no es Carnes Inventadas S\.A\./)
    expect(no.texto).toMatch(/no nos dice de quién es/)
  })
  it('sin respuesta del banco, se dice y no se para', () => {
    expect(textoTitular(null, null).texto).toBe('Comprobando con Revolut…')
    expect(textoTitular({ resultado: 'ahora_no', porque: 'sin respuesta' }, null).tono).toBe('duda')
    expect(textoTitular({ resultado: 'no_se_puede', porque: 'IBAN de fuera de la zona' }, null).texto).toMatch(/no puede comprobar/)
  })
})

describe('lineaDelPago', () => {
  it('cada estado de un pago dice qué pasa y si sigue vivo (regla 8)', () => {
    expect(lineaDelPago({ estado: 'esperando_segunda', estadoPorque: null })).toMatchObject({ vivo: true, texto: expect.stringMatching(/esperando la segunda aprobación/) })
    expect(lineaDelPago({ estado: 'lista', estadoPorque: null })).toMatchObject({ vivo: true, texto: expect.stringMatching(/falta mandarlo a Revolut/) })
    expect(lineaDelPago({ estado: 'enviando', estadoPorque: null }).texto).toBe('Enviado a Revolut. Te avisamos cuando lo confirme.')
    expect(lineaDelPago({ estado: 'esperando_banco', estadoPorque: null }).texto).toMatch(/Esperando aprobación en Revolut/)
    expect(lineaDelPago({ estado: 'pagada', estadoPorque: null })).toMatchObject({ tono: 'ok', vivo: false })
    expect(lineaDelPago({ estado: 'rechazada', estadoPorque: 'Insufficient balance' })).toMatchObject({ tono: 'falta', vivo: false, texto: expect.stringMatching(/«Insufficient balance»/) })
    expect(lineaDelPago({ estado: 'cancelada', estadoPorque: 'No pagar' }).vivo).toBe(false)
  })
  it('los estados son los del CHECK de conta_pago_salida (la 1234), ni uno más ni uno menos', () => {
    const sql = readFileSync('supabase/migrations/20261101T1234_b01p_pagos_base.sql', 'utf8')
    const m = sql.match(/estado\s+text not null check \(estado in \(('esperando_segunda', 'lista'[^)]*)\)\)/)
    const estados = m![1].split(',').map((x) => x.trim().replace(/'/g, ''))
    for (const e of estados) expect(lineaDelPago({ estado: e, estadoPorque: null }).texto).not.toMatch(/^El pago está «/)
  })
})

describe('loteDe', () => {
  it('la lista exacta de la segunda aprobación, como la da conta_pago_lote_ver', () => {
    const l = loteDe({ lote: 'l-1', estado: 'esperando_segunda', huella: 'a'.repeat(64), creado: '2026-11-01T09:41:00Z', aprobado_por: 'Persona Prueba',
      desde: { nombre: 'Revolut · Principal', iban4: '5678', banco: 'Revolut' }, motivos: ['iban_nuevo'], motivos_texto: ['IBAN nuevo'],
      puedo_dar: true, no_puedo_porque: null, segunda: null, total: 1028.5,
      pagos: [{ id: 's-1', factura: 'f-1', concepto: 'A-2026/0412', beneficiario: 'Suministros Norte S.L.', iban4: '1234', iban_check: 'primer_pago', importe: 1028.5, estado: 'esperando_segunda', motivos_texto: ['IBAN nuevo'] }],
      historial: [{ at: '2026-11-01T09:41:00Z', por: 'Persona Prueba', texto: 'Aprueba pagar…' }] })
    expect(l).toMatchObject({ id: 'l-1', puedoDar: true, total: 1028.5, desde: { iban4: '5678' } })
    expect(l.pagos[0]).toMatchObject({ beneficiario: 'Suministros Norte S.L.', iban4: '1234', motivosTexto: ['IBAN nuevo'] })
  })
})

describe('la remesa «banco» no ofrece el fichero', () => {
  const pagina = readFileSync('src/modules/conta/compras/RemesaPagosPage.tsx', 'utf8')
  it('los botones del fichero miran sinFichero (a mano o por el banco), nunca solo aMano', () => {
    expect(pagina).toMatch(/const sinFichero = r\.aMano \|\| r\.porBanco/)
    expect(pagina).not.toMatch(/!r\.aMano &&/)
  })
})
