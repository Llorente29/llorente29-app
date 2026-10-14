// D01 · Tarea 4 · El correo de facturas de cada empresa: la firma de Resend
// (svix), las direcciones, los adjuntos y el recorrido entero contra dobles
// (Resend y la base). Todo inventado.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  clasificarAdjuntos, comprobarFirma, direccionesDeFacturas, enlacesDeFactura, firmaSvix, nombreSeguro, recibirCorreo, rutaEntrada,
  type AdjuntoResend, type CorreoResend, type PuertoEntrada,
} from '../../../supabase/functions/_shared/facturasEntrada'

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
    expect(direccionesDeFacturas({ to: ['facturas@entrada.folvy.app', 'nominas-x@entrada.folvy.app'] })).toEqual([])
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
