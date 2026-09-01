// build/folvyVersionPlugin.ts
//
// LA VERSIÓN LA PONE EL BUILD, NO LA MEMORIA DE NADIE.
//
// Hasta el 01/09/2026 `public/sw.js` llevaba esto:
//     const SW_VERSION = 'folvy-2026-07-03-free-item-gift';
// con un comentario que decía «bump de versión para forzar byte-diff». Había
// que acordarse de subirlo a mano. El valor apuntaba al 3 de julio, el fichero
// llevaba 9 días sin tocarse y entre medias habían entrado 124 commits en main:
// 124 despliegues sirviendo un sw.js byte a byte idéntico, o sea el mecanismo
// de renovación apagado sin que nadie se enterara.
//
// Una versión que hay que acordarse de subir es una versión que se queda en
// julio (Julio, 01/09). Este plugin hace dos cosas y las dos en cada build:
//
//   1. Escribe `dist/version.json` con el id de esta build. Es lo que la app
//      consulta cada pocos minutos para saber si hay algo nuevo publicado.
//   2. Sella `dist/sw.js` sustituyendo el marcador por ese mismo id, para que
//      el fichero cambie de bytes en cada despliegue y el navegador lo instale.
//
// Y si el marcador NO está en public/sw.js, el build FALLA. Es a propósito: sin
// esa guarda, alguien podría quitarlo sin querer y volveríamos al silencio de
// julio — un fallo que solo se nota semanas después y en la tablet de otro.

import type { Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MARCADOR = '__FOLVY_BUILD_ID__'

/**
 * De dónde sale esta build. Vercel lo pone en el entorno del build:
 *   VERCEL_ENV            production | preview | development
 *   VERCEL_GIT_COMMIT_REF la rama
 * Fuera de Vercel (build local) no hay nada de eso y se marca como 'local',
 * que TAMPOCO es producción y también tiene que decirlo.
 */
export function calculaEntorno(env: NodeJS.ProcessEnv = process.env): {
  entorno: 'production' | 'preview' | 'local'
  rama: string | null
} {
  const v = env.VERCEL_ENV
  const rama = env.VERCEL_GIT_COMMIT_REF || null
  if (v === 'production') return { entorno: 'production', rama }
  if (v === 'preview') return { entorno: 'preview', rama }
  return { entorno: 'local', rama }
}

/** Id de esta build: sha corto de git + minuto. Legible y ordenable. */
export function calculaBuildId(ahora = new Date()): string {
  let sha = 'singit'
  try {
    sha = execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || 'singit'
  } catch {
    // En un tarball sin .git no hay sha. El sello de tiempo basta para que
    // cambien los bytes, que es lo que de verdad hace falta.
  }
  const t = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, '')
  return `${t}-${sha}`
}

export function folvyVersion(): Plugin {
  const buildId = calculaBuildId()
  const { entorno, rama } = calculaEntorno()
  return {
    name: 'folvy-version',
    apply: 'build',

    config() {
      // Constante de compilación: lo que ESTA build sabe de sí misma. La app la
      // compara con lo publicado en version.json.
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
          // 01/09: Julio estuvo operando el negocio desde una PREVIEW de rama
          // (feat-hubrise-fase3-ui, SW del 16/08) contra la base de datos
          // REAL, y no había forma de notarlo: una preview y producción se ven
          // exactamente igual. Dos semanas de arreglos que él no veía.
          // Ahora cada build lleva escrito de dónde sale.
          __ENTORNO__: JSON.stringify(entorno),
          __RAMA__: JSON.stringify(rama),
        },
      }
    },

    writeBundle(options) {
      const dir = options.dir ?? 'dist'

      writeFileSync(
        join(dir, 'version.json'),
        JSON.stringify({ buildId, builtAt: new Date().toISOString(), entorno, rama }, null, 2) + '\n',
        'utf8',
      )

      const sw = join(dir, 'sw.js')
      if (!existsSync(sw)) {
        this.error('folvy-version: no hay dist/sw.js que sellar. ¿Se ha movido public/sw.js?')
        return
      }
      const antes = readFileSync(sw, 'utf8')
      if (!antes.includes(MARCADOR)) {
        this.error(
          `folvy-version: public/sw.js no contiene ${MARCADOR}. Sin ese marcador el service worker ` +
          'vuelve a llevar una versión escrita a mano, y eso es exactamente lo que dejó el SW ' +
          'congelado en julio. Devuélvelo antes de seguir.',
        )
        return
      }
      writeFileSync(sw, antes.split(MARCADOR).join(buildId), 'utf8')
    },
  }
}
