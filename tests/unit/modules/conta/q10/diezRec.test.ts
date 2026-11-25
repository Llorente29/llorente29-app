// tests/unit/modules/conta/q10/diezRec.test.ts
//
// Q10 · respuesta 1 · El cliente de la API DiezREC: solo lee (el único POST es el login), el login con «empresa» y,
// si no vale, «codigoEmpresa», las rutas de los listados y las formas cortas. Sin red: fetch inventado (T11; y nunca
// contra el Cegid de QBO en una prueba).

import { describe, expect, it } from 'vitest'
import { ClienteDiezRec, clienteCegid, conceptoCegid, conceptosFijos, esUltima, facturaCegid, motivoDeError, rutaListado } from '../../../../../supabase/functions/_shared/diezRec'

const claves = { client_id: 'id-de-prueba', client_secret: 'secreto-de-prueba', username: 'usuario', password: 'clave' }
function red(respuestas: ((url: string, init: { method: string; headers: Record<string, string>; body?: string }) => { status: number; body: unknown })[]) {
  const llamadas: { url: string; method: string; body: Record<string, unknown> | null; auth: string | undefined }[] = []
  let i = 0
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    llamadas.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization })
    const r = respuestas[Math.min(i++, respuestas.length - 1)](url, init)
    return { status: r.status, text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }
  }
  return { llamadas, fetch }
}

describe('Q10 · DiezREC · el login', () => {
  it('con «empresa»; el token va en cada lectura', async () => {
    const n = red([() => ({ status: 200, body: { id: '1', auth_token: 'tok', expires_in: 7200 } }), () => ({ status: 200, body: { resultadosTotales: 1, datos: [{ codigo: '1' }] } })])
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch })
    const p = await c.pagina('series', 0)
    expect(c.campoEmpresa).toBe('empresa')
    expect(n.llamadas[0]).toMatchObject({ method: 'POST', url: 'https://apirec.diezsoftware.com/api/Auth/login', body: { userName: 'usuario', clientId: 'id-de-prueba', empresa: '1' } })
    expect(n.llamadas[1]).toMatchObject({ method: 'GET', auth: 'Bearer tok' })
    expect(p).toEqual({ filas: [{ codigo: '1' }], total: 1, ultima: true })
  })
  it('si «empresa» da 400, prueba «codigoEmpresa»', async () => {
    const n = red([() => ({ status: 400, body: { 'error de acceso': ['Usuario desconocido.'] } }), () => ({ status: 200, body: { auth_token: 'tok' } })])
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch })
    await c.entrar()
    expect(c.campoEmpresa).toBe('codigoEmpresa')
    expect(n.llamadas[1].body).toMatchObject({ codigoEmpresa: '1' })
  })
  it('si no entra con ninguno, lo dice sin repetir las claves', async () => {
    const n = red([() => ({ status: 400, body: { 'error de acceso': ['Usuario desconocido.'], Error: 'Error 7 - No tiene contratado el programa.' } })])
    await expect(new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }).entrar()).rejects.toThrow(
      'Cegid no ha dejado entrar (400): Usuario desconocido. Error 7 - No tiene contratado el programa.')
    await expect(new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }).entrar()).rejects.not.toThrow(/secreto-de-prueba|clave/)
  })
  it('con 401 (token caducado) vuelve a entrar una vez', async () => {
    const n = red([() => ({ status: 200, body: { auth_token: 't1' } }), () => ({ status: 401, body: undefined }), () => ({ status: 200, body: { auth_token: 't2' } }),
      () => ({ status: 200, body: { resultadosTotales: 0, datos: [] } })])
    const p = await new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }).pagina('clientes', 0)
    expect(p.filas).toEqual([])
    expect(n.llamadas.map((x) => x.auth ?? x.method)).toEqual(['POST', 'Bearer t1', 'POST', 'Bearer t2'])
  })
})

describe('Q10 · DiezREC · solo lee', () => {
  it('no sale nada que no sea GET o el login', async () => {
    const n = red([() => ({ status: 200, body: { auth_token: 'tok' } })])
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }) as unknown as { llamar: (m: string, r: string, b?: unknown) => Promise<unknown> }
    await expect(c.llamar('POST', '/api/Incidences/incidence', {})).rejects.toThrow('Sumied solo lee de la facturación de Cegid: POST /api/Incidences/incidence no sale.')
    await expect(c.llamar('DELETE', '/api/Incidences/delete/1/2')).rejects.toThrow(/solo lee/)
    expect(n.llamadas).toEqual([])
  })
})

