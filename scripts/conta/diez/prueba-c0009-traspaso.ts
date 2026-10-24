// scripts/conta/diez/prueba-c0009-traspaso.ts
//
// C12 (24/10) · El «Cuadra» del traspaso mensual, contra la C0009 de verdad.
// SOLO LEE (escribir: false): el cliente para cualquier escritura.
//
// Lo que se mide, de octubre de 2026 en la C0009:
//   1. getSumasYsaldos contesta y trae Subcuenta, Debe y Haber en cada fila
//      (lo que lee cuadrar(): si Diez los llamara de otra forma, el cuadre
//      saldría «no cuadra» en todo).
//   2. Lo que suma: debe = haber en el mes (un libro siempre cuadra).
//   3. cuadrar() con lo mismo que tiene Diez: «Cuadra», 0 diferencias.
//   4. Con un céntimo de menos en una cuenta: «No cuadra», 1 diferencia de
//      0,01 en esa cuenta.
//   5. Contra los apuntes del mismo mes (api/apuntes, con sus líneas, si las
//      trae): mismas cuentas y mismos importes.
//
// Todo sale por la puerta de salida: solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-traspaso.ts

import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { cuadrar, rangoDelMes, subcuenta, sumarDiez, type Saldo } from '../../../supabase/functions/_shared/diezTraspaso.ts'

const BD = 'C0009'
const MES = '2026-10-01'
const sale = (clave: string, n: number | boolean) => console.log(`@@ ${clave} ${typeof n === 'boolean' ? (n ? 1 : 0) : n}`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('@@ sin_secreto 1'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

try {
  await c.asegurarToken()
  const { ejercicio, desde, hasta } = rangoDelMes(MES)
  const filas = await c.sumasYSaldos(ejercicio, desde, hasta)
  sale('filas', filas.length)
  const conCampos = filas.filter((f) => 'Subcuenta' in f && 'Debe' in f && 'Haber' in f).length
  sale('filas_con_subcuenta_debe_haber', conCampos)
  sale('campos_primera_fila', filas[0] ? Object.keys(filas[0]).length : 0)
  // La forma de la respuesta: cada campo (su nombre es del API, no un dato), en
  // cuántas filas trae un número y cuánto suma en céntimos.
  const campos = new Map<string, { n: number; c: number }>()
  for (const f of filas) for (const [k, v] of Object.entries(f)) {
    const clave = k.toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!clave) continue
    const x = campos.get(clave) ?? { n: 0, c: 0 }
    if (typeof v === 'number' && Number.isFinite(v)) { x.n++; x.c += Math.round(v * 100) }
    campos.set(clave, x)
  }
  for (const [k, x] of [...campos].sort()) { sale(`campo.${k}.numericas`, x.n); sale(`campo.${k}.centimos`, x.c) }

  const m = sumarDiez(filas)
  sale('subcuentas', m.size)
  const debe = [...m.values()].reduce((s, x) => s + x.debe, 0)
  const haber = [...m.values()].reduce((s, x) => s + x.haber, 0)
  sale('debe_centimos', debe)
  sale('haber_centimos', haber)
  sale('debe_igual_haber', debe === haber)

  // 3 · Lo mismo que Diez: cuadra.
  const iguales: Saldo[] = [...m.entries()].map(([cuenta, v]) => ({ cuenta, debe: v.debe / 100, haber: v.haber / 100 }))
  const r1 = cuadrar(iguales, filas)
  sale('cuadra_con_lo_mismo', r1.cuadra)
  sale('diferencias_con_lo_mismo', r1.diferencias.length)
  sale('solo_en_diez_con_lo_mismo', r1.solo_en_diez.length)

  // 4 · Un céntimo de menos en la primera cuenta con debe: no cuadra, una diferencia de 0,01.
  const i = iguales.findIndex((s) => s.debe > 0)
  if (i >= 0) {
    const otro = iguales.map((s, k) => (k === i ? { ...s, debe: Math.round(s.debe * 100 - 1) / 100 } : s))
    const r2 = cuadrar(otro, filas)
    sale('cuadra_con_un_centimo_menos', r2.cuadra)
    sale('diferencias_con_un_centimo_menos', r2.diferencias.length)
    sale('diferencia_centimos', Math.round((r2.diferencias[0]?.falta_debe ?? 0) * 100))
  } else sale('sin_cuenta_con_debe', 1)

  // 5 · Contra los apuntes del mes, si traen sus líneas.
  const apuntes = await c.apuntesDelMes(MES.slice(0, 7).replace('-', '')) as Apunte[]
  sale('apuntes', apuntes.length)
  const lineas = apuntes.flatMap((a) => a.Detalles ?? [])
  sale('lineas_de_apuntes', lineas.length)
  sale('apuntes_debe_centimos', lineas.reduce((t, l) => t + Math.round((l.Debe ?? 0) * 100), 0))
  sale('apuntes_haber_centimos', lineas.reduce((t, l) => t + Math.round((l.Haber ?? 0) * 100), 0))
  sale('apuntes_subcuentas', new Set(lineas.map((l) => subcuenta(l.Cuenta))).size)
  if (lineas.length) {
    const desdeApuntes = sumarDiez(lineas.map((l) => ({ Subcuenta: subcuenta(l.Cuenta), Debe: l.Debe ?? 0, Haber: l.Haber ?? 0 })))
    const s: Saldo[] = [...desdeApuntes.entries()].map(([cuenta, v]) => ({ cuenta, debe: v.debe / 100, haber: v.haber / 100 }))
    const r3 = cuadrar(s, filas)
    sale('cuadra_con_los_apuntes', r3.cuadra)
    sale('diferencias_con_los_apuntes', r3.diferencias.length)
    sale('solo_en_sumas_y_saldos', r3.solo_en_diez.length)
  }
  sale('escrito_en_diez', 0)
} catch (e) {
  const st = (e as { status?: number }).status
  sale('parado', 1)
  if (typeof st === 'number') sale('http', st)
  process.exit(1)
}
