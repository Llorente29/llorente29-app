// src/modules/conta/terceros/useFichaTercero.ts
//
// C03 · La ficha de un tercero: carga lo suyo (cargarFichaTercero) y, si es
// socio de marca, el cálculo del mes en curso POR LOCAL con la función de la
// base (brand_partner_settlement_compute: no escribe nada). La cuenta y la
// empresa salen del marco del módulo.

import { useCallback, useEffect, useState } from 'react'
import { cargarFichaTercero, calcularLiquidacionSocio, type CalculoSocio, type FichaTercero } from '@/modules/conta/services/tercerosService'
import { mesDe } from '@/modules/conta/lib/liquidacionSocio'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'

export type EstadoFicha =
  | { estado: 'cargando' }
  | { estado: 'error'; error: string }
  | { estado: 'no-existe' }
  | { estado: 'lista'; ficha: FichaTercero; mesSocio: { mes: ReturnType<typeof mesDe>; porLocal: (CalculoSocio & { local: string })[] } | null }

export function useFichaTercero(accountId: string | null, companyId: string | null, partyId: string) {
  const [estado, setEstado] = useState<EstadoFicha>({ estado: 'cargando' })
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])
  useEffect(() => {
    if (!accountId) return
    let vivo = true
    ;(async () => {
      const ficha = await cargarFichaTercero(accountId, companyId, partyId)
      if (!ficha) { if (vivo) setEstado({ estado: 'no-existe' }); return }
      let mesSocio: Extract<EstadoFicha, { estado: 'lista' }>['mesSocio'] = null
      if (ficha.papeles.some((p) => p.role === 'brand_partner')) {
        const mes = mesDe(hoyEnMadrid())
        const porLocal = await Promise.all(ficha.locales.map(async (l) => ({
          ...(await calcularLiquidacionSocio(partyId, l.id, mes.desde, mes.hasta)), local: l.name,
        })))
        mesSocio = { mes, porLocal }
      }
      if (vivo) setEstado({ estado: 'lista', ficha, mesSocio })
    })().catch((e: unknown) => { if (vivo) setEstado({ estado: 'error', error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, partyId, vuelta])
  return { ...estado, recargar }
}
