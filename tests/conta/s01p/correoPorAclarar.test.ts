// tests/conta/s01p/correoPorAclarar.test.ts
//
// S01p·20 · 1 · El lector de correos no descarta en silencio (regla 8; Julio, 13/11).
//
// El 01/11, 11 correos «Just-eat invoice» quedaron como «sin_facturas» con «tomados: 0»
// y ninguna pantalla lo dijo. La causa, medida con los .eml de Julio: el lector de aquella
// mañana no conocía el saldo negativo («El importe que debes abonar a Just Eat es…»,
// #428, a las 16:22) y tres llegaron antes de la ruta de Just Eat por facturas@ (#420).
// El lector de hoy los lee; lo que faltaba es que lo que NO entienda se vea.
//
// Con un puerto falso (sin red ni base) y el correo de la forma real (el fixture del V02,
// cambiado para cada caso: nada de los correos de Julio entra en el repositorio, T11):
//   · de saldo negativo y reenviado desde Gmail: es una liquidación, no «sin facturas»;
//   · a 0 € con un abono de campaña: también es una liquidación;
//   · de Just Eat, pero sin su factura en el cuerpo: a «Por aclarar», con el porqué;
//   · de Just Eat, reconocida pero sin sus importes: a «Por aclarar» (antes, un 500);
//   · de alguien que no es una plataforma y sin nada: como antes, solo al registro;
//   · al volver a leer y entrar, su fila sale de «Por aclarar»;
//   · la puerta (documentos@): lo mismo.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  pareceDePlataforma, recibirCorreo, SIN_FACTURA_EN_EL_CORREO,
  type CorreoResend, type DatosLiquidacion, type PuertoEntrada,
} from '../../../supabase/functions/_shared/facturasEntrada'

const HTML_JE = readFileSync('tests/unit/modules/conta/v02/fixtures/liquidaciones/justeat-4126424.html', 'utf8')
const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** La misma liquidación, con saldo negativo (la forma de los 8 de junio a septiembre). */
const NEGATIVA = HTML_JE.replace(/Recibirás de Just Eat<br>(<span[^>]*>)90,30&euro;/, 'El importe que debes abonar a Just Eat es<br>$1-4,36&euro;')
/** A 0 €, con un abono de campaña en su factura (la forma del 4126341). */
const CERO = HTML_JE.replace(/(Recibirás de Just Eat<br><span[^>]*>)90,30&euro;/, '$10,00&euro;')
/** Como la reenvía Gmail: su cabecera de reenvío y el cuerpo dentro de un div. */
const reenviado = (html: string) => `<br><div><div class="gmail_attr">---------- Forwarded message ----------<br>From: <strong>Just Eat Takeaway</strong> &lt;noreply@justeat.test&gt;<br>Subject: Just-eat invoice: 4126424<br></div><br><u></u><div>${html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '')}</div></div>`

function mundo(o: { cuerpo?: string; tipo?: 'facturas' | 'documentos' } = {}) {
  const registro: { resultado: string; detalle: Record<string, unknown> }[] = []
  const liquidaciones: DatosLiquidacion[] = []
  const porAclarar: { emailId: string; subject: string | null; porque: string }[] = []
  const resueltas: string[] = []
  const p: PuertoEntrada = {
    destino: async (lp) => (lp === 'facturas-prueba' ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: o.tipo ?? 'facturas' } : null),
    yaVisto: async () => false,
    registrarCorreo: async (r) => { registro.push({ resultado: r.resultado, detalle: r.detalle as Record<string, unknown> }) },
    adjuntos: async () => [],
    bajar: async () => new Uint8Array(),
    subir: async () => undefined,
    sha256: sha,
    llegada: async (x) => ({ id: `l-${x.nombre}`, yaEstaba: false }),
    leer: async (id) => ({ estado: 'factura', texto: `${id}: leída` }),
    cuerpo: async () => ({ html: o.cuerpo ?? null, text: null }),
    liquidacion: async ({ datos }) => {
      liquidaciones.push(datos)
      return { id: `liq-${liquidaciones.length}`, yaEstaba: false, texto: 'Liquidación registrada.', factura: null }
    },
    facturaComision: async () => ({ id: 'fac-1', estado: 'creada', texto: 'Su factura de comisión está en «Por revisar».' }),
    sinFactura: async (x) => {
      const ya = porAclarar.some((a) => a.emailId === x.emailId)
      if (!ya) porAclarar.push({ emailId: x.emailId, subject: x.subject, porque: x.porque })
      return { id: `pa-${x.emailId}`, yaEstaba: ya }
    },
    sinFacturaResuelta: async (_empresa, emailId) => { resueltas.push(emailId) },
  }
  return { p, registro, liquidaciones, porAclarar, resueltas }
}
const correo = (o: Partial<CorreoResend> = {}): CorreoResend => ({ email_id: 'e1', from: 'reenvio@prueba.test', to: ['facturas-prueba@entrada.folvy.app'], subject: 'Fwd: Just-eat invoice: 4126424', ...o })

