// scripts/conta/diez/prueba-c0009-autoliquidada.ts
//
// I01f · UNA recibida AUTOLIQUIDADA de Sumied en la C0009 (la copia de
// pruebas), leída de vuelta, y su «-ANUL», leída de vuelta (Julio, 20/10: «sí
// a mandar una autoliquidada inventada a la C0009 y leerla de vuelta. Después
// bórrala o anúlala»). La API de Diez que usa Sumied no borra facturas: se
// anula con su «-ANUL», como cualquier recibida enviada (D01, 15/10).
//
// Es la cadena entera de Sumied: la propuesta sale de facturaProveedor (con la
// autoliquidación del I01d), la factura de Diez de facturaRecibida y la «-ANUL»
// de facturaRecibidaQueAnula (_shared/diezRecibida.ts). Importes inventados:
// 1,00 € de base al 21 % (0,21 € de cuota autoliquidada), a la 62900005, de una
// compra intracomunitaria a la cuenta de HubRise (41000038), que ya está en la
// C0009 con su NIF-IVA y su nombre (NO salen).
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente no deja escribir en C0008 sin
//     escribirEnReal, que aquí no se pasa, y la C0001 ni se abre;
//   · una sola: antes de enviar se busca por serie + número + NIF + fecha; si
//     ya está (la original o la «-ANUL»), no se envía otra;
//   · la salida es solo «@@ clave número» (D01 R2): recuentos, el Documento que
//     da Diez y sí/no como 1/0; el workflow la pasa por salida-segura.mjs.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-autoliquidada.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura, type FacturaData } from '../../../supabase/functions/_shared/diezCliente.ts'
import { facturaRecibida, facturaRecibidaQueAnula } from '../../../supabase/functions/_shared/diezRecibida.ts'
import { facturaProveedor } from '../../../src/modules/conta/lib/asientosPropuestos.ts'

const BD = 'C0009'
const NUMERO = 'SUMIED-I01F-0001'
const CUENTA = '41000038'
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

