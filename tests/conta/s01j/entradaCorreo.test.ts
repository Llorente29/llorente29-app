// tests/conta/s01j/entradaCorreo.test.ts
//
// S01j · Las liquidaciones de Glovo y Just Eat que llegan a la dirección de
// FACTURAS. Con un puerto falso (sin red ni base) y los dos correos de la forma
// real (los fixtures del V02: el «Just-eat invoice: 4126424» y el Excel de Glovo
// I170326000540680, medidos en los de Julio):
//   · Just Eat sin adjuntos: su liquidación y su factura de comisión, leídas
//     del cuerpo; si la factura no suma, la liquidación entra sin ella y la
//     factura va aparte (en revisión, con el porqué);
//   · Glovo: el PDF entra como factura y el Excel, como su liquidación; lo que
//     no es su Excel se queda con su porqué;
//   · volver a leer: no se para en «ya visto», y lo que la entrada ya no tiene
//     se dice («reenvíalo desde Gmail»).
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  recibirCorreo, releerCorreos, resumenReleidos, YA_NO_ESTA,
  type AdjuntoResend, type CorreoResend, type DatosLiquidacion, type PuertoEntrada,
} from '../../../supabase/functions/_shared/facturasEntrada'
import { leerLiquidacionJustEat } from '../../../supabase/functions/_shared/liquidacionJustEat'

const FIX = 'tests/unit/modules/conta/v02/fixtures/liquidaciones'
const HTML_JE = readFileSync(`${FIX}/justeat-4126424.html`, 'utf8')
const FILAS_GLOVO = JSON.parse(readFileSync(`${FIX}/glovo-I170326000540680-excel.json`, 'utf8')) as Record<string, unknown>[]
const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

function mundo(o: { adjuntos?: AdjuntoResend[]; cuerpo?: string; visto?: boolean; filas?: Record<string, unknown>[] } = {}) {
  const registro: { resultado: string; detalle: unknown }[] = []
  const liquidaciones: DatosLiquidacion[] = []
  const facturas: { settlementId: string; datos: DatosLiquidacion }[] = []
  const leidas: string[] = []
  const huellas = new Set<string>()
  const p: PuertoEntrada = {
    destino: async (lp) => (lp === 'facturas-prueba' ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: 'facturas' } : null),
    yaVisto: async () => o.visto ?? false,
    registrarCorreo: async (r) => { registro.push({ resultado: r.resultado, detalle: r.detalle }) },
    adjuntos: async () => o.adjuntos ?? [],
    bajar: async (url) => new TextEncoder().encode(`contenido de ${url}`),
    subir: async () => undefined,
    sha256: sha,
    llegada: async (x) => {
      const ya = !!x.sha256 && huellas.has(x.sha256)
      if (x.sha256) huellas.add(x.sha256)
      return { id: `l-${x.nombre}`, yaEstaba: ya }
    },
    leer: async (id) => { leidas.push(id); return { estado: 'factura', texto: `${id}: leída` } },
    cuerpo: async () => ({ html: o.cuerpo ?? null, text: null }),
    liquidacion: async ({ datos }) => {
      liquidaciones.push(datos)
      return { id: `liq-${liquidaciones.length}`, yaEstaba: false, texto: 'Liquidación registrada.', factura: null }
    },
    hoja: async () => o.filas ?? [],
    facturaComision: async (x) => { facturas.push(x); return { id: 'fac-1', estado: 'creada', texto: 'Su factura de comisión está en «Por revisar».' } },
  }
  return { p, registro, liquidaciones, facturas, leidas }
}
const correo = (o: Partial<CorreoResend> = {}): CorreoResend => ({ email_id: 'e1', from: 'reenvio@prueba.test', to: ['facturas-prueba@entrada.folvy.app'], subject: 'Factura', ...o })

