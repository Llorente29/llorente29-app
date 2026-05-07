// src/pages/KioskoFichajePage.tsx
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Button, Card } from '../components/ui'
import type { Employee, Location, KioskoConfig } from '../types'
import {
  employeesForKiosko, hasOpenShift, nextClockType, checkPin,
  getCurrentPosition, buildClockEntry,
  loadKioskoConfig, saveKioskoConfig, defaultKioskoConfig,
  coordsForLocation, distanceMeters,
} from '../services/fichajeKiosko'

type Step = 'select-employee' | 'enter-pin' | 'confirming' | 'success' | 'error'

export default function KioskoFichajePage() {
  const { locations, staff, setStaff } = useApp()
  const [config, setConfig] = useState<KioskoConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [step, setStep] = useState<Step>('select-employee')
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [resultMsg, setResultMsg] = useState('')
  const [now, setNow] = useState(new Date())

  // Tick reloj
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Cargar config al inicio
  useEffect(() => {
    const saved = loadKioskoConfig()
    if (saved) {
      setConfig(saved)
    } else if (locations.length > 0) {
      const def = defaultKioskoConfig(locations[0].id)
      setConfig(def)
      saveKioskoConfig(def)
    }
  }, [locations])

  const activeLocation: Location | undefined = useMemo(
    () => locations.find(l => l.id === config?.locationId),
    [locations, config],
  )

  const employeesAvail = useMemo(() => {
    if (!config) return []
    return employeesForKiosko(staff, config.locationId)
  }, [staff, config])

  // Volver al inicio tras 4s en pantallas finales
  useEffect(() => {
    if (step === 'success' || step === 'error') {
      const t = setTimeout(() => resetAll(), 4000)
      return () => clearTimeout(t)
    }
  }, [step])

  function resetAll() {
    setStep('select-employee')
    setSelectedEmp(null)
    setPin('')
    setPinError('')
    setResultMsg('')
  }

  function selectEmployee(emp: Employee) {
    if (!emp.pin) {
      setResultMsg(`${emp.name} no tiene PIN asignado. Pide al encargado que lo configure.`)
      setStep('error')
      return
    }
    setSelectedEmp(emp)
    setStep('enter-pin')
  }

  function handlePinDigit(d: string) {
    if (pin.length >= 4) return
    setPin(p => p + d)
    setPinError('')
  }

  function handlePinClear() {
    setPin('')
    setPinError('')
  }

  function handlePinBack() {
    setPin(p => p.slice(0, -1))
    setPinError('')
  }

  // Validar PIN cuando llega a 4 dígitos
  useEffect(() => {
    if (pin.length === 4 && selectedEmp) {
      if (checkPin(selectedEmp, pin)) {
        doClockAction()
      } else {
        setPinError('PIN incorrecto')
        setTimeout(() => {
          setPin('')
          setPinError('')
        }, 1200)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  async function doClockAction() {
    if (!selectedEmp || !activeLocation || !config) return
    setStep('confirming')

    let position: GeolocationPosition | null = null
    try {
      position = await getCurrentPosition()
    } catch (e: unknown) {
      // Si geofencing es obligatorio y no podemos obtener posición, fallar
      if (config.blockOutsideGeofence) {
        setResultMsg('No se pudo obtener tu ubicación. ' + (e instanceof Error ? e.message : ''))
        setStep('error')
        return
      }
    }

    const result = buildClockEntry(selectedEmp, activeLocation, config, position)

    if (config.blockOutsideGeofence && !result.withinGeofence) {
      const distStr = result.distanceM > 0 ? `${Math.round(result.distanceM)}m del local` : 'fuera de zona'
      setResultMsg(`Fichaje bloqueado: estás a ${distStr}. Acércate al local para fichar.`)
      setStep('error')
      return
    }

    // Guardar fichaje
    setStaff(prev => prev.map(e => {
      if (e.id !== selectedEmp.id) return e
      return { ...e, clockEntries: [...(e.clockEntries || []), result.entry] }
    }))

    const verb = result.entry.type === 'entrada' ? 'Entrada' : 'Salida'
    setResultMsg(`✅ ${verb} registrada — ${selectedEmp.name}`)
    setStep('success')
  }

  // ── Pantalla completa y detección de instalación ──────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Detectar si la app está instalada como PWA (standalone)
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari usa una propiedad propia
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true
    setIsStandalone(standalone)

    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (e) {
      console.error('Error en pantalla completa:', e)
    }
  }

  if (!config || !activeLocation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50 p-6">
        <Card className="p-8 max-w-md text-center">
          <p className="text-3xl mb-3">⚙️</p>
          <p className="font-semibold text-gray-700">Configura el kiosko</p>
          <p className="text-sm text-gray-500 mt-1">Necesitas asignar este kiosko a un local activo.</p>
          <Button onClick={() => setShowConfig(true)} className="mt-4">Configurar</Button>
        </Card>
        {showConfig && <ConfigModal config={config || defaultKioskoConfig(locations[0]?.id || '')} locations={locations}
          onSave={c => { setConfig(c); saveKioskoConfig(c); setShowConfig(false) }}
          onCancel={() => setShowConfig(false)} />}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50">
      <KioskoHeader
        location={activeLocation} now={now}
        onConfig={() => setShowConfig(true)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {!isStandalone && !isFullscreen && (
        <InstallBanner onFullscreen={toggleFullscreen} />
      )}

      <div className="max-w-3xl mx-auto px-4 pb-8">
        {step === 'select-employee' && (
          <SelectEmployeeView employees={employeesAvail} onSelect={selectEmployee} />
        )}
        {step === 'enter-pin' && selectedEmp && (
          <PinPadView
            employee={selectedEmp}
            pin={pin}
            error={pinError}
            onDigit={handlePinDigit}
            onClear={handlePinClear}
            onBack={handlePinBack}
            onCancel={resetAll}
          />
        )}
        {step === 'confirming' && (
          <CenteredMessage icon="🛰️" title="Comprobando ubicación..." />
        )}
        {step === 'success' && (
          <CenteredMessage icon="✅" title={resultMsg} sub="Volviendo al inicio..." color="text-green-700" />
        )}
        {step === 'error' && (
          <CenteredMessage icon="❌" title="No se pudo fichar" sub={resultMsg} color="text-red-700" />
        )}
      </div>

      {showConfig && (
        <ConfigModal config={config} locations={locations}
          onSave={c => { setConfig(c); saveKioskoConfig(c); setShowConfig(false); resetAll() }}
          onCancel={() => setShowConfig(false)} />
      )}
    </div>
  )
}

// ── Header del kiosko ─────────────────────────────────────────────────────
function KioskoHeader({ location, now, onConfig, isFullscreen, onToggleFullscreen }: {
  location: Location; now: Date; onConfig: () => void
  isFullscreen: boolean; onToggleFullscreen: () => void
}) {
  return (
    <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide">Kiosko de fichaje</p>
        <p className="font-bold text-gray-900">{location.name}</p>
      </div>
      <div className="text-right">
        <p className="text-3xl font-bold text-gray-900 tabular-nums">
          {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-xs text-gray-400">
          {now.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'long' })}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-3">
        <button onClick={onToggleFullscreen} title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
          {isFullscreen ? '🔲' : '⛶'}
        </button>
        <button onClick={onConfig} title="Configuración del kiosko"
          className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
          ⚙️
        </button>
      </div>
    </div>
  )
}

// ── Banner de instalación / pantalla completa ────────────────────────────
function InstallBanner({ onFullscreen }: { onFullscreen: () => void }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  // Detectar plataforma para mostrar instrucciones específicas
  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
  const isAndroid = /Android/.test(ua)

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-start gap-3">
        <span className="text-2xl shrink-0">📱</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">Convierte esta tablet en kiosko</p>
          {isIOS && (
            <p className="text-xs text-amber-700 mt-1">
              Pulsa <strong>Compartir</strong> abajo y selecciona <strong>"Añadir a pantalla de inicio"</strong>. Después abre la app desde el icono.
            </p>
          )}
          {isAndroid && (
            <p className="text-xs text-amber-700 mt-1">
              Pulsa el menú <strong>⋮</strong> arriba a la derecha y selecciona <strong>"Instalar app"</strong> o <strong>"Añadir a pantalla de inicio"</strong>.
            </p>
          )}
          {!isIOS && !isAndroid && (
            <p className="text-xs text-amber-700 mt-1">
              Pulsa el botón <strong>⛶</strong> de arriba a la derecha para usar pantalla completa, o instala la app desde el menú del navegador.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onFullscreen}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-900 font-medium">
            Pantalla completa
          </button>
          <button onClick={() => setDismissed(true)}
            className="text-xs px-3 py-1 text-amber-600 hover:text-amber-800">
            Ocultar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Selección de empleado ─────────────────────────────────────────────────
function SelectEmployeeView({ employees, onSelect }: {
  employees: Employee[]; onSelect: (e: Employee) => void
}) {
  if (!employees.length) {
    return (
      <div className="mt-12 text-center">
        <p className="text-5xl mb-4">👥</p>
        <p className="font-semibold text-gray-700 text-lg">Sin empleados asignados</p>
        <p className="text-sm text-gray-500 mt-1">Asigna empleados a este local desde Personal.</p>
      </div>
    )
  }
  return (
    <div className="mt-6">
      <p className="text-center text-gray-500 text-sm mb-4">Pulsa tu nombre para fichar</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {employees.map(emp => {
          const open = hasOpenShift(emp)
          const next = nextClockType(emp)
          return (
            <button
              key={emp.id}
              onClick={() => onSelect(emp)}
              className={`p-4 rounded-2xl border-2 transition-all text-left active:scale-95 ${
                open
                  ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
                  : 'bg-white border-gray-200 hover:border-teal-400'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-gray-900 text-sm leading-tight">{emp.name || 'Sin nombre'}</p>
                {open && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 mt-1" />}
              </div>
              <p className="text-xs text-gray-400">{emp.position || '—'}</p>
              <p className={`text-xs font-bold mt-2 ${
                next === 'entrada' ? 'text-teal-700' : 'text-orange-600'
              }`}>
                {next === 'entrada' ? '→ Fichar entrada' : '← Fichar salida'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Pin pad ───────────────────────────────────────────────────────────────
function PinPadView({ employee, pin, error, onDigit, onClear, onBack, onCancel }: {
  employee: Employee; pin: string; error: string
  onDigit: (d: string) => void; onClear: () => void; onBack: () => void; onCancel: () => void
}) {
  const next = nextClockType(employee)
  const verb = next === 'entrada' ? 'Fichar ENTRADA' : 'Fichar SALIDA'
  const verbColor = next === 'entrada' ? 'text-teal-700' : 'text-orange-600'

  return (
    <div className="mt-4 max-w-sm mx-auto">
      <Card className="p-5 text-center">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Hola</p>
        <p className="font-bold text-xl text-gray-900 mt-0.5">{employee.name}</p>
        <p className={`text-sm font-bold mt-1 ${verbColor}`}>{verb}</p>

        <div className="my-5 flex justify-center gap-2">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`w-3.5 h-3.5 rounded-full transition-all ${
              error ? 'bg-red-400' :
              pin.length > i ? 'bg-teal-600' : 'bg-gray-200'
            }`} />
          ))}
        </div>

        {error && <p className="text-sm text-red-600 mb-2 font-medium">{error}</p>}

        <div className="grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <PinKey key={d} onClick={() => onDigit(d)}>{d}</PinKey>
          ))}
          <PinKey onClick={onClear} variant="secondary">C</PinKey>
          <PinKey onClick={() => onDigit('0')}>0</PinKey>
          <PinKey onClick={onBack} variant="secondary">←</PinKey>
        </div>

        <button onClick={onCancel} className="mt-4 text-sm text-gray-500 hover:text-gray-700">
          Cancelar
        </button>
      </Card>
    </div>
  )
}

function PinKey({ children, onClick, variant }: {
  children: React.ReactNode; onClick: () => void; variant?: 'secondary'
}) {
  return (
    <button
      onClick={onClick}
      className={`h-14 rounded-xl text-xl font-semibold transition-all active:scale-95 ${
        variant === 'secondary'
          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          : 'bg-white border-2 border-gray-200 text-gray-900 hover:border-teal-400 hover:bg-teal-50'
      }`}
    >
      {children}
    </button>
  )
}

// ── Mensaje centrado ──────────────────────────────────────────────────────
function CenteredMessage({ icon, title, sub, color }: {
  icon: string; title: string; sub?: string; color?: string
}) {
  return (
    <div className="mt-16 text-center">
      <p className="text-7xl mb-4">{icon}</p>
      <p className={`font-bold text-2xl ${color || 'text-gray-800'}`}>{title}</p>
      {sub && <p className="text-sm text-gray-500 mt-2">{sub}</p>}
    </div>
  )
}

// ── Modal de configuración del kiosko ─────────────────────────────────────
function ConfigModal({ config, locations, onSave, onCancel }: {
  config: KioskoConfig; locations: Location[]
  onSave: (c: KioskoConfig) => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState<KioskoConfig>(config)
  const [testResult, setTestResult] = useState<string>('')
  const activeLoc = locations.find(l => l.id === draft.locationId)

  async function testGps() {
    setTestResult('Obteniendo ubicación...')
    try {
      const pos = await getCurrentPosition()
      if (!activeLoc) { setTestResult('Selecciona un local primero'); return }
      const lc = coordsForLocation(activeLoc)
      if (!lc) { setTestResult(`Tu ubicación: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}. El local no tiene coordenadas configuradas.`); return }
      const d = Math.round(distanceMeters(pos.coords.latitude, pos.coords.longitude, lc.lat, lc.lng))
      const ok = d <= draft.geofenceRadiusM
      setTestResult(`${ok ? '✅' : '❌'} Distancia al local: ${d}m (límite ${draft.geofenceRadiusM}m)`)
    } catch (e: unknown) {
      setTestResult('Error: ' + (e instanceof Error ? e.message : 'desconocido'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
        <p className="font-bold text-gray-900 text-lg mb-4">Configuración del kiosko</p>

        <label className="block text-xs font-medium text-gray-600 mb-1">Local del kiosko</label>
        <select
          value={draft.locationId}
          onChange={e => setDraft(d => ({ ...d, locationId: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-4"
        >
          {locations.filter(l => l.active).map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <label className="block text-xs font-medium text-gray-600 mb-1">Radio de geofencing (metros)</label>
        <input type="number" value={draft.geofenceRadiusM}
          onChange={e => setDraft(d => ({ ...d, geofenceRadiusM: +e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />

        <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
          <input type="checkbox" checked={draft.blockOutsideGeofence}
            onChange={e => setDraft(d => ({ ...d, blockOutsideGeofence: e.target.checked }))} />
          Bloquear fichajes fuera de zona
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
          <input type="checkbox" checked={draft.requirePhoto}
            onChange={e => setDraft(d => ({ ...d, requirePhoto: e.target.checked }))} />
          Pedir foto al fichar (próximamente)
        </label>

        <Button onClick={testGps} variant="outline" size="sm" className="w-full mb-2">
          🛰️ Probar GPS
        </Button>
        {testResult && <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 mb-3">{testResult}</p>}

        <div className="flex gap-2 mt-4">
          <Button onClick={onCancel} variant="outline" className="flex-1">Cancelar</Button>
          <Button onClick={() => onSave(draft)} className="flex-1">Guardar</Button>
        </div>
      </div>
    </div>
  )
}
