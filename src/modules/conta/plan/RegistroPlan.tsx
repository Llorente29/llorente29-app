// src/modules/conta/plan/RegistroPlan.tsx
//
// «Lo que ha hecho Folvy» del plan contable (company_account_log): activar,
// crear, ocultar, enlazar, renumerar… con quién y cuándo. Es también el
// «Historial de cambios» de la pantalla del plan (maqueta N5Plan).

import type { ReactNode } from 'react'
import { TarjetaApartado } from '@/modules/conta/empresa/campos'

const FECHA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })
const HORA = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
const cuando = (iso: string) => `${FECHA.format(new Date(iso))} a las ${HORA.format(new Date(iso))}`
const ORIGEN: Record<string, string> = { serie: 'Folvy, al activar el plan', manual: 'a mano', ai_accepted: 'propuesta de Folvy aceptada', migrated: 'traído de otro programa' }

export interface EntradaRegistro { id: string; que?: string; detalle: string; doneAt: string; doneByName: string | null; source: string }

/** accion: lo que se puede hacer con una entrada (C02c: «Deshacer entero» en «Plan traído de …»). */
export function RegistroPlan({ registro, movil = false, titulo = 'Historial del plan contable', accion }: {
  registro: EntradaRegistro[]; movil?: boolean; titulo?: string; accion?: (r: EntradaRegistro) => ReactNode
}) {
  return (
    <TarjetaApartado titulo={titulo} movil={movil}>
      {registro.length === 0 ? (
        <p className="cx-vacio">Aún no hay cambios en el plan contable.</p>
      ) : (
        <ul className="cx-registro" aria-label={titulo}>
          {registro.map((r) => (
            <li key={r.id}>
              <div className="cx-fila-texto">
                <span className="cx-fila-titulo">{r.detalle}</span>
                <span className="cx-fila-apoyo">{cuando(r.doneAt)} · {ORIGEN[r.source] ?? r.source}{r.doneByName ? ` · ${r.doneByName}` : ''}</span>
              </div>
              {accion?.(r)}
            </li>
          ))}
        </ul>
      )}
    </TarjetaApartado>
  )
}
