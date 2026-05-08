import { useState, useEffect } from 'react'
import { useApp } from './context/AppContext'
import type { Page } from './types'
import Logo, { LogoSquare } from './components/Logo'
import StaffPage from './pages/StaffPage'
import FichajesGlobalPage from './pages/FichajesGlobalPage'
import InformesPage from './pages/InformesPage'
import TasksPage from './pages/TasksPage'
import IncidentsPage from './pages/IncidentsPage'
import CalendarioPage from './pages/CalendarioPage'
import TSpoonPage from './pages/TSpoonPage'
import VentasAnalisisPage from './pages/VentasAnalisisPage'
import PrediccionPersonalPage from './pages/PrediccionPersonalPage'
import ZonasPedidoPage from './pages/ZonasPedidoPage'
import KioskoFichajePage from './pages/KioskoFichajePage'
import SolicitudesPendientesPage from './pages/SolicitudesPendientesPage'
import AhoraMismoPage from './pages/AhoraMismoPage'
import TrabajadorApp from './pages/trabajador/TrabajadorApp'
import {
  DashboardPage, ScheduledPage, TemplatesPage,
  AuditsPage, HistoryPage, InventoryPage, TSpoonSettingsPage, LocationsPage
} from './pages/OtherPages'

const MODE_KEY = 'andy-app-mode-v1'
type AppMode = 'gestor' | 'trabajador' | 'unset'

const NAV: { id: Page; label: string; icon: string; section?: string }[] = [
  { id: 'dashboard',          label: 'Dashboard',           icon: '⊞' },
  { id: 'staff',              label: 'Personal',            icon: '👤', section: 'Personal' },
  { id: 'ahora_mismo',        label: 'Ahora mismo',         icon: '🟢' },
  { id: 'fichajes_global',    label: 'Control Horario',     icon: '⏰' },
  { id: 'kiosko_fichaje',     label: 'Kiosko Fichaje',      icon: '🕐' },
  { id: 'solicitudes_pendientes', label: 'Solicitudes',     icon: '📨' },
  { id: 'calendario',         label: 'Calendario',          icon: '📅' },
  { id: 'informes_personal',  label: 'Informes Gestoría',   icon: '📄' },
  { id: 'tasks',              label: 'Tareas',              icon: '✅', section: 'Operaciones' },
  { id: 'scheduled',          label: 'Programadas',         icon: '🔁' },
  { id: 'templates',          label: 'Plantillas',          icon: '📋' },
  { id: 'incidents',          label: 'Incidencias',         icon: '⚠️' },
  { id: 'audits',             label: 'Auditorías',          icon: '🔍' },
  { id: 'history',            label: 'Historial',           icon: '📜' },
  { id: 'tspoon',             label: 'Fichas Técnicas',     icon: '🧪', section: 'Inventario' },
  { id: 'ventas_analisis',    label: 'Análisis de Ventas',  icon: '📊' },
  { id: 'prediccion_personal', label: 'Predicción Personal',  icon: '🔮' },
  { id: 'zonas_pedido',       label: 'Zonas de Pedido',     icon: '🛵' },
  { id: 'inventory',          label: 'Inventario',          icon: '📦' },
  { id: 'locations',          label: 'Locales',             icon: '📍', section: 'Configuración' },
  { id: 'tspoon_settings',    label: 'Avisos',              icon: '🔔' },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard: 'Dashboard', staff: 'Personal', fichajes_global: 'Control Horario',
  kiosko_fichaje: 'Kiosko Fichaje',
  solicitudes_pendientes: 'Solicitudes pendientes',
  ahora_mismo: 'Ahora mismo',
  calendario: 'Calendario de Horarios', informes_personal: 'Informes Gestoría',
  tasks: 'Tareas', scheduled: 'Programadas', templates: 'Plantillas',
  incidents: 'Incidencias', locations: 'Locales', audits: 'Auditorías',
  history: 'Historial', tspoon: 'Fichas Técnicas', inventory: 'Inventario',
  tspoon_settings: 'Configuración de Avisos',
  ventas_analisis: 'Análisis de Ventas',
  prediccion_personal: 'Predicción de Personal',
  zonas_pedido: 'Zonas de Pedido',
}

