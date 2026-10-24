// src/marca/tema.ts
//
// Los colores y la letra de una marca con identidad propia (C06b, Sumied) en
// las pantallas de ENTRADA (--mx-*, en `.mx-entrar`): entrar, contraseña y
// bienvenida, que viven fuera del módulo de contabilidad.
//
// S02 · Patrón único (Julio, 22/10): dentro del módulo ya no se pinta nada por
// marca. Los valores de serie de src/modules/conta/diseno/tokens.css son los
// del patrón, y los de antes (--cx-*, --cxm-*) son alias suyos. Si una marca
// tuviera que repintar el módulo, lo diría diseno/temas.ts (hoy, ninguna).
// Sin tema (Folvy y la marca de pruebas), no se escribe nada.

import type { Marca } from '../../supabase/functions/_shared/marcas.ts'
import { variablesDeMarca } from '../modules/conta/diseno/temas.ts'

/** El CSS del tema de una marca, o null si no tiene. */
export function cssDelTema(m: Marca): string | null {
  const t = m.tema
  if (!t) return null
  const raiz = (sel: string) => `html[data-marca="${m.id}"] ${sel}`
  const encima = variablesDeMarca(m)
  const modulo = encima
    ? `${[raiz('.cx'), raiz('.cx-colores'), raiz('.cxm')].join(', ')} {\n${Object.entries(encima).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`
    : ''
  return `${modulo}${raiz('.mx-entrar')} {
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
