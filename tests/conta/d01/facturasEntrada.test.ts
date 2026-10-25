// D01 · Tarea 4 · El correo de facturas de cada empresa: la firma de Resend
// (svix), las direcciones, los adjuntos y el recorrido entero contra dobles
// (Resend y la base). Todo inventado.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  clasificarAdjuntos, comprobarFirma, destinatariosDelSobre, direccionesDeFacturas, enlacesDeFactura, firmaSvix, nombreSeguro, recibirCorreo, rutaEntrada,
  type AdjuntoResend, type CorreoResend, type PuertoEntrada,
} from '../../../supabase/functions/_shared/facturasEntrada'
import { correoUber } from './uberInventado'

const SECRETO = 'whsec_' + Buffer.from('secreto-de-prueba-del-webhook-32b').toString('base64')
const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('la firma de Resend (svix)', () => {
  it('la buena entra; otra firma, otro cuerpo o un sello viejo, no', async () => {
    const cuerpo = '{"type":"email.received"}'
    const f = await firmaSvix(SECRETO, 'msg_1', '1760000000', cuerpo)
    expect(await comprobarFirma(SECRETO, { id: 'msg_1', timestamp: '1760000000', firma: `v1,otra ${f}` }, cuerpo, 1760000100)).toBeNull()
    expect(await comprobarFirma(SECRETO, { id: 'msg_1', timestamp: '1760000000', firma: f }, cuerpo + ' ', 1760000100)).toBe('la firma no es la de Resend')
    expect(await comprobarFirma(SECRETO, { id: 'msg_1', timestamp: '1760000000', firma: f }, cuerpo, 1760000000 + 3600)).toBe('el sello de tiempo no es de ahora')
    expect(await comprobarFirma(SECRETO, { id: null, timestamp: '1', firma: f }, cuerpo, 1)).toBe('faltan las cabeceras de la firma')
  })
})

