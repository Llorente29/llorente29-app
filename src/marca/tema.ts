// src/marca/tema.ts
//
// Los colores y la letra de una marca con identidad propia (C06b, Sumied),
// puestos encima del estilo nuevo: los tokens del módulo (--cx-*, en `.cx`),
// los de la entrada (--mx-*, en `.mx-entrar`) y, desde el S01, los del
// sistema de diseño (--s-*, en `.cx`, `.cx-colores` y `.cxm`), de los que el
// marco (--cxm-*) es alias. Misma estructura, densidad y teclado; en la marca,
// su letra, sus colores y su barra (decisión de Julio, F01 respuesta 3; las
// maquetas del S01). Se escriben con más peso (html[data-marca="<id>"] …) para
// ganar a los de siempre sin tocar sus ficheros; lo que el tema no nombra se
// queda como estaba. Sin tema (Folvy y la marca de pruebas), no se escribe nada.

import type { Marca } from '../../supabase/functions/_shared/marcas.ts'
import { variablesDeMarca } from '../modules/conta/diseno/temas.ts'

/** El CSS del tema de una marca, o null si no tiene. */
export function cssDelTema(m: Marca): string | null {
  const t = m.tema
  if (!t) return null
  const raiz = (sel: string) => `html[data-marca="${m.id}"] ${sel}`
  const s = Object.entries(variablesDeMarca(m) ?? {}).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `${[raiz('.cx'), raiz('.cx-colores')].join(', ')} {
  --cx-texto: ${t.tinta};
  --cx-apoyo: ${t.apoyo};
  --cx-azul: ${t.accion};
  --cx-azul-suave: ${t.accionSuave};
  --cx-azul-borde: ${t.accionBorde};
  --cx-ia: ${t.acento};
  --cx-letra: ${t.letra};
}
${[raiz('.cx'), raiz('.cx-colores'), raiz('.cxm')].join(', ')} {
${s}
}
${raiz('.mx-entrar')} {
  --mx-tinta: ${t.tinta};
  --mx-apoyo: ${t.apoyo};
  --mx-azul: ${t.accion};
  font-family: ${t.letra};
}
`
}

/** Pone el tema en el documento (una vez, al cargar). */
export function aplicarTema(m: Marca, doc: Document = document): void {
  const css = cssDelTema(m)
  if (!css) return
  doc.documentElement.setAttribute('data-marca', m.id)
  const estilo = doc.createElement('style')
  estilo.id = 'tema-marca'
  estilo.textContent = css
  doc.head.appendChild(estilo)
}
