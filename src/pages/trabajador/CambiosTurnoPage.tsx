// src/pages/trabajador/CambiosTurnoPage.tsx
// Wrapper con 2 pestañas: Tablón (cambios disponibles) | Mis solicitudes.

import { useState } from 'react'
import { ArrowLeft, Globe2, History } from 'lucide-react'
import type { Employee } from '../../types'
import TablonCambiosView from '../../components/trabajador/TablonCambiosView'
import MisCambiosView from '../../components/trabajador/MisCambiosView'

interface Props {
  employee: Employee
  onBack?: () => void
}

type Tab = 'tablon' | 'mias'

export default function CambiosTurnoPage({ employee, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('tablon')
  const [reloadKey, setReloadKey] = useState(0)

  function handleChanged() {
    setReloadKey(k => k + 1)
  }

  return (
    <div className="min-h-screen bg-page pb-20">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="text-accent w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
            aria-label="Volver"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex-1">
          <h1 className="font-display text-xl text-accent">Cambios de turno</h1>
          <p className="text-xs text-text-secondary">{employee.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-1 bg-card border border-border-default rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setTab('tablon')}
            className={`inline-flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-base ${
              tab === 'tablon' ? 'bg-accent-bg text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Globe2 size={14} /> Tablón
          </button>
          <button
            onClick={() => setTab('mias')}
            className={`inline-flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-base ${
              tab === 'mias' ? 'bg-accent-bg text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <History size={14} /> Mis solicitudes
          </button>
        </div>
      </div>

      <div className="px-4">
        {tab === 'tablon' && (
          <TablonCambiosView
            key={`tab-${reloadKey}`}
            myEmployee={employee}
            onChanged={handleChanged}
          />
        )}
        {tab === 'mias' && (
          <MisCambiosView
            key={`mias-${reloadKey}`}
            myEmployee={employee}
            onChanged={handleChanged}
          />
        )}
      </div>
    </div>
  )
}