describe('las direcciones y los adjuntos', () => {
  it('mira to y cc, con nombre o sin él, sin repetir y en minúsculas', () => {
    expect(direccionesDeFacturas({ to: ['Julio <julio@ejemplo.test>'], cc: ['"Facturas" <Facturas-Taberna-Norte@entrada.folvy.app>', 'facturas-taberna-norte@entrada.folvy.app'] }))
      .toEqual([{ localPart: 'facturas-taberna-norte', dominio: 'entrada.folvy.app', direccion: 'facturas-taberna-norte@entrada.folvy.app' }])
    // V02 · Desde la puerta, sin prefijo también es candidata, pero SOLO en un dominio de entrada:
    // la base dice si es de alguien. Fuera de entrada.…, nada.
    expect(direccionesDeFacturas({ to: ['facturas@entrada.folvy.app', 'nominas-x@entrada.folvy.app'] }).map((d) => d.localPart)).toEqual(['facturas', 'nominas-x'])
    expect(direccionesDeFacturas({ to: ['nominas-x@ejemplo.test', 'taberna-norte@folvy.app', 'x@entrada.folvy.app'] })).toEqual([])
  })
  it('toma los PDF y las fotos; deja lo demás diciendo por qué (también el logo de la firma)', () => {
    const r = clasificarAdjuntos([
      { id: '1', filename: 'F-2026-1022.PDF', content_type: 'application/octet-stream', size: 50_000 },
      { id: '2', filename: 'foto.jpeg', content_type: 'image/jpeg', size: 900_000 },
      { id: '3', filename: 'logo.png', content_type: 'image/png', size: 4_000 },
      { id: '4', filename: 'condiciones.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20_000 },
      { id: '5', filename: 'enorme.pdf', content_type: 'application/pdf', size: 11 * 1024 * 1024 },
    ])
    expect(r.tomar.map((x) => [x.id, x.tipo, x.nombre])).toEqual([['1', 'application/pdf', 'F-2026-1022.pdf'], ['2', 'image/jpeg', 'foto.jpg']])
    expect(r.dejar.map((x) => x.porque)).toEqual(['es una imagen pequeña (la firma o el logo del correo)', 'no es un PDF ni una foto', 'pasa de 10 MB'])
  })
  it('un nombre sin rutas ni tildes; la ruta en la carpeta de su cuenta', () => {
    expect(nombreSeguro('../../Factura Teléfono 09/2026.pdf', 'application/pdf')).toBe('2026.pdf')
    expect(nombreSeguro('Factura Teléfono septiembre.pdf', 'application/pdf')).toBe('Factura-Telefono-septiembre.pdf')
    expect(rutaEntrada('acc', 'e-1/x', 0, 'a.pdf')).toBe('acc/_correo/e-1x/01-a.pdf')
  })
  it('los enlaces de descarga: solo https y solo los que lo parecen', () => {
    expect(enlacesDeFactura({ text: 'Descarga tu factura: https://portal.ejemplo.test/descargar?f=77. Más info en https://ejemplo.test/ayuda', html: '<a href="http://inseguro.test/factura.pdf">x</a> <a href="https://cdn.ejemplo.test/F-77.pdf">pdf</a>' }))
      .toEqual(['https://portal.ejemplo.test/descargar?f=77', 'https://cdn.ejemplo.test/F-77.pdf'])
  })
})

function mundo(o: { destino?: { activa: boolean } | null; adjuntos?: AdjuntoResend[]; visto?: boolean } = {}) {
  const registro: unknown[] = []
  const subidas: string[] = []
  const llegadas: { ruta: string | null; enlace: string | null; sha256: string | null }[] = []
  const huellas = new Set<string>()
  const p: PuertoEntrada = {
    destino: async (lp) => (o.destino === null ? null : lp === 'facturas-taberna-norte' ? { companyId: 'emp', accountId: 'acc', activa: o.destino?.activa ?? true } : null),
    yaVisto: async () => o.visto ?? false,
    registrarCorreo: async (r) => { registro.push(r) },
    adjuntos: async () => o.adjuntos ?? [],
    bajar: async (url) => new TextEncoder().encode(`%PDF contenido de ${url.replace('dos', 'uno')}`),
    subir: async (ruta) => { subidas.push(ruta) },
    sha256: sha,
    llegada: async (x) => {
      const ya = !!x.sha256 && huellas.has(x.sha256)
      if (x.sha256) huellas.add(x.sha256)
      llegadas.push({ ruta: x.ruta, enlace: x.enlace, sha256: x.sha256 })
      return { id: `l${llegadas.length}`, yaEstaba: ya }
    },
    leer: async (id) => ({ estado: 'factura', texto: `${id}: leída` }),
  }
  return { p, registro, subidas, llegadas }
}
const correo = (o: Partial<CorreoResend> = {}): CorreoResend => ({ email_id: 'e1', from: 'proveedor@ejemplo.test', to: ['facturas-taberna-norte@entrada.folvy.app'], subject: 'Factura octubre', ...o })

describe('recibirCorreo: el recorrido', () => {
  it('un PDF y una foto: se suben a su cuenta, se registran y se leen', async () => {
    const m = mundo({ adjuntos: [{ id: '1', filename: 'f.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/1' }, { id: '2', filename: 'f.jpg', content_type: 'image/jpeg', size: 300_000, download_url: 'https://r/2' }] })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('recibido')
    expect(r.llegadas.map((x) => x.estado)).toEqual(['factura', 'factura'])
    expect(m.subidas).toEqual(['acc/_correo/e1/01-f.pdf', 'acc/_correo/e1/02-f.jpg'])
    expect(m.registro).toMatchObject([{ resultado: 'recibido', companyId: 'emp' }])
    expect(r.texto).toBe('2 documentos recibidos.')
  })
  it('el mismo fichero dos veces (misma huella) se reconoce y no se lee otra vez', async () => {
    const m = mundo({ adjuntos: [{ id: '1', filename: 'a.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/uno' }, { id: '2', filename: 'b.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/dos' }] })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.llegadas.map((x) => x.estado)).toEqual(['factura', 'repetido'])
  })
  it('solo un enlace: «Falta el PDF», sin seguirlo', async () => {
    const m = mundo({ adjuntos: [] })
    const r = await recibirCorreo(correo({ text: 'Su factura está disponible en https://portal.ejemplo.test/factura/77' }), m.p)
    expect(r.llegadas).toEqual([{ id: 'l1', estado: 'falta_pdf', texto: 'Falta el PDF: el correo trae un enlace. Bájalo y súbelo.' }])
    expect(m.llegadas).toEqual([{ ruta: null, enlace: 'https://portal.ejemplo.test/factura/77', sha256: null }])
    expect(m.subidas).toEqual([])
  })
  it('a una dirección que no es de nadie: se apunta y no se lee (nada se pierde sin rastro)', async () => {
    const m = mundo({ destino: null })
    const r = await recibirCorreo(correo({ to: ['facturas-nadie@entrada.folvy.app'] }), m.p)
    expect(r.resultado).toBe('sin_destino')
    expect(m.registro).toMatchObject([{ resultado: 'sin_destino', companyId: null }])
  })
  it('a una dirección apagada (sin el dominio dado de alta): se apunta y no se lee', async () => {
    const m = mundo({ destino: { activa: false }, adjuntos: [{ id: '1', filename: 'f.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.resultado).toBe('apagada')
    expect(m.subidas).toEqual([])
  })
  it('nunca dos veces el mismo correo', async () => {
    const m = mundo({ visto: true })
    expect((await recibirCorreo(correo(), m.p)).resultado).toBe('repetido')
    expect(m.registro).toEqual([])
  })
  it('un correo sin facturas lo dice, con lo que dejó y por qué', async () => {
    const m = mundo({ adjuntos: [{ id: '1', filename: 'logo.png', content_type: 'image/png', size: 2_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(correo(), m.p)
    expect(r.texto).toBe('El correo no trae ninguna factura (logo.png: es una imagen pequeña (la firma o el logo del correo)) ni un enlace para bajarla.')
    expect(m.registro).toMatchObject([{ resultado: 'sin_facturas' }])
  })
})

// D01 · Liquidaciones por correo (T2, 15/10): la misma entrada, enrutada por la
// clase de la dirección. Resúmenes inventados con la forma de los de Uber.
describe('recibirCorreo: liquidaciones-<empresa>@', () => {
  const resumen = correoUber({ desde: '2026-09-21', hasta: '2026-09-27', dias: [{ fecha: '2026-09-24', pedidos: 2, ventas: 40, impuesto: 4 }],
    desglose: { ventas: 44, pedidosVentas: 2, tasas: -13.31, promociones: -5 } })
  function mundoLiq(o: { adjuntos?: AdjuntoResend[]; cuerpoEnWebhook?: boolean } = {}) {
    const m = mundo({ adjuntos: o.adjuntos })
    const registradas: { companyId: string; datos: Record<string, unknown> }[] = []
    const cuerpos: string[] = []
    m.p.destino = async (lp) => (lp === 'liquidaciones-taberna-norte' ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: 'liquidaciones' }
      : lp === 'facturas-taberna-norte' ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: 'facturas' } : null)
    m.p.cuerpo = async (id) => { cuerpos.push(id); return { html: resumen.html, text: null } }
    m.p.liquidacion = async (x) => { registradas.push(x as never); return { id: 'liq-1', yaEstaba: false, texto: 'Liquidación del 21/09 al 27/09/2026 leída.', factura: 'creada' } }
    return { ...m, registradas, cuerpos }
  }
  const aLiq = (o: Partial<CorreoResend> = {}) => correo({ to: ['liquidaciones-taberna-norte@entrada.folvy.app'], from: 'noreply@uber.com', subject: resumen.subject, ...o })

  it('las clases con prefijo se reconocen en cualquier dominio; sin prefijo, solo en uno de entrada (y manda la base)', () => {
    expect(direccionesDeFacturas({ to: ['liquidaciones-taberna-norte@entrada.folvy.app', 'nominas-x@entrada.folvy.app', 'nominas-x@ejemplo.test'] }).map((d) => d.localPart))
      .toEqual(['liquidaciones-taberna-norte', 'nominas-x'])
  })
  it('un resumen de Uber: pide el cuerpo a Resend, lo lee y lo registra con su factura; al registro, solo ids y recuentos', async () => {
    const m = mundoLiq()
    const r = await recibirCorreo(aLiq(), m.p)
    expect([r.resultado, r.texto]).toEqual(['liquidacion', 'Liquidación del 21/09 al 27/09/2026 leída.'])
    expect(m.cuerpos).toEqual(['e1'])
    expect(m.registradas).toHaveLength(1)
    expect(m.registradas[0]).toMatchObject({ companyId: 'emp', datos: { proveedor: 'uber', email_id: 'e1', desde: '2026-09-21', neto: 25.69, factura: { total: 13.31 } } })
    expect(m.registro).toEqual([expect.objectContaining({ resultado: 'liquidacion', companyId: 'emp',
      detalle: { liquidacion_id: 'liq-1', ya_estaba: false, factura: 'creada', avisos: 0, mensual: false } })])
    expect(m.llegadas).toEqual([])
  })
  it('el resumen del mes adjunto se guarda con la liquidación (y nada más se toma)', async () => {
    const m = mundoLiq({ adjuntos: [
      { id: '1', filename: 'monthly_statement_September_2026.pdf', content_type: 'application/pdf', size: 90_000, download_url: 'https://r/mes' },
      { id: '2', filename: 'logo.png', content_type: 'image/png', size: 2_000, download_url: 'https://r/logo' }] })
    await recibirCorreo(aLiq(), m.p)
    expect(m.subidas).toEqual(['acc/_liquidaciones/e1/monthly_statement_September_2026.pdf'])
    expect((m.registradas[0].datos as { mensual: unknown }).mensual).toBeNull() // este resumen inventado no trae «Resumen unificado»
  })
  it('lo que no es un resumen de pagos se apunta y se dice; no se registra nada', async () => {
    const m = mundoLiq()
    const r = await recibirCorreo(aLiq({ subject: 'Novedades de la plataforma', html: '<p>Hola</p>' }), m.p)
    expect(r.resultado).toBe('no_es_liquidacion')
    expect(r.texto).toBe('No es un resumen de pagos de Uber Eats. Queda apuntado y no se lee: por ahora se leen los resúmenes de pagos de Uber Eats y las liquidaciones de Just Eat.')
    expect(m.registradas).toEqual([])
    expect(m.registro).toMatchObject([{ resultado: 'no_es_liquidacion', detalle: { motivo: 'No es un resumen de pagos de Uber Eats.' } }])
  })
  it('V02 · E2 · una liquidación de Just Eat (el correo de verdad de la factura 4126424): se lee y se registra como liquidación', async () => {
    const m = mundoLiq()
    const html = readFileSync('tests/unit/modules/conta/v02/fixtures/liquidaciones/justeat-4126424.html', 'utf8')
    const r = await recibirCorreo(aLiq({ from: 'Just Eat Takeaway <noreplyes@justeat-int.com>', subject: 'Just-eat invoice: 4126424', html }), m.p)
    expect(r.resultado).toBe('liquidacion')
    expect(m.registradas[0]).toMatchObject({ companyId: 'emp', datos: { proveedor: 'justeat', origen: 'correo', email_id: 'e1', tienda: 'Milanesa House (Calle de Florencio Llorente 29)',
      desde: '2026-10-01', hasta: '2026-10-15', neto: 90.3, factura: { numero: '4126424', total: 32.79 } } })
    expect(m.registro).toEqual([expect.objectContaining({ resultado: 'liquidacion', detalle: { liquidacion_id: 'liq-1', ya_estaba: false, factura: 'creada', avisos: 0, plataforma: 'justeat' } })])
  })
  it('la confirmación de reenvío de Gmail: se apunta su código, en las dos clases', async () => {
    for (const to of ['liquidaciones-taberna-norte@entrada.folvy.app', 'facturas-taberna-norte@entrada.folvy.app']) {
      const m = mundoLiq()
      const r = await recibirCorreo(correo({ to: [to], from: 'Equipo de Gmail <forwarding-noreply@google.com>', subject: '(#123456789) Confirmación de reenvío de Gmail - Recibir correo de alguien@ejemplo.test' }), m.p)
      expect([r.resultado, r.texto]).toEqual(['confirmacion', `Gmail pide confirmar el reenvío a ${to}: el código es 123456789. Escríbelo en Gmail.`])
      expect(m.registro).toMatchObject([{ resultado: 'confirmacion', detalle: { codigo: '123456789' } }])
      expect(m.llegadas).toEqual([])
    }
  })
  it('a facturas-…@, lo de siempre (aunque sea un resumen de Uber: no se lee como liquidación)', async () => {
    const m = mundoLiq({ adjuntos: [{ id: '1', filename: 'f.pdf', content_type: 'application/pdf', size: 30_000, download_url: 'https://r/1' }] })
    const r = await recibirCorreo(correo({ subject: resumen.subject }), m.p)
    expect(r.resultado).toBe('recibido')
    expect(m.registradas).toEqual([])
    expect(m.cuerpos).toEqual([])
  })
})

// D01 · Que no se pierda ningún correo (Julio, 16/10). Un reenvío automático de
// Gmail conserva el To: original —el buzón de quien reenvía— y la dirección de
// entrada va solo en el sobre. Antes, un correo así se contestaba «ignorado» y
// no quedaba en el registro: se perdía sin rastro. Ahora se enruta por el sobre
// si Resend lo trae (en el evento o al pedir el correo entero), y si no lo trae,
// se apunta «sin destino». Buzones y correos inventados.
describe('recibirCorreo: el reenvío que conserva el To: original', () => {
  const resumen = correoUber({ desde: '2026-09-21', hasta: '2026-09-27', dias: [{ fecha: '2026-09-24', pedidos: 2, ventas: 40, impuesto: 4 }],
    desglose: { ventas: 44, pedidosVentas: 2, tasas: -13.31, promociones: -5 } })
  const NUESTRA = 'liquidaciones-taberna-norte@entrada.folvy.app'
  // Como lo deja Gmail al reenviar con un filtro: el To: y el From: de siempre.
  const reenviado = (o: Partial<CorreoResend> & Record<string, unknown> = {}) =>
    correo({ email_id: 'e-reenvio', from: 'Uber Eats <noreply@uber.com>', to: ['Buzón Inventado <buzon.inventado@ejemplo.test>'], subject: resumen.subject, ...o })
  function mundoReenvio(entero: Record<string, unknown> | null = null) {
    const m = mundo()
    const registradas: unknown[] = []
    const pedidos: string[] = []
    m.p.destino = async (lp) => (lp === 'liquidaciones-taberna-norte' ? { companyId: 'emp', accountId: 'acc', activa: true, tipo: 'liquidaciones' } : null)
    m.p.cuerpo = async () => ({ html: resumen.html, text: null })
    m.p.liquidacion = async (x) => { registradas.push(x); return { id: 'liq-1', yaEstaba: false, texto: 'Liquidación del 21/09 al 27/09/2026 leída.', factura: 'creada' } }
    m.p.correoEntero = async (id) => { pedidos.push(id); return entero as never }
    return { ...m, registradas, pedidos }
  }

  it('el To: es el buzón de quien reenvía y la nuestra va en el sobre del evento: se enruta por él y se dice', async () => {
    const m = mundoReenvio()
    const r = await recibirCorreo(reenviado({ envelope: { to: [NUESTRA] } } as never), m.p)
    expect([r.resultado, r.texto]).toEqual(['liquidacion', 'Liquidación del 21/09 al 27/09/2026 leída.'])
    expect(m.registradas).toHaveLength(1)
    expect(m.registro).toEqual([expect.objectContaining({ resultado: 'liquidacion', companyId: 'emp', to: NUESTRA, porSobre: true })])
    expect(m.pedidos).toEqual([]) // con el sobre en el evento no hace falta pedir el correo entero
  })
  it('la nuestra solo en bcc (como deja Resend un destinatario que no está en las cabeceras): se enruta igual', async () => {
    const m = mundoReenvio()
    const r = await recibirCorreo(reenviado({ bcc: [NUESTRA] }), m.p)
    expect(r.resultado).toBe('liquidacion')
  })
  it('el evento no trae el sobre; el correo entero sí, en sus cabeceras (X-Forwarded-To, Delivered-To): se pide y se enruta', async () => {
    for (const headers of [{ 'X-Forwarded-To': NUESTRA }, [{ name: 'Delivered-To', value: NUESTRA }], { 'X-Forwarded-For': `buzon.inventado@ejemplo.test ${NUESTRA}` }]) {
      const m = mundoReenvio({ to: ['buzon.inventado@ejemplo.test'], headers })
      const r = await recibirCorreo(reenviado(), m.p)
      expect([r.resultado, m.pedidos]).toEqual(['liquidacion', ['e-reenvio']])
      expect(m.registro).toEqual([expect.objectContaining({ resultado: 'liquidacion', porSobre: true })])
    }
  })
  it('sin la nuestra en ningún sitio: NO se pierde, queda apuntado «sin destino» (solo con el recuento de destinatarios) y no se lee', async () => {
    const m = mundoReenvio({ to: ['buzon.inventado@ejemplo.test'], headers: { Subject: 'x' } })
    const r = await recibirCorreo(reenviado(), m.p)
    expect(r.resultado).toBe('sin_destino')
    expect(m.registradas).toEqual([])
    expect(m.registro).toEqual([{ emailId: 'e-reenvio', to: 'Buzón Inventado <buzon.inventado@ejemplo.test>', from: 'Uber Eats <noreply@uber.com>', subject: resumen.subject,
      companyId: null, resultado: 'sin_destino', detalle: { motivo: 'ninguna dirección de entrada en sus destinatarios ni en el sobre', destinatarios: 1 } }])
  })
  it('si Resend no da el correo entero (falla o no está), también se apunta «sin destino»', async () => {
    const m = mundoReenvio()
    m.p.correoEntero = async () => { throw new Error('Resend 500') }
    expect((await recibirCorreo(reenviado(), m.p)).resultado).toBe('sin_destino')
    expect(m.registro).toHaveLength(1)
  })
  it('el mismo correo otra vez (Resend reintenta): no se apunta dos veces', async () => {
    const m = mundoReenvio()
    m.p.yaVisto = async () => true
    expect((await recibirCorreo(reenviado(), m.p)).resultado).toBe('repetido')
    expect(m.registro).toEqual([])
  })
  it('el sobre se lee en sus formas: lista, cadena, cabeceras como objeto o como lista; lo que no es de entrada, fuera', () => {
    expect(destinatariosDelSobre({ envelope: { to: NUESTRA } }).map((d) => d.direccion)).toEqual([NUESTRA])
    expect(destinatariosDelSobre({ delivered_to: ['otro@ejemplo.test', `<${NUESTRA}>`] }).map((d) => d.direccion)).toEqual([NUESTRA])
    expect(destinatariosDelSobre({ headers: { 'x-original-to': 'Facturas-Taberna-Norte@Entrada.Folvy.App' } }).map((d) => d.localPart)).toEqual(['facturas-taberna-norte'])
    expect(destinatariosDelSobre({ headers: { To: NUESTRA } })).toEqual([]) // el To: no es el sobre
    expect(destinatariosDelSobre(null)).toEqual([])
  })
})

// D01 · Las facturas de los proveedores por correo (Julio, 16/10). Cada
// proveedor reenvía desde su buzón a facturas-<empresa>@. Los tres casos, con
// correos inventados: la factura, la misma factura otra vez (en otro correo) y
// los justificantes de entrega que un proveedor manda desde otra dirección. Y
// la confirmación del reenvío que se hace con el enlace, no con el código.
describe('recibirCorreo: las facturas de los proveedores', () => {
  const FACTURAS = 'facturas-taberna-norte@entrada.folvy.app'
  const BUZON = 'oficina@cliente-inventado.test'
  const PDF: AdjuntoResend = { id: '1', filename: 'Factura F-2026-0412.pdf', content_type: 'application/pdf', size: 48_000, download_url: 'https://r/uno' }
  // El reenvío automático de Gmail: conserva el From: del proveedor y el To: del buzón; la nuestra va en el sobre.
  const reenviado = (o: Partial<CorreoResend & { envelope: { to: string[] } }> = {}) =>
    ({ ...correo({ from: 'Panadería Inventada <facturacion@panaderia-inventada.test>', to: [BUZON], subject: 'Factura F-2026-0412', ...o }), envelope: { to: [FACTURAS] } })
  function mundoProv(o: { leer?: (id: string) => { estado: string; texto: string } } = {}) {
    const m = mundo({ adjuntos: [PDF] })
    const preguntas: string[] = []
    m.p.remitente = async (emp, de) => {
      preguntas.push(`${emp} ${de}`)
      return /justificantes@panaderia-inventada\.test/.test(de) ? { decision: 'no_facturas', motivo: 'Desde esa dirección el proveedor manda sus justificantes de entrega, que no son facturas.' } : null
    }
    if (o.leer) m.p.leer = async (id) => o.leer!(id)
    return { ...m, preguntas }
  }

  it('la factura: reenviada desde el buzón, se enruta por el sobre, se pregunta por su remitente y se lee', async () => {
    const m = mundoProv()
    const r = await recibirCorreo(reenviado(), m.p)
    expect([r.resultado, r.texto]).toEqual(['recibido', '1 documento recibido.'])
    expect(m.preguntas).toEqual(['emp Panadería Inventada <facturacion@panaderia-inventada.test>'])
    expect(m.subidas).toEqual(['acc/_correo/e1/01-Factura-F-2026-0412.pdf'])
    expect(r.llegadas).toEqual([{ id: 'l1', estado: 'factura', texto: 'l1: leída' }])
    expect(m.registro).toMatchObject([{ resultado: 'recibido', companyId: 'emp', to: FACTURAS, porSobre: true }])
  })
  it('la misma factura otra vez, en otro correo y con el mismo PDF: «ya estaba», no se lee otra vez', async () => {
    const m = mundoProv()
    await recibirCorreo(reenviado({ email_id: 'e1' }), m.p)
    const r = await recibirCorreo(reenviado({ email_id: 'e2' }), m.p)
    expect(r.llegadas).toEqual([{ id: 'l2', estado: 'repetido', texto: 'Factura-F-2026-0412.pdf: ya estaba (el mismo fichero llegó antes).' }])
    expect(m.llegadas.map((x) => x.sha256)).toEqual([m.llegadas[0].sha256, m.llegadas[0].sha256])
  })
  it('la misma factura otra vez con OTRO PDF (otros bytes): se lee, y la base la reconoce por su número', async () => {
    const m = mundoProv({ leer: (id) => (id === 'l1' ? { estado: 'factura', texto: 'He leído la F-2026-0412: todo cuadra.' } : { estado: 'repetida', texto: 'Ya estaba la F-2026-0412: no se apunta dos veces.' }) })
    await recibirCorreo(reenviado({ email_id: 'e1' }), m.p)
    m.p.bajar = async () => new TextEncoder().encode('%PDF el mismo papel, generado otra vez')
    const r = await recibirCorreo(reenviado({ email_id: 'e2' }), m.p)
    expect(r.llegadas).toEqual([{ id: 'l2', estado: 'repetida', texto: 'Ya estaba la F-2026-0412: no se apunta dos veces.' }])
  })
  it('el justificante de entrega, desde la otra dirección del proveedor: no se lee como factura, ni se baja nada; se apunta y se dice', async () => {
    const m = mundoProv()
    const r = await recibirCorreo(reenviado({ from: 'Panadería Inventada <justificantes@panaderia-inventada.test>', subject: 'Justificante de entrega 8812' }), m.p)
    expect([r.resultado, r.texto]).toEqual(['no_es_factura',
      'No se lee como factura: Desde esa dirección el proveedor manda sus justificantes de entrega, que no son facturas. Queda apuntado en el registro de entrada.'])
    expect(m.subidas).toEqual([])
    expect(m.llegadas).toEqual([])
    expect(m.registro).toMatchObject([{ resultado: 'sin_facturas', companyId: 'emp', detalle: { motivo: 'remitente_no_facturas' } }])
  })
  it('sin la regla en la base (la función de la base aún no está), el remitente no frena nada', async () => {
    const m = mundo({ adjuntos: [PDF] })
    const r = await recibirCorreo(reenviado({ from: 'justificantes@panaderia-inventada.test' }), m.p)
    expect(r.resultado).toBe('recibido')
  })
  it('a liquidaciones-…@ no se pregunta por el remitente', async () => {
    const m = mundoProv()
    m.p.destino = async () => ({ companyId: 'emp', accountId: 'acc', activa: true, tipo: 'liquidaciones' })
    m.p.cuerpo = async () => ({ html: '<p>Hola</p>', text: null })
    m.p.liquidacion = async () => ({ id: 'x', yaEstaba: false, texto: '', factura: null })
    await recibirCorreo(correo({ to: ['liquidaciones-taberna-norte@entrada.folvy.app'], from: 'justificantes@panaderia-inventada.test' }), m.p)
    expect(m.preguntas).toEqual([])
  })

  const CONFIRMA = 'https://mail-settings.google.com/mail/vf-%5BANGjdJ8-inventado%5D-AbCdEf123'
  const confirmacion = (o: Partial<CorreoResend> = {}) => correo({ to: [FACTURAS], from: 'Equipo de Gmail <forwarding-noreply@google.com>',
    subject: '(#987654321) Confirmación de reenvío de Gmail - Recibir correo de oficina@cliente-inventado.test', ...o })
  it('la confirmación con enlace (buzón de Google Workspace): pide el cuerpo, apunta el enlace y el código, y no se lee como factura', async () => {
    const m = mundoProv()
    const cuerpos: string[] = []
    m.p.cuerpo = async (id) => { cuerpos.push(id); return { text: null, html: `<p>Para permitirlo, haz clic en el enlace:</p><a href="${CONFIRMA}">${CONFIRMA}</a>` } }
    const r = await recibirCorreo(confirmacion(), m.p)
    expect(cuerpos).toEqual(['e1'])
    expect([r.resultado, r.texto]).toEqual(['confirmacion',
      `Gmail pide confirmar el reenvío a ${FACTURAS}: el código es 987654321, o abre el enlace del correo (los dos quedan apuntados en el registro de entrada).`])
    expect(m.registro).toMatchObject([{ resultado: 'confirmacion', detalle: { codigo: '987654321', enlace: CONFIRMA } }])
    expect(m.llegadas).toEqual([])
    expect(m.preguntas).toEqual([])
  })
  it('la confirmación solo con enlace (sin código): se apunta el enlace', async () => {
    const m = mundoProv()
    m.p.cuerpo = async () => ({ text: `Haz clic para confirmar: ${CONFIRMA}`, html: null })
    const r = await recibirCorreo(confirmacion({ subject: 'Confirmación de reenvío de Gmail' }), m.p)
    expect(r.texto).toBe(`Gmail pide confirmar el reenvío a ${FACTURAS}: se confirma abriendo el enlace del correo (queda apuntado en el registro de entrada).`)
    expect(m.registro).toMatchObject([{ resultado: 'confirmacion', detalle: { codigo: null, enlace: CONFIRMA } }])
  })
  it('un enlace que no es de Google no se toma por el de confirmación', async () => {
    const m = mundoProv()
    m.p.cuerpo = async () => ({ text: 'Confirma aquí: https://mail-settings.google.com.engano.test/mail/vf-falso', html: null })
    const r = await recibirCorreo(confirmacion(), m.p)
    expect(m.registro).toMatchObject([{ resultado: 'confirmacion', detalle: { codigo: '987654321', enlace: null } }])
    expect(r.texto).toBe(`Gmail pide confirmar el reenvío a ${FACTURAS}: el código es 987654321. Escríbelo en Gmail.`)
  })
})
