// tests/unit/modules/conta/g01d/avisos.test.ts
//
// G01d · Tarea 2 · Los núcleos de los avisos al instante: autenticidad, lo que
// dice cada aviso, la cola sin repetidos y el paso de aviso a la lectura de una
// ficha. Datos inventados (T11): códigos y secretos de prueba, ids de ejemplo.
// Los avisos tienen el formato EXACTO de la documentación oficial:
//   · Bitrix24: formulario con event, data[FIELDS][ID], ts y auth[…]
//     (b24restdocs, local-webhooks.md «Outbound Webhook»);
//   · GoCardless: JSON { events, meta }, firmado con HMAC-SHA256 del cuerpo
//     (gocardless-nodejs, webhooks.ts · verifySignature). La firma esperada se
//     calcula aquí con createHmac de Node, otra implementación: si la nuestra
//     se equivoca, no coinciden.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { avisoBitrixAutentico, avisoGoCardlessAutentico, firmaGoCardless, FRASE_RECHAZO, igualesEnTiempoConstante } from '../../../../../supabase/functions/_shared/avisos/autenticidad'
import { EVENTOS_DE_BITRIX, leerAvisoBitrix, leerAvisoGoCardless, type AvisoCrm, type AvisoGc } from '../../../../../supabase/functions/_shared/avisos/leerAviso'
import { COMO_MUCHO_GC_MS, JUNTAR_GC_MS, siguienteIntento, sinRepetidos, trabajosDeGoCardless, trabajosDelCrm } from '../../../../../supabase/functions/_shared/avisos/cola'
import { planDeFichaBitrix } from '../../../../../supabase/functions/_shared/avisos/lecturaDeFicha'

const CODIGO = 'codigodepruebainventado0000000000'
const SECRETO = 'secreto-de-prueba-inventado'

/** Un aviso de Bitrix24 como lo manda el webhook saliente (formulario). */
const formularioBitrix = (evento: string, id: string | number, ts = 1762600000, codigo: string | null = CODIGO) => {
  const f = new URLSearchParams({ event: evento, 'data[FIELDS][ID]': String(id), ts: String(ts), 'auth[domain]': 'portal-de-prueba.bitrix24.es', 'auth[member_id]': '0000' })
  if (codigo !== null) f.set('auth[application_token]', codigo)
  return f.toString()
}

/** Un envío de GoCardless, con el formato de su documentación. Ids de ejemplo. */
const envioGc = (eventos: Record<string, unknown>[]) => JSON.stringify({ events: eventos, meta: { webhook_id: 'WB000000000' } })
const cobroDevuelto = { id: 'EV0000000001', created_at: '2026-11-08T10:00:00.000Z', resource_type: 'payments', action: 'charged_back',
  links: { payment: 'PM0000000001', organisation: 'OR0000000001' }, details: { origin: 'bank', cause: 'payment_charged_back', description: 'Inventado.' } }

describe('¿Es auténtico? Bitrix24', () => {
  it('con el código de la conexión, sí', () => {
    expect(avisoBitrixAutentico({ encendido: true, guardado: CODIGO, recibido: CODIGO })).toEqual({ ok: true })
  })
  it('con otro código, no (firma mala)', () => {
    expect(avisoBitrixAutentico({ encendido: true, guardado: CODIGO, recibido: CODIGO.replace(/0$/, '1') })).toEqual({ ok: false, porque: 'firma_mala' })
    expect(avisoBitrixAutentico({ encendido: true, guardado: CODIGO, recibido: 'corto' })).toEqual({ ok: false, porque: 'firma_mala' })
  })
  it('sin código, no', () => {
    expect(avisoBitrixAutentico({ encendido: true, guardado: CODIGO, recibido: null })).toEqual({ ok: false, porque: 'sin_firma' })
    expect(avisoBitrixAutentico({ encendido: true, guardado: CODIGO, recibido: '  ' })).toEqual({ ok: false, porque: 'sin_firma' })
  })
  it('apagado o sin código guardado, no, aunque el código sea bueno', () => {
    expect(avisoBitrixAutentico({ encendido: false, guardado: CODIGO, recibido: CODIGO })).toEqual({ ok: false, porque: 'apagado' })
    expect(avisoBitrixAutentico({ encendido: true, guardado: null, recibido: CODIGO })).toEqual({ ok: false, porque: 'sin_codigo_guardado' })
  })
})

