// G05 · T4 · La factura de un recibo, rematada en el servidor al emitir
// (_shared/cobro/facturaRecibo.ts): su PDF «Sumied» guardado (y con él, adjunto
// a su asiento: conta_venta_pdf_guardar) y su envío al cliente UNA vez, con las
// puertas de siempre (_shared/facturaVentaEnviar.ts). Con una base falsa y el
// correo falso: datos inventados (T11).
import { jsPDF } from 'jspdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rematarFacturasDeRecibos, type Herramientas } from '../../../../../../supabase/functions/_shared/cobro/facturaRecibo'

type Fila = Record<string, unknown>
const CUENTA = 'c01a0000-0000-4000-8000-00000000000a', EMPRESA = 'e0000000-0000-4000-8000-000000000001'

/** Una base falsa: tablas en memoria, filtros eq/in/not, el almacén y las funciones (rpc) apuntadas. */
function baseFalsa(tablas: Record<string, Fila[]>, opciones: { demo?: boolean; guardarFalla?: string } = {}) {
  const llamadas: { rpc: string; args: Fila }[] = []
  const subidas: string[] = []
  const consulta = (tabla: string) => {
    let filas = [...(tablas[tabla] ?? [])]
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filas = filas.filter((f) => String(f[k]) === String(v)); return q },
      in: (k: string, vs: unknown[]) => { filas = filas.filter((f) => vs.map(String).includes(String(f[k]))); return q },
      not: (k: string) => { filas = filas.filter((f) => f[k] !== null && f[k] !== undefined); return q },
      order: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
      then: (ok: (r: { data: Fila[]; error: null }) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok),
    }
    return q
  }
  const db = {
    from: consulta,
    rpc: async (nombre: string, args: Fila) => {
      llamadas.push({ rpc: nombre, args })
      if (nombre === 'cuenta_puede_salir') return { data: !opciones.demo, error: null }
      if (nombre === 'conta_venta_pdf_guardar') {
        if (opciones.guardarFalla && args.p_id === opciones.guardarFalla) return { data: null, error: { message: 'mes cerrado' } }
        const f = tablas.customer_invoice.find((x) => x.id === args.p_id)!
        f.pdf_path = args.p_ruta
        return { data: { ruta: args.p_ruta, ya_estaba: false }, error: null }
      }
      if (nombre === 'conta_venta_enviada') {
        if (args.p_para) tablas.customer_invoice.find((x) => x.id === args.p_id)!.sent_at = 'ahora'
        tablas.customer_invoice_event.push({ invoice_id: args.p_id, kind: args.p_para ? 'enviada' : 'correo_no', text: args.p_texto })
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
    storage: { from: () => ({
      upload: async (ruta: string) => { subidas.push(ruta); return { error: null } },
      download: async () => ({ data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }),
    }) },
  }
  return { db, llamadas, subidas }
}

const factura = (id: string, numero: string, extra: Fila = {}): Fila => ({
  id, account_id: CUENTA, company_id: EMPRESA, party_id: `p-${id}`, status: 'emitida', doc_type: 'factura', number_text: numero,
  issue_date: '2026-12-04', due_date: null, base: 50, tax: 10.5, withholding_amount: 0, total: 60.5,
  customer: { nombre: 'Cliente Prueba', nif: 'B00000034' }, email_to: null, pdf_path: null, sent_at: null, ...extra,
})
const recibo = (id: string): Fila => ({ id: `r-${id}`, company_id: EMPRESA, party_id: `p-${id}`, mes: '2026-12', confirmado_el: '2026-12-04', mandato_gc_id: null, invoice_id: id,
  factura: { lineas: [{ concepto: 'Gestoría Estándar', cantidad: 1, precioCent: 5000, baseCent: 5000 }] } })
const tablas = (facturas: Fila[], extra: Record<string, Fila[]> = {}): Record<string, Fila[]> => ({
  conta_recibo: facturas.map((f) => recibo(String(f.id))), customer_invoice: facturas,
  customer_invoice_line: facturas.map((f) => ({ invoice_id: f.id, tax_pct: 21, amount: 50, tax_amount: 10.5 })),
  customer_invoice_event: [], company: [{ id: EMPRESA, legal_name: 'Gestoría Demo, S.L.', tax_id: 'B00000026', logo_path: null }],
  conta_cobro_cliente: [], verifactu_factura_estado: [], conta_gc_cliente: [], ...extra,
})
const herramientas = (abiertos = 'factura_venta'): Herramientas => ({ jsPDF, qr: () => [[true]], correo: { resendKey: 'clave-de-prueba', buzonDePruebas: 'buzon@pruebas.example', abiertos } })

afterEach(() => vi.unstubAllGlobals())

describe('G05 · T4 · la factura de un recibo, rematada en el servidor', () => {
  it('su PDF «Sumied» se sube y se guarda (adjunto a la factura y a su asiento), y se manda una vez', async () => {
    const correos: Fila[] = []
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { correos.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'correo-1' }), { status: 200 }) })
    const t = tablas([factura('f1', '2026/1/141', { email_to: 'cliente@ejemplo.example' })])
    const { db, llamadas, subidas } = baseFalsa(t)
    const r = await rematarFacturasDeRecibos(db, EMPRESA, herramientas())
    expect(r).toEqual({ pdfs: 1, enviadas: 1, sinEnviar: [], fallos: [] })
    expect(subidas[0]).toMatch(new RegExp(`^${CUENTA}/ventas/f1/[0-9a-f]{16}\\.pdf$`))
    expect(llamadas.find((x) => x.rpc === 'conta_venta_pdf_guardar')?.args).toMatchObject({ p_id: 'f1', p_ruta: subidas[0] })
    expect(correos).toHaveLength(1)
    expect(correos[0]).toMatchObject({ to: ['cliente@ejemplo.example'] })
    expect((correos[0].attachments as Fila[])[0].filename).toMatch(/\.pdf$/)
    // Otra pasada: ya tiene su PDF y ya se mandó; no se rehace nada.
    expect(await rematarFacturasDeRecibos(db, EMPRESA, herramientas())).toEqual({ pdfs: 0, enviadas: 0, sinEnviar: [], fallos: [] })
    expect(correos).toHaveLength(1)
  })

  it('en la demo, solo al buzón de pruebas; sin correo del cliente, no se manda y su historial lo dice', async () => {
    const correos: Fila[] = []
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { correos.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) })
    const t = tablas([factura('f1', '2026/1/141'), factura('f2', '2026/1/142')], { conta_gc_cliente: [{ company_id: EMPRESA, party_id: 'p-f1', correo: 'de-gocardless@ejemplo.example' }] })
    const { db } = baseFalsa(t, { demo: true })
    const r = await rematarFacturasDeRecibos(db, EMPRESA, herramientas())
    expect([r.pdfs, r.enviadas]).toEqual([2, 1])
    expect(correos.map((c) => c.to)).toEqual([['buzon@pruebas.example']])
    expect(r.sinEnviar).toEqual(['No se ha mandado la 2026/1/142: su cliente no tiene correo (ni en la factura ni en GoCardless). Mándala desde su ficha cuando lo tengas.'])
    expect(t.customer_invoice_event.map((e) => [e.invoice_id, e.kind])).toEqual([['f1', 'enviada'], ['f2', 'correo_no']])
  })

  it('con los correos cerrados no sale nada (y queda dicho); una factura que falla no para a las demás', async () => {
    const fetchFalso = vi.fn()
    vi.stubGlobal('fetch', fetchFalso)
    const t = tablas([factura('f1', '2026/1/141', { email_to: 'uno@ejemplo.example' }), factura('f2', '2026/1/142', { email_to: 'dos@ejemplo.example' })])
    const { db } = baseFalsa(t, { guardarFalla: 'f1' })
    const r = await rematarFacturasDeRecibos(db, EMPRESA, herramientas(''))
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(r.fallos).toEqual(['2026/1/141: no se ha podido guardar su PDF (mes cerrado)'])
    expect(r.pdfs).toBe(1)
    expect(r.sinEnviar).toEqual(['No se ha mandado la 2026/1/142 a dos@ejemplo.example: los correos de facturas aún están cerrados (los abre Julio).'])
  })
})
