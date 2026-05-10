// src/pages/trabajador/CambiosTurnoPage.tsx
// Wrapper con 2 pestañas: Tablón (cambios disponibles) | Mis solicitudes.

import { useState } from 'react'
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
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] pb-20">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="text-[#7C1A1A] text-2xl">←</button>
        )}
        <div className="flex-1">
          <h1 className="text-xl font-bold" style={{ color: '#7C1A1A' }}>Cambios de turno</h1>
          <p className="text-xs text-gray-500">{employee.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-1 bg-white border rounded-lg p-1 shadow-sm">
          <button
            onClick={() => setTab('tablon')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === 'tablon' ? 'bg-[#F5E9D9] text-[#7C1A1A]' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            🌐 Tablón
          </button>
          <button
            onClick={() => setTab('mias')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === 'mias' ? 'bg-[#F5E9D9] text-[#7C1A1A]' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            📜 Mis solicitudes
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