const ap = (f: Factura) => (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
const de = (f: Factura) => (f.Detalles as Record<string, unknown>[] | undefined) ?? []
const suma = (f: Factura, prefijo: string, lado: 'Debe' | 'Haber') => de(f).filter((d) => String(d.Cuenta ?? '').startsWith(prefijo)).reduce((t, d) => t + n2(d[lado]), 0)

/** Envía `fd` si no está ya (por número + NIF + fecha) y la lee de vuelta. */
async function enviarUna(nombre: string, fd: FacturaData, nif: string): Promise<Factura | null> {
  const ya = await c.buscarFactura('2', String(fd.NumeroFactura), nif, Number(fd.FechaFactura))
  di(`${nombre}.ya_estaba`, ya.length > 0)
  let doc = Number(ya[0]?.Documento ?? 0)
  if (!ya.length) {
    try {
      doc = Number((await c.enviarFactura(fd)).Documento)
      di(`${nombre}.aceptada`, true)
    } catch (e) {
      di(`${nombre}.aceptada`, false)
      di(`${nombre}.status`, e instanceof ErrorDiez ? e.status : 0)
      return null
    }
  }
  di(`${nombre}.documento`, doc)
  return doc ? await c.get<Factura>(`/api/facturas/factura/${fd.Ejercicio}/2/${doc}`) : null
}

/** Lo que guardó Diez contra lo que se mandó, y su forma de autoliquidada. */
function vuelta(nombre: string, f: Factura, fd: FacturaData) {
  const iguales = (k: string) => (typeof fd[k] === 'number' ? n2(f[k]) === n2(fd[k]) : String(f[k] ?? '') === String(fd[k] ?? ''))
  const campos = ['Serie', 'TipoAsiento', 'TipoFactura', 'Fecha', 'FechaFactura', 'FechaOperacion', 'CuentaCliente', 'NumeroFactura', 'CifCliente', 'NombreCliente',
    'Descripcion', 'BaseImponible1', 'PorcentajeIVA1', 'CuotaIVA1', 'TotalFactura', 'TotalGastosIngresos']
  di(`${nombre}.campos`, campos.length)
  di(`${nombre}.campos_iguales`, campos.filter(iguales).length)
  campos.forEach((k, i) => { if (!iguales(k)) di(`${nombre}.distinto_campo_${i + 1}`, 1) })
  di(`${nombre}.tipo_factura`, Number(f.TipoFactura))
  di(`${nombre}.total_es_la_base`, n2(f.TotalFactura) === n2(f.BaseImponible1))
  di(`${nombre}.apuntes`, ap(f).length)
  di(`${nombre}.detalles`, de(f).length)
  di(`${nombre}.cuadra`, de(f).reduce((t, d) => t + n2(d.Debe), 0) === de(f).reduce((t, d) => t + n2(d.Haber), 0))
  // La 472 y la 477 por la misma cuota (en la «-ANUL», al revés), y la base al proveedor.
  const neto472 = suma(f, '472', 'Debe') - suma(f, '472', 'Haber')
  const neto477 = suma(f, '477', 'Haber') - suma(f, '477', 'Debe')
  di(`${nombre}.detalle_472_es_47200000`, de(f).some((d) => String(d.Cuenta) === '47200000'))
  di(`${nombre}.detalle_477_es_47700000`, de(f).some((d) => String(d.Cuenta) === '47700000'))
  di(`${nombre}.472_igual_a_477`, neto472 !== 0 && neto472 === neto477)
  di(`${nombre}.472_es_la_cuota`, neto472 === n2(f.CuotaIVA1))
  di(`${nombre}.proveedor_lleva_la_base`, suma(f, CUENTA, 'Haber') - suma(f, CUENTA, 'Debe') === n2(f.TotalFactura))
}

try {
  await c.asegurarToken()
  seccion('entrar')
  di('entrar.c0009', true)

  // 1. La ficha de HubRise en la C0009: su NIF-IVA y su nombre, de una suya (no salen).
  let molde: Factura | undefined
  for (const m of ['202609', '202608', '202607']) {
    molde = (await c.facturasDelMes(m)).find((f) => String(f.Serie) === '2' && String(f.CuentaCliente) === CUENTA && f.CifCliente && f.NombreCliente)
    if (molde) break
  }
  if (!molde) throw new Error('sin proveedor')
  di('proveedor.encontrado', true)
  const nif = String(molde.CifCliente)

  // 2. La propuesta de Sumied (la autoliquidación del I01d) y su factura de Diez.
  const p = facturaProveedor({
    id: 'prueba-i01f', numero: NUMERO, fecha: hoy, proveedor: 'Proveedor de prueba', terceroId: null, esSocio: false, tieneNif: true, localId: 'prueba',
    lineas: [{ base: 1, tipo: null, cuentaGasto: '62900005' }], total: 1, retencion: null,
    autoliquidacion: { tipo: 'ue_compra', porque: 'Prueba: compra intracomunitaria inventada.' },
  }, {
    proveedor: CUENTA, ivaSoportado: (pct) => ({ cuenta: '47200000', tipoId: `t${pct}` }), retencion: '47510000',
    autoliquidada: (t) => ({ tipoId: t, porcentaje: 21, soportado: '47200000', repercutido: '47700000' }),
  })
  seccion('propuesta')
  di('propuesta.hecha', !!p.propuesta)
  if (!p.propuesta) throw new Error('sin propuesta')
  di('propuesta.lineas', p.propuesta.lineas.length)
  const { factura: fd } = facturaRecibida({
    fecha: hoy, fechaFactura: hoy, numero: NUMERO, proveedor: { nombre: String(molde.NombreCliente), nif, pais: 'FR' },
    // El tratamiento lo pone la base (tax_rate.treatment): «ue_compra» es intra_eu.
    lineas: p.propuesta.lineas.map((x) => ({ cuenta: x.cuenta, debe: x.debe, haber: x.haber, tipoIva: x.iva?.tipo ?? null, baseIva: x.iva?.base ?? null,
      tratamiento: x.iva?.tipoId === 'ue_compra' ? 'intra_eu' : x.iva ? 'taxed' : null })),
  }, { hoy })
  di('factura.tipo_factura', Number(fd.TipoFactura))
  di('factura.total_es_la_base', n2(fd.TotalFactura) === n2(fd.BaseImponible1))

  // 3. La original: enviada (si no estaba) y leída de vuelta.
  seccion('original')
  const original = await enviarUna('original', fd, nif)
  if (!original) throw new Error('la original no está')
  vuelta('original', original, fd)

  // 4. Su «-ANUL», como la hace el envío real (de la factura rehecha por
  // Sumied, enviarContraasientoRecibida): enviada (si no estaba) y leída de vuelta.
  seccion('anulacion')
  const anula = facturaRecibidaQueAnula(fd, { fecha: hoy, hoy })
  const anulada = await enviarUna('anulacion', anula, nif)
  if (!anulada) throw new Error('la anulación no está')
  vuelta('anulacion', anulada, anula)
  di('anulacion.total_negativo', n2(anulada.TotalFactura) < 0)

  // 5. Las dos juntas dejan a cero lo que tocaron: el proveedor, la 472 y la 477.
  seccion('las_dos')
  for (const [k, cta] of [['proveedor', CUENTA], ['c472', '472'], ['c477', '477']] as const) {
    di(`las_dos.${k}_a_cero`, suma(original, cta, 'Debe') - suma(original, cta, 'Haber') + suma(anulada, cta, 'Debe') - suma(anulada, cta, 'Haber') === 0)
  }
  di('las_dos.en_el_libro_del_mes', (await c.facturasDelMes(hoy.slice(0, 7).replace('-', ''))).filter((x) => String(x.Serie) === '2'
    && [Number(original.Documento), Number(anulada.Documento)].includes(Number(x.Documento))).length)
} catch {
  // El motivo no sale (puede llevar datos): el código de salida dice que paró.
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
