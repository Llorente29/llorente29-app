// src/modules/conta/bancos/useLeerConservando.ts
//
// Como `useLeer` (libros/contexto.ts), pero mientras vuelve a leer CONSERVA lo
// leído antes en vez de volver a null. Lo usa la página de Bancos para lo de
// arriba: si al confirmar un movimiento la página volviera al esqueleto, se
// desmontaría la pestaña y con ella el «Casado: …» que lo confirma (regla 8;
// lo cazó la e2e del 13/10: el casado se hacía y el aviso no llegaba a verse).

import { useEffect, useState } from 'react'

/** `ambito`: de quién son los datos (cuenta y empresa). Lo leído para otro ámbito no se conserva nunca. */
export function useLeerConservando<T>(leer: (() => Promise<T>) | null, ambito: string, clave: string): { datos: T | null; error: string | null; leyendo: boolean; recargar: () => void } {
  const [r, setR] = useState<{ ambito: string; clave: string; datos: T | null; error: string | null }>({ ambito: '', clave: '', datos: null, error: null })
  const [vuelta, setVuelta] = useState(0)
  const k = `${ambito}|${clave}:${vuelta}`
  useEffect(() => {
    if (!leer) return
    let vivo = true
    leer().then((datos) => { if (vivo) setR({ ambito, clave: k, datos, error: null }) },
      (e: unknown) => { if (vivo) setR((x) => ({ ambito, clave: k, datos: x.ambito === ambito ? x.datos : null, error: e instanceof Error ? e.message : String(e) })) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `k` resume lo que se lee
  }, [k])
  return { datos: r.ambito === ambito ? r.datos : null, error: r.clave === k ? r.error : null, leyendo: r.clave !== k, recargar: () => setVuelta((v) => v + 1) }
}
