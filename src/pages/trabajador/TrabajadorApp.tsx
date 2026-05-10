// src/pages/trabajador/TrabajadorApp.tsx
// Orquestador del modo trabajador: gestiona login, sesión y navegación entre subpáginas.
import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import LoginEmpleado from './LoginEmpleado'
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

const SESSION_KEY = 'andy-empleado-session-v1'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos' | 'cambios'

interface Props {
  onExitMode: () => void
}

export default function TrabajadorApp({ onExitMode }: Props) {
  const { staff } = useApp()
  const [employeeId, setEmployeeId] = useState<string | null>(() => {
    try { return localStorage.getItem(SESSION_KEY) } catch { return null }
  })
  const [subPage, setSubPage] = useState<SubPage>('home')
  const [showBolsaHoras, setShowBolsaHoras] = useState(false)
  const [location, setLocation] = useState<Location | undefined>(undefined)

  // Cargar setting de visibilidad de bolsa de horas
  useEffect(() => {
    fetchAppSettings().then(s => setShowBolsaHoras(s.showHourBankToEmployee))
  }, [])

  // Si el empleado fue eliminado o cambió de PIN, expulsar
  useEffect(() => {
    if (!employeeId) return
    const exists = staff.find(e => e.id === employeeId && e.active)
    if (!exists) {
      localStorage.removeItem(SESSION_KEY)
      setEmployeeId(null)
    }
  }, [employeeId, staff])

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

  function handleLogin(emp: Employee) {
    localStorage.setItem(SESSION_KEY, emp.id)
    setEmployeeId(emp.id)
    setSubPage('home')
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setEmployeeId(null)
    setSubPage('home')
  }

  if (!employee) {
    return <LoginEmpleado onLogin={handleLogin} onBackToSelector={onExitMode} />
  }

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

  // home
  return (
    <HomeEmpleado
      employee={employee}
      onNavigate={p => setSubPage(p)}
      onLogout={handleLogout}
      showBolsaHoras={showBolsaHoras}
    />
  )
}
