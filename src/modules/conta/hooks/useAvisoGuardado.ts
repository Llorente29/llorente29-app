// src/modules/conta/hooks/useAvisoGuardado.ts

import { useEffect, useRef, useState } from 'react'

/**
 * «Guardado» discreto: aparece al guardar y se va solo. Lleva contenido
 * (regla 8 de CLAUDE.md): dice QUÉ se ha guardado, no solo un visto.
 */
export function useAvisoGuardado(): [string | null, (texto: string) => void] {
  const [texto, setTexto] = useState<string | null>(null)
  const t = useRef<number | null>(null)
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current) }, [])
  return [texto, (nuevo: string) => {
    setTexto(nuevo)
    if (t.current) window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setTexto(null), 4000)
  }]
}

