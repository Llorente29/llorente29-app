// scripts/conta/diez/guarda-desde.ts
//
// B01r·26 (13/11) · LA GUARDA DE DIEZ de una tanda: cuenta, SOLO CON GET, los
// asientos de una base de Diez con fecha desde un día, y dice si son los que la
// tanda espera. La usa «Aplicar SQL en PRODUCCIÓN» cuando la carpeta de la tanda
// trae guarda-diez.json:
//
//   { "base": "C0008", "ejercicio": "2026", "desde": "20261001", "esperado": 0 }
//
// La primera: la 1745 (liberar octubre) solo puede ir cuando Julio ha borrado en
// la C0008 todo lo de octubre en adelante.
//
// Salida, por la puerta (salidaSegura): solo claves y enteros. Código de salida:
// 0 si cuadra, 3 si no cuadra, 1 si no se ha podido leer (y entonces el real
// para: sin leer no hay guarda).
//
//   DIEZ_LECTURA='{…}' GUARDA=supabase/produccion/tandas/…/guarda-diez.json npx tsx scripts/conta/diez/guarda-desde.ts

import { readFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'

const di = (k: string, v: number) => console.log(`@@ ${k} ${Math.trunc(v)}`)

type Guarda = { base: string; ejercicio: string; desde: string; esperado: number }
const g = JSON.parse(readFileSync(process.env.GUARDA ?? '', 'utf8')) as Guarda
if (!/^C\d{4}$/.test(g.base) || g.base === 'C0001' || !/^\d{4}$/.test(g.ejercicio) || !/^\d{8}$/.test(g.desde) || !Number.isInteger(g.esperado)) {
  console.log('guarda-diez.json no tiene la forma { base: «C» y cuatro cifras, ejercicio: AAAA, desde: AAAAMMDD, esperado: entero }.')
  process.exit(1)
}
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA: sin leer Diez no hay guarda.'); process.exit(1) }

let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: g.base,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  // Los meses desde «desde» hasta hoy (y uno más, por si alguien apunta con fecha de mañana).
  const hoy = new Date()
  const fin = hoy.getUTCFullYear() * 12 + hoy.getUTCMonth() + 1 // el mes que viene, contado en meses (0 = enero)
  const meses: string[] = []
  for (let k = Number(g.desde.slice(0, 4)) * 12 + Number(g.desde.slice(4, 6)) - 1; k <= fin; k++) {
    meses.push(`${Math.floor(k / 12)}${String((k % 12) + 1).padStart(2, '0')}`)
  }
  const vistos = new Map<string, Apunte>()
  for (const m of meses) for (const a of await c.apuntesDelMes(m)) vistos.set(`${a.Ejercicio}/${a.Serie}/${a.Documento}`, a)
  const desde = [...vistos.values()].filter((a) => String(a.Ejercicio) === g.ejercicio && String(a.Fecha ?? '') >= g.desde)
  di('guarda.meses_leidos', meses.length)
  di('guarda.asientos_desde', desde.length)
  di('guarda.esperado', g.esperado)
  di('guarda.cuadra', desde.length === g.esperado ? 1 : 0)
  di('guarda.peticiones', c.metrica.peticiones)
  process.exit(desde.length === g.esperado ? 0 : 3)
} catch (e) {
  console.log(`No se ha podido leer Diez: ${(e as Error).message}`)
  di('guarda.leida', 0)
  process.exit(1)
}
