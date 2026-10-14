// scripts/conta/diez/importar-preparar.ts
//
// C04b · T3 · La tanda del histórico de Diez, paso 1 de 2: LEER y PREPARAR.
// Lee de Diez (solo GET), convierte con convertirAsiento y deja en CARGA:
//   · asientos.csv   — orden, ejercicio, documento esperado y el asiento (JSON)
//                      en el orden de la cadena (fecha, serie, número);
//   · subcuentas.csv — las que usan los asientos, con el nombre de Diez;
//   · testigo.csv    — ejercicio, hasta, subcuentas y huella del testigo;
//   · rechazos.csv   — los que no se pueden convertir y mueven saldo (ROJO);
//   · sin-importe.csv — los que en Diez tienen todo a cero (fuera, sin bloquear).
// Y escribe en claro, para el informe, SOLO recuentos y claves (los motivos,
// sin importes). El paso 2 (importar.sql) lo escribe en la base dentro de UNA
// transacción.
//
// Dos fuentes:
//   · DIEZ_FUENTE=real     — la base DIEZ_BD con el secreto DIEZ_LECTURA; el
//                            testigo, el de esa base (testigoDeBase: la C0008,
//                            testigo-huellas.json, los Excel de Julio; otra base,
//                            testigo-huellas-<BASE>.json si existe, y si no,
//                            sin testigo: la tanda no puede salir en verde).
//   · DIEZ_FUENTE=simulado — el Diez de mentira con datos INVENTADOS
//                            (importar-simulado.mjs); el testigo se calcula de
//                            esos mismos datos. Es para ensayar la tanda en
//                            staging: los datos reales nunca van a staging.
//
//   CARGA=/tmp/carga DIEZ_FUENTE=real DIEZ_BD=C0008 DIEZ_DESDE=… DIEZ_HASTA=… DIEZ_CORTE=… DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/importar-preparar.ts
//
// C06 (traer de Diez para otra empresa): nada de una empresa escrito aquí. La
// base (DIEZ_BD) la lee el workflow de conta_diez_base —la base que Folvy
// registró para la empresa— y se le pasa al cliente como baseRegistrada; las
// fechas son obligatorias (sin las de Foodint por defecto).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken, type Apunte } from '../../../supabase/functions/_shared/diezCliente.ts'
import { documentoEsperado, paraLaBase, prepararHistorico } from '../../../supabase/functions/_shared/diezImportar.ts'
import { cent } from '../../../supabase/functions/_shared/diezMapeo.ts'
import { huellaTestigo } from '../../../supabase/functions/_shared/diezTestigo.ts'
// @ts-expect-error módulo .mjs sin tipos
import { arrancarDiezFalso } from './falso.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { datosSimulados } from './importar-simulado.mjs'

const FUENTE = process.env.DIEZ_FUENTE
const CARGA = process.env.CARGA || '/tmp/carga'
const DESDE = process.env.DIEZ_DESDE ?? ''
const HASTA = process.env.DIEZ_HASTA ?? ''
const CORTE = process.env.DIEZ_CORTE ?? ''
const BD = (process.env.DIEZ_BD ?? '').trim().toUpperCase()
if (FUENTE !== 'real' && FUENTE !== 'simulado') { console.log('DIEZ_FUENTE tiene que ser «real» o «simulado».'); process.exit(1) }
if (!/^\d{6}$/.test(DESDE) || !/^\d{6}$/.test(HASTA) || !/^\d{4}-\d{2}-\d{2}$/.test(CORTE) || DESDE > HASTA) {
  console.log('Faltan las fechas: DIEZ_DESDE y DIEZ_HASTA (AAAAMM) y DIEZ_CORTE (AAAA-MM-DD). No se lee nada.'); process.exit(1)
}
if (FUENTE === 'real' && !/^C\d{4}$/.test(BD)) { console.log('Falta DIEZ_BD (la base registrada para la empresa, C y cuatro cifras). No se lee nada.'); process.exit(1) }

/** El testigo de una base: el fichero de huellas de SUS Excel, o ninguno. */
function testigoDeBase(bd: string): string | null {
  const f = bd === 'C0008' ? 'testigo-huellas.json' : `testigo-huellas-${bd}.json`
  const u = new URL(`./${f}`, import.meta.url)
  return existsSync(u) ? readFileSync(u, 'utf8') : null
}

const csv = (xs: unknown[]) => xs.map((x) => (x == null ? '' : `"${String(x).replace(/"/g, '""')}"`)).join(',')
const sinImportes = (s: string) => s.replace(/-?\d[\d.]*[.,]\d{2}\b/g, '[importe]')
const memoria = (): AlmacenToken => {
  let g: { token: string; expiresAt: string } | null = null
  return { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } }
}

let cerrar = async () => {}
let cliente: ClienteDiez
let testigo: { ejercicio: string; hasta: string; cuentas: number; huella: string }[]

