// scripts/conta/diez/prueba-c0009-autoliquidada-detalle.ts
//
// I01f · SOLO LEE (escribir: false). El detalle que guardó Diez de la
// autoliquidada inventada de Sumied (SUMIED-I01F-0001) y de su «-ANUL» en la
// C0009: el run 141 dijo que la «-ANUL» no cuadra y que la 472 y la 477 no
// quedan a cero entre las dos. Aquí se mira, línea a línea, qué cuenta lleva
// cada una (472, 477, el proveedor o el gasto), si va al Debe o al Haber, con
// qué signo y si su importe es la cuota o la base, y las cabeceras de cuota y
// total con su signo. Los importes son inventados (1,00 € y 0,21 €); aun así
// solo salen signos, recuentos y sí/no.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-autoliquidada-detalle.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
const NUMERO = 'SUMIED-I01F-0001'
const CUENTA = '41000038'

const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const signo = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

// 1 la 472, 2 la 477, 3 el proveedor, 4 el gasto (6…), 9 otra.
const clase = (cta: string) => (cta.startsWith('472') ? 1 : cta.startsWith('477') ? 2 : cta === CUENTA ? 3 : cta.startsWith('6') ? 4 : 9)

function detalle(nombre: string, f: Factura) {
  const cuota = Math.abs(n2(f.CuotaIVA1)), base = Math.abs(n2(f.BaseImponible1))
  di(`${nombre}.tipo_factura`, Number(f.TipoFactura))
  di(`${nombre}.signo_base`, signo(n2(f.BaseImponible1)))
  di(`${nombre}.signo_cuota`, signo(n2(f.CuotaIVA1)))
  di(`${nombre}.signo_total`, signo(n2(f.TotalFactura)))
  di(`${nombre}.total_es_la_base`, n2(f.TotalFactura) === n2(f.BaseImponible1))
  const ap = (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
  di(`${nombre}.apuntes`, ap.length)
  ap.forEach((a, i) => { di(`${nombre}.ap${i + 1}.clase`, clase(String(a.Cuenta ?? ''))); di(`${nombre}.ap${i + 1}.signo`, signo(n2(a.Importe))) })
  const de = (f.Detalles as Record<string, unknown>[] | undefined) ?? []
  di(`${nombre}.detalles`, de.length)
  let debe = 0, haber = 0
  de.forEach((d, i) => {
    const k = `${nombre}.d${i + 1}`
    const D = n2(d.Debe), H = n2(d.Haber), x = Math.abs(D !== 0 ? D : H)
    debe += D; haber += H
    di(`${k}.clase`, clase(String(d.Cuenta ?? '')))
    di(`${k}.signo_debe`, signo(D))
    di(`${k}.signo_haber`, signo(H))
    di(`${k}.es_la_cuota`, x === cuota)
    di(`${k}.es_la_base`, x === base)
    di(`${k}.es_base_mas_cuota`, x === base + cuota)
  })
  di(`${nombre}.signo_debe_menos_haber`, signo(debe - haber))
  di(`${nombre}.descuadre_es_la_cuota`, Math.abs(debe - haber) === cuota)
  di(`${nombre}.descuadre_es_dos_cuotas`, Math.abs(debe - haber) === 2 * cuota)
}

try {
  await c.asegurarToken()
  seccion('entrar')
  di('entrar.c0009', true)
  // Las dos son de hoy (20/10): se buscan en el libro del mes por número.
  const mes = (await c.facturasDelMes('202610')).filter((x) => String(x.Serie) === '2')
  for (const [nombre, num] of [['original', NUMERO], ['anulacion', `${NUMERO}-ANUL`]] as const) {
    seccion(nombre)
    const hit = mes.filter((x) => String(x.NumeroFactura) === num)
    di(`${nombre}.encontradas`, hit.length)
    if (!hit.length) continue
    di(`${nombre}.documento`, Number(hit[0].Documento))
    const f = await c.get<Factura>(`/api/facturas/factura/${hit[0].Ejercicio ?? '2026'}/2/${hit[0].Documento}`)
    detalle(nombre, f)
  }
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
