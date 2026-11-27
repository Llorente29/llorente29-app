/// <reference lib="dom" />
// tests/e2e/conta/x35/siembra.ts
//
// X35 · Lo que lee «El mes de un vistazo», simulado: lo de «Facturas del mes» COPIADO TAL CUAL de la e2e de la Q10
// (../q10/facturas-noviembre.spec.ts: los cobros, lo leído de Cegid ya leído, lo mandado y lo cobrado por el banco) y lo
// de «Clientes y cuotas» de la del R20 (../r20/cifras.spec.ts: «Te deben», cruzado con el banco, y el próximo cobro). Así
// las dos pantallas leen lo mismo en la misma prueba. Todo inventado (T11). Nada se escribe.

import type { Page, Route } from '@playwright/test'
import { dia, FRASES, pantallas, siembra } from '../g04/siembra'

type Fila = Record<string, unknown>
const json = (r: Route, cuerpo: unknown) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/*' }, body: JSON.stringify(cuerpo) })

/** El mes que viene (AAAA-MM). */
export const mesQueViene = () => { const [a, m] = dia(0).slice(0, 7).split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}` }

/** Lo de «Clientes y cuotas» (como la e2e del R20): «Te deben» cruzado con el banco y el próximo cobro de GoCardless. */
export async function simularCuenta(page: Page, Q: string, A: string) {
  const datos = siembra(Q, A)
  const M = mesQueViene()
  datos.conta_consulta_cargo_devuelto.push({ cuenta_id: 'x', empresa_id: Q, gc_id: 'PM2', suscripcion_gc_id: 'S3-viejo', estado: 'failed', fecha: dia(-100), importe: 60.5,
    clientes: ['c3'], mandato_activo: false, cobrado_despues: false, otra_via: null })
  const s = (gc: string, ficha: string | null, cliente: string, importe: number, d: string) =>
    ({ empresa_id: Q, gc_id: `SB-${gc}`, gc_cliente_id: `CU-${gc}`, cliente_gc: cliente, ficha_id: ficha, nombre: 'GESTORIA MENSUAL', fecha: `${M}-${d}`, importe })
  const cobro = { meses: [{ empresa_id: Q, mes: M, leido_at: `${dia(0)}T06:15:00Z` }],
    suscripciones: [s('1', 'c1', 'PANADERIA MUESTRA SL', 145, '04'), s('3', 'c3', 'ESTUDIO DE PRUEBA SL', 121, '04'), s('8', 'c8', 'TRANSPORTES DE EJEMPLO SL', 496.1, '04')] }
  await page.route(/\/rest\/v1\/([a-z_]+)\?/, (r) => {
    const nombre = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    if (r.request().method() !== 'GET' || !(nombre in datos)) return r.fallback()
    return json(r, datos[nombre as keyof typeof datos])
  })
  const banco = { cruzadas: [Q], recibos: [{ empresa_id: Q, gc_id: 'PM1', movement_id: 'mov-1', importe: 108.9, fecha: dia(-60), via: 'transferencia' }],
    tarjeta: [{ empresa_id: Q, movement_id: 'tpv-1', fecha: dia(-5), importe: 300 }, { empresa_id: Q, movement_id: 'tpv-2', fecha: dia(-4), importe: 20.28 }] }
  const LECTURAS: Record<string, (c: Record<string, unknown>) => unknown> = { ...pantallas(datos), conta_cifras_del_cobro: () => cobro, conta_cifras_del_banco: () => banco }
  await page.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (r) => {
    const f = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.request().url())![1]
    const cuerpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>
    if (f in LECTURAS) return json(r, LECTURAS[f](cuerpo))
    if (f in FRASES) return json(r, FRASES[f](cuerpo))
    return r.fallback()
  })
}

/** Lo de «Facturas del mes», copiado de la e2e de la Q10 (con lo de Cegid ya leído y el mes que se le diga). */
export async function simularQ10(page: Page, Q: string, A: string, MES: string) {
  const conectada = true, fijos = false as boolean
  const BANCO = bancoDe(MES)

  const NIF = { [Q]: 'B00000000', [A]: '00000000T' }
  const NOMBRE = { [Q]: 'Gestoría de Prueba Norte, S.L.', [A]: 'Autónoma de Prueba' }
  await page.route(/\/rest\/v1\/company\?/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const resp = await r.fetch().catch(() => null)
    if (!resp) return
    let cuerpo: unknown = await resp.json().catch(() => null)
    const cambiar = (x: Fila) => {
      const id = String(x.id)
      if (!(id in NIF)) return x
      const y: Fila = { ...x, sector: 'gestoria', is_hospitality: false, tax_id: NIF[id], fiscal_street: 'Calle Inventada 1', fiscal_postal_code: '28000', fiscal_city: 'Madrid', email: 'gestoria@ejemplo.test' }
      for (const k of ['legal_name', 'trade_name', 'name', 'nombre', 'commercial_name']) if (k in y) y[k] = NOMBRE[id]
      return y
    }
    cuerpo = Array.isArray(cuerpo) ? cuerpo.map((x) => cambiar(x as Fila)) : cuerpo && typeof cuerpo === 'object' ? cambiar(cuerpo as Fila) : cuerpo
    return r.fulfill({ response: resp, body: JSON.stringify(cuerpo) })
  })
  const cobro = (gc: string, importe: number, fecha: string, estado = 'paid_out', x: Fila = {}) =>
    ({ gc_id: `PM${gc}`, estado, fecha, importe, suscripcion_gc_id: `SB${gc}`, mandato_gc_id: `MD${gc}`, motivo_es: null, ...x })
  const cobros = [
    cobro('1', 121, `${MES}-03`), cobro('2', 53, `${MES}-04`), cobro('3', 24.2, `${MES}-04`), cobro('4', 60.5, `${MES}-24`, 'confirmed'),
    // Sin cliente atado, sin NIF y un cobro suelto: a «Pendiente de revisar».
    cobro('5', 121, `${MES}-04`), cobro('6', 36.3, `${MES}-05`), cobro('7', 99, `${MES}-09`, 'paid_out', { suscripcion_gc_id: null }),
    // Lo que GoCardless no cobró: sin factura.
    cobro('8', 121, `${MES}-04`, 'failed', { motivo_es: 'Fondos insuficientes' }), cobro('9', 53, `${MES}-04`, 'charged_back'),
    // El Contasimple del cliente 1: su factura va aparte, en la serie 3.
    cobro('10', 36.3, `${MES}-05`, 'paid_out', { mandato_gc_id: 'MD1' }),
    // Respuesta 4: un cobro suelto del cliente 1, con su texto; su concepto se confirma en la pantalla.
    ...(fijos ? [cobro('11', 96.8, `${MES}-06`, 'paid_out', { mandato_gc_id: 'MD1', suscripcion_gc_id: null, descripcion: 'Renta anual de prueba 2023' })] : []),
  ]
  const sus = (gc: string, nombre: string) => ({ gc_id: `SB${gc}`, nombre, gc_cliente_id: `CU${gc}` })
  const suscripciones = [sus('1', 'GESTORIA MENSUAL'), sus('2', 'SERVICIOS GESTORIA'), sus('3', 'GESTION LABORAL PERSONA INVENTADA'), sus('4', 'GESTORIA MENSUAL'),
    sus('5', 'GESTORIA MENSUAL'), sus('6', 'CONTASIMPLE SOFTWARE'), sus('8', 'GESTORIA MENSUAL'), sus('9', 'GESTORIA MENSUAL'),
    { gc_id: 'SB10', nombre: 'CONTASIMPLE SOFTWARE', gc_cliente_id: 'CU1' }]
  const mandatos = Array.from({ length: 9 }, (_, i) => ({ gc_id: `MD${i + 1}`, gc_cliente_id: `CU${i + 1}`, cuenta_final: String(10 + i) }))
  const enlaces = Array.from({ length: 9 }, (_, i) => ({ gc_cliente_id: `CU${i + 1}`, party_id: `p${i + 1}`, estado: i + 1 === 5 ? 'propuesto' : 'atado' }))
  const fichas = [
    ['p1', 'Construcciones Ficticias, S.A.', 'A00000000'], ['p2', 'Talleres de Prueba, S.L.', 'B00000000'], ['p3', 'Persona Inventada Uno', '00000000T'],
    ['p4', 'Comercial Ejemplo, S.L.', 'B00000001'], ['p5', 'Sin Atar de Prueba, S.L.', 'B00000002'], ['p6', 'Sin NIF de Prueba, S.L.', null],
    ['p7', 'Suelto de Prueba, S.L.', 'B00000003'], ['p8', 'Fallido de Prueba, S.L.', 'B00000004'], ['p9', 'Devuelto de Prueba, S.L.', 'B00000005'],
  ].map(([id, name, tax_id]) => ({ id, name, tax_id }))
  // Sus 430 en Sumied: p1, p2 y p4 (el código de su cliente en Cegid); p3 no tiene (se ata por su NIF).
  const enlaces430 = [['p1', '43000101'], ['p2', '43000102'], ['p4', '43000104']].map(([entity_id, code]) => ({ entity_id, company_account: { code } }))
  // Lo leído de Cegid: vacío hasta pulsar «Leer de Cegid».
  let leido = true
  const clientesCegid = [[101, 'A00000000'], [102, 'B00000000'], [103, '00000000T'], [104, 'B00000001']]
    .map(([codigo, nif]) => ({ codigo, nombre_comercial: null, nombre_fiscal: `Cliente Cegid ${codigo}`, nif, conceptos: [] as Fila[], leido_at: '2026-11-25T17:00:00Z' }))
  // Respuesta 3: con «fijos», el 102 tiene un concepto fijo en su ficha de Cegid. Respuesta 6: no lo para porque está
  // entre los revisados (ya lleva «Facturar hasta», conta_cegid_cuota_revisada).
  // Respuesta 4: el 105 de Cegid tiene el mismo correo que el cliente 5 de GoCardless (su ficha no tiene código): se propone atarla.
  if (fijos) clientesCegid.push({ codigo: 105, nombre_comercial: null, nombre_fiscal: 'Cliente Cegid 105', nif: '', conceptos: [], leido_at: '2026-11-25T17:00:00Z', email: 'cinco@ejemplo.test' } as unknown as typeof clientesCegid[number])
  if (fijos) clientesCegid[1].conceptos = [{ codigoConcepto: '0002', descripcion: 'SERVICIOS DE GESTORÍA', totalLinea: 43.8, cantidad: 1, importe: 43.8 }]
  const conceptosCegid = [['0001', 'HONORARIOS MENSUALES'], ['0002', 'SERVICIOS DE GESTORÍA'], ['0008', 'GESTIÓN LABORAL']]
    .map(([codigo, descripcion]) => ({ codigo, descripcion, por_iva: 21, con_retencion: false, iva_incluido: false }))
  const linea = (codigoConcepto: string, importe: number, llevaRetencion = false) => ({ linea: 1, codigoConcepto, importe, total: importe, cantidad: 1, porcentajeIva: 21, llevaRetencion })
  const factura = (codigo: number, cliente: number, lineas: Fila[], ret: number) =>
    ({ ejercicio: 2026, serie: '1', codigo, cliente, nif: null, fecha_cegid: 20261005, total: null, retencion: ret ? 7.5 : 0, porcentaje_retencion: ret || null, lineas })
  const facturasCegid = [factura(2700, 101, [linea('0001', 100)], 0), factura(2701, 102, [linea('0002', 50, true)], 15),
    factura(2702, 103, [linea('0008', 20)], 0), factura(2703, 104, [linea('0001', 50, true)], 15)]
  const TABLAS: Record<string, unknown[]> = { conta_gc_cobro: cobros, conta_gc_suscripcion: suscripciones, conta_gc_mandato: mandatos, conta_gc_enlace: enlaces, party: fichas, customer_fiscal: [],
    company_account_link: enlaces430,
    // El atado de «Clientes y cuotas»: el cliente 5 tiene su enlace solo «propuesto», pero su fila aquí lo ata.
    conta_cobro_cliente: [{ party_id: 'p5', gc_cliente_id: 'CU5' }] }
  const CEGID: Record<string, unknown[]> = { conta_cegid_cliente: clientesCegid, conta_cegid_concepto: conceptosCegid, conta_cegid_factura: facturasCegid,
    conta_cegid_cuota_revisada: [{ cliente: 102 }] }
  await page.route(/\/rest\/v1\/(conta_cegid_cliente|conta_cegid_concepto|conta_cegid_factura|conta_cegid_cuota_revisada)\?/, (r) => {
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    return json(r, leido ? CEGID[t] : [])
  })
  // La conexión: el conector, la de la cuenta (con claves) y la de cada sociedad (con su código).
  const objeto = (r: Route, x: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) })
  await page.route(/\/rest\/v1\/connector\?/, (r) => objeto(r, { id: 'conector-diezrec' }))
  await page.route(/\/rest\/v1\/account_connector\?/, (r) => json(r, conectada ? [{ id: 'ac-cuenta', scope: 'account', company_id: null, external_account_id: null },
    { id: 'ac-q', scope: 'company', company_id: Q, external_account_id: '1' }, { id: 'ac-a', scope: 'company', company_id: A, external_account_id: '1' }] : []))
  await page.route(/\/functions\/v1\/connector-credentials/, (r) => objeto(r, { ok: true, hasCredentials: true }))
  const pedidas: Fila[] = []
  await page.route(/\/functions\/v1\/conta-cegid-leer/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'leer') { leido = true; return objeto(r, { ok: true, que: b.que, pagina: b.pagina, leidas: b.que === 'clientes' ? 4 : b.que === 'conceptos' ? 3 : 4, total: 4, ultima: true }) }
    return objeto(r, { ok: true, que: b.que, desde: b.desde, hechos: 4, ultima: true })
  })
  TABLAS.conta_gc_cliente = fijos ? [{ gc_id: 'CU5', correo: 'cinco@ejemplo.test' }] : []
  TABLAS.conta_cegid_concepto_elegido = []
  // Respuesta 4 · «Confirmar» el concepto (conta_cegid_elegir_concepto).
  await page.route(/\/rest\/v1\/rpc\/conta_cegid_elegir_concepto/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push({ accion: 'elegir', ...b })
    return objeto(r, { concepto: b.p_concepto, frase: `Confirmado: va al concepto ${b.p_concepto} de Cegid.` })
  })
  // Respuesta 7 · Los tres botones de Julio (conta_banco_decidir).
  await page.route(/\/rest\/v1\/rpc\/conta_banco_decidir/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push({ accion: 'decidir', ...b })
    return objeto(r, { decision: b.p_decision, frase: b.p_decision === 'facturar' ? `Apuntado: se factura al cliente ${b.p_cliente} de Cegid con el concepto ${b.p_concepto}.` : 'Apuntado: no es un cobro. No se manda a Cegid.' })
  })
  // Respuesta 4 · «Atar al N» (conta_cegid_atar): pone el código en la fila de «Clientes y cuotas» de la ficha.
  await page.route(/\/rest\/v1\/rpc\/conta_cegid_atar/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push({ accion: 'atar', ...b })
    TABLAS.conta_cobro_cliente = (TABLAS.conta_cobro_cliente as Fila[]).map((x) => x.party_id === b.p_party ? { ...x, codigo_cliente: b.p_codigo } : x)
    return objeto(r, { codigo: b.p_codigo, antes: null, frase: `Atada al cliente ${b.p_codigo} de Cegid.` })
  })
  await page.route(/\/rest\/v1\/(conta_gc_cobro|conta_gc_suscripcion|conta_gc_mandato|conta_gc_enlace|party|customer_fiscal|company_account_link|conta_cobro_cliente|conta_gc_cliente|conta_cegid_concepto_elegido)\?/, (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const t = /\/rest\/v1\/([a-z_]+)\?/.exec(r.request().url())![1]
    // La segunda página (range desde 1000) va vacía.
    if (/offset=1000|range=1000/.test(r.request().url()) || (r.request().headers()['range'] ?? '').startsWith('1000')) return json(r, [])
    return json(r, TABLAS[t])
  })
  // Respuesta 3 · lo mandado a Cegid (conta_cegid_incidencia) y conta-cegid-mandar, simulados: nada sale a Cegid.
  const mandadas: Fila[] = []
  let numero = 0
  await page.route(/\/rest\/v1\/conta_cegid_incidencia\?/, (r) => json(r, mandadas))
  await page.route(/\/functions\/v1\/conta-cegid-mandar/, (r) => {
    const b = (r.request().postDataJSON() ?? {}) as Fila
    pedidas.push(b)
    if (b.accion === 'mandar') {
      const ids = b.cobros as string[]
      for (const gc of ids) mandadas.push({ gc_cobro_id: gc, cliente: b.cliente, incidencia: ++numero, estado: 'mandada', total: Number(cobros.find((c) => c.gc_id === gc)?.importe ?? 0), serie: b.serie, serie_factura: null })
      return objeto(r, { ok: true, hechas: ids.length, frase: `Mandado a Cegid el cliente ${b.cliente}: ${ids.length} ${ids.length === 1 ? 'cobro' : 'cobros'}.` })
    }
    if (b.accion === 'leer_mes') {
      // Lo que hay en Cegid del mes: lo mandado y vivo. Con «facturado», Julio ya facturó la serie 1.
      for (const x of mandadas) if (false as boolean && x.serie === '1' && x.estado === 'mandada') { x.estado = 'facturada'; x.serie_factura = '1' }
      const incidencias = mandadas.filter((x) => x.estado !== 'deshecha').map((x) => ({ cliente: x.cliente, incidencia: x.incidencia, concepto: x.gc_cobro_id === 'PM10' ? '0016' : x.gc_cobro_id === 'PM3' ? '0008' : x.gc_cobro_id === 'PM11' ? '0017' : '00001',
        titulo: null, texto: null, importe: null, total: x.total, facturada: x.estado === 'facturada', serieFactura: x.serie_factura, numeroFactura: x.estado === 'facturada' ? 2750 : null }))
      return objeto(r, { ok: true, incidencias, frase: `Leídas de Cegid ${incidencias.length} incidencias de ${MES}. No se ha escrito nada en Cegid.` })
    }
    // Respuesta 7 · Lo cobrado por el banco y con tarjeta (banco_leer) y mandar uno (mandar_banco).
    if (b.accion === 'banco_leer') return objeto(r, { ok: true, cobros: BANCO, facturados: { 101: ['2026-05'] }, frase: `Leídos ${BANCO.length} cobros del banco y con tarjeta de ${MES}, y las facturas en Cegid de 1 clientes. No se ha escrito nada en Cegid.` })
    if (b.accion === 'mandar_banco') {
      const lineas = b.clave === 'mov:00000000-0000-4000-8000-0000000000b2' ? [['PMB2', 102, 60.5], ['mov:00000000-0000-4000-8000-0000000000b2:recargo', 102, 2]]
        : b.clave === 'mov:00000000-0000-4000-8000-0000000000b3' ? [['mov:00000000-0000-4000-8000-0000000000b3', 103, 242]] : []
      for (const [gc, cliente, total] of lineas) mandadas.push({ gc_cobro_id: gc, cliente, incidencia: ++numero, estado: 'mandada', total, serie: '1', serie_factura: null, origen_clave: b.clave })
      const frase = b.clave === 'mov:00000000-0000-4000-8000-0000000000b2' ? 'Mandado a Cegid el cliente 102: 2 líneas, 62,50 €.' : 'Mandado a Cegid el cliente 103: 1 línea, 242,00 €.'
      return objeto(r, { ok: true, hechas: lineas.length, frase })
    }
    const vivas = mandadas.filter((x) => x.estado === 'mandada')
    for (const x of vivas) x.estado = 'deshecha'
    return objeto(r, { ok: true, borradas: vivas.length, facturadas: 0, frase: `Deshecho: ${vivas.length} incidencias borradas en Cegid.` })
  })
  return pedidas
}
/**
 * Respuesta 7 · Lo cobrado por el banco y con tarjeta, inventado (T11): un recibo de mayo, ya facturado en Cegid (no
 * sale); uno de agosto sin factura, con 2 € de recargo (va con el mes en la descripción y el 0018); una transferencia
 * sin recibo (la decide Julio); y un pago con tarjeta ya facturado en el CRM.
 */
const bancoDe = (MES: string) => [
  { clave: 'mov:00000000-0000-4000-8000-0000000000b1', tipo: 'banco', movementId: '00000000-0000-4000-8000-0000000000b1', fecha: `${MES}-04`, importe: 84.7, via: 'transferencia', estado: 'casado',
    texto: 'TRANSFER INMEDIATA, CLIENTE UNO DE PRUEBA', codigo: 101, recibos: [{ gcId: 'PMB1', importe: 84.7, fecha: '2026-05-04', texto: 'GESTORIA MENSUAL', elegido: null }], decision: null },
  { clave: 'mov:00000000-0000-4000-8000-0000000000b2', tipo: 'banco', movementId: '00000000-0000-4000-8000-0000000000b2', fecha: `${MES}-20`, importe: 62.5, via: 'traspaso', estado: 'casado',
    texto: 'TRASPASO, , Mes de agosto', codigo: 102, recibos: [{ gcId: 'PMB2', importe: 60.5, fecha: '2026-08-04', texto: 'GESTORIA MENSUAL', elegido: null }], decision: null },
  { clave: 'mov:00000000-0000-4000-8000-0000000000b3', tipo: 'banco', movementId: '00000000-0000-4000-8000-0000000000b3', fecha: `${MES}-23`, importe: 242, via: 'transferencia', estado: 'casado',
    texto: 'TRANSFER INMEDIATA, CLIENTE TRES DE PRUEBA', codigo: 103, recibos: [], decision: null },
  { clave: 'tpv:2026-11-04T11:19:02Z|48.40', tipo: 'tarjeta', movementId: '00000000-0000-4000-8000-0000000000b4', fecha: `${MES}-04`, importe: 48.4, via: 'tarjeta', estado: 'casado',
    texto: 'el mismo día, con su importe', codigo: 104, recibos: [], etapa: 'factura_final', falta: null, decision: null },
]

