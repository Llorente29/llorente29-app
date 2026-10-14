// scripts/conta/diez/balance-lineas.ts
//
// C06b · punto 1 · El balance abreviado de Folvy contra el de Diez, línea a
// línea, a la misma fecha. Lee de la C0008 TODOS los apuntes del ejercicio
// (apertura incluida, mes a mes) y los compara con los saldos del libro de
// Folvy a una fecha de corte (el fichero que vuelca el workflow con
// conta_lectura, solo SELECT):
//   · por subcuenta, Diez a la fecha de corte contra Folvy a la fecha de corte;
//   · por línea del balance abreviado (el mismo mapeo de serie que usa
//     Folvy, con el mismo «prefijo más largo» de cuentasAnuales.colocar),
//     Clientes, Otros deudores y el patrimonio neto;
//   · lo que Diez tiene DESPUÉS del corte (octubre): cuántos asientos y a qué
//     líneas mueven.
//
// Lo que sale en el registro, que es público:
//   · en claro, solo RECUENTOS y SÍ/NO (¿coinciden al céntimo?);
//   · las cifras, CIFRADAS con testigo-clave-publica.pem, como el testigo.
// Solo GET. Nada sale sin cifrar ni se escribe en ninguna base.
//
//   DIEZ_LECTURA='{…}' FOLVY_SALDOS=folvy.txt FOLVY_MAPEO=mapeo.txt \
//     BALANCE_EJERCICIO=2026 BALANCE_CORTE=20260930 npx tsx scripts/conta/diez/balance-lineas.ts

import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { cent } from '../../../supabase/functions/_shared/diezMapeo.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const EJERCICIO = process.env.BALANCE_EJERCICIO || '2026'
const CORTE = process.env.BALANCE_CORTE || '20260930'
const HASTA_MES = process.env.BALANCE_HASTA_MES || `${EJERCICIO}12`

const l: string[] = []
const md = (...x: string[]) => l.push(...x)

// Folvy: «código|plantilla|céntimos deudores» (debe − haber) por subcuenta, a la fecha de corte.
const folvy = new Map<string, number>()
const plantilla = new Map<string, string>()
for (const fila of readFileSync(process.env.FOLVY_SALDOS || 'folvy.txt', 'utf8').split('\n').filter(Boolean)) {
  const [code, tpl, c] = fila.split('|')
  folvy.set(code, Number(c))
  if (tpl) plantilla.set(code, tpl)
}
// Mapeo de serie del abreviado: «prefijo|línea|by_balance|lado de la línea».
interface Fila { prefix: string; line: string; byBalance: string | null; side: string }
const mapeo: Fila[] = readFileSync(process.env.FOLVY_MAPEO || 'mapeo.txt', 'utf8').split('\n').filter(Boolean)
  .map((x) => { const [prefix, line, by, side] = x.split('|'); return { prefix, line, byBalance: by || null, side } })

// Lo mismo que cuentasAnuales.colocar: el prefijo más largo; dos filas, por el signo.
const colocar = (code: string, deudor: number): Fila | null => {
  const tpl = plantilla.get(code) ?? code
  const cubren = mapeo.filter((m) => tpl.startsWith(m.prefix))
  if (!cubren.length) return null
  const max = Math.max(...cubren.map((m) => m.prefix.length))
  const top = cubren.filter((m) => m.prefix.length === max)
  if (top.length === 1) return top[0]
  const lado = deudor >= 0 ? 'deudor' : 'acreedor'
  return top.find((m) => m.byBalance === lado) ?? top.find((m) => !m.byBalance) ?? top[0]
}
// Las líneas que se miran: las tres de Julio y el total de III.
const LINEAS: Record<string, (line: string) => boolean> = {
  'ACT.B.III.1 Clientes por ventas': (x) => x === 'ACT.B.III.1',
  'ACT.B.III.3 Otros deudores': (x) => x === 'ACT.B.III.3',
  'ACT.B.III Deudores comerciales (total)': (x) => x.startsWith('ACT.B.III.'),
  'PNP.A Patrimonio neto': (x) => x === 'PNP.A' || x.startsWith('PNP.A.'),
}
const porLinea = (saldos: Map<string, number>) => {
  const out: Record<string, number> = Object.fromEntries(Object.keys(LINEAS).map((k) => [k, 0]))
  for (const [code, deudor] of saldos) {
    if (!/^[1-7]/.test(plantilla.get(code) ?? code)) continue
    const m = colocar(code, deudor)
    if (!m) continue
    const natural = m.side === 'activo' ? deudor : -deudor
    for (const [k, f] of Object.entries(LINEAS)) if (f(m.line)) out[k] += natural
  }
  return out
}

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred || typeof cred !== 'object') { console.log('Falta el secreto DIEZ_LECTURA. No se lee nada.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, pausaMs: 120,
})

// Diez a veces contesta 400 «OutOfMemoryException» a un mes (14/10, run
// 38533537089): es suyo y pasajero. Se reintenta ese mes, con pausa, y se dice.
const reintentos: Record<string, number> = {}
const leerMes = async (mes: string): Promise<Apunte[]> => {
  for (let i = 0; ; i++) {
    try { return await c.apuntesDelMes(mes) } catch (e) {
      const sinMemoria = JSON.stringify((e as { cuerpo?: unknown }).cuerpo ?? '').includes('OutOfMemory')
      if (!sinMemoria || i >= 4) throw e
      reintentos[mes] = i + 1
      await new Promise((r) => setTimeout(r, 30_000 * (i + 1)))
    }
  }
}

