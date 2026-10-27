// tests/unit/modules/conta/pc01/cobroCorreos.test.ts
//
// PC01 · Entrega 4 · Los correos de cobro que salen desde Sumied
// (supabase/functions/_shared/cobroCorreos.ts): el recordatorio de una factura
// y el mandato para firmar. Lo que dicen, la marca de la empresa, que nada de
// lo que escribe el cliente o la empresa se cuela como HTML, y a qué dirección
// lleva el enlace de firma.

import { describe, expect, it } from 'vitest'
import {
  PLANTILLA_MANDATO, PLANTILLA_RECORDATORIO, colorMarca, correoMandato, correoRecordatorio, cuandoVence, origenFirma,
} from '../../../../../supabase/functions/_shared/cobroCorreos'
import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'

const TECNICAS = /\b(SEPA|CORE|pain|XML|SDD|token|null|undefined|NaN)\b/

const base = {
  empresa: 'Llorente29 Food SL', cliente: 'Ghost Kitchens Madrid SL', numero: 'A-2026/0010', fecha: '2026-09-10',
  total: 1452, pendiente: 1452, conPdf: true,
}

describe('el recordatorio', () => {
  it('antes de vencer, el día que vence y vencida, cada uno lo dice a su manera', () => {
    expect(cuandoVence('2026-11-01', '2026-10-29')).toEqual({ asunto: 'vence el 01/11', frase: 'vence el 01/11/2026' })
    expect(cuandoVence('2026-11-01', '2026-11-01')).toEqual({ asunto: 'vence hoy', frase: 'vence hoy' })
    expect(cuandoVence('2026-10-10', '2026-10-25').frase).toBe('venció el 10/10/2026, hace 15 días')
    expect(cuandoVence('2026-10-24', '2026-10-25').frase).toBe('venció el 24/10/2026, hace 1 día')
  })

  it('vencida: el asunto, el importe con céntimos y el PDF; sin palabras de técnico', () => {
    const c = correoRecordatorio({ ...base, vence: '2026-10-10', hoy: '2026-10-25' })
    expect(c.asunto).toBe('Factura A-2026/0010 de Llorente29 Food SL: pendiente de pago')
    expect(c.texto).toContain('Te recordamos que la factura A-2026/0010 del 10/09/2026, por 1.452,00 €, venció el 10/10/2026, hace 15 días.')
    expect(c.texto).toContain('Te la adjuntamos otra vez en PDF.')
    expect(c.texto).toContain('Si ya la has pagado, gracias: no hace falta que hagas nada.')
    expect(c.texto).not.toMatch(TECNICAS)
    expect(c.html).not.toMatch(TECNICAS)
  })

  it('cobrada en parte: dice lo que queda', () => {
    const c = correoRecordatorio({ ...base, pendiente: 452.5, vence: '2026-11-01', hoy: '2026-10-29', conPdf: false })
    expect(c.texto).toContain('vence el 01/11/2026. Quedan pendientes 452,50 €.')
    expect(c.texto).not.toContain('PDF')
  })

  it('con enlace de pago: el botón con lo pendiente; Bizum, solo si está activo', () => {
    const solo = correoRecordatorio({ ...base, vence: '2026-11-01', hoy: '2026-11-01', enlacePago: 'https://app.sumied.com/pagar.html?t=abc' })
    expect(solo.texto).toContain('Puedes pagarla ahora con tarjeta desde el botón de abajo.')
    expect(solo.texto).not.toContain('Bizum')
    const c = correoRecordatorio({ ...base, vence: '2026-11-01', hoy: '2026-11-01', enlacePago: 'https://app.sumied.com/pagar.html?t=abc', conBizum: true })
    expect(c.html).toContain('href="https://app.sumied.com/pagar.html?t=abc"')
    expect(c.html).toContain('Pagar 1.452,00 €')
    expect(c.texto).toContain('Pagar: https://app.sumied.com/pagar.html?t=abc')
    expect(c.texto).toContain('Puedes pagarla ahora con tarjeta o Bizum')
  })

  it('lo que escriben la empresa y el cliente va como texto, nunca como HTML', () => {
    const c = correoRecordatorio({ ...base, empresa: 'Bar <b>Pepe</b> & Co', cliente: '<script>x()</script>', vence: '2026-11-01', hoy: '2026-11-01' })
    expect(c.html).not.toContain('<script>')
    expect(c.html).not.toContain('<b>Pepe</b>')
    expect(c.html).toContain('&lt;script&gt;')
    expect(c.asunto).not.toMatch(/[<>\r\n]/)
  })

  it('la marca: el color de la empresa si es un #RRGGBB; el logo, solo por https', () => {
    expect(colorMarca('#1E63C9')).toBe('#1E63C9')
    expect(colorMarca('red; background:url(x)')).toBe('#0B1F3B')
    expect(colorMarca(null)).toBe('#0B1F3B')
    const con = correoRecordatorio({ ...base, color: '#00AA55', logo: 'https://x.supabase.co/storage/v1/object/sign/company-logos/a.png?token=1', vence: '2026-11-01', hoy: '2026-11-01' })
    expect(con.html).toContain('border-bottom:3px solid #00AA55')
    expect(con.html).toContain('<img src="https://x.supabase.co/storage/v1/object/sign/company-logos/a.png?token=1"')
    const sin = correoRecordatorio({ ...base, logo: 'javascript:alert(1)', vence: '2026-11-01', hoy: '2026-11-01' })
    expect(sin.html).not.toContain('<img')
    expect(sin.html).toContain('<strong style="font-size:18px;color:#0B1F3B">Llorente29 Food SL</strong>')
  })
})