describe('¿Es auténtico? GoCardless', () => {
  const cuerpo = envioGc([cobroDevuelto])
  const firmaNode = createHmac('sha256', SECRETO).update(cuerpo).digest('hex')

  it('nuestra firma es la de createHmac (la que usa el código oficial)', async () => {
    expect(await firmaGoCardless(cuerpo, SECRETO)).toBe(firmaNode)
  })
  it('con la firma buena, sí (también en mayúsculas)', async () => {
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo, firma: firmaNode })).toEqual({ ok: true })
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo, firma: firmaNode.toUpperCase() })).toEqual({ ok: true })
  })
  it('un byte cambiado en el cuerpo, o la firma de otro secreto: firma mala', async () => {
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo: cuerpo.replace('charged_back', 'confirmed'), firma: firmaNode })).toEqual({ ok: false, porque: 'firma_mala' })
    const otra = createHmac('sha256', 'otro-secreto').update(cuerpo).digest('hex')
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo, firma: otra })).toEqual({ ok: false, porque: 'firma_mala' })
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo, firma: 'no-es-hex' })).toEqual({ ok: false, porque: 'firma_mala' })
  })
  it('sin firma, no; apagado, no', async () => {
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo, firma: null })).toEqual({ ok: false, porque: 'sin_firma' })
    expect(await avisoGoCardlessAutentico({ encendido: false, secreto: SECRETO, cuerpo, firma: firmaNode })).toEqual({ ok: false, porque: 'apagado' })
  })
  it('se firma el cuerpo TAL CUAL: el mismo JSON con otros espacios no vale', async () => {
    const reformateado = JSON.stringify(JSON.parse(cuerpo), null, 2)
    expect(await avisoGoCardlessAutentico({ encendido: true, secreto: SECRETO, cuerpo: reformateado, firma: firmaNode })).toEqual({ ok: false, porque: 'firma_mala' })
  })
  it('lo que se dice al rechazar no lleva el código ni la firma, ni palabras de técnico', () => {
    for (const f of Object.values(FRASE_RECHAZO)) {
      expect(f).not.toContain(CODIGO)
      expect(f).not.toMatch(/webhook|endpoint|evento|payload|hmac/i)
    }
  })
  it('la comparación no se para en el primer carácter distinto (mismo resultado, longitudes distintas)', () => {
    const a = new TextEncoder().encode('abc'); const b = new TextEncoder().encode('abd'); const c = new TextEncoder().encode('ab')
    expect(igualesEnTiempoConstante(a, a)).toBe(true)
    expect(igualesEnTiempoConstante(a, b)).toBe(false)
    expect(igualesEnTiempoConstante(a, c)).toBe(false)
  })
})

