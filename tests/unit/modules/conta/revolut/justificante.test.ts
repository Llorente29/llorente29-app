// tests/unit/modules/conta/revolut/justificante.test.ts
//
// B01 · Cola 1e · El justificante de un pago: la clave, el PDF (con el IBAN
// tapado), el correo con su freno, hacer los que faltan y el WhatsApp.
// Datos inventados (T11): el IBAN del banco 9999.

import { jsPDF } from 'jspdf'
import { describe, expect, it, vi } from 'vitest'
import {
  CLAVE, correoJustificante, filasJustificante, hacerJustificantes, ibanTapado, justificantePagoPdf, mandarJustificante, nuevaClave,
  nombreJustificante, rutaJustificante, type DatosJustificante,
} from '../../../../../supabase/functions/_shared/justificantePago'
import { caducaEn, enlaceJustificante, enlaceWhatsApp, telefonoWhatsApp, textoWhatsApp } from '@/modules/conta/lib/justificante'

const D: DatosJustificante = {
  salida: '00000000-0000-4000-8000-0000000000a1', account_id: '00000000-0000-4000-8000-0000000000c1', company_id: '00000000-0000-4000-8000-0000000000e1',
  invoice_id: '00000000-0000-4000-8000-0000000000f1', estado: 'pagada', pagado_at: '2026-11-02T21:05:00Z', importe: '1105.30', concepto: 'DCV-2026/1184',
  referencia: 'tx-prueba-1', banco: 'Revolut',
  empresa: { nombre: 'Bar Prueba', razon: 'Bar Prueba SL', nif: 'B00000000', color: '#0F766E', email: 'admin@ejemplo.invalid' },
  desde: { nombre: 'Revolut', iban4: '9999' },
  proveedor: { nombre: 'Distribuciones Prueba SL', nif: 'B12345678', iban4: '2115', iban_pais: 'ES', al_pagar: true, correo: 'pagos@ejemplo.invalid' },
  factura: { numero: 'DCV-2026/1184', fecha: '2026-10-22', total: 1105.3 },
  justificante: null,
}

/** El texto de un PDF de jsPDF (sin comprimir: sus cadenas, tal cual). */
const textoPdf = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

describe('la clave del enlace', () => {
  it('son 32 bytes al azar en base64url: 43 letras sin «+», «/» ni «=»', () => {
    const c = nuevaClave((n) => new Uint8Array(n).fill(251))
    expect(c).toMatch(CLAVE)
    expect(c).not.toMatch(/[+/=]/)
    const a = nuevaClave((n) => crypto.getRandomValues(new Uint8Array(n)))
    const b = nuevaClave((n) => crypto.getRandomValues(new Uint8Array(n)))
    expect(a).not.toBe(b)
  })
  it('con menos azar, no hace clave', () => {
    expect(() => nuevaClave(() => new Uint8Array(16))).toThrow('32 bytes')
  })
})

describe('el PDF', () => {
  it('lleva la empresa, el proveedor, la factura, el importe, la hora de Madrid y la referencia; el IBAN, tapado', () => {
    const filas = Object.fromEntries(filasJustificante(D))
    expect(filas['Paga']).toBe('Bar Prueba SL · B00000000')
    expect(filas['A la cuenta']).toBe('ES·· ···· ···· ···· ···· 2115')
    expect(filas['Factura']).toBe('DCV-2026/1184 del 22/10/2026')
    expect(filas['Pagado']).toBe('02/11/2026 a las 22:05 (hora de Madrid)')
    expect(filas['Referencia de Revolut']).toBe('tx-prueba-1')
    const t = textoPdf(justificantePagoPdf(jsPDF, D))
    expect(t).toContain('1.105,30')
    expect(t).toContain('Bar Prueba')
    expect(t).toContain('2115')
    expect(t).not.toContain('ES0799990000000000002115')
  })
  it('un pago que el banco no ha confirmado no tiene PDF', () => {
    expect(() => justificantePagoPdf(jsPDF, { ...D, estado: 'enviada' })).toThrow('no está confirmado')
  })
  it('el nombre del fichero y dónde se guarda', () => {
    expect(nombreJustificante('26A/10966')).toBe('Justificante-26A-10966.pdf')
    expect(rutaJustificante('c', 's')).toBe('c/justificantes/s.pdf')
    expect(ibanTapado(null, null)).toBe('···· ···· ···· ···· ···· ····')
  })
})

describe('el correo', () => {
  const ok = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) }))
  it('cerrado hasta que Julio lo abra: no llama a nadie y lo dice', async () => {
    const f = ok()
    const r = await mandarJustificante({ fetch: f, resendKey: 'k', abiertos: '', para: 'pagos@ejemplo.invalid', d: D, pdf: new Uint8Array([1]) })
    expect(r).toEqual({ enviado: false, texto: 'No se ha mandado el justificante de DCV-2026/1184 a pagos@ejemplo.invalid: los correos de justificantes aún están cerrados (los abre Julio).' })
    expect(f).not.toHaveBeenCalled()
  })
  it('abierto, sale con el PDF adjunto, del buzón de pagos y con respuesta a la empresa', async () => {
    const f = ok()
    const r = await mandarJustificante({ fetch: f, resendKey: 'k', abiertos: 'justificante_pago', para: 'Pagos@Ejemplo.invalid', d: D, pdf: new Uint8Array([1, 2]) })
    expect(r.enviado).toBe(true)
    expect(r.texto).toBe('Mandado el justificante de DCV-2026/1184 a pagos@ejemplo.invalid, con su PDF.')
    const cuerpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(cuerpo.from).toBe('"Bar Prueba vía Sumied" <pagos@sumied.com>')
    expect(cuerpo.to).toEqual(['pagos@ejemplo.invalid'])
    expect(cuerpo.reply_to).toBe('admin@ejemplo.invalid')
    expect(cuerpo.attachments[0].filename).toBe('Justificante-DCV-2026-1184.pdf')
    expect(correoJustificante(D).texto).toContain('Bar Prueba te ha pagado la factura DCV-2026/1184: 1.105,30 € por transferencia desde Revolut, el 02/11/2026.')
  })
  it('un correo que no vale no se manda', async () => {
    const r = await mandarJustificante({ fetch: ok(), resendKey: 'k', abiertos: 'justificante_pago', para: 'no es un correo', d: D, pdf: new Uint8Array() })
    expect(r.enviado).toBe(false)
  })
})

