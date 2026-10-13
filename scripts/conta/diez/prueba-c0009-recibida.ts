// scripts/conta/diez/prueba-c0009-recibida.ts
//
// D01 · Tarea 5 · UNA factura recibida de Folvy en la C0009 (la copia de
// pruebas) y leída de vuelta, para medir la serie 2 (Julio, respuesta D01_1).
//
// Es la cadena entera de Folvy, no un molde copiado: la propuesta sale de
// facturaProveedor (lo que propone el libro) y la factura de Diez de
// facturaRecibida (_shared/diezRecibida.ts). Importes inventados: 1,00 € al
// 10 % a la 600 y 1,00 € al 21 % a la 629, total 2,31 €.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente no deja escribir en C0008 sin
//     escribirEnReal, que aquí no se pasa, y la C0001 ni se abre;
//   · una sola: antes de enviar se busca por serie + número + NIF + fecha; si
//     ya está, no se envía otra (se lee la que hay);
//   · el proveedor es uno que ya está en la serie 2 de la C0009 (su 400 existe
//     en Diez), con su NIF y su nombre, que NO salen;
//   · la salida es solo «@@ clave número» (D01 R2): recuentos, el Documento
//     que da Diez y sí/no como 1/0. Ni importes, ni números de factura, ni
//     textos; y el workflow la pasa además por scripts/conta/salida-segura.mjs;
//   · el PDF no se adjunta: aquí solo se mide la factura. El freno «sin
//     documento no se envía» es del envío al validar, no de esta prueba.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { facturaRecibida } from '../../../supabase/functions/_shared/diezRecibida.ts'
import { facturaProveedor } from '../../../src/modules/conta/lib/asientosPropuestos.ts'

const BD = 'C0009'
const NUMERO = 'FOLVY-D01-0001'
const FECHA = '2026-10-13'

/** Una cifra a la salida: «@@ clave valor». Un sí/no sale como 1/0. */
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

