// scripts/e2e/reporter-pantalla.mjs — reporter de Playwright: de cada prueba
// que falla, lo que había en pantalla, al registro del job y al resumen del run.
//
// Q03 (18/11). Lo añade por-fichero.sh a los de siempre (list, github, blob),
// así que corre en todas las e2e: la de un push, la lanzada a mano y la de la
// noche. Las funciones están en scripts/e2e/pantalla.mjs.
//
// Escribe al acabar cada fichero, después del resumen de Playwright:
//   · PANTALLA_REGISTRO (si no, la salida): el bloque de cada prueba que falló;
//     por-fichero.sh lo saca fuera del grupo plegado del fichero;
//   · PANTALLA_RESUMEN: lo mismo, plegado, para el resumen del run;
//   · PANTALLA_ESTADO: cuántas llevan copiadas en el run (el tope es por run,
//     y cada fichero es un Playwright distinto).

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { TOPES, bloque, erroresDeLaSalida, leerContexto, leerEstado, leerTraza, resumenMd } from './pantalla.mjs'

export default class ReporterPantalla {
  constructor() { this.fallos = [] }

  onTestEnd(test, result) {
    if (!['failed', 'timedOut', 'interrupted'].includes(result.status)) return
    const adj = (n) => result.attachments.find((a) => a.name === n && a.path)?.path
    let ctx = { error: null, pantalla: null }
    try { const p = adj('error-context'); if (p) ctx = leerContexto(readFileSync(p, 'utf8')) } catch { /* sin contexto */ }
    const traza = leerTraza(adj('trace'))
    const salida = erroresDeLaSalida(result.stdout)
    const errorDeLaPrueba = result.errors?.map((e) => e.message ?? '').filter(Boolean).join('\n') || ''
    this.fallos.push({
      donde: `${relative(process.cwd(), test.location.file).replace(/^tests\/e2e\//, '')}:${test.location.line}`,
      titulo: test.titlePath().slice(3).join(' › ') || test.title,
      tamano: test.parent.project()?.name ?? '',
      error: (ctx.error || errorDeLaPrueba).replace(/\u001b\[[0-9;]*m/g, ''),
      pantalla: ctx.pantalla,
      respuestas: traza.respuestas,
      // X09 · La pestaña activa y lo que estaba cargando, del DOM de la traza.
      activa: traza.activa ?? null,
      ocupados: traza.ocupados ?? [],
      errores: [...traza.errores, ...salida.filter((x) => !x.startsWith('[consola]') || !traza.errores.length)],
    })
  }

  onEnd() {
    if (!this.fallos.length) return
    const rutaEstado = process.env.PANTALLA_ESTADO
    const estado = rutaEstado ? leerEstado(rutaEstado) : { copiadas: 0, cortadas: 0 }
    const tope = Number(process.env.PANTALLA_TOPE_RUN) || TOPES.pruebasPorRun
    const registro = []
    const resumen = []
    let cortadasAqui = 0
    for (const f of this.fallos) {
      const copiar = estado.copiadas < tope
      if (copiar) estado.copiadas++
      else { estado.cortadas++; cortadasAqui++ }
      registro.push(...bloque(f, { copiar, tope }))
      resumen.push(...resumenMd(f, { copiar }))
    }
    if (cortadasAqui) registro.push(`… y ${cortadasAqui} ${cortadasAqui === 1 ? 'prueba más' : 'pruebas más'} sin su pantalla en este fichero (tope de ${tope} por run); están en el artefacto «playwright-report».`, '')
    const texto = `${registro.join('\n')}\n`
    if (process.env.PANTALLA_REGISTRO) appendFileSync(process.env.PANTALLA_REGISTRO, texto)
    else process.stdout.write(`\n${texto}`)
    if (process.env.PANTALLA_RESUMEN) appendFileSync(process.env.PANTALLA_RESUMEN, `${resumen.join('\n')}\n`)
    if (rutaEstado) writeFileSync(rutaEstado, JSON.stringify(estado))
  }

  printsToStdio() { return !process.env.PANTALLA_REGISTRO }
}
