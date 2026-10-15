// scripts/conta/diez/prueba-c0009-riders.ts
//
// E05 · Tarea 1 · LAS FACTURAS DE RIDERS EN DIEZ, SOLO LEYENDO (C0009, solo GET).
//
// Antes de subir las quincenas de Catcher se mira cómo están en Diez las
// recibidas de riders (41000100), flotas y la comisión de Catcher, para saber
// qué se enlazaría con la búsqueda antes de escribir (#190) y qué se daría de
// alta: cuántas hay por mes de la factura y del asiento, por quincena, con NIF
// o NIE, cuántas comparten número, qué forma tiene el número (solo si encaja
// con la del portal, sí/no), qué cuentas de gasto llevan y qué IVA.
//
// Frenos: C0009 y escribir: false (el cliente no puede escribir); la salida es
// solo «@@ clave número» y el workflow la pasa por salida-segura.mjs. Ni
// nombres, ni NIF/NIE, ni importes, ni números de factura: recuentos.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-riders.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { esLaMismaRecibida, mesesEntre, nifParaComparar } from '../../../supabase/functions/_shared/diezEnviar.ts'
import { claveNumero } from '../../../supabase/functions/_shared/lecturaFactura.ts'

const BD = 'C0009'
const RIDERS = '41000100'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
/** Una clave a partir de un código del programa (cuenta, tipo, porcentaje): solo cifras y letras ASCII. */
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

const clave = (f: Factura) => `${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`
const unicas = (fs: Factura[]) => [...new Map(fs.map((f) => [clave(f), f])).values()]
const mes = (x: unknown) => String(x ?? '').slice(0, 6)
const dia = (x: unknown) => Number(String(x ?? '').slice(6, 8))
// La forma del número en el portal: invoice_<id>_ES_I_<id>_26_<n> (y la de flotas). Solo se dice si encaja.
const formaPortal = (n: unknown) => /ES[_\- ]?I[_\- ]?\d+[_\- ]\d{2}[_\- ]\d+/i.test(String(n ?? ''))
const soloCifras = (n: unknown) => /^\d+$/.test(String(n ?? '').trim())
const esEmpresa = (nif: unknown) => /^[ABCDEFGHJNPQRSUVW]/.test(nifParaComparar(nif) ?? '')
const esPersona = (nif: unknown) => /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/.test(nifParaComparar(nif) ?? '')
const deCatcher = (f: Factura) => /CATCHER/i.test(String(f.NombreCliente ?? ''))

