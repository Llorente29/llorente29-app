// scripts/conta/diez/prueba-c0009-recibida-anular.ts
//
// D01 · CÓMO SE ANULA UNA RECIBIDA EN DIEZ, SOLO LEYENDO (C0009, solo GET).
//
// Julio (15/10): anular una recibida ya enviada con su «-ANUL», igual que las
// ventas. La forma de las ventas se midió en la serie 1 (rectificativas-molde,
// 14/10); aquí se mira la serie 2 y se ensaya la de Folvy sin escribir:
//   · cuántas recibidas de la gestoría llevan «ANUL» en el número o la
//     descripción, el total en negativo o campos de rectificativa, y su forma
//     (TipoFactura, signos, si su original está en Diez y es del mismo proveedor);
//   · para cada recibida real de los últimos 12 meses, la «-ANUL» que haría
//     Folvy (facturaRecibidaQueAnula, el código de la función): si cuadra
//     (bases, cuotas, total y apuntes, todo al revés) y si la búsqueda antes de
//     escribir (esLaMismaRecibida) encontraría alguna ya en Diez — que tiene que
//     ser solo donde la gestoría ya la anuló, y nunca la original.
//
// Frenos: C0009 y escribir: false (el cliente no puede escribir: solo GET); la
// salida es solo «@@ clave número» y el workflow la pasa por salida-segura.mjs.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida-anular.ts

import { ClienteDiez, type AlmacenToken, type Factura, type FacturaData } from '../../../supabase/functions/_shared/diezCliente.ts'
import { esLaMismaRecibida, mesesEntre, MESES_BUSQUEDA_RECIBIDA } from '../../../supabase/functions/_shared/diezEnviar.ts'
import { facturaRecibidaQueAnula } from '../../../supabase/functions/_shared/diezRecibida.ts'
import { claveNumero } from '../../../supabase/functions/_shared/lecturaFactura.ts'

const BD = 'C0009'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const lleno = (x: unknown) => x != null && x !== '' && x !== 0 && x !== false
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

const hoyIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const hoy = hoyIso.replace(/-/g, '').slice(0, 6)
const clave = (f: Factura) => `${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`
const unicas = (fs: Factura[]) => [...new Map(fs.map((f) => [clave(f), f])).values()]
const conAnul = (f: Factura) => /ANUL/.test(claveNumero(String(f.NumeroFactura ?? '')) ?? '') || /^ANUL/i.test(String(f.Descripcion ?? '').trim())

