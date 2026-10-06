// tests/conta/fixtures/importar/diez/traer-por-api.ts
//
// C03 · Respuesta 3 · GENERA tests/e2e/conta/c03/diez-traido.json: la revisión
// y el plan que mandaría el asistente «Traer tu plan» con la fixture INVENTADA
// de Diez, con el MISMO núcleo que la pantalla (importarPlan.ts +
// propuestaImportacion.ts), como prueba-staging.ts. La e2e de la revisión de
// las 430 lo manda por la API (company_chart_import_save + _apply) para tener
// el plan traído sin recorrer el asistente entero, que ya prueba la e2e del C02c.
//
// Sin fichas de Folvy con las que casar: la empresa de prueba es nueva y cada
// proveedor del listado entra como ficha nueva, por completar.
//
//   npx tsx tests/conta/fixtures/importar/diez/traer-por-api.ts

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adivinarColumnas, juntar, leerTabla, partirCsv, resumir, type Lectura } from '../../../../../src/modules/conta/lib/importarPlan'
import { decidir, planTraer, proponer, validar } from '../../../../../src/modules/conta/lib/propuestaImportacion'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const dir = join(raiz, 'tests/conta/fixtures/importar/diez')
const serie = JSON.parse(readFileSync(join(raiz, 'supabase/conta/pgc/serie.json'), 'utf8')) as { cuentas: { plan: string; code: string; is_leaf: boolean; valid_to: string | null }[] }
const hojas = new Set(serie.cuentas.filter((c) => c.plan === 'pymes' && c.is_leaf && !c.valid_to).map((c) => c.code))
const ramas = new Set(serie.cuentas.filter((c) => c.plan === 'pymes' && !c.is_leaf && !c.valid_to).map((c) => c.code))

function leer(f: string, conDireccion: boolean): Lectura {
  const filas = partirCsv(readFileSync(join(dir, f), 'utf8'))
  const { columnas, cabecera } = adivinarColumnas(filas)
  if (!columnas) throw new Error(f)
  const l = leerTabla('diez', filas, columnas, cabecera)
  if (!conDireccion) return l
  const cab = filas[0]
  const fila = new Map(filas.slice(1).map((r) => [r[0], r]))
  const v = (code: string, k: string) => fila.get(code)?.[cab.indexOf(k)] ?? null
  return { ...l, terceros: l.terceros.map((t) => ({ ...t, direccion: v(t.code, 'direccion'), cp: v(t.code, 'cp'), poblacion: v(t.code, 'poblacion'), provincia: v(t.code, 'provincia') })) }
}

const ficheros = ['plan.csv', 'proveedores.csv', 'clientes.csv']
const lectura = juntar('diez', [leer('plan.csv', false), leer('proveedores.csv', true), leer('clientes.csv', true)])
const r = resumir(lectura, { plan: 'pymes', digitos: 8 }, hojas, ramas)
if (!r.ok) throw new Error(r.motivo ?? 'no')
let filas = proponer({ cuentas: r.cuentas, terceros: lectura.terceros, proveedores: [], bancos: [], programa: 'Cegid Diez' })
// «Decide tú», como en la fixture del C02c: las 4751 a ninguno salvo la 47510015 (111); los clientes, «solo es cliente»; el resto, cuenta suya.
for (const f of filas.filter((x) => x.decision.tipo === 'pendiente')) {
  const id = f.code === '47510015' ? '111' : f.code.startsWith('4751') ? 'ninguno' : f.code.startsWith('430') ? 'cliente_c03' : 'sin_ficha'
  filas = decidir(filas, f.code, (f.opciones.find((o) => o.id === id) ?? f.opciones[0]).decision)
}
const problemas = validar(filas)
if (problemas.length) throw new Error(problemas.map((p) => p.texto).join('\n'))
const plan = planTraer(filas, r.cuentas, lectura.terceros)
// Lo que guarda el asistente (TraerPlan.tsx): las mismas claves que la importación de producción.
const review = { version: 1, programa: 'diez', ficheros, huella: 'c0330000'.padEnd(64, '0'), lectura, filas }

const salida = join(raiz, 'tests/e2e/conta/c03/diez-traido.json')
writeFileSync(salida, `${JSON.stringify({ ficheros, review, plan })}\n`)
const pago = plan.enlaces.filter((e) => String(e.code).startsWith('430'))
console.log(`${salida}: ${plan.cuentas.length} cuentas, ${plan.crear.length} fichas nuevas; 430 de pago: ${pago.map((e) => e.code).join(', ') || 'ninguna'}`)
