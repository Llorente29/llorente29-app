// tests/conta/s01p/pdfDelCorreo.test.ts
//
// S01p·20 · 1b · El PDF de la factura de Just Eat, hecho del cuerpo del correo (Julio, 13/11):
// la factura viene escrita en el correo, sin PDF, y el PDF es obligatorio en Sumied y para Diez.
//   · el correo en filas, como en su tabla: la factura con su número, sus direcciones, sus líneas,
//     «Base · IVA · Cuota» y su total; sin la barra de navegación ni «Volver al inicio»;
//   · el PDF es un PDF (A4), con lo que dice el correo;
//   · al entrar, la factura de comisión recibe su PDF; si guardarlo falla, la liquidación entra igual
//     y se dice;
//   · para las que ya entraron: solo si el correo trae ESA factura; lo que no está, se dice.
// Con el correo de la forma real (el fixture del V02); nada de los correos de Julio (T11).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { filasDelCorreo, nombrePdfCorreo, pdfDelCorreo, type PdfMinimo } from '../../../supabase/functions/_shared/correoPdf'
import {
  ponerPapelesDelCorreo, recibirCorreo, resumenPapeles, type CorreoResend, type PuertoEntrada,
} from '../../../supabase/functions/_shared/facturasEntrada'

const HTML_JE = readFileSync('tests/unit/modules/conta/v02/fixtures/liquidaciones/justeat-4126424.html', 'utf8')
const Pdf = jsPDF as unknown as new (o?: Record<string, unknown>) => PdfMinimo
const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('S01p·20 · 1b · el correo en filas y en PDF', () => {
  it('la factura sale con su número, el emisor, sus líneas y su total, sin la navegación', () => {
    const filas = filasDelCorreo({ html: HTML_JE })
    const texto = filas.map((f) => f.map((c) => c.join(' / ')).join(' | '))
    expect(texto.some((t) => t.startsWith('Nº Factura 4126424 | Just Eat Spain SL'))).toBe(true)
    expect(texto.some((t) => /^Base \| IVA \| Cuota$/.test(t))).toBe(true)
    expect(texto.some((t) => /^Total incluido IVA \| 32,79€$/.test(t))).toBe(true)
    expect(texto.some((t) => /Volver al inicio|Resumen \| Tu factura \|/.test(t))).toBe(false)
  })
  it('el PDF es un PDF, y su nombre dice de qué factura es', () => {
    const b = pdfDelCorreo(Pdf, { asunto: 'Fwd: Just-eat invoice: 4126424', de: 'reenvio@prueba.test', recibido: '2026-10-16T13:52:50Z', html: HTML_JE })
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe('%PDF-')
    expect(b.length).toBeGreaterThan(3000)
    expect(nombrePdfCorreo('4126424', 'x')).toBe('just-eat-4126424.pdf')
    expect(nombrePdfCorreo(null, 'Fwd: Just-eat invoice: 1')).toBe('Fwd-Just-eat-invoice-1.pdf')
  })
  it('sin cuerpo no hay PDF: lo dice', () => {
    expect(() => pdfDelCorreo(Pdf, { asunto: 'x', de: null, recibido: null, html: null, text: null })).toThrow(/no tiene cuerpo/)
  })
})

