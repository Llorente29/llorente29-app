// build/indexDeMarca.ts
//
// EL HTML QUE LEE UN ENLACE COMPARTIDO (C06, respuesta 2 de Julio, 13/10).
//
// WhatsApp, el correo y los buscadores leen el HTML de la página SIN ejecutar
// nada. index.html dice «Folvy» en el título, la descripción, el icono y el
// nombre de la aplicación, y aplicarMarcaAlDocumento (src/marca/marca.ts) lo
// cambia cuando ya corre la app: el usuario no lo ve, pero la vista previa de
// un enlace sí. Con la marca, nunca debe verse «Folvy».
//
// Solución: el build escribe, para cada marca que no es Folvy, su propio
// dist/marcas/<id>/index.html (el mismo de siempre, con las mismas piezas de
// la app, pero con las metas de la marca), y Vercel lo sirve:
//   · por el dominio de la marca (rewrite por host, vercel.json);
//   · fuera de producción, con ?marca=<id> (rewrite por query, nunca en
//     *.folvy.app ni en folvy-app.vercel.app).
// El index de Folvy no se toca: app.folvy.app y las tiendas sirven el de antes.
//
// Si index.html deja de tener una de las metas que se cambian, el build FALLA
// (como folvyVersion con su marcador): una meta que no se cambia es una vista
// previa que vuelve a decir «Folvy» sin que nadie lo note.

import type { Plugin } from 'vite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARCAS, urlBaseDeMarca, type Marca } from '../supabase/functions/_shared/marcas'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Cambia una pieza que TIENE que estar; si no está, error con su nombre. */
function cambiar(html: string, patron: RegExp, por: string, que: string): string {
  if (!patron.test(html)) throw new Error(`indexDeMarca: index.html ya no tiene ${que}; la vista previa de la marca volvería a decir «Folvy».`)
  return html.replace(patron, por)
}

/**
 * El index.html de una marca a partir del de Folvy. `origen` es la URL base
 * absoluta de la marca (https://su-dominio) o null si aún no tiene dominio: la
 * imagen de vista previa va absoluta cuando se puede, porque WhatsApp no
 * resuelve rutas relativas.
 */
export function indexDeMarca(html: string, m: Marca, origen: string | null): string {
  let h = html
  h = cambiar(h, /<title>[^<]*<\/title>/, `<title>${esc(m.nombre)}</title>`, 'el <title>')
  h = cambiar(h, /<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${esc(m.favicon)}" />`, 'el icono')
  h = cambiar(h, /<link rel="manifest"[^>]*>/, `<link rel="manifest" href="${esc(m.manifiesto)}" />`, 'el manifiesto')
  h = cambiar(h, /<meta name="description"[^>]*>/, `<meta name="description" content="${esc(m.descripcion)}" />`, 'la descripción')
  h = cambiar(h, /<meta name="apple-mobile-web-app-title"[^>]*>/, `<meta name="apple-mobile-web-app-title" content="${esc(m.nombre)}" />`, 'el nombre en iOS')
  h = cambiar(h, /<meta name="application-name"[^>]*>/, `<meta name="application-name" content="${esc(m.nombre)}" />`, 'el nombre de la aplicación')
  h = cambiar(h, /<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${esc(m.favicon)}" />`, 'el icono de iOS')
  const imagen = m.imagenVistaPrevia ? (origen ? origen.replace(/\/$/, '') + m.imagenVistaPrevia : m.imagenVistaPrevia) : null
  const og = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(m.nombre)}" />`,
    `<meta property="og:title" content="${esc(m.nombre)}" />`,
    `<meta property="og:description" content="${esc(m.descripcion)}" />`,
    ...(imagen ? [`<meta property="og:image" content="${esc(imagen)}" />`, `<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`] : []),
    `<meta name="twitter:card" content="${imagen ? 'summary_large_image' : 'summary'}" />`,
  ].map((l) => `    ${l}`).join('\n')
  h = cambiar(h, /(\s*)<\/head>/, `\n${og}$1</head>`, 'el </head>')
  return h
}

/** Plugin del build: tras escribir dist/, un index por marca que no es Folvy. */
export function indexDeMarcas(): Plugin {
  let salida = 'dist'
  return {
    name: 'index-de-marcas',
    apply: 'build',
    configResolved(c) { salida = c.build.outDir },
    writeBundle() {
      const base = readFileSync(join(salida, 'index.html'), 'utf8')
      for (const m of Object.values(MARCAS)) {
        if (m.id === 'folvy') continue
        const dir = join(salida, 'marcas', m.id)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'index.html'), indexDeMarca(base, m, urlBaseDeMarca(m)))
      }
    },
  }
}
