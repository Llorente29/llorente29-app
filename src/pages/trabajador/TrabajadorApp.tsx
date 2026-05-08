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
import MiBolsaHoras from './MiBolsaHoras'
import MisTurnos from './MisTurnos'
import { fetchAppSettings } from '../../services/appSettingsService'
import type { Employee } from '../../types'

const SESSION_KEY = 'andy-empleado-session-v1'

type SubPage = 'home' | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos'

interface Props {
  onExitMode: () => void  // Llamar para salir del modo trabajador (volver al selector inicial)
}

export default function TrabajadorApp({ onExitMode }: Props) {
  const { staff } = useApp()
  const [employeeId, setEmployeeId] = useState<string | null>(() => {
    try { return localStorage.getItem(SESSION_KEY) } catch { return null }
  })
  const [subPage, setSubPage] = useState<SubPage>('home')
  const [showBolsaHoras, setShowBolsaHoras] = useState(false)

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
    return <MiBolsaHoras employee={employee} onBack={() => setSubPage('home')} />
  }

  if (subPage === 'turnos') {
    return <MisTurnos employee={employee} onBack={() => setSubPage('home')} />
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
