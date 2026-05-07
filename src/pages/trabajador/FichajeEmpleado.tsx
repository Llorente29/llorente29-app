// src/pages/trabajador/FichajeEmpleado.tsx
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Card } from '../../components/ui'
import type { Employee, Location } from '../../types'
import {
  getCurrentPosition, distanceMeters, coordsForLocation,
  hasOpenShift, nextClockType, buildClockEntry, defaultKioskoConfig,
} from '../../services/fichajeKiosko'

const RADIUS_M = 200

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
          if (closest && closest.dist <= RADIUS_M) {
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

  const inZone = distance !== null && distance <= RADIUS_M

  async function doClockAction() {
    if (!selectedLoc || !position) return
    setStep('confirming')

    const config = defaultKioskoConfig(selectedLoc.id)
    const result = buildClockEntry(currentEmp, selectedLoc, config, position)

    if (!result.withinGeofence) {
      setStep('error')
      setErrorMsg(`Estás a ${Math.round(result.distanceM)}m del local. Acércate para fichar.`)
      return
    }

    await addClockEntry(currentEmp.id, result.entry)
    setStep('success')
  }

  // ── RENDER ───────────────────────────────────────────────────────────

  if (step === 'fetching-gps') {
    return (
      <Centered>
        <p className="text-5xl mb-3">🛰️</p>
        <p className="font-semibold text-gray-700">Obteniendo tu ubicación...</p>
        <p className="text-xs text-gray-400 mt-1">Permite el acceso a la ubicación cuando el navegador lo pida</p>
      </Centered>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center">
            <p className="text-5xl mb-3">❌</p>
            <p className="font-semibold text-gray-800 text-lg">No se puede fichar</p>
            <p className="text-sm text-gray-600 mt-3">{errorMsg}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={onBack}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">
                Volver
              </button>
              <button onClick={() => { setStep('idle'); setErrorMsg('') }}
                className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700">
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
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center">
            <p className="text-7xl mb-3">✅</p>
            <p className="font-bold text-2xl text-emerald-800">
              {nextType === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!'}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · {selectedLoc?.name}
            </p>
            <button onClick={onBack}
              className="mt-6 w-full py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">
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
        <p className="text-5xl mb-3">⏳</p>
        <p className="font-semibold text-gray-700">Registrando fichaje...</p>
      </Centered>
    )
  }

  // step === 'idle' — pantalla principal de fichaje
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-4 pb-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Fichaje</p>
            <p className="font-bold text-gray-900">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {/* Selector de local si tiene varios */}
        {allowedLocations.length > 1 && (
          <Card className="p-4 mb-4">
            <p className="text-xs text-gray-500 mb-2">Local donde fichas</p>
            <div className="space-y-2">
              {allowedLocations.map(l => {
                const lc = coordsForLocation(l)
                let dist: number | null = null
                if (lc && position) {
                  dist = distanceMeters(position.coords.latitude, position.coords.longitude, lc.lat, lc.lng)
                }
                const isClose = dist !== null && dist <= RADIUS_M
                return (
                  <button
                    key={l.id}
                    onClick={() => setSelectedLocId(l.id)}
                    className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                      selectedLocId === l.id
                        ? 'bg-teal-50 border-teal-400'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-gray-900 text-sm">{l.name}</p>
                      {dist !== null && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isClose ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
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
          <Card className={`p-4 mb-4 ${inZone ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{inZone ? '📍' : '⚠️'}</span>
              <div className="flex-1">
                <p className={`text-sm font-semibold ${inZone ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {inZone ? 'Estás en la zona del local' : `Estás a ${Math.round(distance)}m del local`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {inZone ? `${Math.round(distance)}m · ${selectedLoc.name}` : 'Acércate hasta menos de 200m para fichar'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {open && (
          <Card className="p-3 mb-4 bg-emerald-50 border-emerald-200">
            <p className="text-xs text-emerald-800 font-medium text-center">
              ⏱️ Tienes una jornada abierta. Pulsa para fichar SALIDA.
            </p>
          </Card>
        )}

        {/* Botón gigante de fichar */}
        <button
          onClick={doClockAction}
          disabled={!inZone || !selectedLoc}
          className={`w-full py-12 rounded-3xl text-2xl font-bold transition-all active:scale-95 ${
            !inZone || !selectedLoc
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : nextType === 'entrada'
                ? 'bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg hover:shadow-xl'
                : 'bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-lg hover:shadow-xl'
          }`}
        >
          {nextType === 'entrada' ? '🟢 FICHAR ENTRADA' : '🛑 FICHAR SALIDA'}
        </button>

        {!inZone && selectedLoc && (
          <p className="text-center text-xs text-amber-700 mt-3">
            Acércate al local para activar el botón
          </p>
        )}
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-emerald-50 p-6">
      <div className="text-center">{children}</div>
    </div>
  )
}
