// scripts/conta/diez/libros-iva-lectura.ts
//
// I01b · Los libros de IVA de Diez (18/10). PRIMER PASO, SOLO LEYENDO.
//
// La importación del histórico (C04b) trajo el diario de Diez (/api/apuntes)
// pero no sus libros registro de IVA (/api/facturas): en Sumied, el libro de
// IVA de Foodint empieza el 01/10/2026 y el 303 de un trimestre traído no se
// puede calcular. Antes de escribir nada, esto mide en C0008, trimestre a
// trimestre de 2026, lo que hay en las facturas de Diez:
//   · cuántas hay por libro (serie 1 expedidas, serie 2 recibidas, otras) y por
//     tipo de factura (1 normal; 6 y 7, abonos);
//   · cuántas veces sale repetida la misma (Ejercicio/Serie/Documento) en el
//     listado, y si las repetidas son idénticas;
//   · los tipos de IVA que usan, cuántos tipos lleva cada una, y si hay
//     recargo o retención;
//   · cuántas recibidas son de otro trimestre por su fecha de factura;
//   · los NOMBRES de los campos que trae una factura (para el mapeo);
//   · la suma de cuotas de cada libro y trimestre, como HUELLA (md5 de los
//     céntimos, 16 cifras): se compara fuera con la misma huella de la 477 y la
//     472 del diario de Sumied, sin sacar ningún importe.
//
// Frenos (los de patrones-ventas-c0008.ts):
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni NIF, ni
//     nombres, ni importes.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/libros-iva-lectura.ts

import { createHash } from 'node:crypto'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0008'
const MESES = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609']

/** Una huella publicable (16 cifras hexadecimales). */
export const huella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)
/** Los céntimos de un importe de Diez (double), redondeados. */
export const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
/** El trimestre (1–4) de una fecha AAAAMMDD. */
export const trimestre = (aaaammdd: unknown) => Math.floor((Math.floor(Number(aaaammdd) / 100) % 100 - 1) / 3) + 1
/** Los tramos de IVA de una factura: hasta 8 (BaseImponibleN, PorcentajeIVAN, CuotaIVAN). */
export function tramos(f: Record<string, unknown>) {
  const t: { base: number; tipo: number; cuota: number }[] = []
  for (let n = 1; n <= 8; n++) {
    const base = cent(f[`BaseImponible${n}`]), cuota = cent(f[`CuotaIVA${n}`]), tipo = Number(f[`PorcentajeIVA${n}`] ?? 0)
    if (base !== 0 || cuota !== 0) t.push({ base, tipo, cuota })
  }
  return t
}
const libro = (f: Factura) => (String(f.Serie) === '1' ? 'expedidas' : String(f.Serie) === '2' ? 'recibidas' : 'otras')
const clave = (f: Factura) => `${f.Ejercicio}/${f.Serie}/${f.Documento}`
const nombreCampo = (k: string) => k.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)

const sale = (k: string, v: number | string) => process.stdout.write(`@@ ${k} ${v}\n`)
const seccion = (k: string) => process.stdout.write(`@@ # ${k}\n`)

