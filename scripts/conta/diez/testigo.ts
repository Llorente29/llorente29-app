// scripts/conta/diez/testigo.ts
//
// C04b · T3 · La regla 1 contra el testigo: lee TODOS los apuntes de la C0008
// (de 2023-10 a 2026-09), los pasa por convertirAsiento —lo mismo que hará el
// importador— y suma por ejercicio, TipoAsiento y subcuenta:
//   · lo que dice Diez, tal cual (debe y haber con su signo);
//   · lo que guardaría Folvy, y lo que pasó de lado por ser negativo;
//   · lo que convertirAsiento rechazaría (no llegaría a Folvy).
// La comparación con los Excel de sumas y saldos (el testigo) se hace FUERA,
// con diezTestigo.ts: el testigo no viaja al runner.
//
// Por qué por TipoAsiento: Diez marca así apertura, regularización y cierre
// (0–5), y cuál es cuál no se supone: se elige el que hace cuadrar y se dice.
//
// Lo que sale en el registro, que es público:
//   · en claro, solo RECUENTOS (asientos por tipo, rechazos por motivo);
//   · las sumas por subcuenta, CIFRADAS con la clave pública de
//     testigo-clave-publica.pem (RSA-OAEP + AES-256-GCM). La privada no está
//     en el repositorio ni en el runner: solo puede leerlas quien la tiene.
// Solo GET. Ningún dato sale sin cifrar ni se escribe en ninguna base.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/testigo.ts

import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { cent, convertirAsiento } from '../../../supabase/functions/_shared/diezMapeo.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const DESDE = process.env.TESTIGO_DESDE || '202310'
const HASTA = process.env.TESTIGO_HASTA || '202609'

const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred || typeof cred !== 'object') { console.log('Falta el secreto DIEZ_LECTURA. No se lee nada.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, pausaMs: 120,
})