describe('el mandato para firmar', () => {
  it('lleva la referencia, el botón al enlace y hasta cuándo vale; en palabras de la calle', () => {
    const c = correoMandato({ empresa: 'Llorente29 Food SL', cliente: 'Bar La Esquina de Usera', ref: 'SUM-000124', enlace: 'https://app.sumied.com/mandato.html?t=abc', caduca: '2026-11-25' })
    expect(c.asunto).toBe('Llorente29 Food SL: firma la domiciliación de tus recibos (SUM-000124)')
    expect(c.texto).toContain('El enlace vale hasta el 25/11/2026.')
    expect(c.texto).toContain('Firmar: https://app.sumied.com/mandato.html?t=abc')
    expect(c.html).toContain('Firmar la domiciliación')
    expect(c.texto).not.toMatch(TECNICAS)
    expect(c.html).not.toMatch(TECNICAS)
  })
})

describe('a qué dirección lleva el enlace de firma', () => {
  const dominios = Object.values(MARCAS).flatMap((m) => m.dominios)
  it('la de la app desde la que se prepara, si es de una marca', () => {
    expect(origenFirma('https://app.folvy.app', dominios)).toBe('https://app.folvy.app')
    expect(origenFirma('https://app.sumied.com/conta/ventas/cobros', dominios)).toBe('https://app.sumied.com')
  })
  it('si no (otra web, sin https, nada), la de Sumied', () => {
    expect(origenFirma('https://phishing.example', dominios)).toBe('https://app.sumied.com')
    expect(origenFirma('http://app.folvy.app', dominios)).toBe('https://app.sumied.com')
    expect(origenFirma(null, dominios)).toBe('https://app.sumied.com')
    expect(origenFirma('no es una url', dominios)).toBe('https://app.sumied.com')
  })
})

describe('el freno', () => {
  it('los dos tipos de correo tienen su nombre, para abrirlos uno a uno', () => {
    expect(PLANTILLA_RECORDATORIO).toBe('recordatorio_cobro')
    expect(PLANTILLA_MANDATO).toBe('mandato_sepa')
  })
})
