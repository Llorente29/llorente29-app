// src/pages/trabajador/usarFichajesPendientes.ts
//
// L1a · PR 1 (27/10/2026). Quien manda los fichajes hechos sin cobertura: al
// abrir el portal, al volver la red y cada minuto mientras quede algo. El aviso
// que lo cuenta está en FichajesPendientes.tsx.
import { useCallback, useEffect, useState } from 'react'
import {
  enviarFichajesPendientes, fichajesPendientes, descartarFichajePendiente, type FichajePendiente,
} from '../../services/fichajeServidor'

/** Manda lo pendiente y devuelve lo que queda de esta persona, para enseñarlo. */
export function useFichajesPendientes(employeeId: string | null | undefined, alSubir?: () => void) {
  const [pendientes, setPendientes] = useState<FichajePendiente[]>(() => (employeeId ? fichajesPendientes(employeeId) : []))
  const [subidos, setSubidos] = useState(0)

  const enviar = useCallback(async () => {
    if (!employeeId) return
    const r = await enviarFichajesPendientes()
    if (r.subidos > 0) { setSubidos(s => s + r.subidos); alSubir?.() }
    setPendientes(fichajesPendientes(employeeId))
  }, [employeeId, alSubir])

  useEffect(() => {
    // El primer envío, recién montado (fuera del render del efecto).
    const primero = window.setTimeout(() => { void enviar() }, 0)
    const alVolverLaRed = () => { void enviar() }
    window.addEventListener('online', alVolverLaRed)
    const reloj = window.setInterval(() => {
      if (fichajesPendientes().some(p => !p.rechazo)) void enviar()
    }, 60_000)
    return () => { window.clearTimeout(primero); window.removeEventListener('online', alVolverLaRed); window.clearInterval(reloj) }
  }, [enviar])

  const descartar = useCallback((clave: string) => {
    descartarFichajePendiente(clave)
    if (employeeId) setPendientes(fichajesPendientes(employeeId))
  }, [employeeId])

  return { pendientes, subidos, descartar }
}
