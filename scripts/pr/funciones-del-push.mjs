// scripts/pr/funciones-del-push.mjs
//
// W06 (Julio, 22/10) · Las funciones que hay que desplegar por un push: las
// carpetas cambiadas y, si cambia algo de _shared, CADA función que lo usa
// (directa o indirectamente). Hasta hoy deploy-edge-functions se saltaba
// _shared y un cambio ahí no desplegaba a nadie: el #285 dejó conta-diez-enviar
// y conta-diez-cola con el código de antes hasta que se desplegaron a mano.
//
//   node scripts/pr/funciones-del-push.mjs <antes> <después>
//     → los nombres, separados por espacios (vacío si ninguna)

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { funcionesTocadas } from './funcionesADesplegar.mjs'
import { importaDeFunciones, RAIZ } from './importsDeFunciones.mjs'

/** Las del diff, que siguen existiendo en el árbol de ahora (una borrada no se despliega). */
export function funcionesDelPush(cambiados, importa = importaDeFunciones(), existe = (fn) => existsSync(`${RAIZ}/${fn}`)) {
  return funcionesTocadas(cambiados, importa).filter((fn) => existe(fn))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [antes, despues] = process.argv.slice(2)
  if (!antes || !despues) { console.error('uso: funciones-del-push.mjs <antes> <después>'); process.exit(2) }
  const cambiados = execFileSync('git', ['diff', '--name-only', antes, despues, '--', RAIZ], { encoding: 'utf8' }).split('\n').filter(Boolean)
  console.log(funcionesDelPush(cambiados).join(' '))
}
