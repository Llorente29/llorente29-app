// src/modules/conta/textos/useTexto.ts
//
// S01 (paso 4) · El texto de una clave en el nivel de quien mira (useNivel, del marco).

import { useNivel } from '@/modules/conta/marco/nuevo/contexto'
import { texto, type ClaveTexto } from './textos'

/** El texto del nivel de quien mira, para donde no hace falta guardar el sitio (un título, una ayuda). */
export function useTexto(): (clave: ClaveTexto, datos?: Readonly<Record<string, string | number>>) => string {
  const nivel = useNivel()
  return (clave, datos) => texto(clave, nivel, datos)
}
