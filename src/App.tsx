import { useState } from 'react'
import { useApp } from './context/AppContext'
import type { Page } from './types'
import StaffPage from './pages/StaffPage'
import FichajesGlobalPage from './pages/FichajesGlobalPage'
import InformesPage from './pages/InformesPage'
import {
  DashboardPage, TasksPage, ScheduledPage, TemplatesPage, IncidentsPage,
  AuditsPage, HistoryPage, TSpoonPage, InventoryPage, TSpoonSettingsPage, LocationsPage
} from './pages/OtherPages'

const NAV_ITEMS: { id: Page; label: string; section?: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'staff', label: 'Personal', section: 'Personal' },
  { id: 'fichajes_global', label: 'Control Horario' },
  { id: 'informes_personal', label: 'Informes Gestoría' },
  { id: 'tasks', label: 'Tareas', section: 'Operaciones' },
  { id: 'scheduled', label: 'Programadas' },
  { id: 'templates', label: 'Plantillas' },
  { id: 'incidents', label: 'Incidencias' },
  { id: 'audits', label: 'Auditorías' },
  { id: 'history', label: 'Historial' },
  { id: 'tspoon', label: 'Fichas Técnicas', section: 'Inventario' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'locations', label: 'Locales', section: 'Configuración' },
  { id: 'tspoon_settings', label: 'Avisos' },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard: 'Dashboard', staff: 'Personal', fichajes_global: 'Control Horario',
  informes_personal: 'Informes Gestoría', tasks: 'Tareas', scheduled: 'Programadas',
  templates: 'Plantillas', incidents: 'Incidencias', locations: 'Locales',
  audits: 'Auditorías', history: 'Historial', tspoon: 'Fichas Técnicas',
  inventory: 'Inventario', tspoon_settings: 'Avisos',
}

function renderPage(page: Page) {
  switch (page) {
    case 'dashboard': return <DashboardPage />
    case 'staff': return <StaffPage />
    case 'fichajes_global': return <FichajesGlobalPage />
    case 'informes_personal': return <InformesPage />
    case 'tasks': return <TasksPage />
    case 'scheduled': return <ScheduledPage />
    case 'templates': return <TemplatesPage />
    case 'incidents': return <IncidentsPage />
    case 'audits': return <AuditsPage />
    case 'history': return <HistoryPage />
    case 'tspoon': return <TSpoonPage />
    case 'inventory': return <InventoryPage />
    case 'locations': return <LocationsPage />
    case 'tspoon_settings': return <TSpoonSettingsPage />
    default: return <DashboardPage />
  }
}

function Sidebar({ page, setPage, collapsed, setCollapsed }: {
  page: Page; setPage: (p: Page) => void; collapsed: boolean; setCollapsed: (v: boolean) => void
}) {
  const { tasks, incidents } = useApp()
  const pendingTasks = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length
  const openInc = incidents.filter(i => i.status !== 'resuelta').length
  const badge = (id: Page) => id === 'tasks' ? pendingTasks : id === 'incidents' ? openInc : 0

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-gray-200 transition-all duration-200 ${collapsed ? 'w-[68px]' : 'w-60'}`}>
      <div className="h-16 flex items-center px-4 border-b gap-3 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-sm" style={{ fontFamily: 'Instrument Serif, serif' }}>P</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight truncate">Panel Control</p>
            <p className="text-[10px] text-gray-400 truncate">Hostelería Pro</p>
          </div>
        )}
      </div>
      <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item, idx) => {
          const isActive = page === item.id
          const showSection = item.section && (idx === 0 || NAV_ITEMS[idx - 1].section !== item.section)
          const b = badge(item.id)
          return (
            <div key={item.id}>
              {showSection && !collapsed && (
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest px-3 pt-4 pb-1">{item.section}</p>
              )}
              {showSection && collapsed && <div className="border-t border-gray-100 my-2 mx-2" />}
              <button
                onClick={() => setPage(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive ? 'bg-teal-50 text-teal-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="relative shrink-0 w-5 h-5 flex items-center justify-center">
                  <span className="text-base">{
                    { dashboard: '⊞', staff: '👤', fichajes_global: '⏰', informes_personal: '📄',
                      tasks: '✅', scheduled: '📅', templates: '📋', incidents: '⚠️',
                      audits: '🔍', history: '📜', tspoon: '🧪', inventory: '📦',
                      locations: '📍', tspoon_settings: '🔔' }[item.id]
                  }</span>
                  {b > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{b}</span>
                  )}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            </div>
          )
        })}
      </nav>
      <div className="p-2.5 border-t">
        <button onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-100">
          <span>{collapsed ? '→' : '←'}</span>
          {!collapsed && <span>Contraer</span>}
        </button>
      </div>
    </aside>
  )
}

function BottomNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const icons: Record<string, string> = { dashboard: '⊞', staff: '👤', fichajes_global: '⏰', tasks: '✅', locations: '📍' }
  const main: Page[] = ['dashboard', 'staff', 'fichajes_global', 'tasks', 'locations']
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex items-center justify-around py-1.5 px-2 lg:hidden">
      {main.map(id => (
        <button key={id} onClick={() => setPage(id)}
          className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-lg ${page === id ? 'text-teal-600' : 'text-gray-400'}`}>
          <span className="text-xl">{icons[id]}</span>
          <span className="text-[10px] font-medium">{PAGE_TITLES[id].split(' ')[0]}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const { tasks } = useApp()
  const pending = tasks.filter(t => t.status === 'pendiente' || t.status === 'vencida').length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="hidden lg:block">
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>
      <BottomNav page={page} setPage={setPage} />
      <div className={`transition-all duration-200 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-60'}`}>
        <header className="h-16 border-b border-gray-200 bg-white/80 backdrop-blur-sm flex items-center justify-between px-5 shrink-0 sticky top-0 z-30">
          <h1 className="text-lg font-semibold" style={{ fontFamily: 'Instrument Serif, serif' }}>{PAGE_TITLES[page]}</h1>
          <div className="flex items-center gap-2">
            {pending > 0 && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-500 text-white animate-pulse">
                {pending} pendiente{pending > 1 ? 's' : ''}
              </span>
            )}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">AM</span>
            </div>
          </div>
        </header>
        <main className="p-4 sm:p-6 pb-24 lg:pb-6">
          {renderPage(page)}
        </main>
      </div>
    </div>
  )
}
