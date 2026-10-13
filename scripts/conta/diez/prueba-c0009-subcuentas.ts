// scripts/conta/diez/prueba-c0009-subcuentas.ts
//
// C04b R5 · Las subcuentas que Diez no tiene, creadas primero en Diez con el
// mismo código y nombre que en Folvy (Julio, 13/10). Se prueba en la C0009 (la
// copia de pruebas) con las cuatro reales de octubre: 47700010 y las 708 de
// Scandal Burgers, The Urban Kebab y Dirty Burger.
//
// Frenos:
//   · la base es C0009 escrita aquí, no la del secreto; el cliente no deja
//     escribir en C0008 sin escribirEnReal, que aquí no se pasa;
//   · la que ya esté no se vuelve a crear (y si está con otro nombre, se dice
//     y no se toca); un segundo run no crea nada;
//   · después se lee el plan otra vez: cada una tiene que estar con su nombre;
//   · la salida pasa por limpiar().
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-subcuentas.ts

import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'
import { asegurarSubcuentas, planDeDiez } from '../../../supabase/functions/_shared/diezSubcuentas.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const USADAS = [
  { codigo: '47700010', nombre: 'IVA repercutido 10 %' },
  { codigo: '70800003', nombre: 'DEVOL. VENTAS SCANDAL BURGER' },
  { codigo: '70800007', nombre: 'DEVOL. VENTAS THE URBAN KEBAB' },
  { codigo: '70800008', nombre: 'DEVOL. VENTAS DIRTY BURGER' },
]

const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

md(`## Diez · subcuentas nuevas en ${BD}`, '')
try {
  await c.asegurarToken()
  const antes = planDeDiez(await c.subcuentas())
  md(`- Plan de ${BD} antes: ${antes.size} subcuentas`, ...USADAS.map((u) => `  - ${u.codigo}: ${antes.has(u.codigo) ? `ya estaba (${antes.get(u.codigo) === u.nombre ? 'mismo nombre' : 'OTRO nombre'})` : 'no está'}`))
  const r = await asegurarSubcuentas(c, USADAS)
  const despues = planDeDiez(await c.subcuentas())
  md('', `- **Creadas: ${r.creadas.length ? r.creadas.join(', ') : 'ninguna'}** · ya estaban: ${r.yaEstaban}`,
    ...r.otroNombre.map((o) => `- ${o.codigo} está en Diez con otro nombre: no se toca`),
    `- Plan de ${BD} después: ${despues.size} subcuentas (${despues.size - antes.size} más)`,
    ...USADAS.map((u) => `  - ${u.codigo}: ${despues.get(u.codigo) === u.nombre ? 'está, con el nombre de Folvy' : despues.has(u.codigo) ? 'está, con otro nombre' : 'NO está'}`),
    '', '- **Falta mirarlo en la pantalla de Diez (Julio):** que salgan en el plan de la C0009 y se puedan usar en un asiento.')
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones}`)
soltar()