function renderPage(page: Page) {
  switch (page) {
    case 'dashboard':         return <DashboardPage />
    case 'staff':             return <StaffPage />
    case 'fichajes_global':   return <FichajesGlobalPage />
    case 'kiosko_fichaje':    return <KioskoFichajePage />
    case 'solicitudes_pendientes': return <SolicitudesPendientesPage />
    case 'ahora_mismo':       return <AhoraMismoPage />
    case 'calendario':        return <CalendarioPage />
    case 'informes_personal': return <InformesPage />
    case 'tasks':             return <TasksPage />
    case 'scheduled':         return <ScheduledPage />
    case 'templates':         return <TemplatesPage />
    case 'incidents':         return <IncidentsPage />
    case 'audits':            return <AuditsPage />
    case 'history':           return <HistoryPage />
    case 'tspoon':            return <TSpoonPage />
    case 'ventas_analisis':   return <VentasAnalisisPage />
    case 'prediccion_personal': return <PrediccionPersonalPage />
    case 'zonas_pedido':      return <ZonasPedidoPage />
    case 'inventory':         return <InventoryPage />
    case 'locations':         return <LocationsPage />
    case 'tspoon_settings':   return <TSpoonSettingsPage />
    default:                  return <DashboardPage />
  }
}

function ModeSelector({ onSelect }: { onSelect: (mode: AppMode) => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E9D9] via-white to-[#F5E9D9] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Logo size="xl" withBg className="mb-4" />
          <p className="text-sm text-gray-500 mt-4">¿Quién eres?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onSelect('trabajador')}
            className="w-full p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-[#7C1A1A] transition-all text-left active:scale-95"
          >
            <div className="flex items-center gap-4">
              <span className="text-4xl">👷</span>
              <div>
                <p className="font-bold text-gray-900">Soy trabajador</p>
                <p className="text-xs text-gray-500 mt-0.5">Fichar, ver mi horario, mis cosas</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onSelect('gestor')}
            className="w-full p-5 rounded-2xl border-2 border-gray-200 bg-white hover:border-[#F39C2A] transition-all text-left active:scale-95"
          >
            <div className="flex items-center gap-4">
              <span className="text-4xl">👔</span>
              <div>
                <p className="font-bold text-gray-900">Soy gestor / encargado</p>
                <p className="text-xs text-gray-500 mt-0.5">Acceso completo a la gestión</p>
              </div>
            </div>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Tu elección se recordará. Puedes cambiar más tarde.
        </p>
      </div>
    </div>
  )
}

