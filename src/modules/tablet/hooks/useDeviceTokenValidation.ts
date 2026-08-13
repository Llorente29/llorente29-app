// src/modules/tablet/hooks/useDeviceTokenValidation.ts
//
// fix/tablet-robustez (12/08), Tareas A+B+C. Valida el token de dispositivo
// con la función BARATA (device_location_by_token, ~16ms) en vez de
// kds_board (~1-2s, escala con los pedidos vivos — es la que provocó el
// cierre de Carabanchel el 11/08: un timeout de 3s en kds_board se mostró
// como "token revocado" sobre una tablet que seguía perfectamente
// vinculada). kds_board se sigue usando para lo que es — pintar el
// tablero — no para validar.
//
// Reintento con espera creciente (retryBackoff.ts) para red/lentitud, PARA
// SIEMPRE, sin pedir vincular. Solo un rechazo EXPLÍCITO del servidor
// (excepción "token no válido" de device_location_by_token) muestra la
// pantalla de vincular y borra el token guardado — un fallo de red o de
// tiempo NUNCA lo borra.
//
// Comparten esto TabletStationRoute (/estacion) y KdsKioskRoute (/cocina-tv)
// — antes cada uno tenía su propio efecto casi idéntico, ambos con el mismo
// bug (validaban con kds_board).

import { useEffect, useRef, useState } from 'react'
import { getDeviceLocation, type TabletLocationInfo } from '../services/tabletAvailabilityService'
import { runRetryLoop, type RetryLoopHandle } from '@/lib/retryBackoff'

export type ValidationStatus =
  | { kind: 'idle' }
  | { kind: 'trying'; attempt: number; slow: boolean }
  | { kind: 'valid'; info: TabletLocationInfo }
  | { kind: 'rejected'; message: string }

// El mensaje de device_location_by_token es fijo y propio ("device_location_
// by_token: token no válido") — comprobamos por substring, no por código,
// porque es una excepción nuestra y estable, no un error de red.
function isExplicitTokenRejection(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /token no v[aá]lido/i.test(msg)
}

export function tokenValidationMessage(status: ValidationStatus): string | null {
  if (status.kind === 'trying') {
    return status.slow ? 'Folvy va lento. Reintentando…' : 'Sin conexión con Folvy. Reintentando…'
  }
  if (status.kind === 'rejected') return status.message
  return null
}

/** onRejected: se llama SOLO ante rechazo explícito — el sitio de llamada
 *  decide qué hacer con el token guardado (típicamente: desvincular). */
export function useDeviceTokenValidation(token: string | null, onRejected?: () => void): ValidationStatus {
  const [status, setStatus] = useState<ValidationStatus>({ kind: 'idle' })
  const handleRef = useRef<RetryLoopHandle | null>(null)
  const onRejectedRef = useRef(onRejected)
  onRejectedRef.current = onRejected

  useEffect(() => {
    handleRef.current?.cancel()
    if (!token) { setStatus({ kind: 'idle' }); return }

    handleRef.current = runRetryLoop({
      call: () => getDeviceLocation(token),
      isExplicitRejection: isExplicitTokenRejection,
      onState: (s) => {
        if (s.phase === 'trying') setStatus({ kind: 'trying', attempt: s.attempt, slow: s.slow })
        if (s.phase === 'rejected') {
          setStatus({
            kind: 'rejected',
            message: 'Esta tablet ya no está vinculada. Escanea el QR de la estación.',
          })
          onRejectedRef.current?.()
        }
      },
      onSuccess: (info) => setStatus({ kind: 'valid', info }),
    })

    return () => { handleRef.current?.cancel() }
  }, [token])

  return status
}
