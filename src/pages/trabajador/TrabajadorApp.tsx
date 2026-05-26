// src/pages/trabajador/TrabajadorApp.tsx
// Orquestador del modo trabajador: gestiona navegación entre módulos y subpáginas.
// Home: 2 botones grandes (APPCC + Portal). Preparado para añadir más módulos.
import { useState, useEffect } from 'react'
import { ArrowLeft, Ban, AlertTriangle } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import HomeEmpleado from './HomeEmpleado'
import type { WorkerModule } from './HomeEmpleado'
import PortalEmpleado from './PortalEmpleado'
import type { PortalSubPage } from './PortalEmpleado'
import FichajeEmpleado from './FichajeEmpleado'
import MiHorario from './MiHorario'
import MisFichajes from './MisFichajes'
import MisDocumentos from './MisDocumentos'
import MisVacaciones from './MisVacaciones'
import MiBolsaHoras from '../../components/MiBolsaHoras'
import MisTurnos from './MisTurnos'
import CambiosTurnoPage from './CambiosTurnoPage'
import MisChecklistsPage from './MisChecklistsPage'
import ExecutionPage from '../../modules/appcc/pages/ExecutionPage'
import { fetchAppSettings } from '../../services/appSettingsService'
import { fetchLocations } from '../../services/supabaseSync'
import { supabase } from '../../lib/supabase'
import type { Employee, Location } from '../../types'

type SubPage =
  | 'home'
  | 'portal'
  | 'fichar' | 'horario' | 'fichajes' | 'documentos' | 'vacaciones' | 'bolsa' | 'turnos' | 'cambios'
  | 'appcc_list' | 'appcc_execution'

interface Props {
  employeeId?: string
  onExitMode: () => void
}

