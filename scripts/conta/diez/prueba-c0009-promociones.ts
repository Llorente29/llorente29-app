// scripts/conta/diez/prueba-c0009-promociones.ts
//
// C06b (16/10) · Antes del primer envío real con promociones y envíos (Julio,
// decisión 1.3): UNA factura emitida de prueba en la C0009 con la forma nueva
// del asiento del día, hecha por la cadena de Folvy (facturaDeVentas, la misma
// que usa conta-diez-enviar), y leída de vuelta.
//
// El asiento es INVENTADO, el ejemplo del diseño (Glovo · Foodint Alcalá):
//   43000001 D 43,50 · 70009002 D 9,09 (promociones, en negativo en la factura)
//   · 70000002 H 45,45 (la marca) · 70500001 H 3,18 (envíos cobrados) ·
//   47700010 H 3,96 (base 39,54).
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente no escribe en C0008 sin
//     escribirEnReal, que aquí no se pasa, y la C0001 está vetada;
//   · las subcuentas 70009002 y 70500001 se crean en la C0009 si no están
//     (con el mismo código y nombre que en Folvy), y se leen de vuelta;
//   · NUNCA DOS VECES: antes de enviar se busca por serie, número y cliente;
//     si ya está, no se envía otra (se lee la que hay);
//   · la salida es solo «@@ clave número» (D01 R2): recuentos y sí/no (1/0).
//     Ni importes, ni textos; el workflow la pasa por salida-segura.mjs.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-promociones.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica.ts'
import { facturaDeVentas, type AsientoVentas } from '../../../supabase/functions/_shared/diezFactura.ts'
import { asegurarSubcuentas } from '../../../supabase/functions/_shared/diezSubcuentas.ts'