async function main() {
  const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
  if (!cred) { sale('falta_secreto', 1); process.exit(1) }
  let guardado: { token: string; expiresAt: string } | null = null
  const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
  const c = new ClienteDiez({
    base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
    credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
    almacen, escribir: false, pausaMs: 150,
  })
  try { await c.asegurarToken() } catch (e) {
    const x = e as { name?: string; status?: number }
    sale('entra_c0008', 0)
    sale(`error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
    process.exit(1)
  }
  sale('entra_c0008', 1)

  const filas: Factura[] = []
  let leidos = 0, sinContestar = 0
  for (const m of MESES) {
    try { filas.push(...(await c.facturasDelMes(m))); leidos++ } catch { sinContestar++; sale(`mes_sin_contestar.${m}`, 1) }
  }
  seccion('lectura')
  sale('meses_leidos', leidos); sale('meses_sin_contestar', sinContestar); sale('filas', filas.length)

  // Repetidas en el listado: ¿la misma o distinta?
  const porClave = new Map<string, Factura[]>()
  for (const f of filas) porClave.set(clave(f), [...(porClave.get(clave(f)) ?? []), f])
  let repetidas = 0, repetidasDistintas = 0
  for (const fs of porClave.values()) {
    if (fs.length < 2) continue
    repetidas++
    if (new Set(fs.map((f) => JSON.stringify(f))).size > 1) repetidasDistintas++
  }
  const unicas = [...porClave.values()].map((fs) => fs[0])
  sale('facturas_distintas', unicas.length); sale('claves_repetidas', repetidas); sale('claves_repetidas_con_contenido_distinto', repetidasDistintas)

  // Los nombres de los campos (no sus valores).
  seccion('campos')
  const campos = new Map<string, number>()
  for (const f of unicas) for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '' && v !== 0) campos.set(nombreCampo(k), (campos.get(nombreCampo(k)) ?? 0) + 1)
  for (const [k, n] of [...campos].sort()) sale(`campo.${k}`, n)

  // Por libro y trimestre (del asiento, como el diario).
  for (const lib of ['expedidas', 'recibidas', 'otras']) {
    for (const q of [1, 2, 3]) {
      const fs = unicas.filter((f) => libro(f) === lib && trimestre(f.Fecha) === q)
      if (fs.length === 0 && lib === 'otras') continue
      seccion(`${lib}_${q}t`)
      const p = `${lib}.${q}t`
      sale(`${p}.facturas`, fs.length)
      const tiposFactura = new Map<number, number>()
      const tipos = new Map<number, number>()
      const nTramos = new Map<number, number>()
      let cuota = 0, base = 0, conRecargo = 0, conRetencion = 0, deOtroTrimestre = 0, sinTramos = 0
      for (const f of fs) {
        const tf = Number(f.TipoFactura ?? 0)
        tiposFactura.set(tf, (tiposFactura.get(tf) ?? 0) + 1)
        const t = tramos(f)
        if (t.length === 0) sinTramos++
        nTramos.set(t.length, (nTramos.get(t.length) ?? 0) + 1)
        for (const x of t) { cuota += x.cuota; base += x.base; tipos.set(x.tipo, (tipos.get(x.tipo) ?? 0) + 1) }
        if (Object.entries(f).some(([k, v]) => /recargo/i.test(k) && Number(v) !== 0 && !Number.isNaN(Number(v)))) conRecargo++
        if (Object.entries(f).some(([k, v]) => /retencion/i.test(k) && !/tipo/i.test(k) && Number(v) !== 0 && !Number.isNaN(Number(v)))) conRetencion++
        if (f.FechaFactura && trimestre(f.FechaFactura) !== q) deOtroTrimestre++
      }
      for (const [k, n] of [...tiposFactura].sort((a, b) => a[0] - b[0])) sale(`${p}.tipo_factura_${k}`, n)
      for (const [k, n] of [...tipos].sort((a, b) => a[0] - b[0])) sale(`${p}.tramos_al_${String(k).replace('.', '_')}`, n)
      for (const [k, n] of [...nTramos].sort((a, b) => a[0] - b[0])) sale(`${p}.con_${k}_tramos`, n)
      sale(`${p}.sin_tramos`, sinTramos); sale(`${p}.con_recargo`, conRecargo); sale(`${p}.con_retencion`, conRetencion)
      sale(`${p}.fecha_factura_de_otro_trimestre`, deOtroTrimestre)
      // Las sumas, solo como huella: se comparan fuera con la del diario de Sumied.
      sale(`${p}.huella_cuotas`, huella(String(cuota)))
      sale(`${p}.huella_bases`, huella(String(base)))
    }
  }
  sale('peticiones', c.metrica.peticiones)
}

// Solo corre como programa (la prueba importa las funciones puras).
if (process.argv[1] && process.argv[1].endsWith('libros-iva-lectura.ts')) await main()