describe('S01p·20 · 1 · lo que el lector de hoy lee del cuerpo (los 8 del 01/11)', () => {
  it('saldo negativo y reenviado desde Gmail: es una liquidación, con su factura; y su fila sale de «Por aclarar»', async () => {
    const m = mundo({ cuerpo: reenviado(NEGATIVA) })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(m.liquidaciones[0]).toMatchObject({ proveedor: 'justeat', neto: -4.36, referencia: '4126424' })
    expect(m.porAclarar).toEqual([])
    expect(m.resueltas).toEqual(['e1'])
  })
  it('a 0 € con un abono de campaña: es una liquidación, no «sin facturas»', async () => {
    const m = mundo({ cuerpo: CERO })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(m.liquidaciones[0]).toMatchObject({ neto: 0 })
    expect(m.registro.map((x) => x.resultado)).toEqual(['liquidacion'])
  })
})

describe('S01p·20 · 1 · lo que no entiende va a «Por aclarar», nunca solo al registro (regla 8)', () => {
  it('de Just Eat sin la factura en el cuerpo: su fila, con el asunto y el porqué; y lo dice', async () => {
    const m = mundo({ cuerpo: '<p>Tu factura está disponible en Mi Restaurante.</p>' })
    const r = await recibirCorreo(correo(), m.p)
    expect(m.porAclarar).toEqual([{ emailId: 'e1', subject: 'Fwd: Just-eat invoice: 4126424', porque: SIN_FACTURA_EN_EL_CORREO }])
    expect(r.llegadas).toEqual([{ id: 'pa-e1', estado: 'por_aclarar', texto: 'Queda en Documentos › «Por aclarar»: No he encontrado la factura en el correo.' }])
    expect(r.texto).toContain('«Por aclarar»')
    expect(m.registro).toEqual([{ resultado: 'sin_facturas', detalle: { tomados: 0, dejados: [], por_aclarar: 'pa-e1', motivo: SIN_FACTURA_EN_EL_CORREO } }])
    expect(m.liquidaciones).toEqual([])
  })
  it('dos veces el mismo correo: una sola fila', async () => {
    const m = mundo({ cuerpo: '<p>Nada que leer.</p>' })
    await recibirCorreo(correo(), m.p)
    await recibirCorreo(correo(), m.p)
    expect(m.porAclarar).toHaveLength(1)
  })
  it('de Just Eat, reconocida pero sin sus importes: a «Por aclarar» con el porqué del lector (antes, un error sin rastro)', async () => {
    const sinVentas = HTML_JE.replace('Total de ventas', 'Total vendido')
    const m = mundo({ cuerpo: sinVentas })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('no_es_liquidacion')
    expect(m.porAclarar[0].porque).toMatch(/le faltan importes/)
    expect(m.registro[0]).toMatchObject({ resultado: 'no_es_liquidacion', detalle: { plataforma: 'justeat', por_aclarar: 'pa-e1' } })
  })
  it('de alguien que no es una plataforma y sin nada: como antes, solo al registro', async () => {
    const m = mundo({ cuerpo: '<p>Hola</p>' })
    const r = await recibirCorreo(correo({ subject: 'Fwd: Una consulta', from: 'alguien@prueba.test' }), m.p)
    expect(m.porAclarar).toEqual([])
    expect(r.texto).toMatch(/no trae ninguna factura/)
    expect(m.registro[0].resultado).toBe('sin_facturas')
  })
  it('la puerta (documentos@): de una plataforma y sin nada, también a «Por aclarar»', async () => {
    const m = mundo({ cuerpo: '<p>Tu resumen está en la web.</p>', tipo: 'documentos' })
    const r = await recibirCorreo(correo({ subject: 'Tu resumen de pagos de Uber Eats' }), m.p)
    expect(m.porAclarar).toHaveLength(1)
    expect(r.llegadas.map((l) => l.estado)).toEqual(['por_aclarar'])
  })
  it('qué es una plataforma: por el remitente o por el asunto', () => {
    expect(pareceDePlataforma({ from: 'noreplyes@justeat-int.com', subject: null })).toBe(true)
    expect(pareceDePlataforma({ from: 'yo@prueba.test', subject: 'Fwd: Just-eat invoice: 1' })).toBe(true)
    expect(pareceDePlataforma({ from: 'yo@prueba.test', subject: 'Factura de Uber Eats' })).toBe(true)
    expect(pareceDePlataforma({ from: 'facturas@glovoapp.com', subject: null })).toBe(true)
    expect(pareceDePlataforma({ from: 'proveedor@prueba.test', subject: 'Factura 12' })).toBe(false)
  })
})