function mundo(o: { papel?: 'bien' | 'falla' } = {}) {
  const registro: { resultado: string; detalle: Record<string, unknown> }[] = []
  const papeles: { facturaId: string; numero: string | null; asunto: string | null }[] = []
  const p: PuertoEntrada = {
    destino: async () => ({ companyId: 'emp', accountId: 'acc', activa: true, tipo: 'facturas' }),
    yaVisto: async () => false,
    registrarCorreo: async (r) => { registro.push({ resultado: r.resultado, detalle: r.detalle as Record<string, unknown> }) },
    adjuntos: async () => [],
    bajar: async () => new Uint8Array(),
    subir: async () => undefined,
    sha256: sha,
    llegada: async (x) => ({ id: `l-${x.nombre}`, yaEstaba: false }),
    leer: async (id) => ({ estado: 'factura', texto: id }),
    cuerpo: async () => ({ html: HTML_JE, text: null }),
    liquidacion: async () => ({ id: 'liq-1', yaEstaba: false, texto: 'Liquidación registrada.', factura: null }),
    facturaComision: async () => ({ id: 'fac-1', estado: 'creada', texto: 'Su factura de comisión está en «Por revisar».' }),
    papelDelCorreo: async (x) => {
      if (o.papel === 'falla') throw new Error('el almacén no contesta')
      papeles.push({ facturaId: x.facturaId, numero: x.numero, asunto: x.asunto })
      return { puesto: true, texto: `La factura ${x.numero} tiene ya su PDF, hecho de su correo.` }
    },
  }
  return { p, registro, papeles }
}
const correo = (o: Partial<CorreoResend> = {}): CorreoResend => ({ email_id: 'e1', from: 'reenvio@prueba.test', to: ['facturas-prueba@entrada.folvy.app'], subject: 'Fwd: Just-eat invoice: 4126424', ...o })

describe('S01p·20 · 1b · al entrar, la factura de comisión recibe el PDF de su correo', () => {
  it('su PDF va a su factura, y lo dice', async () => {
    const m = mundo()
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(m.papeles).toEqual([{ facturaId: 'fac-1', numero: '4126424', asunto: 'Fwd: Just-eat invoice: 4126424' }])
    expect(r.texto).toBe('Liquidación registrada. Su factura de comisión está en «Por revisar». La factura 4126424 tiene ya su PDF, hecho de su correo.')
    expect(m.registro[0].detalle).toMatchObject({ factura_id: 'fac-1', pdf: true })
  })
  it('si guardar el PDF falla, la liquidación entra igual y se dice', async () => {
    const m = mundo({ papel: 'falla' })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(r.texto).toMatch(/No he podido guardar el PDF del correo: el almacén no contesta\.$/)
    expect(m.registro[0].detalle).toMatchObject({ pdf: false })
  })
})

describe('S01p·20 · 1b · las que ya entraron sin PDF', () => {
  const pedir = (c: CorreoResend | null) => async () => c
  it('solo si el correo trae ESA factura; lo que no está o no cuadra, se dice', async () => {
    const m = mundo()
    const bien = await ponerPapelesDelCorreo([{ emailId: 'e1', facturaId: 'fac-1', numero: '4126424' }], { accountId: 'acc', companyId: 'emp' }, m.p,
      pedir({ ...correo(), html: HTML_JE }))
    expect(bien.map((x) => x.estado)).toEqual(['puesto'])
    const otra = await ponerPapelesDelCorreo([{ emailId: 'e1', facturaId: 'fac-9', numero: '9999999' }], { accountId: 'acc', companyId: 'emp' }, m.p,
      pedir({ ...correo(), html: HTML_JE }))
    expect(otra[0]).toMatchObject({ estado: 'no_cuadra', texto: 'El correo trae la factura 4126424 y la de Sumied es la 9999999: no la toco.' })
    const fuera = await ponerPapelesDelCorreo([{ emailId: 'e2', facturaId: 'fac-2', numero: '1' }], { accountId: 'acc', companyId: 'emp' }, m.p, pedir(null))
    expect(fuera[0].estado).toBe('ya_no_esta')
    expect(m.papeles).toHaveLength(1)
    expect(resumenPapeles([...bien, ...otra, ...fuera])).toBe(
      'Una factura de Just Eat tiene ya su PDF, hecho de su correo; 1 sin tocar porque su correo trae otra factura; 1 sin tocar porque su correo ya no está en el buzón (reenvíalo desde Gmail).')
    expect(resumenPapeles([])).toBe('No hay ninguna factura de Just Eat sin su PDF: no he tocado nada.')
  })
})