const meses = (): string[] => {
  const out: string[] = []
  let y = Number(DESDE.slice(0, 4)), m = Number(DESDE.slice(4))
  while (y * 100 + m <= Number(HASTA)) { out.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

// [ejercicio][tipo][cuenta] = [debe, haber] o [debe, haber, negativos]
type Suma = Record<string, Record<string, Record<string, number[]>>>
const diez: Suma = {}, folvy: Suma = {}, rechazado: Suma = {}
const fechas: Record<string, Record<string, [string, string]>> = {}
const n: Record<string, Record<string, { asientos: number; rechazos: number; negativos: number }>> = {}
const motivos: Record<string, number> = {}
const sumar = (s: Suma, ej: string, tipo: string, cuenta: string, valores: number[]) => {
  const v = (((s[ej] ??= {})[tipo] ??= {})[cuenta] ??= valores.map(() => 0))
  valores.forEach((x, i) => (v[i] += x))
}

md('## Diez · el testigo de la regla 1 (sumas por subcuenta, cifradas)', '', `Meses ${DESDE}–${HASTA} · base C0008 · solo GET`, '')
// Si el listado paginado repite un asiento, otro se ha quedado fuera aunque el
// total cuadre (lo que pasa con Drive): se cuenta por mes y se dice.
const repetidos: Record<string, number> = {}
for (const mes of meses()) {
  const apuntes: Apunte[] = await c.apuntesDelMes(mes)
  const claves = apuntes.map((a) => `${a.Ejercicio}|${a.Serie}|${a.Documento}`)
  const rep = claves.length - new Set(claves).size
  if (rep) repetidos[mes] = rep
  for (const a of apuntes) {
    const ej = String(a.Ejercicio), tipo = String(a.TipoAsiento ?? '—')
    const cuenta = (((n[ej] ??= {})[tipo] ??= { asientos: 0, rechazos: 0, negativos: 0 }))
    cuenta.asientos++
    const f = String(a.Fecha ?? '')
    const r = ((fechas[ej] ??= {})[tipo] ??= [f, f]); if (f < r[0]) r[0] = f; if (f > r[1]) r[1] = f
    const movido: Record<string, number> = {}
    for (const d of a.Detalles ?? []) {
      const cta = String(d.Cuenta ?? '').trim(), debe = cent(d.Debe), haber = cent(d.Haber)
      sumar(diez, ej, tipo, cta, [debe, haber])
      const m = (debe < 0 ? -debe : 0) + (haber < 0 ? -haber : 0)
      if (m) movido[cta] = (movido[cta] ?? 0) + m
    }
    const conv = await convertirAsiento(a)
    if ('rechazo' in conv) {
      cuenta.rechazos++
      const motivo = String(conv.rechazo.motivo).replace(/\d/g, '9')
      motivos[motivo] = (motivos[motivo] ?? 0) + 1
      for (const d of a.Detalles ?? []) sumar(rechazado, ej, tipo, String(d.Cuenta ?? '').trim(), [cent(d.Debe), cent(d.Haber)])
      continue
    }
    cuenta.negativos += conv.ok.ajustes.negativos
    for (const x of conv.ok.lineas) sumar(folvy, ej, tipo, x.cuenta, [x.debe, x.haber, 0])
    for (const [cta, m] of Object.entries(movido)) sumar(folvy, ej, tipo, cta, [0, 0, m])
  }
}

// En claro: solo recuentos.
md('### Asientos por ejercicio y TipoAsiento', '', '| Ejercicio | Tipo | Asientos | Rechazados | Líneas con negativo | Primera fecha | Última fecha |', '|---|---|---:|---:|---:|---|---|')
for (const ej of Object.keys(n).sort()) for (const tipo of Object.keys(n[ej]).sort()) {
  const x = n[ej][tipo], [f0, f1] = fechas[ej][tipo]
  md(`| ${ej} | ${tipo} | ${x.asientos} | ${x.rechazos} | ${x.negativos} | ${f0.slice(0, 4)}-${f0.slice(4, 6)}-${f0.slice(6)} | ${f1.slice(0, 4)}-${f1.slice(4, 6)}-${f1.slice(6)} |`)
}
md('', '### Asientos repetidos en el listado paginado', '', ...(Object.keys(repetidos).length ? Object.entries(repetidos).map(([m, k]) => `- ${m}: ${k} repetido${k === 1 ? '' : 's'} (y otros tantos que faltan)`) : ['- ninguno: cada asiento, una vez']))
md('', '### Por qué rechazaría convertirAsiento', '', ...(Object.keys(motivos).length ? Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, k]) => `- ${k} × ${m}`) : ['- ninguno']), '')

// Cifrado: las sumas por subcuenta.
const claro = gzipSync(Buffer.from(JSON.stringify({ desde: DESDE, hasta: HASTA, diez, folvy, rechazado, fechas })))
const clave = randomBytes(32), iv = randomBytes(12)
const cif = createCipheriv('aes-256-gcm', clave, iv)
const datos = Buffer.concat([cif.update(claro), cif.final()])
const envuelta = publicEncrypt({ key: readFileSync(new URL('./testigo-clave-publica.pem', import.meta.url)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, clave)
const paquete = Buffer.from(JSON.stringify({ k: envuelta.toString('base64'), iv: iv.toString('base64'), tag: cif.getAuthTag().toString('base64'), d: datos.toString('base64') })).toString('base64')
md(`### Sumas por subcuenta: cifradas (${paquete.length} caracteres)`, '', 'Solo las puede leer quien tiene la clave privada; aquí no dicen nada.', '')
soltar()
// El paquete va aparte de limpiar(): es texto cifrado (base64), no hay nada que tapar.
process.stdout.write('-----TESTIGO CIFRADO-----\n')
for (let i = 0; i < paquete.length; i += 100) process.stdout.write(`T ${paquete.slice(i, i + 100)}\n`)
process.stdout.write('-----FIN TESTIGO-----\n')
