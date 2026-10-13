// scripts/conta/diez/prueba-c0009-recibida-molde.ts
//
// D01 · Tarea 5 · LA FACTURA RECIBIDA DE MOLDE, SOLO LEYENDO (C0009).
//
// Antes de enviar a Diez la primera factura recibida que propone Folvy, se mira
// cómo guarda Diez las de la serie 2 (las recibidas de la gestoría): los
// campos, los tipos, las claves de IVA, cuántos tipos lleva una factura, el
// recargo, la retención, las cuentas del asiento (6…, 472…, 400/410, 4751) y
// cómo se numeran. De ahí sale la forma de lo que Folvy manda.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente se crea con escribir: false,
//     así que no puede escribir nada aunque se quisiera;
//   · la salida es solo «@@ clave número» (D01 R2): recuentos y sí/no como
//     1/0. Ni textos, ni nombres, ni NIF, ni importes, ni números de factura;
//     y el workflow la pasa además por scripts/conta/salida-segura.mjs. (El
//     13/10 la primera versión sacó el texto de cinco descripciones, con
//     nombres: se borraron sus registros.)
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida-molde.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const conValor = (v: unknown) => v != null && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && !v.length)
const grupo = (cuenta: unknown) => String(cuenta ?? '').slice(0, 3)
/** Una clave a partir de un código del programa (nunca de un texto): solo cifras y letras ASCII. */
const k = (x: unknown) => String(x ?? 'nulo').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) || 'vacio'

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  const meses: string[] = []
  let rec: Factura[] = []
  for (const m of ['202609', '202608', '202607', '202606', '202605', '202604']) {
    const del = (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2')
    if (del.length) { meses.push(m); rec = rec.concat(del) }
    if (meses.length === 3) break
  }
  seccion('donde')
  di('meses', meses.length)
  di('recibidas', rec.length)
  if (!rec.length) throw new Error('sin recibidas')
  for (const g of [...new Set(rec.map((f) => grupo(f.CuentaCliente)))].sort()) di(`tercero.grupo_${k(g)}`, rec.filter((f) => grupo(f.CuentaCliente) === g).length)

  // Los campos: cuántas lo traen con valor. De los que son códigos del
  // programa (tipos, claves, porcentajes), cuántas llevan cada valor.
  seccion('campos_con_valor')
  const claves = [...new Set(rec.flatMap((f) => Object.keys(f)))].sort()
  for (const cl of claves) di(`campo.${k(cl)}`, rec.filter((f) => conValor((f as Record<string, unknown>)[cl])).length)
  seccion('codigos')
  for (const cl of ['TipoAsiento', 'TipoFactura', 'TipoRectificativa', 'TipoRetencion', 'PorcentajeIVA1', 'PorcentajeIVA2', 'PorcentajeIVA3', 'PorcentajeRetencion']) {
    for (const v of [...new Set(rec.map((f) => (f as Record<string, unknown>)[cl]))].filter((v) => typeof v === 'number')) {
      di(`${k(cl)}.${k(v)}`, rec.filter((f) => (f as Record<string, unknown>)[cl] === v).length)
    }
  }

  const ntipos = (f: Factura) => [1, 2, 3].filter((i) => n2(f[`BaseImponible${i}`]) !== 0).length
  const cuadra = (f: Factura) => Math.abs([1, 2, 3].reduce((t, i) => t + n2(f[`BaseImponible${i}`]) + n2(f[`CuotaIVA${i}`]) + n2(f[`CuotaRecargo${i}`]), 0) - Math.abs(n2(f.ImporteRetencion ?? f.CuotaRetencion)) - n2(f.TotalFactura)) <= 1
  seccion('cifras')
  for (const t of [0, 1, 2, 3]) di(`con_tipos_${t}`, rec.filter((f) => ntipos(f) === t).length)
  di('con_recargo', rec.filter((f) => [1, 2, 3].some((i) => n2(f[`CuotaRecargo${i}`]) !== 0)).length)
  di('con_retencion', rec.filter((f) => n2(f.ImporteRetencion ?? f.CuotaRetencion) !== 0).length)
  di('total_negativo', rec.filter((f) => n2(f.TotalFactura) < 0).length)
  di('cuadran', rec.filter(cuadra).length)

  const ap = (f: Factura) => (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
  const de = (f: Factura) => (f.Detalles as Record<string, unknown>[] | undefined) ?? []
  seccion('cuentas')
  di('apuntes_suman_las_bases', rec.filter((f) => ap(f).reduce((t, a) => t + n2(a.Importe), 0) === [1, 2, 3].reduce((t, i) => t + n2(f[`BaseImponible${i}`]), 0)).length)
  for (const g of [...new Set(rec.flatMap((f) => ap(f).map((a) => grupo(a.Cuenta))))].sort()) di(`apunte.grupo_${k(g)}`, rec.filter((f) => ap(f).some((a) => grupo(a.Cuenta) === g)).length)
  const c472 = [...new Set(rec.flatMap((f) => de(f).map((d) => String(d.Cuenta ?? '')).filter((x) => x.startsWith('472'))))]
  di('cuentas_472_distintas', c472.length)
  di('la_472_es_la_generica', c472.length === 1 && c472[0] === '47200000')

  seccion('numeros_y_fechas')
  di('mismo_numero_y_cuenta_dos_veces', rec.length - new Set(rec.map((f) => `${f.CuentaCliente}|${f.NumeroFactura}`)).size)
  const dias = rec.map((f) => {
    const a = String(f.FechaFactura ?? ''), b = String(f.Fecha ?? '')
    if (a.length !== 8 || b.length !== 8) return null
    return (Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8)) - Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8))) / 864e5
  }).filter((x): x is number => x != null)
  di('fecha_igual_a_la_factura', dias.filter((d) => d === 0).length)
  di('fecha_posterior', dias.filter((d) => d > 0).length)
  di('fecha_anterior', dias.filter((d) => d < 0).length)
  di('descripcion_es_numero_guion_nombre', rec.filter((f) => String(f.Descripcion ?? '') === `${f.NumeroFactura}-${f.NombreCliente}`).length)
  di('descripcion_empieza_por_el_numero', rec.filter((f) => String(f.Descripcion ?? '').startsWith(`${f.NumeroFactura}-`)).length)
  di('con_analitica', rec.filter((f) => Array.isArray(f.Analitica) && (f.Analitica as unknown[]).length).length)
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
