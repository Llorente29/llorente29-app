// scripts/conta/diez/prueba-c0009-traspaso.ts
//
// C12 (24/10) · El «Cuadra» del traspaso mensual, contra la C0009 de verdad.
// SOLO LEE (escribir: false): el cliente para cualquier escritura.
//
// Lo que se mide, de octubre de 2026 en la C0009, con lo que lee el traspaso
// de verdad (conta-diez-traspaso): los apuntes del mes y sus líneas.
//   1. api/apuntes del mes contesta y sus líneas traen Cuenta, Debe y Haber.
//   2. Lo que suman (debe y haber, en céntimos): en un libro sano, iguales.
//   3. cuadrar() con lo mismo que tiene Diez: «Cuadra», 0 diferencias.
//   4. Con un céntimo de menos en una cuenta: «No cuadra», 1 diferencia de
//      0,01 en esa cuenta.
//   5. Por qué no getSumasYsaldos: cuántas líneas y subcuentas trae al lado
//      de los apuntes (C04b, run 9: líneas de solo algunas cuentas).
//
// Todo sale por la puerta de salida: solo «@@ clave número».
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-traspaso.ts

import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { aaaammDelMes, cuadrar, lineasDeApuntes, sumarDiez, type Saldo } from '../../../supabase/functions/_shared/diezTraspaso.ts'

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
  // 1 · Lo que lee el traspaso: los apuntes del mes, con sus líneas.
  const apuntes = await c.apuntesDelMes(aaaammDelMes(MES)) as Apunte[]
  const filas = lineasDeApuntes(apuntes)
  sale('apuntes', apuntes.length)
  sale('apuntes_sin_lineas', apuntes.filter((a) => !(a.Detalles ?? []).length).length)
  sale('lineas', filas.length)
  sale('lineas_con_cuenta', apuntes.flatMap((a) => a.Detalles ?? []).filter((l) => !!l.Cuenta).length)

  // 2 · Lo que suman.
  const m = sumarDiez(filas)
  sale('subcuentas', m.size)
  const debe = [...m.values()].reduce((t, x) => t + x.debe, 0)
  const haber = [...m.values()].reduce((t, x) => t + x.haber, 0)
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
  const i = iguales.findIndex((x) => x.debe > 0)
  if (i >= 0) {
    const otro = iguales.map((x, k) => (k === i ? { ...x, debe: Math.round(x.debe * 100 - 1) / 100 } : x))
    const r2 = cuadrar(otro, filas)
    sale('cuadra_con_un_centimo_menos', r2.cuadra)
    sale('diferencias_con_un_centimo_menos', r2.diferencias.length)
    sale('diferencia_centimos', Math.round((r2.diferencias[0]?.falta_debe ?? 0) * 100))
  } else sale('sin_cuenta_con_debe', 1)

  // 4b · ¿Las facturas (ventas y recibidas) están entre los apuntes? Si no, el cuadre no las vería.
  const facturas = await c.facturasDelMes(aaaammDelMes(MES))
  const claves = new Set(apuntes.map((a) => `${a.Ejercicio}|${a.Serie}|${a.Documento}`))
  sale('facturas', facturas.length)
  sale('facturas_entre_los_apuntes', facturas.filter((f) => claves.has(`${f.Ejercicio}|${f.Serie}|${f.Documento}`)).length)
  for (const serie of [...new Set(apuntes.map((a) => String(a.Serie)))].sort()) {
    if (/^[0-9]{1,3}$/.test(serie)) sale(`apuntes_serie_${serie}`, apuntes.filter((a) => String(a.Serie) === serie).length)
  }

  // 5 · Por qué no getSumasYsaldos: lo que trae al lado de los apuntes.
  const sys = await c.todas<Record<string, unknown>>(`/api/subcuentas/getSumasYsaldos/${MES.slice(0, 4)}/${aaaammDelMes(MES)}01/${aaaammDelMes(MES)}31`)
  sale('sumas_y_saldos_lineas', sys.length)
  sale('sumas_y_saldos_subcuentas', sumarDiez(sys).size)
  sale('escrito_en_diez', 0)
} catch (e) {
  const st = (e as { status?: number }).status
  sale('parado', 1)
  if (typeof st === 'number') sale('http', st)
  process.exit(1)
}