describe('Lo que dice un aviso', () => {
  it('Bitrix24: los seis eventos del encargo, con su ficha y su acción', () => {
    expect(EVENTOS_DE_BITRIX).toEqual(['ONCRMCOMPANYADD', 'ONCRMCOMPANYUPDATE', 'ONCRMCOMPANYDELETE', 'ONCRMCONTACTADD', 'ONCRMCONTACTUPDATE', 'ONCRMCONTACTDELETE'])
    const r = leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 2917))
    expect(r).toEqual({ ok: true, codigo: CODIGO, avisos: [{ clave: 'bitrix24:ONCRMCOMPANYUPDATE:2917:1762600000', crm: 'bitrix24', tipoFicha: 'empresa', accion: 'cambio', idExterno: '2917', ts: 1762600000 }] })
    expect(leerAvisoBitrix(formularioBitrix('onCrmContactDelete', 7))).toMatchObject({ ok: true, avisos: [{ tipoFicha: 'contacto', accion: 'baja', idExterno: '7' }] })
  })
  it('Bitrix24: lo que no es de empresas o contactos, o sin ficha o sin hora, no entra y dice por qué', () => {
    expect(leerAvisoBitrix(formularioBitrix('ONCRMDEALUPDATE', 1))).toEqual({ ok: false, porque: 'Sumied no atiende el aviso «ONCRMDEALUPDATE» (solo empresas y contactos del CRM).' })
    expect(leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 'abc'))).toEqual({ ok: false, porque: 'El aviso no trae el número de la ficha.' })
    expect(leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 1, 0))).toEqual({ ok: false, porque: 'El aviso no trae cuándo se mandó.' })
    expect(leerAvisoBitrix('')).toEqual({ ok: false, porque: 'El aviso no dice qué ha pasado.' })
  })
  it('Bitrix24: el mismo cambio con otra hora es otro aviso; con la misma, el mismo', () => {
    const a = leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 5, 100)) as { avisos: AvisoCrm[] }
    const b = leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 5, 101)) as { avisos: AvisoCrm[] }
    const c = leerAvisoBitrix(formularioBitrix('ONCRMCOMPANYUPDATE', 5, 100)) as { avisos: AvisoCrm[] }
    expect(a.avisos[0].clave).not.toBe(b.avisos[0].clave)
    expect(a.avisos[0].clave).toBe(c.avisos[0].clave)
  })
  it('GoCardless: cada aviso con su id, sus enlaces y su causa; lo que Sumied no lee se queda fuera', () => {
    const r = leerAvisoGoCardless(envioGc([cobroDevuelto, { id: 'EV0000000002', resource_type: 'payouts', action: 'paid', links: { payout: 'PO1' } }]))
    expect(r).toEqual({ ok: true, codigo: null, fuera: 1, avisos: [{ clave: 'gocardless:EV0000000001', id: 'EV0000000001', recurso: 'payments', accion: 'charged_back',
      creado: '2026-11-08T10:00:00.000Z', enlaces: { payment: 'PM0000000001', organisation: 'OR0000000001' }, causa: 'payment_charged_back' }] })
  })
  it('GoCardless: lo que no se puede leer se dice', () => {
    expect(leerAvisoGoCardless('no es json')).toEqual({ ok: false, porque: 'El aviso no se puede leer (no es JSON).' })
    expect(leerAvisoGoCardless('{}')).toEqual({ ok: false, porque: 'El aviso no trae ninguna novedad (events).' })
  })
  it('lo leído no guarda datos personales: ni la descripción del motivo ni nada fuera de ids y palabras de GoCardless', () => {
    const r = leerAvisoGoCardless(envioGc([{ ...cobroDevuelto, details: { ...cobroDevuelto.details, description: 'Nombre Inventado devolvió el cargo' } }])) as { avisos: AvisoGc[] }
    expect(JSON.stringify(r.avisos)).not.toContain('Nombre Inventado')
  })
})

const crm = (accion: AvisoCrm['accion'], id: string, ts: number, tipoFicha: AvisoCrm['tipoFicha'] = 'empresa'): AvisoCrm =>
  ({ clave: `bitrix24:${accion}:${tipoFicha}:${id}:${ts}`, crm: 'bitrix24', tipoFicha, accion, idExterno: id, ts })