const BD = 'C0009'
const FECHA = '2026-10-14'
const L = (cuenta: string, debe: number, haber: number, marca: string | null = null, tipoIva: number | null = null) => ({ cuenta, debe, haber, marca, tipoIva })
const ASIENTO: AsientoVentas = {
  fecha: FECHA, local: 'Foodint Alcalá', canal: 'glovo',
  lineas: [L('43000001', 43.5, 0), L('70009002', 9.09, 0), L('70000002', 0, 45.45, 'Meraki Pita'), L('70500001', 0, 3.18), L('47700010', 0, 3.96, null, 10)],
}

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

  // 1. Las dos subcuentas nuevas, en la C0009.
  seccion('subcuentas')
  const sc = await asegurarSubcuentas(c, [{ codigo: '70009002', nombre: 'PROMOCIONES GLOVO' }, { codigo: '70500001', nombre: 'ENVÍOS COBRADOS' }])
  di('subcuentas.creadas', sc.creadas.length)
  di('subcuentas.ya_estaban', sc.yaEstaban)
  di('subcuentas.con_otro_nombre', sc.otroNombre.length)

  // 2. La factura de Folvy, con el nombre del cliente de Glovo en Diez.
  const cliente = await c.subcuenta('43000001')
  const nombre = String(cliente?.Descripcion ?? '').trim()
  if (!nombre) throw new Error('sin nombre de cliente')
  const { factura: fd, sinPoner } = facturaDeVentas(ASIENTO, { correspondencia: CORRESPONDENCIA_LLORENTE29, nombreCliente: nombre, hoy: new Date().toISOString().slice(0, 10), conAnalitica: true })
  const apMandados = fd.Apuntes as { Cuenta: string; Importe: number }[]
  seccion('factura')
  di('factura.apuntes', apMandados.length)
  di('factura.promocion_en_negativo', apMandados.some((a) => a.Cuenta === '70009002' && n2(a.Importe) < 0))
  di('factura.envio_en_positivo', apMandados.some((a) => a.Cuenta === '70500001' && n2(a.Importe) > 0))
  di('factura.analitica_filas', (fd.Analitica as unknown[]).length)
  di('factura.analitica_sin_poner', sinPoner.length)

  // 3. Nunca dos veces.
  const delMes = await c.facturasDelMes(String(fd.FechaFactura).slice(0, 6))
  const ya = [...new Map(delMes.filter((f) => String(f.Serie) === fd.Serie && String(f.NumeroFactura) === fd.NumeroFactura && String(f.CuentaCliente) === fd.CuentaCliente)
    .map((f) => [String(f.Documento), f])).values()]
  seccion('envio')
  di('envio.ya_estaba', ya.length > 0)
  if (ya.length > 1) throw new Error('más de una')
  let doc = ya.length ? Number(ya[0].Documento) : 0
  if (!ya.length) {
    try {
      const creada = await c.enviarFactura(fd)
      doc = Number(creada.Documento)
      di('envio.aceptada', true)
    } catch (e) {
      di('envio.aceptada', false)
      di('envio.status', e instanceof ErrorDiez ? e.status : 0)
    }
  }

  // 4. Leída de vuelta: la factura, el asiento que hace Diez y la analítica.
  if (doc) {
    const f = await c.get<Factura>(`/api/facturas/factura/2026/1/${doc}`)
    const ap = ((f.Apuntes as { Cuenta: string; Importe: number }[] | undefined) ?? []).map((a) => `${a.Cuenta}:${n2(a.Importe)}`).sort()
    const mandado = apMandados.map((a) => `${a.Cuenta}:${n2(a.Importe)}`).sort()
    seccion('vuelta')
    di('vuelta.base_igual', n2(f.BaseImponible1) === n2(fd.BaseImponible1))
    di('vuelta.cuota_igual', n2(f.CuotaIVA1) === n2(fd.CuotaIVA1))
    di('vuelta.total_igual', n2(f.TotalFactura) === n2(fd.TotalFactura))
    di('vuelta.gastos_ingresos_igual', n2(f.TotalGastosIngresos) === n2(fd.TotalGastosIngresos))
    di('vuelta.apuntes', ap.length)
    di('vuelta.apuntes_iguales', ap.join() === mandado.join())
    const det = (f.Detalles as { Cuenta?: string; Debe?: number; Haber?: number }[] | undefined) ?? []
    const lado = (cta: string, k: 'Debe' | 'Haber') => det.filter((d) => String(d.Cuenta) === cta).reduce((t, d) => t + n2(d[k]), 0)
    seccion('asiento_de_diez')
    di('diez.lineas', det.length)
    di('diez.cuadra', det.reduce((t, d) => t + n2(d.Debe), 0) === det.reduce((t, d) => t + n2(d.Haber), 0))
    di('diez.430_al_debe_el_total', lado('43000001', 'Debe') === n2(fd.TotalFactura))
    di('diez.promocion_al_debe', lado('70009002', 'Debe') === 909 || lado('70009002', 'Haber') === -909)
    di('diez.envio_al_haber', lado('70500001', 'Haber') === 318)
    di('diez.venta_al_haber', lado('70000002', 'Haber') === 4545)
    di('diez.477_al_haber_la_cuota', lado('47700010', 'Haber') === n2(fd.CuotaIVA1))
    const an = await c.get<unknown>(`/api/analitica/asiento/2026/1/${doc}`)
    const filas = (Array.isArray(an) ? an : an && typeof an === 'object' ? [an] : []) as Record<string, unknown>[]
    const clave = (x: Record<string, unknown>) => `${x.Subcuenta}|${x.Grupo}|${x.Subgrupo ?? ''}|${x.Nivel3}|${n2(x.ImporteDebe)}|${n2(x.ImporteHaber)}`
    seccion('analitica')
    di('analitica.filas', filas.length)
    di('analitica.igual_que_la_mandada', filas.map(clave).sort().join() === (fd.Analitica as Record<string, unknown>[]).map(clave).sort().join())
    const oct = await c.facturasDelMes(String(fd.FechaFactura).slice(0, 6))
    di('libro.una_sola', new Set(oct.filter((x) => String(x.NumeroFactura) === fd.NumeroFactura && String(x.CuentaCliente) === fd.CuentaCliente).map((x) => String(x.Documento))).size === 1)
  }
} catch {
  // El motivo no sale (puede llevar datos): el código de salida dice que paró.
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
