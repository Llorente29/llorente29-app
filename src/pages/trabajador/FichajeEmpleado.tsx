// src/pages/trabajador/FichajeEmpleado.tsx
import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft, MapPin, AlertCircle, AlertTriangle, CheckCircle2, Satellite,
  Clock, Timer, LogIn, LogOut,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee, Location } from '../../types'
import {
  getCurrentPosition, distanceMeters, coordsForLocation,
  hasOpenShift, nextClockType, buildClockEntry, defaultKioskoConfig,
} from '../../services/fichajeKiosko'

const DEFAULT_RADIUS_M = 200  // fallback si el local no tiene radio configurado
const radiusForLoc = (loc: Location | null | undefined) => (loc?.clockRadiusM ?? DEFAULT_RADIUS_M)

interface Props {
  employee: Employee
  onBack: () => void
}

export default function FichajeEmpleado({ employee, onBack }: Props) {
  const { locations, addClockEntry, staff } = useApp()
  const [step, setStep] = useState<'idle' | 'fetching-gps' | 'choosing-location' | 'confirming' | 'success' | 'error'>('idle')
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null)

  // Locales donde puede fichar
  const allowedLocations = useMemo(() => {
    const ids = (employee.assignedLocations && employee.assignedLocations.length > 0)
      ? employee.assignedLocations
      : [employee.locationId]
    return locations.filter(l => l.active && ids.includes(l.id))
  }, [locations, employee])

  // Obtener empleado actualizado del staff (para detectar jornada abierta tras fichar)
  const currentEmp = useMemo(() => staff.find(e => e.id === employee.id) || employee, [staff, employee])
  const open = hasOpenShift(currentEmp)
  const nextType = nextClockType(currentEmp)

  // Obtener GPS al entrar
  useEffect(() => {
    if (step !== 'idle') return
    setStep('fetching-gps')
    getCurrentPosition()
      .then(pos => {
        setPosition(pos)
        // Calcular el local más cercano automáticamente
        if (allowedLocations.length === 1) {
          setSelectedLocId(allowedLocations[0].id)
          setStep('idle')
        } else if (allowedLocations.length > 1) {
          // Auto-seleccionar el más cercano dentro del radio
          const distances = allowedLocations.map(l => {
            const lc = coordsForLocation(l)
            if (!lc) return { loc: l, dist: Infinity }
            return {
              loc: l,
              dist: distanceMeters(pos.coords.latitude, pos.coords.longitude, lc.lat, lc.lng),
            }
          }).sort((a, b) => a.dist - b.dist)
          const closest = distances[0]
          if (closest && closest.dist <= radiusForLoc(closest.loc)) {
            setSelectedLocId(closest.loc.id)
          }
          setStep('idle')
        } else {
          setStep('error')
          setErrorMsg('No tienes ningún local asignado. Contacta con tu encargado.')
        }
      })
      .catch(e => {
        setStep('error')
        setErrorMsg('No se pudo obtener tu ubicación. ' + (e instanceof Error ? e.message : 'Activa el GPS y permite la ubicación en el navegador.'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedLoc: Location | null = selectedLocId ? (allowedLocations.find(l => l.id === selectedLocId) || null) : null

  // Calcular distancia al local seleccionado
  const distance = useMemo(() => {
    if (!position || !selectedLoc) return null
    const lc = coordsForLocation(selectedLoc)
    if (!lc) return null
    return distanceMeters(position.coords.latitude, position.coords.longitude, lc.lat, lc.lng)
  }, [position, selectedLoc])

  const inZone = distance !== null && distance <= radiusForLoc(selectedLoc)
  const geofenceMode = selectedLoc?.clockGeofenceMode ?? 'block'
  // En modo 'warn' se puede fichar aunque esté fuera de zona (GPS caprichoso / sin coords).
  const canClock = !!selectedLoc && (inZone || geofenceMode === 'warn')

  async function doClockAction() {
    if (!selectedLoc || !position) return
    setStep('confirming')

    // El radio efectivo viene del local (no del kiosko fijo).
    const config = { ...defaultKioskoConfig(selectedLoc.id), geofenceRadiusM: radiusForLoc(selectedLoc) }
    const result = buildClockEntry(currentEmp, selectedLoc, config, position)

    if (!result.withinGeofence && geofenceMode === 'block') {
      setStep('error')
      setErrorMsg(`Estás a ${Math.round(result.distanceM)}m del local. Acércate para fichar.`)
      return
    }

    // Modo 'warn': se ficha aunque esté fuera de zona, pero queda marcado con la
    // distancia para que el manager pueda revisarlo (GPS caprichoso / sin coords).
    const entry = (!result.withinGeofence && geofenceMode === 'warn')
      ? { ...result.entry, address: `Fuera de zona · ${Math.round(result.distanceM)}m` }
      : result.entry

    await addClockEntry(currentEmp.id, entry)
    setStep('success')
  }

  // ── RENDER ───────────────────────────────────────────────────────────

  if (step === 'fetching-gps') {
    return (
      <Centered>
        <div className="flex justify-center mb-3">
          <Satellite size={48} className="text-accent" />
        </div>
        <p className="font-semibold text-text-primary">Obteniendo tu ubicación...</p>
        <p className="text-xs text-text-secondary mt-1">Permite el acceso a la ubicación cuando el navegador lo pida</p>
      </Centered>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center">
            <div className="flex justify-center mb-3">
              <AlertCircle size={48} className="text-danger" />
            </div>
            <p className="font-semibold text-text-primary text-lg">No se puede fichar</p>
            <p className="text-sm text-text-secondary mt-3">{errorMsg}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={onBack}
                className="flex-1 py-3 rounded-xl bg-accent-bg text-text-primary font-medium hover:bg-page transition-base">
                Volver
              </button>
              <button onClick={() => { setStep('idle'); setErrorMsg('') }}
                className="flex-1 py-3 rounded-xl bg-accent text-text-on-accent font-medium hover:bg-accent-hover transition-base">
                Reintentar
              </button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center">
            <div className="flex justify-center mb-3">
              <CheckCircle2 size={72} className="text-success" />
            </div>
            <p className="font-bold text-2xl text-success">
              {nextType === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!'}
            </p>
            <p className="text-sm text-text-secondary mt-2">
              {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · {selectedLoc?.name}
            </p>
            <button onClick={onBack}
              className="mt-6 w-full py-3 rounded-xl bg-success text-text-on-accent font-medium hover:opacity-90 transition-base">
              Volver al inicio
            </button>
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'confirming') {
    return (
      <Centered>
        <div className="flex justify-center mb-3">
          <Timer size={48} className="text-accent" />
        </div>
        <p className="font-semibold text-text-primary">Registrando fichaje...</p>
      </Centered>
    )
  }

  // step === 'idle' — pantalla principal de fichaje
  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={onBack}
            className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
            aria-label="Volver"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="text-xs text-text-secondary uppercase tracking-wide">Fichaje</p>
            <p className="font-bold text-text-primary">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {/* Selector de local si tiene varios */}
        {allowedLocations.length > 1 && (
          <Card className="p-4 mb-4">
            <p className="text-xs text-text-secondary mb-2">Local donde fichas</p>
            <div className="space-y-2">
              {allowedLocations.map(l => {
                const lc = coordsForLocation(l)
                let dist: number | null = null
                if (lc && position) {
                  dist = distanceMeters(position.coords.latitude, position.coords.longitude, lc.lat, lc.lng)
                }
                const isClose = dist !== null && dist <= radiusForLoc(l)
                return (
                  <button
                    key={l.id}
                    onClick={() => setSelectedLocId(l.id)}
                    className={`w-full p-3 rounded-xl border-2 text-left transition-base ${
                      selectedLocId === l.id
                        ? 'bg-accent-bg border-accent'
                        : 'bg-card border-border-default hover:border-accent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-text-primary text-sm">{l.name}</p>
                      {dist !== null && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isClose ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                        }`}>
                          {Math.round(dist)}m
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
        )}

        {/* Estado de ubicación */}
        {selectedLoc && distance !== null && (
          <Card className={`p-4 mb-4 ${inZone ? 'bg-success-bg border-success/30' : 'bg-warning-bg border-warning/30'}`}>
            <div className="flex items-center gap-3">
              {inZone
                ? <MapPin size={24} className="text-success shrink-0" />
                : <AlertTriangle size={24} className="text-warning shrink-0" />}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${inZone ? 'text-success' : 'text-warning'}`}>
                  {inZone ? 'Estás en la zona del local' : `Estás a ${Math.round(distance)}m del local`}
                </p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {inZone
                    ? `${Math.round(distance)}m · ${selectedLoc.name}`
                    : geofenceMode === 'warn'
                      ? 'Puedes fichar igualmente; quedará marcado para revisión.'
                      : 'Acércate al local para fichar'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {open && (
          <Card className="p-3 mb-4 bg-success-bg border-success/30">
            <p className="text-xs text-success font-medium text-center inline-flex items-center justify-center gap-1 w-full">
              <Clock size={12} /> Tienes una jornada abierta. Pulsa para fichar SALIDA.
            </p>
          </Card>
        )}

        {/* Botón gigante de fichar */}
        <button
          onClick={doClockAction}
          disabled={!canClock}
          className={`inline-flex items-center justify-center gap-3 w-full py-12 rounded-2xl text-2xl font-bold transition-base active:scale-95 ${
            !canClock
              ? 'bg-page text-text-secondary cursor-not-allowed'
              : nextType === 'entrada'
                ? 'bg-accent text-text-on-accent shadow-lg hover:bg-accent-hover'
                : 'bg-danger text-text-on-accent shadow-lg hover:opacity-90'
          }`}
        >
          {nextType === 'entrada' ? <><LogIn size={28} /> FICHAR ENTRADA</> : <><LogOut size={28} /> FICHAR SALIDA</>}
        </button>

        {!inZone && selectedLoc && geofenceMode === 'block' && (
          <p className="text-center text-xs text-warning mt-3 inline-flex items-center justify-center gap-1 w-full">
            <AlertTriangle size={11} /> Acércate al local para activar el botón
          </p>
        )}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page p-6">
      <div className="text-center">{children}</div>
    </div>
  )
}