describe('La cola, sin repetidos', () => {
  it('lo ya visto no vuelve a entrar, tampoco el repetido del mismo envío', () => {
    const a = crm('cambio', '1', 10); const b = crm('cambio', '2', 10)
    expect(sinRepetidos([a, b, a], new Set([b.clave]))).toEqual([a])
    expect(sinRepetidos([a, a, a], new Set())).toEqual([a])
  })
  it('del CRM, un trabajo por ficha con el último aviso; la baja no borra nada, es «Pendiente de revisar»', () => {
    const t = trabajosDelCrm([crm('alta', '9', 1), crm('cambio', '9', 5), crm('cambio', '3', 2), crm('baja', '4', 1), crm('cambio', '4', 1), crm('cambio', '9', 5, 'contacto')])
    expect(t.map((x) => [x.tipo, x.tipoFicha, x.idExterno, x.claves.length])).toEqual([
      ['leer_ficha', 'contacto', '9', 1],
      ['leer_ficha', 'empresa', '3', 1],
      ['baja', 'empresa', '4', 2],
      ['leer_ficha', 'empresa', '9', 2],
    ])
  })
  it('un alta después de una baja (se volvió a crear) es leer la ficha', () => {
    expect(trabajosDelCrm([crm('baja', '1', 1), crm('alta', '1', 2)])[0].tipo).toBe('leer_ficha')
  })
  it('de GoCardless, por empresa: espera a juntar 30 s desde el último, o 2 min desde el primero', () => {
    const av = (id: string): AvisoGc => ({ clave: `gocardless:${id}`, id, recurso: 'payments', accion: 'failed', creado: null, enlaces: {}, causa: null })
    const t0 = 1_000_000
    const cola = [{ aviso: av('A'), empresa: 'E1', llegada: t0 }, { aviso: av('B'), empresa: 'E1', llegada: t0 + 20_000 }, { aviso: av('C'), empresa: 'E2', llegada: t0 }]
    expect(trabajosDeGoCardless(cola, t0 + 29_999).map((x) => x.empresa)).toEqual([])
    expect(trabajosDeGoCardless(cola, t0 + JUNTAR_GC_MS).map((x) => x.empresa)).toEqual(['E2'])
    expect(trabajosDeGoCardless(cola, t0 + 20_000 + JUNTAR_GC_MS)).toEqual([
      { tipo: 'releer_empresa', empresa: 'E1', claves: ['gocardless:A', 'gocardless:B'] },
      { tipo: 'releer_empresa', empresa: 'E2', claves: ['gocardless:C'] },
    ])
    // Si no dejan de llegar, a los 2 min se relee igual.
    const sinParar = Array.from({ length: 13 }, (_, i) => ({ aviso: av(`X${i}`), empresa: 'E3', llegada: t0 + i * 10_000 }))
    expect(trabajosDeGoCardless(sinParar, t0 + COMO_MUCHO_GC_MS).map((x) => x.claves.length)).toEqual([13])
  })
  it('un trabajo que falla se repite a los 1, 2, 5, 15 y 30 min; después lo recoge la lectura de la noche', () => {
    expect([1, 2, 3, 4, 5].map((n) => (siguienteIntento(n, 0) ?? 0) / 60_000)).toEqual([1, 2, 5, 15, 30])
    expect(siguienteIntento(6, 0)).toBeNull()
  })
})

describe('Del aviso a la lectura de una ficha', () => {
  const select = { empresa: ['ID', 'TITLE', 'UF_CRM_NIF'], contacto: ['ID', 'NAME', 'LAST_NAME'] }
  it('una empresa: crm.company.list con los mismos campos que la lectura entera y su ID', () => {
    const [t] = trabajosDelCrm([crm('cambio', '2917', 1)])
    expect(planDeFichaBitrix(t, select)).toEqual({ tipo: 'leer', tipoFicha: 'empresa', idExterno: '2917',
      peticiones: [{ metodo: 'crm.company.list', cuerpo: { select: ['ID', 'TITLE', 'UF_CRM_NIF'], filter: { ID: 2917 }, order: { ID: 'ASC' }, start: 0 } }] })
  })
  it('un contacto: crm.contact.list y sus empresas por crm.item.list (companyIds), como la lectura entera', () => {
    const [t] = trabajosDelCrm([crm('alta', '7', 1, 'contacto')])
    expect(planDeFichaBitrix(t, select)).toEqual({ tipo: 'leer', tipoFicha: 'contacto', idExterno: '7', peticiones: [
      { metodo: 'crm.contact.list', cuerpo: { select: ['ID', 'NAME', 'LAST_NAME'], filter: { ID: 7 }, order: { ID: 'ASC' }, start: 0 } },
      { metodo: 'crm.item.list', cuerpo: { entityTypeId: 3, select: ['id', 'companyIds'], filter: { id: 7 }, order: { id: 'ASC' }, start: 0 } },
    ] })
  })
  it('una baja no pide nada al CRM: sale en «Pendiente de revisar» y lo dice en palabras', () => {
    const [t] = trabajosDelCrm([crm('baja', '4', 1)])
    expect(planDeFichaBitrix(t, select)).toEqual({ tipo: 'pendiente_de_revisar', tipoFicha: 'empresa', idExterno: '4',
      porque: 'La empresa n.º 4 se ha borrado en el CRM. En Sumied no se borra nada: decide si se queda.' })
  })
})
