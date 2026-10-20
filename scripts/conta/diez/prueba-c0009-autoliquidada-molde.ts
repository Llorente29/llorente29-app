// scripts/conta/diez/prueba-c0009-autoliquidada-molde.ts
//
// I01f · LA RECIBIDA AUTOLIQUIDADA DE MOLDE, SOLO LEYENDO (C0009).
//
// Julio (20/10): «Enviar a Diez las recibidas autoliquidadas (intracomunitarias
// e inversión del sujeto pasivo). Mide primero, solo leyendo, cómo guarda Diez
// una de las que ya tiene (por ejemplo, una de HubRise del 3T)».
//
// Lo que ya se sabe, de producción (solo lectura, 20/10): Diez trajo a Sumied
// la de HubRise del 07/08 como asiento de la serie 2 con el gasto (629…) al
// Debe, 47200000 al Debe y 47700000 al Haber por la misma cuota, y la base a
// la 41000038; y su fila del libro de IVA con clave 09, S2, FR, NIF-IVA (02),
// inversión del sujeto pasivo. Las 16 autoliquidadas de Foodint van así.
// Lo que falta saber es la FACTURA de Diez (lo que se manda): qué campos lleva
// una autoliquidada que no lleva una recibida normal, con qué códigos, qué es
// su TotalFactura (¿la base, o base + cuota?) y qué cuentas lleva el detalle.
//
// Cómo se reconocen, sin texto: una recibida de la serie 2 es autoliquidada si
// su detalle lleva una 477 (en una recibida normal no hay). Y, para
// comprobarlo por el otro lado, las de las cuentas de los cinco extranjeros de
// la 0310 (41000024 Trypleez, 41000035–38).
//
// Frenos (los del molde de las recibidas, D01):
//   · la base es C0009, escrita aquí; el cliente se crea con escribir: false;
//   · la salida es solo «@@ clave número»: recuentos y sí/no como 1/0. Ni
//     textos, ni nombres, ni NIF, ni importes, ni números de factura; y el
//     workflow la pasa además por scripts/conta/salida-segura.mjs. Las claves
//     salen de nombres de campo y de códigos del programa, nunca de un texto.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-autoliquidada-molde.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const conValor = (v: unknown) => v != null && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && !v.length)
/** Una clave a partir de un nombre de campo o un código del programa (nunca de un texto): solo cifras y letras ASCII. */
const k = (x: unknown) => String(x ?? 'nulo').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24) || 'vacio'
const EXTRANJEROS = new Set(['41000024', '41000035', '41000036', '41000037', '41000038'])

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