// Diez, por subcuenta: a la fecha de corte y con todo lo que hay.
const alCorte = new Map<string, number>(), todo = new Map<string, number>(), despues = new Map<string, number>()
const sumar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
const asientosMes: Record<string, number> = {}
let tras = 0, otroEjercicio = 0
const vistos = new Set<string>()
let repetidos = 0
for (let m = 1; Number(`${EJERCICIO}${String(m).padStart(2, '0')}`) <= Number(HASTA_MES); m++) {
  const mes = `${EJERCICIO}${String(m).padStart(2, '0')}`
  const apuntes: Apunte[] = await leerMes(mes)
  asientosMes[mes] = apuntes.length
  process.stderr.write(`${mes}: ${apuntes.length} asientos\n`)
  for (const a of apuntes) {
    const k = `${a.Ejercicio}|${a.Serie}|${a.Documento}`
    if (vistos.has(k)) { repetidos++; continue }
    vistos.add(k)
    if (String(a.Ejercicio) !== EJERCICIO) { otroEjercicio++; continue }
    const f = String(a.Fecha ?? '')
    const enCorte = f <= CORTE
    if (!enCorte) tras++
    for (const d of a.Detalles ?? []) {
      const cta = String(d.Cuenta ?? '').trim(), v = cent(d.Debe) - cent(d.Haber)
      sumar(todo, cta, v)
      sumar(enCorte ? alCorte : despues, cta, v)
    }
  }
}

// Comparación por subcuenta, a la fecha de corte.
const codigos = new Set([...alCorte.keys(), ...folvy.keys()])
const distintas: { code: string; diez: number; folvy: number }[] = []
for (const code of codigos) {
  const a = alCorte.get(code) ?? 0, b = folvy.get(code) ?? 0
  if (a !== b) distintas.push({ code, diez: a, folvy: b })
}
const grupo = (code: string) => code.slice(0, 3)
const distintasPorGrupo: Record<string, number> = {}
for (const x of distintas) distintasPorGrupo[grupo(x.code)] = (distintasPorGrupo[grupo(x.code)] ?? 0) + 1

const lDiezCorte = porLinea(alCorte), lDiezTodo = porLinea(todo), lFolvy = porLinea(folvy), lDespues = porLinea(despues)

md(`## Diez · balance abreviado contra Folvy, línea a línea (C0008, ejercicio ${EJERCICIO}, corte ${CORTE.slice(0, 4)}-${CORTE.slice(4, 6)}-${CORTE.slice(6)})`, '', 'Solo GET en Diez; Folvy con conta_lectura. En claro, solo recuentos y sí/no.', '')
md('### Asientos leídos por mes', '', ...Object.entries(asientosMes).map(([m, k]) => `- ${m}: ${k}`), '')
md(`Meses reintentados por «OutOfMemoryException» de Diez: ${Object.keys(reintentos).length ? Object.entries(reintentos).map(([m, k]) => `${m} (${k})`).join(', ') : 'ninguno'}`, '')
md(`Asientos repetidos en el listado: ${repetidos} · de otro ejercicio: ${otroEjercicio} · con fecha posterior al corte: ${tras}`, '')
md('### Por subcuenta, a la fecha de corte', '', `- subcuentas con saldo en algún lado: ${codigos.size}`, `- que NO coinciden al céntimo: ${distintas.length}`,
  ...Object.entries(distintasPorGrupo).sort().map(([g, k]) => `  - grupo ${g}: ${k}`), '')
md('### Por línea', '', '| Línea | Diez al corte = Folvy al corte | Diez con todo = Folvy al corte | Diez mueve después del corte |', '|---|---|---|---|')
for (const k of Object.keys(LINEAS)) {
  md(`| ${k} | ${lDiezCorte[k] === lFolvy[k] ? 'sí' : 'NO'} | ${lDiezTodo[k] === lFolvy[k] ? 'sí' : 'NO'} | ${lDespues[k] !== 0 ? 'sí' : 'no'} |`)
}
md('', 'Las cifras (por línea: Diez al corte, Diez con todo, Folvy, lo de después; y cada subcuenta que no coincide): cifradas.', '')

const claro = gzipSync(Buffer.from(JSON.stringify({ ejercicio: EJERCICIO, corte: CORTE, lineas: { diezAlCorte: lDiezCorte, diezConTodo: lDiezTodo, folvy: lFolvy, despues: lDespues }, distintas, despues: Object.fromEntries(despues) })))
const clave = randomBytes(32), iv = randomBytes(12)
const cif = createCipheriv('aes-256-gcm', clave, iv)
const datos = Buffer.concat([cif.update(claro), cif.final()])
const envuelta = publicEncrypt({ key: readFileSync(new URL('./testigo-clave-publica.pem', import.meta.url)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, clave)
const paquete = Buffer.from(JSON.stringify({ k: envuelta.toString('base64'), iv: iv.toString('base64'), tag: cif.getAuthTag().toString('base64'), d: datos.toString('base64') })).toString('base64')
process.stdout.write(limpiar(l.join('\n')) + '\n')
process.stdout.write('-----TESTIGO CIFRADO-----\n')
for (let i = 0; i < paquete.length; i += 100) process.stdout.write(`T ${paquete.slice(i, i + 100)}\n`)
process.stdout.write('-----FIN TESTIGO-----\n')