describe('hacer los que faltan', () => {
  function srv(nuevo = true) {
    const llamadas: [string, Record<string, unknown>][] = []
    return {
      llamadas,
      rpc: vi.fn(async (f: string, a: Record<string, unknown>) => {
        llamadas.push([f, a])
        if (f === 'conta_pago_justificante_por_hacer') return { data: [D.salida], error: null }
        if (f === 'conta_pago_justificante_datos') return { data: D, error: null }
        if (f === 'conta_pago_justificante_guardar') return { data: { id: 'j-1', nuevo }, error: null }
        return { data: { ok: true }, error: null }
      }),
    }
  }
  it('hace el PDF, lo sube, lo guarda y, si el proveedor lo pide, lo manda y lo apunta', async () => {
    const s = srv()
    const subir = vi.fn(async () => {})
    const mandar = vi.fn(async () => ({ enviado: true, texto: 'Mandado.' }))
    const r = await hacerJustificantes(s, D.company_id, { pdf: () => new Uint8Array([1]), clave: () => 'A'.repeat(43), subir, mandar })
    expect(r).toEqual({ hechos: 1, mandados: 1, fallos: 0 })
    expect(subir).toHaveBeenCalledWith(`${D.account_id}/justificantes/${D.salida}.pdf`, new Uint8Array([1]))
    expect(s.llamadas.find(([f]) => f === 'conta_pago_justificante_correo')![1]).toEqual({ p_id: 'j-1', p_a: 'pagos@ejemplo.invalid', p_texto: 'Mandado.', p_quien: null })
  })
  it('sin la casilla del proveedor, no se manda', async () => {
    const s = srv()
    const mandar = vi.fn()
    s.rpc.mockImplementation(async (f: string) => f === 'conta_pago_justificante_por_hacer' ? { data: [D.salida], error: null }
      : f === 'conta_pago_justificante_datos' ? { data: { ...D, proveedor: { ...D.proveedor, al_pagar: false } }, error: null }
      : { data: { id: 'j-1', nuevo: true }, error: null })
    const r = await hacerJustificantes(s, D.company_id, { pdf: () => new Uint8Array(), clave: () => 'A'.repeat(43), subir: async () => {}, mandar })
    expect(r).toEqual({ hechos: 1, mandados: 0, fallos: 0 })
    expect(mandar).not.toHaveBeenCalled()
  })
  it('si ya estaba hecho (otra lectura a la vez), no lo manda dos veces', async () => {
    const mandar = vi.fn()
    await hacerJustificantes(srv(false), D.company_id, { pdf: () => new Uint8Array(), clave: () => 'A'.repeat(43), subir: async () => {}, mandar })
    expect(mandar).not.toHaveBeenCalled()
  })
  it('un fallo al subir se cuenta y no lanza', async () => {
    const r = await hacerJustificantes(srv(), D.company_id, { pdf: () => new Uint8Array(), clave: () => 'A'.repeat(43), subir: async () => { throw new Error('no') }, mandar: null })
    expect(r).toEqual({ hechos: 0, mandados: 0, fallos: 1 })
  })
})

describe('WhatsApp y el enlace', () => {
  it('el teléfono, con su prefijo; lo que no es un teléfono, null', () => {
    expect(telefonoWhatsApp('600 00 00 00')).toBe('34600000000')
    expect(telefonoWhatsApp('+34 600-000-000')).toBe('34600000000')
    expect(telefonoWhatsApp('0034600000000')).toBe('34600000000')
    expect(telefonoWhatsApp('+351 912 345 678')).toBe('351912345678')
    expect(telefonoWhatsApp('')).toBeNull()
    expect(telefonoWhatsApp('llamar a Ana')).toBeNull()
    expect(telefonoWhatsApp('1234')).toBeNull()
  })
  it('wa.me con el mensaje escrito y el enlace; sin teléfono, null', () => {
    const enlace = enlaceJustificante('https://x.supabase.co/', 'A'.repeat(43))
    expect(enlace).toBe(`https://x.supabase.co/functions/v1/conta-justificante?c=${'A'.repeat(43)}`)
    const texto = textoWhatsApp({ empresa: 'Bar Prueba', numero: '26A/10966', importe: 363.67, enlace })
    expect(texto).toBe(`Hola: te hemos pagado la factura 26A/10966 (363,67 €). El justificante, aquí: ${enlace} · Bar Prueba`)
    expect(enlaceWhatsApp('600000000', texto)).toBe(`https://wa.me/34600000000?text=${encodeURIComponent(texto)}`)
    expect(enlaceWhatsApp(null, texto)).toBeNull()
  })
  it('lo que le queda al enlace', () => {
    const ahora = new Date('2026-11-02T10:00:00Z')
    expect(caducaEn('2026-12-02T10:00:00Z', ahora)).toBe('El enlace caduca en 30 días')
    expect(caducaEn('2026-11-03T09:00:00Z', ahora)).toBe('El enlace caduca hoy')
    expect(caducaEn('2026-11-02T09:00:00Z', ahora)).toBe('El enlace ha caducado')
  })
})
