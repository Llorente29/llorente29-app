// scripts/conta/diez/prueba-c0009-facturas-leer.ts
//
// B01r26 (14/11) · ¿QUÉ CONSULTA DE FACTURAS TUMBA A DIEZ? En el ensayo de octubre
// en la C0009, «Ya lo he importado» dio «GET /api/facturas → 500» después de
// importar los dos Excel con su PDF. SOLO LEE (escribir: false), octubre y
// noviembre de 2026:
//   · el mes entero en páginas de 200 (lo de siempre), y en páginas de 25 y de 5;
//   · día a día, en páginas de 10: qué días dan 500;
//   · y, de un día que da 500, factura a factura por número de documento si se puede.
// Por la puerta de salida: solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-facturas-leer.ts

import { ClienteDiez, ErrorDiez, limitesMes, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
const sale = (k: string, n: number) => console.log(`@@ ${k} ${Math.trunc(n)}`)
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { sale('sin_secreto', 1); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})
const estado = (x: unknown) => (x instanceof ErrorDiez ? x.status : 0)
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')

try {
  await c.asegurarToken()
  for (const mes of ['202610', '202611']) {
    const [a, b] = limitesMes(mes)
    const ruta = `/api/facturas?${q({ $filter: `Fecha ge ${a} and Fecha le ${b}` })}`
    for (const tam of [200, 25, 5]) {
      try { const xs = await c.todas<Factura>(ruta, tam); sale(`m${mes}.tam${tam}.ok`, 1); sale(`m${mes}.tam${tam}.facturas`, xs.length) } catch (x) { sale(`m${mes}.tam${tam}.ok`, 0); sale(`m${mes}.tam${tam}.estado`, estado(x)) }
    }
    let malos = 0, buenos = 0
    for (let d = a; d <= b; d++) {
      try { await c.todas<Factura>(`/api/facturas?${q({ $filter: `Fecha ge ${d} and Fecha le ${d}` })}`, 10); buenos++ } catch (x) { malos++; sale(`d${d}.estado`, estado(x)) }
    }
    sale(`m${mes}.dias_bien`, buenos)
    sale(`m${mes}.dias_500`, malos)
  }
} catch (e) {
  console.log(`Parado: ${(e as Error).message}`)
  process.exit(1)
}
sale('peticiones', c.metrica.peticiones)