describe('Q10 · DiezREC · rutas y formas cortas', () => {
  it('listados de 200 en 200, $skip es la página, con $orderby fijo; las facturas por ejercicio', () => {
    expect(rutaListado('clientes', 2)).toBe('/api/Customers?$orderby=codigo&$top=200&$skip=2')
    expect(rutaListado('facturas', 0, 2026)).toBe('/api/Invoices?$filter=ejercicio%20eq%202026&$orderby=codigo&$top=200&$skip=0')
    expect(esUltima(0, 200, 450)).toBe(false)
    expect(esUltima(2, 50, 450)).toBe(true)
    expect(esUltima(1, 200, 400)).toBe(true)
  })
  it('cliente, conceptos fijos, concepto y factura', () => {
    expect(clienteCegid({ codigo: 167, nombreComercial: 'EJEMPLO', nombreFisCal: 'EMPRESA EJEMPLO S.L.', nif: 'B00000000', email: 'a@ejemplo.test' }))
      .toEqual({ codigo: 167, nombre_comercial: 'EJEMPLO', nombre_fiscal: 'EMPRESA EJEMPLO S.L.', nif: 'B00000000', email: 'a@ejemplo.test' })
    expect(conceptosFijos({ detalleConceptos: [{ codigoConcepto: '0008', importe: 20, cantidad: 5, totalLinea: 100, descripcion: 'GESTIÓN LABORAL' }] }))
      .toEqual([{ codigoConcepto: '0008', descripcion: 'GESTIÓN LABORAL', importe: 20, cantidad: 5, totalLinea: 100 }])
    expect(conceptoCegid({ codigo: 'HON01', descripcion: 'HONORARIOS', importe: 100, area: 3, extraordinario: false })).toMatchObject({ con_retencion: null, iva_incluido: null })
    expect(conceptoCegid({ codigo: 'HON01', porIva: 21, conRetencion: '*', ivaIncluido: null })).toMatchObject({ por_iva: 21, con_retencion: true, iva_incluido: false })
    expect(facturaCegid({ ejercicio: 2026, serie: '1', codigo: 2742, cliente: 167, base1: 100, base2: 75.28, cuotaIva1: 21, cuotaIva2: 15.81, totalFactura: 212.09, retencion: 0, fecha: 46331, details: [{ linea: 1 }] }))
      .toMatchObject({ ejercicio: 2026, serie: '1', codigo: 2742, cliente: 167, base: 175.28, iva: 36.81, total: 212.09, fecha_cegid: 46331, lineas: [{ linea: 1 }] })
  })
  it('los errores, en una línea', () => {
    expect(motivoDeError('Debe indicar un código de concepto existente')).toBe('Debe indicar un código de concepto existente')
    expect(motivoDeError({ title: 'One or more validation errors occurred.', errors: { UserName: ['The UserName field is required.'] } })).toBe('The UserName field is required.')
  })
})

describe('Q10 · DiezREC · «Probar la conexión» dice a qué empresa ha entrado', async () => {
  const { fraseProbado, rutaUltimaFactura } = await import('../../../../../supabase/functions/_shared/diezRec')
  it('la última factura del año de una serie', () => {
    expect(rutaUltimaFactura(2026, '1')).toBe("/api/Invoices?$filter=ejercicio%20eq%202026%20and%20serie%20eq%20'1'&$orderby=codigo%20desc&$top=1&$skip=0")
  })
  it('por lo que lee: sus series con su última factura y cuántos clientes', () => {
    expect(fraseProbado({ campo: 'empresa', empresa: '1000', idCliente: '1234', clientes: 412, ejercicio: 2026,
      series: [{ codigo: '1', descripcion: 'GENERAL', ultima: { ejercicio: 2026, codigo: 2749 } }, { codigo: '3', descripcion: null, ultima: null }] }))
      .toBe('Conectada con la facturación de Cegid: ha entrado en la empresa 1000 (con «empresa»; cliente de Diez Software 1234). Tiene 412 clientes. '
        + 'Series: 1 («GENERAL»): la última de 2026 es la 2026/1/2749; 3: ninguna factura de 2026. Mira que es la empresa que toca. No se ha escrito nada.')
  })
  it('el login guarda el id del cliente de Diez Software', async () => {
    let i = 0
    const fetch = async () => ({ status: 200, text: async () => JSON.stringify(i++ === 0 ? { id: '1234', auth_token: 'tok' } : {}) })
    const c = new ClienteDiezRec({ claves, empresa: '1000', fetch })
    await c.entrar()
    expect(c.idCliente).toBe('1234')
  })
})