try {
  await c.asegurarToken()
  // Los asientos de junio a hoy: una factura de septiembre se puede asentar en octubre.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()).replace(/-/g, '').slice(0, 6)
  const meses = mesesEntre('202606', hoy)
  const porMes = new Map<string, Factura[]>()
  for (const m of meses) porMes.set(m, (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2'))
  const rec = unicas([...porMes.values()].flat())
  const riders = rec.filter((f) => String(f.CuentaCliente) === RIDERS)
  const catcher = rec.filter(deCatcher)

  seccion('poblacion')
  di('meses_de_asiento_leidos', meses.length)
  di('recibidas', rec.length)
  di('riders_41000100', riders.length)
  di('de_catcher_por_nombre', catcher.length)
  for (const g of [...new Set(catcher.map((f) => String(f.CuentaCliente).slice(0, 3)))].sort()) di(`de_catcher.cuenta_grupo_${k(g)}`, catcher.filter((f) => String(f.CuentaCliente).startsWith(g)).length)
  di('de_catcher.cuentas_distintas', new Set(catcher.map((f) => String(f.CuentaCliente))).size)

  seccion('riders_por_mes_de_factura')
  for (const m of [...new Set(riders.map((f) => mes(f.FechaFactura)))].sort()) {
    const del = riders.filter((f) => mes(f.FechaFactura) === m)
    di(`mes_${m}.facturas`, del.length)
    di(`mes_${m}.primera_quincena`, del.filter((f) => dia(f.FechaFactura) <= 15).length)
    di(`mes_${m}.segunda_quincena`, del.filter((f) => dia(f.FechaFactura) > 15).length)
    di(`mes_${m}.asiento_otro_mes`, del.filter((f) => mes(f.Fecha) !== m).length)
  }

  // Septiembre, que es lo que se subiría primero.
  const sep = riders.filter((f) => mes(f.FechaFactura) === '202609')
  const sepCatcher = catcher.filter((f) => mes(f.FechaFactura) === '202609')
  seccion('septiembre')
  di('riders', sep.length)
  di('de_catcher', sepCatcher.length)
  // El día de la factura: Catcher las emite al cerrar cada quincena.
  for (const d of [...new Set(sep.map((f) => dia(f.FechaFactura)))].sort((x, y) => x - y)) di(`riders.dia_${String(d).padStart(2, '0')}`, sep.filter((f) => dia(f.FechaFactura) === d).length)
  for (const d of [...new Set(sep.filter((f) => esEmpresa(f.CifCliente)).map((f) => dia(f.FechaFactura)))].sort((x, y) => x - y)) di(`riders.empresa_dia_${String(d).padStart(2, '0')}`, sep.filter((f) => esEmpresa(f.CifCliente) && dia(f.FechaFactura) === d).length)
  for (const d of [...new Set(sepCatcher.map((f) => dia(f.FechaFactura)))].sort((x, y) => x - y)) di(`de_catcher.dia_${String(d).padStart(2, '0')}`, sepCatcher.filter((f) => dia(f.FechaFactura) === d).length)
  di('riders.con_nif', sep.filter((f) => nifParaComparar(f.CifCliente)).length)
  di('riders.nif_de_persona', sep.filter((f) => esPersona(f.CifCliente)).length)
  di('riders.nif_de_empresa', sep.filter((f) => esEmpresa(f.CifCliente)).length)
  di('riders.emisores_distintos_por_nif', new Set(sep.map((f) => nifParaComparar(f.CifCliente)).filter(Boolean)).size)
  di('riders.numero_con_la_forma_del_portal', sep.filter((f) => formaPortal(f.NumeroFactura)).length)
  di('riders.numero_solo_cifras', sep.filter((f) => soloCifras(f.NumeroFactura)).length)
  di('riders.numero_sin_clave', sep.filter((f) => !claveNumero(String(f.NumeroFactura ?? ''))).length)
  di('riders.mismo_numero_normalizado_repetido', sep.length - new Set(sep.map((f) => claveNumero(String(f.NumeroFactura ?? '')))).size)
  di('riders.mismo_numero_y_nif_repetido', sep.length - new Set(sep.map((f) => `${claveNumero(String(f.NumeroFactura ?? ''))}|${nifParaComparar(f.CifCliente)}`)).size)
  di('riders.descripcion_empieza_por_el_numero', sep.filter((f) => String(f.Descripcion ?? '').startsWith(`${f.NumeroFactura}`)).length)
  di('riders.total_negativo', sep.filter((f) => n2(f.TotalFactura) < 0).length)
  di('riders.con_retencion', sep.filter((f) => n2(f.ImporteRetencion ?? f.CuotaRetencion) !== 0).length)
  for (const v of [...new Set(sep.map((f) => f.PorcentajeIVA1))]) di(`riders.iva1_${k(v)}`, sep.filter((f) => f.PorcentajeIVA1 === v).length)
  di('riders.con_mas_de_un_tipo', sep.filter((f) => n2(f.BaseImponible2) !== 0).length)
  const ap = (f: Factura) => (f.Apuntes as { Cuenta?: string }[] | undefined) ?? []
  for (const cu of [...new Set(sep.flatMap((f) => ap(f).map((a) => String(a.Cuenta ?? ''))))].sort()) di(`riders.gasto_${k(cu)}`, sep.filter((f) => ap(f).some((a) => String(a.Cuenta) === cu)).length)
  for (const cu of [...new Set(sepCatcher.flatMap((f) => ap(f).map((a) => String(a.Cuenta ?? ''))))].sort()) di(`de_catcher.gasto_${k(cu)}`, sepCatcher.filter((f) => ap(f).some((a) => String(a.Cuenta) === cu)).length)
  for (const v of [...new Set(sepCatcher.map((f) => f.PorcentajeIVA1))]) di(`de_catcher.iva1_${k(v)}`, sepCatcher.filter((f) => f.PorcentajeIVA1 === v).length)
  di('de_catcher.numero_con_la_forma_del_portal', sepCatcher.filter((f) => formaPortal(f.NumeroFactura)).length)

  // Lo que haría la búsqueda antes de escribir (#190) si se subiera cada una tal cual está en Diez.
  seccion('busqueda_antes_de_escribir')
  let una = 0, varias = 0, ninguna = 0
  for (const f of [...sep, ...sepCatcher]) {
    const igual = esLaMismaRecibida({ numero: f.NumeroFactura, cuenta: f.CuentaCliente, nif: f.CifCliente })
    if (!igual) { ninguna++; continue }
    const ya = unicas(mesesEntre(mes(f.FechaFactura), hoy).flatMap((m) => porMes.get(m) ?? []).filter(igual))
    if (ya.length === 1) una++; else if (ya.length > 1) varias++; else ninguna++
  }
  di('se_enlazaria', una)
  di('mas_de_una_no_se_toca', varias)
  di('no_la_encuentra', ninguna)
  // En riders la cuenta es la misma para todos: lo que separa a dos facturas es el número y el NIF.
  di('riders.solo_la_cuenta_no_basta', sep.filter((f) => {
    const igual = esLaMismaRecibida({ numero: f.NumeroFactura, cuenta: f.CuentaCliente, nif: null })
    return !!igual && sep.filter(igual).length > 1
  }).length)
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
