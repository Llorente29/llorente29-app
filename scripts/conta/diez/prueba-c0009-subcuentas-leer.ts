// scripts/conta/diez/prueba-c0009-subcuentas-leer.ts
//
// B01r26 (14/11) · ¿QUÉ SUBCUENTA HACE FALLAR A DIEZ? El ensayo de octubre en la
// C0009 se cortó en 47 asientos con «GET subcuenta → 500 (Object reference not set
// to an instance of an object)». SOLO LEE (escribir: false): la lista de subcuentas
// de la C0009 y, para cada sospechosa, si está en la lista y qué contesta su GET.
// Si las que dan 500 son justo las que no están en la lista, Diez contesta 500 en
// vez de 404 a la subcuenta que no existe.
//
// Por la puerta de salida: solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-subcuentas-leer.ts

import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'

const BD = 'C0009'
// Las que solo salen en los asientos cortados (producción, 14/11) y las 11 que faltan en la C0008 (13/11).
const SOSPECHOSAS = ['40000019', '40700001', '41000027', '41000042', '41000043', '41000044', '41000046', '41000047', '41000100', '47200004',
  '47200010', '47200021', '47700010', '47700021', '60000000', '62100000', '62300004', '63400000', '70009001', '70800004']
// Y unas que seguro existen, de control.
const CONTROL = ['43000002', '57200001', '70000000']

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
try {
  await c.asegurarToken()
  const lista = new Set((await c.subcuentas()).map((x) => String(x.Codigo ?? '').trim()))
  sale('subcuentas_en_la_lista', lista.size)
  let coinciden = 0, total = 0
  for (const k of [...SOSPECHOSAS, ...CONTROL]) {
    const r = await (c as unknown as { llamar(m: string, r: string): Promise<{ status: number; json: unknown }> }).llamar('GET', `/api/subcuentas/subcuenta/${k}`)
    const enLista = lista.has(k)
    sale(`s${k}.en_lista`, enLista ? 1 : 0)
    sale(`s${k}.get`, r.status)
    total++
    // Lo que se espera si la hipótesis es buena: en la lista → 200; fuera → 500 (o 404).
    if ((enLista && r.status === 200) || (!enLista && (r.status === 500 || r.status === 404))) coinciden++
  }
  sale('coinciden_con_la_lista', coinciden)
  sale('preguntadas', total)
} catch (e) {
  console.log(`Parado: ${(e as Error).message}`)
  process.exit(1)
}
sale('peticiones', c.metrica.peticiones)
