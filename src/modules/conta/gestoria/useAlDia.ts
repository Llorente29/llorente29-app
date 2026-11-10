// src/modules/conta/gestoria/useAlDia.ts
//
// GD · La pantalla se pone al día sola cuando acaba una lectura del CRM o de GoCardless de su cuenta (alDia.ts).
// Si Realtime no contesta, no pasa nada: la pantalla sigue como hasta ahora (se recarga al volver a entrar).

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { JUNTAR_MS, TABLA_DE_LECTURAS, filtroDeLaCuenta, pideRecargar } from './alDia'

export function useAlDiaConLasLecturas(cuenta: string | null | undefined, recargar: () => void): void {
  const ultimo = useRef(recargar)
  useEffect(() => { ultimo.current = recargar }, [recargar])
  useEffect(() => {
    const sb = supabase
    if (!sb || !cuenta) return
    let espera: ReturnType<typeof setTimeout> | null = null
    const canal = sb.channel(`conta-al-dia:${cuenta}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLA_DE_LECTURAS, filter: filtroDeLaCuenta(cuenta) }, (cambio) => {
        if (!pideRecargar(cambio.new as Record<string, unknown>, cuenta)) return
        if (espera) clearTimeout(espera)
        espera = setTimeout(() => ultimo.current(), JUNTAR_MS)
      })
      .subscribe()
    return () => { if (espera) clearTimeout(espera); void sb.removeChannel(canal) }
  }, [cuenta])
}
