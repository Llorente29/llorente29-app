// src/pages/trabajador/TrabajadorApp.tsx
// Orquestador del modo trabajador: gestiona navegación entre subpáginas.
// La sesión es global (Supabase Auth en App.tsx), aquí solo recibimos el employee resuelto.
import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import HomeEmpleado from './HomeEmpleado'
import FichajeEmpleado from './FichajeEmpleado'
import MiHorario from './MiHorario'
import MisFichajes from './MisFichajes'
import MisDocumentos from './MisDocumentos'
import MisVacaciones from './MisVacaciones'
import MiBolsaHoras from '../../components/MiBolsaHoras'
import MisTurnos from './MisTurnos'
import CambiosTurnoPage from './CambiosTurnoPage'
import { fetchAppSettings } from '../../services/appSettingsService'
import { fetchLocations } from '../../services/supabaseSync'
import type { Employee, Location } from '../../types'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos' | 'cambios'

interface Props {
  /** ID del empleado vinculado al user_profile del usuario logueado (Auth) */
  employeeId?: string
  /** Callback al pulsar "Salir" — cierra sesión global */
  onExitMode: () => void
}

export default function TrabajadorApp({ employeeId, onExitMode }: Props) {
  const { staff } = useApp()
  const [subPage, setSubPage] = useState<SubPage>('home')
  const [showBolsaHoras, setShowBolsaHoras] = useState(false)
  const [location, setLocation] = useState<Location | undefined>(undefined)

  // Cargar setting de visibilidad de bolsa de horas
  useEffect(() => {
    fetchAppSettings().then(s => setShowBolsaHoras(s.showHourBankToEmployee))
  }, [])

  const employee: Employee | null = employeeId
    ? (staff.find(e => e.id === employeeId) || null)
    : null

  // Cargar el local del empleado (para la bolsa de horas como página independiente)
  useEffect(() => {
    let cancel = false
    async function loadLoc() {
      if (!employee?.locationId) return
      const all = await fetchLocations()
      if (cancel || !all) return
      setLocation(all.find(l => l.id === employee.locationId))
    }
    loadLoc()
    return () => { cancel = true }
  }, [employee?.locationId])

  // Si no hay employeeId vinculado al user, mostrar mensaje claro
  if (!employeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-white rounded-2xl shadow-lg p-6">
          <p className="text-4xl mb-3">⚠️</p>
          <h2 className="font-bold text-gray-900 mb-2">Tu cuenta no está vinculada a un empleado</h2>
          <p className="text-sm text-gray-600 mb-4">
            Pide a tu administrador que vincule tu cuenta de email con tu ficha de empleado.
          </p>
          <button
            onClick={onExitMode}
            className="px-4 py-2 rounded-lg text-white text-sm"
            style={{ backgroundColor: '#7C1A1A' }}
          >
            Salir
          </button>
        </div>
      </div>
    )
  }

  // El employeeId existe pero el empleado no se encuentra (puede estar inactivo o ya no existir)
  if (!employee) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-white rounded-2xl shadow-lg p-6">
          <p className="text-4xl mb-3">🚫</p>
          <h2 className="font-bold text-gray-900 mb-2">No tienes acceso</h2>
          <p className="text-sm text-gray-600 mb-4">
            Tu ficha de empleado no está disponible. Posiblemente has sido dado de baja.
            Contacta con tu administrador.
          </p>
          <button
            onClick={onExitMode}
            className="px-4 py-2 rounded-lg text-white text-sm"
            style={{ backgroundColor: '#7C1A1A' }}
          >
            Salir
          </button>
        </div>
      </div>
    )
  }

  // El empleado existe pero está inactivo (dado de baja)
  if (!employee.active) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-white rounded-2xl shadow-lg p-6">
          <p className="text-4xl mb-3">🚫</p>
          <h2 className="font-bold text-gray-900 mb-2">Cuenta desactivada</h2>
          <p className="text-sm text-gray-600 mb-4">
            Tu cuenta ha sido dada de baja. Contacta con tu administrador si crees que es un error.
          </p>
          <button
            onClick={onExitMode}
            className="px-4 py-2 rounded-lg text-white text-sm"
            style={{ backgroundColor: '#7C1A1A' }}
          >
            Salir
          </button>
        </div>
      </div>
    )
  }

  // Subpáginas
  if (subPage === 'fichar') {
    return <FichajeEmpleado employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'horario') {
    return <MiHorario employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'fichajes') {
    return <MisFichajes employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'documentos') {
    return <MisDocumentos employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'vacaciones') {
    return <MisVacaciones employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'bolsa' && showBolsaHoras) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] p-4 pb-8">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setSubPage('home')} className="text-2xl text-gray-500">←</button>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Mi bolsa de horas</p>
              <p className="font-bold text-gray-900">{employee.name.split(' ')[0]}</p>
            </div>
          </div>
          <MiBolsaHoras employee={employee} location={location} />
        </div>
      </div>
    )
  }

  if (subPage === 'turnos') {
    return <MisTurnos employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'cambios') {
    return <CambiosTurnoPage employee={employee} onBack={() => setSubPage('home')} />
  }

  // home — usuario ya autenticado por Auth global, sin selector de empleado, sin PIN
  return (
    <HomeEmpleado
      employee={employee}
      onNavigate={p => setSubPage(p)}
      onLogout={onExitMode}
      showBolsaHoras={showBolsaHoras}
    />
  )
}
