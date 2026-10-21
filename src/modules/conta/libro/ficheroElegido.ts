// src/modules/conta/libro/ficheroElegido.ts
//
// S01d · Un fichero elegido en el navegador, con su dirección local
// (URL.createObjectURL) para verlo antes de subirlo. La dirección se crea al
// elegir (no en un efecto) y se suelta al cambiar de fichero o al salir.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface FicheroElegido { fichero: File; url: string }

export function useFicheroElegido(): [FicheroElegido | null, (f: File | null) => void] {
  const [elegido, setElegido] = useState<FicheroElegido | null>(null)
  const actual = useRef<string | null>(null)
  useEffect(() => () => { if (actual.current) URL.revokeObjectURL(actual.current) }, [])
  const elegir = useCallback((f: File | null) => {
    if (actual.current) URL.revokeObjectURL(actual.current)
    const url = f ? URL.createObjectURL(f) : null
    actual.current = url
    setElegido(f && url ? { fichero: f, url } : null)
  }, [])
  return [elegido, elegir]
}
