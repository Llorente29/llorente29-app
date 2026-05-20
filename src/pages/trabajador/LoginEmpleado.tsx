// src/pages/trabajador/LoginEmpleado.tsx
import { useState, useEffect, useMemo } from 'react'
import { Users, ArrowLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import Logo from '../../components/Logo'
import type { Employee } from '../../types'

interface Props {
  onLogin: (employee: Employee) => void
  onBackToSelector: () => void
}

export default function LoginEmpleado({ onLogin, onBackToSelector }: Props) {
  const { staff } = useApp()
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const employees = useMemo(() => {
    return staff
      .filter(e => e.active)
      .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [staff, search])

  // Validar PIN cuando llega a 4 dígitos
  useEffect(() => {
    if (pin.length === 4 && selectedEmp) {
      if (selectedEmp.pin === pin) {
        onLogin(selectedEmp)
      } else {
        setError('PIN incorrecto')
        setTimeout(() => { setPin(''); setError('') }, 1200)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  if (!selectedEmp) {
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-6">
          <div className="text-center mb-6">
            <Logo size="xl" className="mb-3" />
            <p className="text-sm text-text-secondary mt-3">Pulsa tu nombre para entrar</p>
          </div>

          <input
            type="text"
            placeholder="Buscar mi nombre..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border-default bg-card text-base mb-4 focus:outline-none focus:border-accent"
          />

          {employees.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="flex justify-center mb-2"><Users size={32} className="text-accent" /></div>
              <p className="text-sm font-semibold text-text-primary">Sin empleados disponibles</p>
              <p className="text-xs text-text-secondary mt-1">Tu encargado aún no te ha dado de alta. Contacta con él.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {employees.map(e => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEmp(e)}
                  className="w-full p-4 rounded-xl border-2 border-border-default bg-card hover:border-accent transition-base text-left active:scale-95"
                >
                  <p className="font-semibold text-text-primary">{e.name || 'Sin nombre'}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{e.position || '—'}</p>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onBackToSelector}
            className="w-full mt-6 text-xs text-text-secondary hover:text-text-secondary"
          >
            No soy trabajador, salir
          </button>
        </div>
      </div>
    )
  }

  // Pantalla de PIN
  return (
    <div className="min-h-screen bg-page p-4">
      <div className="max-w-sm mx-auto pt-8">
        <Card className="p-6 text-center">
          <p className="text-xs text-text-secondary uppercase tracking-wide">Hola</p>
          <p className="font-bold text-2xl text-text-primary mt-1">{selectedEmp.name}</p>
          <p className="text-sm text-text-secondary mt-1">Introduce tu PIN</p>

          <div className="my-6 flex justify-center gap-2">
            {[0, 1, 2, 3].map(i => (
              <span key={i} className={`w-4 h-4 rounded-full transition-base ${
                error ? 'bg-danger' :
                pin.length > i ? 'bg-accent' : 'bg-page'
              }`} />
            ))}
          </div>

          {error && <p className="text-sm text-danger mb-3 font-medium">{error}</p>}

          <div className="grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map(d => (
              <button
                key={d}
                onClick={() => { if (pin.length < 4) { setPin(p => p + d); setError('') } }}
                className="h-16 rounded-xl text-2xl font-semibold bg-card border-2 border-border-default text-text-primary hover:border-accent hover:bg-accent-bg transition-base active:scale-95"
              >
                {d}
              </button>
            ))}
            <button
              onClick={() => { setPin(''); setError('') }}
              className="h-16 rounded-xl text-lg font-semibold bg-accent-bg text-text-secondary hover:bg-page active:scale-95 transition-base"
            >
              C
            </button>
            <button
              onClick={() => { if (pin.length < 4) { setPin(p => p + '0'); setError('') } }}
              className="h-16 rounded-xl text-2xl font-semibold bg-card border-2 border-border-default text-text-primary hover:border-accent hover:bg-accent-bg active:scale-95 transition-base"
            >
              0
            </button>
            <button
              onClick={() => { setPin(p => p.slice(0, -1)); setError('') }}
              className="h-16 rounded-xl text-lg font-semibold bg-accent-bg text-text-secondary hover:bg-page active:scale-95 transition-base inline-flex items-center justify-center"
            >
              <ArrowLeft size={18} />
            </button>
          </div>

          <button
            onClick={() => { setSelectedEmp(null); setPin(''); setError('') }}
            className="mt-5 text-sm text-text-secondary hover:text-text-primary inline-flex items-center gap-1 transition-base"
          >
            <ArrowLeft size={14} /> Volver
          </button>
        </Card>
      </div>
    </div>
  )
}
