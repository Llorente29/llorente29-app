// scripts/conta/diez/diagnostico-1860-c0008.ts
//
// C06b · 17/10 · LOS ASIENTOS 1860 Y 1861 QUE NO LLEGARON A DIEZ (C0008), SOLO
// LEYENDO.
//
// El 1860 (Glovo · Alcalá, 16/10) tuvo un intento a las 04:27 UTC que duró 38 s
// y cuyo error real se perdió; el 1861 (Uber · Alcalá, 16/10) contestó 500 a
// los 6 s (registro de la función) sin dejar el suyo. Son los dos primeros con
// las subcuentas 70009001/70009002/70500001. Aquí se mira, solo con GET:
//   1. si están escritos en Diez (por su número, por su cuenta y día, y por
//      los apuntes del día);
//   2. si el listado de facturas de octubre contesta (lo primero que hace el
//      envío después de dejar su fila), y si no, qué día falla;
//   3. las subcuentas nuevas frente a las que ya funcionan (70000001, 70800001,
//      70500000 si está): qué campos tienen distintos.
//
// Frenos:
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni nombres, ni
//     importes. Los campos se comparan con la referencia (1 igual, 0 distinto);
//     solo sale el valor si es un entero o un sí/no.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/diagnostico-1860-c0008.ts
import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const DIA = 20261016
const NUMEROS = { glv_flo: 'GLV-FLO-20261016', ubr_flo: 'UBR-FLO-20261016' } as const
const CLIENTES = { glovo: '43000001', uber: '43000002' } as const
const NUEVAS = ['70009001', '70009002', '70500001'] as const
const REFERENCIA = '70000001'
const OTRAS = ['70800001', '43000001'] as const