describe('S01j · Just Eat a la dirección de facturas', () => {
  it('sin adjuntos: su liquidación y su factura, del cuerpo; con su fecha y el número del asunto', async () => {
    const m = mundo({ cuerpo: HTML_JE })
    const r = await recibirCorreo(correo({ subject: 'Fwd: Just-eat invoice: 4126424' }), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(m.liquidaciones).toHaveLength(1)
    expect(m.liquidaciones[0]).toMatchObject({ proveedor: 'justeat', desde: '2026-10-01', hasta: '2026-10-15', neto: 90.3, referencia: '4126424', referencia_asunto: '4126424', fecha_factura: '2026-10-15' })
    expect(m.facturas).toEqual([{ settlementId: 'liq-1', datos: m.liquidaciones[0], emailId: 'e1' }])
    expect((m.liquidaciones[0] as { factura: unknown }).factura).toEqual({ numero: '4126424', base: 27.1, iva: 5.69, total: 32.79 })
    expect(m.registro).toMatchObject([{ resultado: 'liquidacion', detalle: { plataforma: 'justeat', factura_id: 'fac-1', factura_estado: 'creada' } }])
    expect(r.texto).toBe('Liquidación registrada. Su factura de comisión está en «Por revisar».')
  })
  it('si su factura no suma: la liquidación entra sin ella, y la factura va aparte con todo lo leído', async () => {
    const malo = HTML_JE.replace('Total incluido IVA</td><td colspan=2></td><td style=padding-top:10px;padding-right:4px;text-align:right>32,79', 'Total incluido IVA</td><td colspan=2></td><td style=padding-top:10px;padding-right:4px;text-align:right>32,90')
    expect(leerLiquidacionJustEat({ from: null, subject: 'Just-eat invoice: 4126424', html: malo }).factura.total).toBe(32.9)
    const m = mundo({ cuerpo: malo })
    const r = await recibirCorreo(correo({ subject: 'Fwd: Just-eat invoice: 4126424' }), m.p)
    expect((m.liquidaciones[0] as { factura: unknown }).factura).toBeNull()
    expect((m.facturas[0].datos as { factura: { total: number } }).factura.total).toBe(32.9)
    expect(r.texto).toBe('La liquidación de Just Eat del 01/10 al 15/10 ha entrado. Su factura de comisión está en «Por revisar».')
  })
  it('un correo de Just Eat que no es su liquidación sigue el camino de siempre', async () => {
    const m = mundo({ cuerpo: '<p>Novedades de Just Eat para tu restaurante</p>' })
    const r = await recibirCorreo(correo({ subject: 'Just Eat: novedades' }), m.p)
    expect(m.liquidaciones).toEqual([])
    expect(m.registro).toMatchObject([{ resultado: 'sin_facturas' }])
    expect(r.resultado).toBe('recibido')
  })
})

describe('S01j · Glovo: el PDF como factura y el Excel como su liquidación', () => {
  const adjuntos: AdjuntoResend[] = [
    { id: '1', filename: 'Invoicing Document-000000000001.PDF', content_type: 'application/pdf', size: 60_000, download_url: 'https://r/pdf' },
    { id: '2', filename: 'invoice-000000000001.XLSX', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 20_000, download_url: 'https://r/xlsx' },
  ]
  it('los dos: la factura se lee y la liquidación sale del Excel, con su correo', async () => {
    const m = mundo({ adjuntos, filas: FILAS_GLOVO })
    const r = await recibirCorreo(correo({ subject: 'Fwd: Glovoapp Spain Platform S.L. - Factura 000000000001' }), m.p)
    expect(m.leidas).toEqual(['l-Invoicing-Document-000000000001.pdf'])
    expect(m.liquidaciones).toHaveLength(1)
    expect(m.liquidaciones[0]).toMatchObject({ proveedor: 'glovo', origen: 'excel', referencia: 'I170326000540680', email_id: 'e1' })
    expect(m.registro).toMatchObject([{ resultado: 'recibido', detalle: { tomados: 1, dejados: [], liquidaciones: [{ id: 'liq-1', plataforma: 'glovo' }] } }])
    expect(r.texto).toBe('1 documento recibido; Liquidación registrada.')
  })
  it('un Excel que no es el de Glovo se queda, con su porqué; y el de otro remitente ni se mira', async () => {
    const m = mundo({ adjuntos, filas: [{ Columna: 'otra cosa' }] })
    await recibirCorreo(correo({ subject: 'Fwd: Glovoapp Spain Platform S.L. - Factura 000000000001' }), m.p)
    expect(m.liquidaciones).toEqual([])
    expect(m.registro[0].detalle).toMatchObject({ dejados: [{ nombre: 'invoice-000000000001.XLSX', porque: 'es un Excel, pero no el de la liquidación de Glovo' }] })
    const otro = mundo({ adjuntos, filas: FILAS_GLOVO })
    await recibirCorreo(correo({ subject: 'Factura de un proveedor' }), otro.p)
    expect(otro.liquidaciones).toEqual([])
    expect(otro.registro[0].detalle).toMatchObject({ dejados: [{ porque: 'no es un PDF ni una foto' }] })
  })
})

describe('S01j · volver a leer', () => {
  it('no se para en «ya visto», y el mismo PDF otra vez no se lee de nuevo', async () => {
    const m = mundo({ visto: true, adjuntos: [{ id: '1', filename: 'f.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/1' }] })
    const pedir = async (id: string) => (id === 'fuera' ? null : correo({ email_id: id }))
    const rs = await releerCorreos(['e1', 'e1', 'fuera'], m.p, pedir)
    expect(rs.map((x) => x.estado)).toEqual(['leido', 'leido', 'ya_no_esta'])
    expect(m.leidas).toHaveLength(1)
    expect(rs[2].texto).toBe(YA_NO_ESTA)
    expect(resumenReleidos(rs)).toBe('Leídos otra vez 2 correos; 1 ya no está en el buzón: reenvíalos desde Gmail.')
    expect(resumenReleidos([])).toBe('No había ningún correo que volver a leer.')
  })
  it('si Resend falla con uno, lo dice y sigue con los demás', async () => {
    const m = mundo()
    const rs = await releerCorreos(['a', 'b'], m.p, async (id) => { if (id === 'a') throw new Error('Resend contesta 500'); return correo({ email_id: id }) })
    expect(rs.map((x) => [x.estado, x.texto.slice(0, 22)])).toEqual([['error', 'No se ha podido pedir:'], ['leido', 'El correo no trae ning']])
  })
})
