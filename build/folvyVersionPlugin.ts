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
 *
 * PERO VERCEL NO ES EL ÚNICO QUE CONSTRUYE (01/09, la tarde del mismo día).
 * El bundle OTA de las tablets lo construye GitHub Actions (build-apk.yml), y
 * allí no hay VERCEL_ENV: la build caía en 'local' y las tablets pintaron
 * «BUILD LOCAL — NO ES PRODUCCIÓN» siendo producción pura. Pase (Alcalá) y
 * camichi4 (Carabanchel) cogieron el bundle 203 el 01/09 a las 12:16 y 09:16
 * de Madrid y las dos lo pintaron.
 *
 * La franja no falló: hizo lo que se le pidió — si no consta que sea
 * producción, etiqueta. Lo que faltaba es que el bundle SUPIERA de dónde sale.
 * Por eso el arreglo no es quitar la franja ni ablandar el fallback, sino que
 * quien construye lo DECLARE: FOLVY_ENTORNO (+ FOLVY_RAMA), igual que el
 * buildId va sellado dentro del bundle. Un bundle de producción dice
 * producción; uno que no lo sabe, sigue etiquetando.
 *
 * ORDEN DE PRECEDENCIA, y el porqué:
 *   1. VERCEL_ENV manda SIEMPRE dentro de Vercel, incluso cuando dice algo que
 *      no es production ni preview. Si Vercel dice que esto no es producción,
 *      no hay variable que lo reetiquete: así una preview NUNCA puede pasar
 *      por producción por una env var suelta, que es el incidente original.
 *   2. Fuera de Vercel, FOLVY_ENTORNO es la declaración de quien construye.
 *   3. Sin nada, 'local'. Sigue fallando hacia AVISAR.
 */
export function calculaEntorno(env: NodeJS.ProcessEnv = process.env): {
  entorno: 'production' | 'preview' | 'local'
  rama: string | null
} {
  const rama = env.VERCEL_GIT_COMMIT_REF || env.FOLVY_RAMA || null

  const v = env.VERCEL_ENV
  if (v === 'production') return { entorno: 'production', rama }
  if (v === 'preview') return { entorno: 'preview', rama }
  // Dentro de Vercel y NO es production/preview: Vercel tiene la última
  // palabra sobre sus propias builds. No se consulta la declaración.
  if (v) return { entorno: 'local', rama }

  const declarado = env.FOLVY_ENTORNO
  if (declarado === 'production') return { entorno: 'production', rama }
  if (declarado === 'preview') return { entorno: 'preview', rama }
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