const sale = (clave: string, valor: number | string) => process.stdout.write(`@@ ${clave} ${valor}\n`)
const seccion = (clave: string) => process.stdout.write(`@@ # ${clave}\n`)
const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.]/g, '_').slice(0, 40)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('falta_secreto', 1); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})
/** Solo el tipo y el código de un error: el mensaje puede llevar texto de Diez. */
const fallo = (pre: string, e: unknown) => {
  const x = e as { name?: string; status?: number }
  sale(`${pre}.error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
}
const ms = async <T>(clave: string, f: () => Promise<T>): Promise<T | null> => {
  const t0 = Date.now()
  try { const r = await f(); sale(`${clave}.ms`, Date.now() - t0); sale(`${clave}.ok`, 1); return r } catch (e) {
    sale(`${clave}.ms`, Date.now() - t0); sale(`${clave}.ok`, 0); fallo(clave, e); return null
  }
}

try { await c.asegurarToken() } catch (e) { sale('entra_c0008', 0); fallo('entra', e); process.exit(1) }
sale('entra_c0008', 1)

const P2 = process.env.DIAGNOSTICO_PASADA === '2'
// 2 · El listado de octubre, como lo pide el envío.
seccion('listado_octubre')
const oct = await ms('octubre', () => c.facturasDelMes('202610'))
if (oct) sale('octubre.facturas', oct.length)

// Día a día, del 01 al 17: dónde contesta y dónde no.
seccion('listado_por_dia')
const delDia: Factura[] = []
for (let d = 1; d <= (P2 ? 0 : 17); d++) {
  const f = 20261000 + d
  const r = await ms(`dia${String(d).padStart(2, '0')}`, () => c.todas<Factura>(`/api/facturas?$filter=${encodeURIComponent(`Fecha ge ${f} and Fecha le ${f}`)}`))
  if (r) { sale(`dia${String(d).padStart(2, '0')}.facturas`, r.length); if (f === DIA) delDia.push(...r) }
}

// 1 · ¿Están escritos?
seccion('escritos_en_diez')
const fuente = oct ?? delDia
const unicas = [...new Map(fuente.map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()]
for (const [clave, num] of Object.entries(NUMEROS)) sale(`numero.${clave}`, unicas.filter((f) => String(f.NumeroFactura ?? '').trim().toUpperCase() === num).length)
for (const [clave, cuenta] of Object.entries(CLIENTES)) {
  const delDiaCliente = unicas.filter((f) => String(f.CuentaCliente) === cuenta && (Number(f.Fecha) === DIA || Number(f.FechaFactura) === DIA))
  sale(`cliente_dia16.${clave}`, delDiaCliente.length)
  sale(`cliente_dia16.${clave}.de_folvy`, delDiaCliente.filter((f) => /^(GLV|UBR)-[A-Z]{3}-\d{8}$/.test(String(f.NumeroFactura ?? ''))).length)
}
// Los apuntes del 16 (por si Diez dejó un asiento sin su factura).
const apuntes = await ms('apuntes_dia16', () => c.todas<{ Serie?: string; Documento?: number; Detalles?: { Cuenta?: string }[] }>(`/api/apuntes?$filter=${encodeURIComponent(`Fecha ge ${DIA} and Fecha le ${DIA}`)}`))
if (apuntes) {
  sale('apuntes_dia16.asientos', new Set(apuntes.map((a) => `${a.Serie}/${a.Documento}`)).size)
  for (const cta of NUEVAS) sale(`apuntes_dia16.con_${cta}`, apuntes.filter((a) => (a.Detalles ?? []).some((d) => String(d.Cuenta) === cta)).length)
}

// 3 · Las subcuentas nuevas frente a la de ventas que ya funciona.
seccion('subcuentas')
const leer = async (cod: string) => { try { return await c.subcuenta(cod) } catch (e) { fallo(`sc_${cod}`, e); return undefined } }
const ref = await leer(REFERENCIA)
sale(`sc_${REFERENCIA}.existe`, ref ? 1 : 0)
const escalares = (o: Record<string, unknown> | null | undefined) => Object.entries(o ?? {}).filter(([, v]) => v === null || typeof v !== 'object')
for (const [campo, v] of escalares(ref)) {
  if (typeof v === 'boolean') sale(`ref.${k(campo)}`, v ? 1 : 0)
  else if (typeof v === 'number' && Number.isInteger(v)) sale(`ref.${k(campo)}`, v)
  else if (v === null) sale(`ref.${k(campo)}.nulo`, 1)
}
for (const cod of [...NUEVAS, ...OTRAS]) {
  const sc = await leer(cod)
  sale(`sc_${cod}.existe`, sc ? 1 : 0)
  if (!sc) continue
  const claves = new Set([...Object.keys(ref ?? {}), ...Object.keys(sc)])
  let distintos = 0
  for (const campo of claves) {
    const a = (ref as Record<string, unknown> | null)?.[campo], b = (sc as Record<string, unknown>)[campo]
    if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) {
      sale(`sc_${cod}.${k(campo)}.objeto_igual`, JSON.stringify(a ?? null) === JSON.stringify(b ?? null) ? 1 : 0)
      continue
    }
    if (campo === 'Codigo' || campo === 'Descripcion') continue
    const igual = a === b
    if (!igual) {
      distintos++
      sale(`sc_${cod}.${k(campo)}.distinto`, 1)
      if (typeof b === 'boolean') sale(`sc_${cod}.${k(campo)}`, b ? 1 : 0)
      else if (typeof b === 'number' && Number.isInteger(b)) sale(`sc_${cod}.${k(campo)}`, b)
      else if (b === null || b === undefined) sale(`sc_${cod}.${k(campo)}.nulo`, 1)
      else sale(`sc_${cod}.${k(campo)}.texto`, 1)
    }
  }
  sale(`sc_${cod}.campos_distintos`, distintos)
}
// Segunda pasada (17/10): ¿los 500 son de unas cuentas o días concretos, o
// Diez falla a ratos? Cada lectura, tres veces, con su código y su tiempo.
seccion('repeticion')
const codigo = async (clave: string, ruta: string) => {
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now()
    try {
      const r = await (c as unknown as { llamar(m: string, r: string): Promise<{ status: number }> }).llamar('GET', ruta)
      sale(`${clave}.v${i}.status`, r.status)
    } catch (e) { fallo(`${clave}.v${i}`, e) }
    sale(`${clave}.v${i}.ms`, Date.now() - t0)
  }
}
if (process.env.DIAGNOSTICO_PASADA === '2') {
  for (const cod of ['43000001', '43000002', '43000003', '70000001', '70009001', '70009002', '70500001']) await codigo(`sc_${cod}`, `/api/subcuentas/subcuenta/${cod}`)
  await codigo('facturas_dia01', `/api/facturas?$filter=${encodeURIComponent('Fecha ge 20261001 and Fecha le 20261001')}&$top=200&$skip=0`)
  await codigo('facturas_dia15', `/api/facturas?$filter=${encodeURIComponent('Fecha ge 20261015 and Fecha le 20261015')}&$top=200&$skip=0`)
  await codigo('apuntes_dia16', `/api/apuntes?$filter=${encodeURIComponent('Fecha ge 20261016 and Fecha le 20261016')}&$top=200&$skip=0`)
}
sale('peticiones', c.metrica.peticiones)
sale('reintentos429', c.metrica.reintentos429)
void ErrorDiez