try {
  await c.asegurarToken()
  // Del mes más reciente hacia atrás hasta 2023-01, y para sola a los 11 minutos (el job tiene 15).
  const todos = mesesEntre('202301', hoy).reverse()
  const hasta = Date.now() + 11 * 60_000
  const porMes = new Map<string, Factura[]>()
  let sinContestar = 0
  for (const m of todos) {
    if (Date.now() > hasta) break
    try { porMes.set(m, (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2')) } catch { sinContestar++; porMes.set(m, []) }
  }
  const rec = unicas([...porMes.values()].flat())
  seccion('poblacion')
  di('meses_leidos', porMes.size)
  di('meses_sin_contestar', sinContestar)
  di('recibidas', rec.length)
  if (!rec.length) throw new Error('sin recibidas')

  // 1 · Lo que ya hay: las anuladas por la gestoría en la serie 2.
  seccion('gestoria')
  const anul = rec.filter(conAnul)
  const neg = rec.filter((f) => n2(f.TotalFactura) < 0)
  const rect = rec.filter((f) => lleno(f.FacturaRectificativa) || lleno(f.TipoRectificativa) || lleno(f.NumeroFacturaRectificativa))
  di('con_anul', anul.length)
  di('con_anul.numero_acaba_en_anul', anul.filter((f) => /ANUL$/.test(claveNumero(String(f.NumeroFactura ?? '')) ?? '')).length)
  di('con_anul.descripcion_empieza_por_anul', anul.filter((f) => /^ANUL/i.test(String(f.Descripcion ?? '').trim())).length)
  di('con_anul.total_negativo', anul.filter((f) => n2(f.TotalFactura) < 0).length)
  di('con_anul.con_rectificativa', anul.filter((f) => rect.includes(f)).length)
  for (const t of [...new Set(anul.map((f) => f.TipoFactura))]) di(`con_anul.tipofactura_${k(t)}`, anul.filter((f) => f.TipoFactura === t).length)
  // Su original: el mismo número sin «ANUL», del mismo proveedor (cuenta o NIF), en lo leído.
  const original = (f: Factura) => {
    const base = (claveNumero(String(f.NumeroFactura ?? '')) ?? '').replace(/ANUL$/, '')
    return rec.filter((g) => g !== f && claveNumero(String(g.NumeroFactura ?? '')) === base
      && (String(g.CuentaCliente) === String(f.CuentaCliente) || (lleno(g.CifCliente) && String(g.CifCliente) === String(f.CifCliente))))
  }
  const conOrig = anul.filter((f) => original(f).length === 1)
  di('con_anul.su_original_esta', conOrig.length)
  di('con_anul.su_original.importes_al_reves', conOrig.filter((f) => { const o = original(f)[0]; return n2(f.TotalFactura) === -n2(o.TotalFactura) && [1, 2, 3].every((i) => n2(f[`BaseImponible${i}`]) === -n2(o[`BaseImponible${i}`])) }).length)
  di('negativas', neg.length)
  di('negativas.sin_anul', neg.filter((f) => !conAnul(f)).length)
  for (const t of [...new Set(neg.map((f) => f.TipoFactura))]) di(`negativas.tipofactura_${k(t)}`, neg.filter((f) => f.TipoFactura === t).length)
  di('con_rectificativa', rect.length)

  // 2 · La «-ANUL» de Folvy para cada recibida de los últimos 12 meses, sin escribir.
  seccion('folvy')
  const ventana = rec.filter((f) => !conAnul(f) && n2(f.TotalFactura) > 0 && mesesEntre(String(f.FechaFactura ?? '').slice(0, 6), hoy).length <= MESES_BUSQUEDA_RECIBIDA)
  di('en_ventana', ventana.length)
  let hechas = 0, fallan = 0, cuadran = 0, encuentraOriginal = 0, encuentraYaAnulada = 0, encuentraNinguna = 0, encuentraVarias = 0, sinClave = 0
  for (const f of ventana) {
    let a: FacturaData
    try { a = facturaRecibidaQueAnula(f as FacturaData, { fecha: hoyIso, hoy: hoyIso }); hechas++ } catch { fallan++; continue }
    const ap = ((a.Apuntes as { Importe?: number }[] | undefined) ?? []).reduce((t, x) => t + n2(x.Importe), 0)
    const apO = ((f.Apuntes as { Importe?: number }[] | undefined) ?? []).reduce((t, x) => t + n2(x.Importe), 0)
    if (n2(a.TotalFactura) === -n2(f.TotalFactura) && ap === -apO && [1, 2, 3].every((i) => n2(a[`BaseImponible${i}`]) === -n2(f[`BaseImponible${i}`]) && n2(a[`CuotaIVA${i}`]) === -n2(f[`CuotaIVA${i}`]))) cuadran++
    const igual = esLaMismaRecibida({ numero: a.NumeroFactura, cuenta: a.CuentaCliente, nif: f.CifCliente })
    if (!igual) { sinClave++; continue }
    // Desde el mes de la ORIGINAL a hoy: lo más amplio que buscaría (el contraasiento nunca es anterior).
    const ya = unicas(mesesEntre(String(f.FechaFactura ?? '').slice(0, 6), hoy).flatMap((m) => porMes.get(m) ?? []).filter(igual))
    if (ya.some((g) => clave(g) === clave(f))) encuentraOriginal++
    if (ya.length === 0) encuentraNinguna++
    else if (ya.length === 1) encuentraYaAnulada++
    else encuentraVarias++
  }
  di('hechas', hechas)
  di('no_se_pueden_hacer', fallan)
  di('cuadran_al_reves', cuadran)
  di('sin_clave', sinClave)
  di('la_busqueda_encuentra_la_original', encuentraOriginal)
  di('la_busqueda_no_encuentra_ninguna', encuentraNinguna)
  di('la_busqueda_encuentra_una_ya_anulada', encuentraYaAnulada)
  di('la_busqueda_encuentra_varias', encuentraVarias)
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