export default function TrabajadorApp({ employeeId, onExitMode }: Props) {
  const {
    staff,
    syncing,
    lastSync,
    accountsLoading,
    authResolved,
    activeAccountId,
    cloudEnabled,
    refreshStaff,
  } = useApp()
  const [subPage, setSubPage] = useState<SubPage>('home')
  const [showBolsaHoras, setShowBolsaHoras] = useState(false)
  const [location, setLocation] = useState<Location | undefined>(undefined)
  const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null)
  const [appccPendingCount, setAppccPendingCount] = useState(0)
  // refreshAttempted: marca si ya hemos pedido un refresh para resolver el caso
  // del encargado dual que entra al modo trabajador desde el Shell sin haber
  // disparado el sync para esta cuenta todavía. Una sola oportunidad por montaje.
  const [refreshAttempted, setRefreshAttempted] = useState(false)

  useEffect(() => {
    fetchAppSettings().then(s => setShowBolsaHoras(s.showHourBankToEmployee))
  }, [])

  const employee: Employee | null = employeeId
    ? (staff.find(e => e.id === employeeId) || null)
    : null

  // Guarda de carga: solo afirmar "no existe el empleado" cuando ya hemos
  // visto la BBDD al menos una vez para esta cuenta. Sin esto, el primer
  // render tras login muestra "No tienes acceso" porque staff aún es [] o
  // viene del cache global de localStorage.
  const stillLoading =
    !authResolved
    || accountsLoading
    || !activeAccountId
    || (cloudEnabled && (syncing || lastSync === null))

  useEffect(() => {
    let cancel = false
    async function loadLoc() {
      if (!employee?.locationId) return
      const all = await fetchLocations(null)
      if (cancel || !all) return
      setLocation(all.find(l => l.id === employee.locationId))
    }
    loadLoc()
    return () => { cancel = true }
  }, [employee?.locationId])

  // Contar checklists APPCC pendientes del día
  useEffect(() => {
    if (!supabase || !employee?.locationId) return
    let cancel = false
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('appcc_executions')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', employee.locationId)
      .eq('scheduled_date', today)
      .in('status', ['pending', 'in_progress'])
      .then(({ count }) => {
        if (!cancel) setAppccPendingCount(count ?? 0)
      })
    return () => { cancel = true }
  }, [employee?.locationId, subPage])

  // Refresh único bajo demanda: si llegamos aquí con employeeId pero sin
  // encontrar al empleado en staff, y el sync ya no está activo, puede ser
  // que staff no se haya sincronizado para esta cuenta (caso del encargado
  // dual que entra al modo trabajador desde el Shell). Forzamos UN refresh
  // antes de declarar "No tienes acceso".
  useEffect(() => {
    if (employeeId && !stillLoading && !employee && !refreshAttempted) {
      setRefreshAttempted(true)
      void refreshStaff()
    }
  }, [employeeId, stillLoading, employee, refreshAttempted, refreshStaff])

  // Error screens
  if (!employeeId) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-card rounded-xl shadow-lg p-6">
          <div className="flex justify-center mb-3"><AlertTriangle size={40} className="text-warning" /></div>
          <h2 className="font-bold text-text-primary mb-2">Tu cuenta no está vinculada a un empleado</h2>
          <p className="text-sm text-text-secondary mb-4">
            Pide a tu administrador que vincule tu cuenta de email con tu ficha de empleado.
          </p>
          <button onClick={onExitMode} className="px-4 py-2 rounded-lg text-text-on-accent text-sm bg-accent hover:bg-accent-hover transition-base">
            Salir
          </button>
        </div>
      </div>
    )
  }

  if (!employee && (stillLoading || !refreshAttempted)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <div className="text-center">
          <p className="text-2xl font-display font-medium mb-2 text-accent">
            Folvy
          </p>
          <p className="text-sm text-text-secondary">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-card rounded-xl shadow-lg p-6">
          <div className="flex justify-center mb-3"><Ban size={40} className="text-danger" /></div>
          <h2 className="font-bold text-text-primary mb-2">No tienes acceso</h2>
          <p className="text-sm text-text-secondary mb-4">
            Tu ficha de empleado no está disponible. Contacta con tu administrador.
          </p>
          <button onClick={onExitMode} className="px-4 py-2 rounded-lg text-text-on-accent text-sm bg-accent hover:bg-accent-hover transition-base">
            Salir
          </button>
        </div>
      </div>
    )
  }

  if (!employee.active) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-4">
        <div className="max-w-md text-center bg-card rounded-xl shadow-lg p-6">
          <div className="flex justify-center mb-3"><Ban size={40} className="text-danger" /></div>
          <h2 className="font-bold text-text-primary mb-2">Cuenta desactivada</h2>
          <p className="text-sm text-text-secondary mb-4">
            Tu cuenta ha sido dada de baja. Contacta con tu administrador si crees que es un error.
          </p>
          <button onClick={onExitMode} className="px-4 py-2 rounded-lg text-text-on-accent text-sm bg-accent hover:bg-accent-hover transition-base">
            Salir
          </button>
        </div>
      </div>
    )
  }

  // === ROUTING ===

  // APPCC: ejecución de un checklist
  if (subPage === 'appcc_execution' && currentExecutionId) {
    return (
      <ExecutionPage
        executionId={currentExecutionId}
        onBack={() => { setCurrentExecutionId(null); setSubPage('appcc_list') }}
      />
    )
  }

  // APPCC: lista de checklists del día
  if (subPage === 'appcc_list') {
    return (
      <MisChecklistsPage
        employee={employee}
        onBack={() => setSubPage('home')}
        onOpenExecution={(id) => { setCurrentExecutionId(id); setSubPage('appcc_execution') }}
      />
    )
  }

  // Portal: subpáginas
  if (subPage === 'fichar') return <FichajeEmpleado employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'horario') return <MiHorario employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'fichajes') return <MisFichajes employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'documentos') return <MisDocumentos employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'vacaciones') return <MisVacaciones employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'turnos') return <MisTurnos employee={employee} onBack={() => setSubPage('portal')} />
  if (subPage === 'cambios') return <CambiosTurnoPage employee={employee} onBack={() => setSubPage('portal')} />

  if (subPage === 'bolsa' && showBolsaHoras) {
    return (
      <div className="min-h-screen bg-page p-4 pb-8">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setSubPage('portal')} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
              <ArrowLeft size={20} />
            </button>
            <div>
              <p className="text-xs text-text-secondary uppercase tracking-wide">Mi bolsa de horas</p>
              <p className="font-bold text-text-primary">{employee.name.split(' ')[0]}</p>
            </div>
          </div>
          <MiBolsaHoras employee={employee} location={location} />
        </div>
      </div>
    )
  }

  // Portal: menú de botones
  if (subPage === 'portal') {
    return (
      <PortalEmpleado
        employee={employee}
        onNavigate={(p: PortalSubPage) => setSubPage(p)}
        onBack={() => setSubPage('home')}
        showBolsaHoras={showBolsaHoras}
      />
    )
  }

  // Home: botones grandes de módulos
  return (
    <HomeEmpleado
      employee={employee}
      onNavigate={(mod: WorkerModule) => {
        if (mod === 'appcc') setSubPage('appcc_list')
        else if (mod === 'portal') setSubPage('portal')
      }}
      onLogout={onExitMode}
      appccPendingCount={appccPendingCount}
    />
  )
}