function Sidebar({ page, setPage, collapsed, setCollapsed }: {
  page: Page; setPage: (p: Page) => void; collapsed: boolean; setCollapsed: (v: boolean) => void
}) {
  const { tasks, incidents } = useApp()
  const [pendingVacations, setPendingVacations] = useState(0)
  const pendingTasks = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length
  const openInc = incidents.filter(i => i.status !== 'resuelta').length

  // Cargar conteo de vacaciones pendientes
  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const mod = await import('./services/vacationsService')
        const list = await mod.fetchPendingVacations()
        if (!cancel) setPendingVacations((list || []).length)
      } catch { /* ignore */ }
    }
    load()
    const id = setInterval(load, 30000) // refrescar cada 30s
    return () => { cancel = true; clearInterval(id) }
  }, [])

  const badge = (id: Page) =>
    id === 'tasks' ? pendingTasks
    : id === 'incidents' ? openInc
    : id === 'solicitudes_pendientes' ? pendingVacations
    : 0

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${collapsed ? 'w-[64px]' : 'w-56'}`}>
      <div className={`h-14 flex items-center border-b gap-3 shrink-0 ${collapsed ? 'px-3.5' : 'px-4'}`}>
        <LogoSquare size={32} />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight truncate">Foodint</p>
            <p className="text-[10px] text-gray-400 truncate">App del equipo</p>
          </div>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item, idx) => {
          const isActive = page === item.id
          const showSection = item.section && (idx === 0 || NAV[idx - 1].section !== item.section)
          const b = badge(item.id)
          return (
            <div key={item.id}>
              {showSection && !collapsed && (
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-3 pb-1">{item.section}</p>
              )}
              {showSection && collapsed && <div className="border-t border-gray-100 my-1.5 mx-1" />}
              <button
                title={collapsed ? item.label : undefined}
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'bg-[#F5E9D9] text-[#7C1A1A]' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="relative shrink-0 text-base leading-none">
                  {item.icon}
                  {b > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">{b}</span>
                  )}
                </span>
                {!collapsed && <span className="truncate text-sm">{item.label}</span>}
              </button>
            </div>
          )
        })}
      </nav>

      <div className="p-2 border-t">
        <button onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-100">
          <span className="text-sm">{collapsed ? '→' : '←'}</span>
          {!collapsed && <span>Contraer</span>}
        </button>
      </div>
    </aside>
  )
}

function BottomNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const main: Page[] = ['dashboard', 'staff', 'kiosko_fichaje', 'tasks', 'locations']
  const icons: Record<string, string> = { dashboard: '⊞', staff: '👤', kiosko_fichaje: '🕐', tasks: '✅', locations: '📍' }
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center justify-around py-1 px-1 lg:hidden">
      {main.map(id => (
        <button key={id} onClick={() => setPage(id)}
          className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg min-w-0 ${page === id ? 'text-[#7C1A1A]' : 'text-gray-400'}`}>
          <span className="text-xl leading-none">{icons[id]}</span>
          <span className="text-[9px] font-medium truncate">{PAGE_TITLES[id as Page].split(' ')[0]}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<AppMode>('unset')
  const { tasks, incidents } = useApp()
  const pending = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length
  const critInc = incidents.filter(i => i.severity === 'critica' && i.status !== 'resuelta').length

  // Cargar modo guardado
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY) as AppMode | null
      if (saved === 'gestor' || saved === 'trabajador') setMode(saved)
    } catch { /* ignore */ }
  }, [])

  function selectMode(m: AppMode) {
    localStorage.setItem(MODE_KEY, m)
    setMode(m)
  }

  function exitTrabajadorMode() {
    localStorage.removeItem(MODE_KEY)
    setMode('unset')
  }

  // Modo no definido — pedir al usuario que elija
  if (mode === 'unset') {
    return <ModeSelector onSelect={selectMode} />
  }

  // Modo trabajador — UI específica del empleado
  if (mode === 'trabajador') {
    return <TrabajadorApp onExitMode={exitTrabajadorMode} />
  }

  // Modo gestor — la app completa de siempre
  // En el kiosko ocultamos sidebar y header — pantalla completa
  const isKiosko = page === 'kiosko_fichaje'

  if (isKiosko) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KioskoFichajePage />
        <button
          onClick={() => setPage('dashboard')}
          className="fixed bottom-4 left-4 text-xs text-gray-300 hover:text-gray-500"
          title="Salir del kiosko"
        >
          ← salir
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="hidden lg:block">
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>
      <BottomNav page={page} setPage={setPage} />
      <div className={`transition-all duration-200 ${collapsed ? 'lg:ml-[64px]' : 'lg:ml-56'}`}>
        <header className="h-14 border-b border-gray-200 bg-white/90 backdrop-blur-sm flex items-center justify-between px-5 shrink-0 sticky top-0 z-30">
          <h1 className="text-lg font-semibold" style={{ fontFamily: 'Instrument Serif, serif' }}>{PAGE_TITLES[page]}</h1>
          <div className="flex items-center gap-2">
            {pending > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                {pending} tarea{pending > 1 ? 's' : ''}
              </span>
            )}
            {critInc > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200 animate-pulse">
                ⚠️ {critInc} crítica{critInc > 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={exitTrabajadorMode}
              title="Cambiar de modo"
              className="hover:opacity-80 transition-opacity"
            >
              <LogoSquare size={28} />
            </button>
          </div>
        </header>
        <main className="p-4 sm:p-6 pb-24 lg:pb-6">
          {renderPage(page)}
        </main>
      </div>
    </div>
  )
}