try {
  await c.asegurarToken()
  seccion('entrar')
  di('entrar.c0009', true)

  // 1. Un proveedor que ya está en la serie 2 (su 400 existe en Diez), con NIF.
  let antes: Factura[] = []
  for (const m of ['202609', '202608', '202607']) {
    antes = (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2' && String(f.CuentaCliente ?? '').startsWith('400') && f.CifCliente && f.NombreCliente)
    if (antes.length) break
  }
  const molde = antes[0]
  if (!molde) throw new Error('sin proveedor')
  di('proveedor.con_400_y_nif', true)
  const prov = String(molde.CuentaCliente)

  // 2. La propuesta de Folvy y su factura de Diez.
  const p = facturaProveedor({
    id: 'prueba-d01', numero: NUMERO, fecha: FECHA, proveedor: 'Proveedor de prueba', terceroId: null, esSocio: false, tieneNif: true, localId: 'prueba',
    lineas: [{ base: 1, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }, { base: 1, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62900000' }],
    total: 2.31, retencion: null,
  }, { proveedor: prov, ivaSoportado: (pct) => ({ cuenta: `472000${String(pct).padStart(2, '0')}`, tipoId: `t${pct}` }), retencion: '47510019' })
  seccion('propuesta')
  di('propuesta.hecha', !!p.propuesta)
  if (!p.propuesta) throw new Error('sin propuesta')
  const { factura: fd, esperado } = facturaRecibida({
    fecha: FECHA, fechaFactura: FECHA, numero: NUMERO, proveedor: { nombre: String(molde.NombreCliente), nif: String(molde.CifCliente) },
    lineas: p.propuesta.lineas.map((x) => ({ cuenta: x.cuenta, debe: x.debe, haber: x.haber, tipoIva: x.iva?.tipo ?? null, baseIva: x.iva?.base ?? null })),
  }, { hoy: FECHA })
  di('propuesta.lineas', p.propuesta.lineas.length)
  di('propuesta.segura', p.propuesta.confianza === 'seguro')
  di('factura.serie', Number(fd.Serie))
  di('factura.tipo_asiento', Number(fd.TipoAsiento))
  di('factura.tipo_factura', Number(fd.TipoFactura))
  di('factura.tipos_de_iva', esperado.tipos.length)
  di('factura.apuntes', (fd.Apuntes as unknown[]).length)

  // 3. ¿Ya está? Entonces no se envía otra.
  const recientes = [...await c.facturasDelMes('202609'), ...await c.facturasDelMes('202610')].filter((f) => String(f.Serie) === '2')
  const maxAntes = Math.max(0, ...recientes.map((f) => Number(f.Documento) || 0))
  const ya = await c.buscarFactura('2', NUMERO, String(molde.CifCliente), Number(FECHA.replaceAll('-', '')))
  let creada: Factura | null = ya[0] ?? null
  seccion('envio')
  di('envio.ya_estaba', ya.length > 0)
  if (!ya.length) {
    try {
      creada = await c.enviarFactura(fd)
      di('envio.aceptada', true)
      di('envio.documento', Number(creada.Documento))
      di('envio.documento_mayor_antes', maxAntes)
    } catch (e) {
      di('envio.aceptada', false)
      di('envio.status', e instanceof ErrorDiez ? e.status : 0)
    }
  }

  // 4. Leída de vuelta: lo que guardó Diez contra lo que se mandó.
  if (creada?.Documento) {
    const doc = Number(creada.Documento)
    const f = await c.get<Factura>(`/api/facturas/factura/2026/2/${doc}`)
    const iguales = (k: string) => (typeof fd[k] === 'number' ? n2(f[k]) === n2(fd[k]) : String(f[k] ?? '') === String(fd[k] ?? ''))
    const campos = ['Serie', 'TipoAsiento', 'TipoFactura', 'Fecha', 'FechaFactura', 'CuentaCliente', 'NumeroFactura', 'CifCliente', 'NombreCliente', 'Descripcion',
      'BaseImponible1', 'PorcentajeIVA1', 'CuotaIVA1', 'BaseImponible2', 'PorcentajeIVA2', 'CuotaIVA2', 'TotalFactura', 'TotalGastosIngresos']
    const ap = (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
    const de = (f.Detalles as Record<string, unknown>[] | undefined) ?? []
    const debe = de.reduce((t, d) => t + n2(d.Debe), 0), haber = de.reduce((t, d) => t + n2(d.Haber), 0)
    const c472 = [...new Set(de.filter((d) => String(d.Cuenta ?? '').startsWith('472')).map((d) => String(d.Cuenta)))]
    seccion('vuelta')
    di('vuelta.campos', campos.length)
    di('vuelta.campos_iguales', campos.filter(iguales).length)
    // Cuál no vuelve igual, por su posición en la lista de arriba (no su valor).
    campos.forEach((k, i) => { if (!iguales(k)) di(`vuelta.distinto_campo_${i + 1}`, 1) })
    di('vuelta.apuntes', ap.length)
    di('vuelta.apuntes_iguales', ap.length === (fd.Apuntes as unknown[]).length && ap.every((x, i) => String(x.Cuenta) === (fd.Apuntes as { Cuenta: string }[])[i]?.Cuenta && n2(x.Importe) === n2((fd.Apuntes as { Importe: number }[])[i]?.Importe)))
    di('vuelta.detalles', de.length)
    di('vuelta.cuadra', debe === haber)
    di('vuelta.haber_es_el_total', haber === n2(fd.TotalFactura))
    di('vuelta.cuentas_472', c472.length)
    di('vuelta.472_es_la_generica', c472.length === 1 && c472[0] === '47200000')
    di('vuelta.proveedor_el_mandado', de.some((d) => String(d.Cuenta) === prov && n2(d.Haber) === n2(fd.TotalFactura)))
    di('vuelta.serie2_sin_hueco', doc === maxAntes + 1 || ya.length > 0)
    const oct = await c.facturasDelMes('202610')
    di('vuelta.en_el_libro_de_octubre', oct.some((x) => Number(x.Documento) === doc && String(x.Serie) === '2'))
  }
} catch {
  // El motivo no sale (puede llevar datos): el código de salida dice que paró.
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