const de = (f: Factura) => (f.Detalles as Record<string, unknown>[] | undefined) ?? []
const ap = (f: Factura) => (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
const cuentasDe = (f: Factura) => [...de(f), ...ap(f)].map((d) => String(d.Cuenta ?? ''))
const bases = (f: Factura) => [1, 2, 3].reduce((t, i) => t + n2(f[`BaseImponible${i}`]), 0)
const cuotas = (f: Factura) => [1, 2, 3].reduce((t, i) => t + n2(f[`CuotaIVA${i}`]), 0)

try {
  await c.asegurarToken()
  let rec: Factura[] = []
  let meses = 0
  for (const m of ['202609', '202608', '202607', '202606', '202605', '202604', '202603', '202602', '202601']) {
    const del = (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2')
    if (del.length) meses++
    rec = rec.concat(del)
  }
  const con477 = rec.filter((f) => cuentasDe(f).some((x) => x.startsWith('477')))
  const deExtranjeros = rec.filter((f) => EXTRANJEROS.has(String(f.CuentaCliente ?? '')))
  const auto = [...new Set([...con477, ...deExtranjeros])]
  const normales = rec.filter((f) => !auto.includes(f))

  seccion('donde')
  di('meses_con_recibidas', meses)
  di('recibidas', rec.length)
  di('autoliquidadas_por_la_477', con477.length)
  di('de_los_cinco_extranjeros', deExtranjeros.length)
  di('de_los_cinco_y_con_477', deExtranjeros.filter((f) => con477.includes(f)).length)
  for (const cta of [...EXTRANJEROS].sort()) di(`cuenta_${cta}`, deExtranjeros.filter((f) => String(f.CuentaCliente) === cta).length)
  if (!auto.length) { di('ninguna_autoliquidada', true); process.exit(0) }

  // Los campos: en cuántas autoliquidadas lleva valor, y en cuántas normales.
  // Lo que distingue una de otra sale aquí.
  seccion('campos_con_valor_autoliquidadas_frente_a_normales')
  const claves = [...new Set(rec.flatMap((f) => Object.keys(f)))].sort()
  for (const cl of claves) {
    const a = auto.filter((f) => conValor((f as Record<string, unknown>)[cl])).length
    const n = normales.filter((f) => conValor((f as Record<string, unknown>)[cl])).length
    di(`campo.${k(cl)}.auto`, a)
    di(`campo.${k(cl)}.normales`, n)
  }

  // Los códigos (números del programa) de todos los campos numéricos que no son
  // importes ni fechas: qué valores llevan las autoliquidadas.
  seccion('codigos_de_las_autoliquidadas')
  const importe = /importe|base|cuota|total|fecha|ejercicio|documento|numero|linea/i
  for (const cl of claves.filter((x) => !importe.test(x))) {
    const vals = [...new Set(auto.map((f) => (f as Record<string, unknown>)[cl]))].filter((v) => typeof v === 'number' || typeof v === 'boolean')
    if (vals.length === 0 || vals.length > 6) continue
    for (const v of vals) di(`${k(cl)}.${k(v)}`, auto.filter((f) => (f as Record<string, unknown>)[cl] === v).length)
  }
  for (const cl of ['PorcentajeIVA1', 'PorcentajeIVA2', 'PorcentajeIVA3']) {
    for (const v of [...new Set(auto.map((f) => (f as Record<string, unknown>)[cl]))].filter((v) => typeof v === 'number')) {
      di(`${k(cl)}.${k(v)}`, auto.filter((f) => (f as Record<string, unknown>)[cl] === v).length)
    }
  }

  // El total: ¿la base, o base + cuota?
  seccion('cifras_de_las_autoliquidadas')
  di('con_un_tipo', auto.filter((f) => [1, 2, 3].filter((i) => n2(f[`BaseImponible${i}`]) !== 0).length === 1).length)
  di('con_cuota', auto.filter((f) => cuotas(f) !== 0).length)
  di('total_es_la_base', auto.filter((f) => n2(f.TotalFactura) === bases(f)).length)
  di('total_es_base_mas_cuota', auto.filter((f) => n2(f.TotalFactura) === bases(f) + cuotas(f)).length)
  di('total_gastos_es_la_base', auto.filter((f) => n2(f.TotalGastosIngresos) === bases(f)).length)
  di('apuntes_suman_las_bases', auto.filter((f) => ap(f).reduce((t, a) => t + n2(a.Importe), 0) === bases(f)).length)

  // Las cuentas: del detalle (lo que pone Diez) y de los apuntes (lo que se manda).
  seccion('cuentas_de_las_autoliquidadas')
  const grupos = (xs: string[]) => [...new Set(xs.map((x) => x.slice(0, 3)))].sort()
  for (const g of grupos(auto.flatMap((f) => de(f).map((d) => String(d.Cuenta ?? ''))))) di(`detalle.grupo_${k(g)}`, auto.filter((f) => de(f).some((d) => String(d.Cuenta ?? '').startsWith(g))).length)
  for (const g of grupos(auto.flatMap((f) => ap(f).map((d) => String(d.Cuenta ?? ''))))) di(`apunte.grupo_${k(g)}`, auto.filter((f) => ap(f).some((d) => String(d.Cuenta ?? '').startsWith(g))).length)
  di('detalle_472_es_47200000', auto.filter((f) => de(f).some((d) => String(d.Cuenta) === '47200000')).length)
  di('detalle_477_es_47700000', auto.filter((f) => de(f).some((d) => String(d.Cuenta) === '47700000')).length)
  di('detalle_472_igual_a_477', auto.filter((f) => {
    const s = (p: string, lado: string) => de(f).filter((d) => String(d.Cuenta ?? '').startsWith(p)).reduce((t, d) => t + n2(d[lado]), 0)
    return s('472', 'Debe') + s('472', 'Importe') === s('477', 'Haber') + s('477', 'Importe') && s('472', 'Debe') + s('472', 'Importe') !== 0
  }).length)
  // Las claves de los elementos del detalle (nombres de campo), para saber cómo se lee el Debe y el Haber.
  for (const cl of [...new Set(auto.flatMap((f) => de(f).flatMap((d) => Object.keys(d))))].sort()) di(`detalle.campo.${k(cl)}`, auto.filter((f) => de(f).some((d) => conValor(d[cl]))).length)

  seccion('fechas_y_descripcion')
  di('descripcion_es_numero_guion_nombre', auto.filter((f) => String(f.Descripcion ?? '') === `${f.NumeroFactura}-${f.NombreCliente}`).length)
  di('con_cif', auto.filter((f) => conValor(f.CifCliente)).length)
  di('cif_con_dos_letras_delante', auto.filter((f) => /^[A-Z]{2}/.test(String(f.CifCliente ?? ''))).length)
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
