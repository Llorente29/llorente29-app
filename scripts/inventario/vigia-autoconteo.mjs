#!/usr/bin/env node
// scripts/inventario/vigia-autoconteo.mjs
//
// EL VIGÍA DEL AUTOCONTEO (encargo de Julio del 21/10, respuesta 4): que un
// fallo de la noche no vuelva a quedar mudo. Lo corre cada mañana
// .github/workflows/vigia-autoconteo.yml contra producción, con conta_lectura y
// en solo lectura, DESPUÉS del cron de las 03:10 UTC y del generador de las
// 04:00. Lee public.autoconteo_vigia() (la 0400), que no da nombres: códigos,
// días y cuántos.
//
// Rojo si:
//   · el último run del cron de las 03:10 no es «succeeded»;
//   · hay algún autoconteo sin aplicar: con un fallo apuntado, o abierto con
//     más de 24 h (el cron ya tendría que haberlo cogido).
// Verde, y lo dice, si la 0400 aún no está en producción.
//
//   node scripts/inventario/vigia-autoconteo.mjs <filas.csv> > salida.txt
// filas.csv: «clave,valor» por línea (psql --csv -t), o vacío si no hay 0400.
// Escribe solo «@@ clave número» (enNumeros) y sale con 1 si está en rojo.

import { readFileSync } from 'node:fs'

/** Las filas de autoconteo_vigia() a un objeto. Sin filas: la 0400 no está. */
export function leerFilas(csv) {
  const filas = {}
  for (const linea of csv.split('\n')) {
    if (!linea.trim()) continue
    const coma = linea.indexOf(',')
    if (coma < 0) continue
    let valor = linea.slice(coma + 1)
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1).replace(/""/g, '"')
    filas[linea.slice(0, coma)] = valor
  }
  return filas
}

/** «INV-1|2026-10-20|contando|3|con fallo;…» → una fila por autoconteo. */
export function leerSinAplicar(texto) {
  if (!texto) return []
  return texto.split(';').filter(Boolean).map((t) => {
    const [codigo, dia, estado, contadas, fallo] = t.split('|')
    return { codigo, dia, estado, contadas: Number(contadas), conFallo: fallo === 'con fallo' }
  })
}

export function evaluar(filas) {
  if (!('cron_estado' in filas)) {
    return { rojo: false, titulo: 'Aún no está la 0400 en producción: no hay nada que vigilar todavía.', lineas: [] }
  }
  const sin = leerSinAplicar(filas.sin_aplicar)
  const lineas = []
  const cronMal = !['succeeded', 'sin pg_cron'].includes(filas.cron_estado)
  lineas.push(`- **El cron de las 03:10 UTC:** ${filas.cron_estado === 'succeeded' ? 'en verde' : `**${filas.cron_estado}**`}` +
    ` (empezó ${filas.cron_inicio}, hora de Madrid).` +
    (cronMal && filas.cron_mensaje && filas.cron_mensaje !== '—' ? ` Dice: «${filas.cron_mensaje}».` : ''))
  if (sin.length === 0) {
    lineas.push('- **Autoconteos sin aplicar:** ninguno.')
  } else {
    lineas.push(`- **Autoconteos sin aplicar: ${sin.length}.** Se ven en Almacén → Inventario, con su error.`)
    lineas.push('', '| Conteo | Del día | Estado | Líneas contadas | Fallo apuntado |', '|---|---|---|---|---|')
    for (const s of sin) lineas.push(`| ${s.codigo} | ${s.dia} | ${s.estado} | ${s.contadas} | ${s.conFallo ? 'sí' : 'no (lleva más de 24 h abierto)'} |`)
  }
  const rojo = cronMal || sin.length > 0
  const titulo = rojo
    ? (sin.length > 0
        ? `${sin.length} autoconteo${sin.length === 1 ? '' : 's'} sin aplicar${cronMal ? ' y el cron de la noche en rojo' : ''}.`
        : 'El cron de la noche ha terminado en rojo.')
    : 'Todo aplicado: el cron de la noche en verde y ningún autoconteo esperando.'
  return { rojo, titulo, lineas }
}

/**
 * Lo que sale al registro y al resumen PÚBLICOS: solo «@@ clave número», que es
 * lo que deja pasar scripts/conta/salida-segura.mjs (D01 R2). Ni códigos, ni el
 * mensaje del cron (puede llevar el nombre de un producto): eso se mira en la
 * app, en Almacén → Inventario.
 */
export function enNumeros(filas) {
  const r = evaluar(filas)
  const hay0400 = 'cron_estado' in filas
  const sin = leerSinAplicar(filas.sin_aplicar)
  return [
    '@@ # vigia_autoconteo',
    `@@ hay_0400 ${hay0400 ? 1 : 0}`,
    `@@ cron.verde ${filas.cron_estado === 'succeeded' ? 1 : 0}`,
    `@@ cron.sin_correr ${filas.cron_estado === 'nunca ha corrido' ? 1 : 0}`,
    `@@ sin_aplicar ${sin.length}`,
    `@@ sin_aplicar.con_fallo ${sin.filter((s) => s.conFallo).length}`,
    `@@ sin_aplicar.mas_de_24h ${sin.filter((s) => !s.conFallo).length}`,
    `@@ rojo ${r.rojo ? 1 : 0}`,
  ].join('\n') + '\n'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fCsv] = process.argv.slice(2)
  const filas = leerFilas(readFileSync(fCsv, 'utf8'))
  process.stdout.write(enNumeros(filas))
  process.exit(evaluar(filas).rojo ? 1 : 0)
}
