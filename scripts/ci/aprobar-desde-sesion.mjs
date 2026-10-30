#!/usr/bin/env node
// scripts/ci/aprobar-desde-sesion.mjs <run_id>
//
// W12b (30/10) · La prueba de que una SESIÓN no puede aprobar un real. Las
// sesiones lanzan con la autorización de Julio (en GitHub salen como él), así
// que si GitHub las dejara aprobar el entorno «produccion», la aprobación no
// frenaría nada. Este guion, lanzado DESDE UNA SESIÓN contra un real que espera
// la aprobación, lo intenta y tiene que recibir un rechazo (403).
//
// Cómo se prueba sin riesgo: el real de prueba es de una tanda ya aplicada y sin
// ensayo lanzado desde main. Si la aprobación pasara, el run pararía en «hace
// falta un ensayo en verde de este mismo commit» antes de escribir nada.
//
//   node scripts/ci/aprobar-desde-sesion.mjs <run_id>
//   sale con 0 si GitHub lo rechaza (lo esperado) y con 1 si lo aprueba.

import { execFileSync } from 'node:child_process'

const REPO = process.env.GITHUB_REPOSITORY || 'Llorente29/llorente29-app'

/** Qué dice el intento, en tres partes. `codigo` es el HTTP que contestó GitHub. */
export function veredicto(codigo, run, cuerpo = '') {
  if (codigo >= 200 && codigo < 300) {
    return {
      ok: false,
      mensaje: `Una sesión HA PODIDO aprobar el real del run ${run} (HTTP ${codigo}): la aprobación de «produccion» no frena a las sesiones. `
        + 'Dónde: Settings → Environments → produccion. '
        + 'Qué hacer: rechaza ese run si sigue en marcha y avisa a Julio; hace falta que el revisor sea una cuenta que las sesiones no usen.',
    }
  }
  return {
    ok: true,
    mensaje: `Bien: GitHub no deja a una sesión aprobar el real del run ${run} (HTTP ${codigo}${cuerpo ? `: ${cuerpo.slice(0, 160)}` : ''}). El real sigue esperando a Julio.`,
  }
}

function api(metodo, ruta, cuerpo) {
  const args = ['api', '-i', '-X', metodo, ruta]
  if (cuerpo) args.push('--input', '-')
  try {
    const salida = execFileSync('gh', args, { encoding: 'utf8', input: cuerpo ? JSON.stringify(cuerpo) : undefined, stdio: ['pipe', 'pipe', 'pipe'] })
    return { codigo: Number(salida.match(/^HTTP\/\S+ (\d{3})/)?.[1] ?? 0), texto: salida }
  } catch (e) {
    const texto = `${e.stdout ?? ''}${e.stderr ?? ''}`
    return { codigo: Number(texto.match(/HTTP\/\S+ (\d{3})/)?.[1] ?? texto.match(/HTTP (\d{3})/)?.[1] ?? 0), texto }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = process.argv[2]
  if (!/^\d+$/.test(run ?? '')) { console.error('Uso: aprobar-desde-sesion.mjs <run_id> (un real que espera la aprobación).'); process.exit(2) }
  const pendientes = api('GET', `repos/${REPO}/actions/runs/${run}/pending_deployments`)
  const json = pendientes.texto.slice(pendientes.texto.indexOf('['))
  let lista = []
  try { lista = JSON.parse(json) } catch { /* sin lista: se intenta igual con el id que no hay */ }
  const ids = lista.map((p) => p.environment?.id).filter(Boolean)
  console.log(`Run ${run}: ${lista.length} entorno(s) esperando aprobación${lista.length ? ` (${lista.map((p) => p.environment?.name).join(', ')})` : ''}.`)
  if (!ids.length) { console.error('Ese run no está esperando ninguna aprobación: la prueba necesita un real en espera.'); process.exit(2) }
  const intento = api('POST', `repos/${REPO}/actions/runs/${run}/pending_deployments`, {
    environment_ids: ids, state: 'approved', comment: 'W12b: prueba de que una sesión NO puede aprobar un real (tiene que salir 403).',
  })
  const cuerpo = (intento.texto.split(/\r?\n\r?\n/).pop() ?? '').replace(/\s+/g, ' ').trim()
  const v = veredicto(intento.codigo, run, cuerpo)
  console.log(v.ok ? v.mensaje : `::error::${v.mensaje}`)
  process.exit(v.ok ? 0 : 1)
}