if (FUENTE === 'real') {
  const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
  if (!cred || typeof cred !== 'object') { console.log('Falta el secreto DIEZ_LECTURA. No se lee nada.'); process.exit(1) }
  cliente = new ClienteDiez({
    base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD, baseRegistrada: BD, almacen: memoria(), pausaMs: 120,
    credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  })
  const t = testigoDeBase(BD)
  const h = t ? JSON.parse(t) : {}
  testigo = Object.entries(h).filter(([k]) => /^\d{4}$/.test(k)).map(([ejercicio, v]) => ({ ejercicio, ...(v as { hasta: string; cuentas: number; huella: string }) }))
} else {
  const d = datosSimulados()
  const falso = await arrancarDiezFalso({ bases: { C0009: { apuntes: d.apuntes, subcuentas: d.subcuentas } } })
  cerrar = () => falso.cerrar()
  cliente = new ClienteDiez({ base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, almacen: memoria(), pausaMs: 0 })
  // El testigo de mentira: lo de Diez en bruto, sin regularización (4) ni cierre (5), como los Excel.
  testigo = []
  for (const [ejercicio, hasta] of d.ejercicios as [string, string][]) {
    const crudo = new Map<string, { debe: number; haber: number }>()
    for (const a of d.apuntes as Apunte[]) {
      if (String(a.Ejercicio) !== ejercicio || a.TipoAsiento === 4 || a.TipoAsiento === 5 || String(a.Fecha) > hasta.replace(/-/g, '')) continue
      for (const l of a.Detalles ?? []) {
        const x = crudo.get(String(l.Cuenta)) ?? { debe: 0, haber: 0 }
        x.debe += cent(l.Debe); x.haber += cent(l.Haber); crudo.set(String(l.Cuenta), x)
      }
    }
    testigo.push({ ejercicio, hasta, cuentas: [...crudo.values()].filter((c) => c.debe || c.haber).length, huella: await huellaTestigo(crudo) })
  }
}

const p = await prepararHistorico({ lector: cliente, desde: DESDE, hasta: HASTA, corte: CORTE })
await cerrar()
const nombres = new Map(p.subcuentas.map((s) => [s.code, s.nombre]))

mkdirSync(CARGA, { recursive: true })
writeFileSync(`${CARGA}/asientos.csv`, p.asientos.map((a, i) => csv([i + 1, a.ejercicio, documentoEsperado(a, nombres) ?? '', JSON.stringify(paraLaBase(a))])).join('\n') + '\n')
writeFileSync(`${CARGA}/subcuentas.csv`, p.subcuentas.map((s) => csv([JSON.stringify(s)])).join('\n') + '\n')
writeFileSync(`${CARGA}/testigo.csv`, testigo.map((t) => csv([t.ejercicio, t.hasta, t.cuentas, t.huella])).join('\n') + '\n')
// Lo que no entra: los rechazos (mueven saldo: ponen la tanda en ROJO) y lo que
// en Diez no tiene importe (fuera, con su motivo, sin bloquear). Sin importes.
writeFileSync(`${CARGA}/rechazos.csv`, p.rechazadosAlConvertir.map((r) => csv([r.clave.split('/')[0], r.clave, sinImportes(r.motivo)])).join('\n') + (p.rechazadosAlConvertir.length ? '\n' : ''))
writeFileSync(`${CARGA}/sin-importe.csv`, p.sinImporte.map((r) => csv([r.clave.split('/')[0], r.clave])).join('\n') + (p.sinImporte.length ? '\n' : ''))

const motivos = new Map<string, string[]>()
for (const r of p.rechazadosAlConvertir) { const m = sinImportes(r.motivo); motivos.set(m, [...(motivos.get(m) ?? []), r.clave]) }
console.log([
  `## Diez · tanda del histórico · lectura (${FUENTE})`, '',
  `${FUENTE === 'real' ? `Base ${BD} · ` : ''}Meses ${DESDE}–${HASTA} · corte ${CORTE} · solo GET`, '',
  `- Meses leídos: ${p.meses}`,
  `- Asientos leídos: ${p.leidos}`,
  `- Preparados para escribir: ${p.asientos.length}`,
  `- Posteriores al corte (entran por el día a día): ${p.fueraDelCorte.length}${p.fueraDelCorte.length ? ` — ${p.fueraDelCorte.join(', ')}` : ''}`,
  `- Fuera, sin importe en Diez (todas las líneas a cero; no es un rechazo): ${p.sinImporte.length}${p.sinImporte.length ? ` — ${p.sinImporte.map((r) => r.clave).join(', ')}` : ''}`,
  `- Rechazados al convertir (mueven saldo y no entran: la tanda sale en ROJO): ${p.rechazadosAlConvertir.length}`,
  ...[...motivos.entries()].map(([m, ks]) => `  - ${ks.length} × ${m}: ${ks.join(', ')}`),
  `- Subcuentas que usan: ${p.subcuentas.length}`,
  `- Testigo: ${testigo.length ? testigo.map((t) => `${t.ejercicio} (${t.cuentas} subcuentas, hasta ${t.hasta})`).join(' · ') : '**ninguno**: no hay con qué medir lo traído; la tanda no puede salir en verde'}`,
  '',
].join('\n'))
