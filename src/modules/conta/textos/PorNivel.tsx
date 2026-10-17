// src/modules/conta/textos/PorNivel.tsx
//
// S01 (paso 4) · Un texto que cambia con el nivel sin mover nada: pinta los
// tres, uno encima de otro, y solo se ve el del nivel de quien mira. Ocupa lo
// del más largo, así que un botón o una etiqueta no cambian de tamaño al cambiar
// de nivel (maqueta 5: «nunca dónde está cada cosa»). El lector solo oye el
// que se ve.

import { NIVELES } from '@/modules/conta/esqueleto/preferencias'
import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { texto, type ClaveTexto } from './textos'

export function PorNivel({ clave, datos }: { clave: ClaveTexto; datos?: Readonly<Record<string, string | number>> }) {
  const nivel = useNivel()
  return (
    <span className="s-por-nivel">
      {NIVELES.map((n) => <span key={n} aria-hidden={n !== nivel} data-actual={n === nivel || undefined}>{texto(clave, n, datos)}</span>)}
    </span>
  )
}
