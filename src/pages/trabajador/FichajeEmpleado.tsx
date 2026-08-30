// src/pages/trabajador/FichajeEmpleado.tsx
import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft, MapPin, AlertCircle, AlertTriangle, CheckCircle2, Satellite,
  Clock, Timer, LogIn, LogOut,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { fetchEmployeeClockStatus } from '../../services/teamHoursService'
import type { EmployeeClockStatus } from '../../services/teamHoursService'
import { mensajeDeFalloDeFichaje } from '../../services/supabaseSync'
import { Card } from '../../components/ui'
import type { Employee, Location } from '../../types'
import {
  getCurrentPosition, distanceMeters, coordsForLocation,
  hasOpenShift, nextClockType, buildClockEntry, defaultKioskoConfig,
  avisoDeContexto, horaCorta,
} from '../../services/fichajeKiosko'
import type { AvisoContexto } from '../../services/fichajeKiosko'
import type { CalendarContext, ScheduledShift, ShiftTypeInfo } from '../../services/horasComputo'
import { listShiftTemplates, getSchedule } from '../../services/schedulerService'
import { getMondayOfWeek, toISODate, shiftDurationHours } from '../../types/scheduler'
import { fetchAppSettings } from '../../services/appSettingsService'

const DEFAULT_RADIUS_M = 200  // fallback si el local no tiene radio configurado
const radiusForLoc = (loc: Location | null | undefined) => (loc?.clockRadiusM ?? DEFAULT_RADIUS_M)

// Donde se ficha: 'in' (en zona) · 'outside' (fuera, marca la distancia) ·
// 'nogps' (sin ubicacion). La salida anticipada NO es un modo: es una marca
// aparte, porque se puede salir antes de hora Y estar fuera de zona a la vez.
type ClockMode = 'in' | 'outside' | 'nogps'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function FichajeEmpleado({ employee, onBack }: Props) {
  const { locations, addClockEntry, staff } = useApp()
  const [step, setStep] = useState<'idle' | 'fetching-gps' | 'choosing-location' | 'confirming' | 'warn-confirm' | 'early-confirm' | 'contexto-confirm' | 'success' | 'error'>('idle')
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [pendingDist, setPendingDist] = useState(0)
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null)

  // Redondeo: contexto del calendario publicado (turno teórico de HOY) + tolerancia.
  // Sin esto, buildClockEntry no puede redondear (no sabe el horario teórico).
  const [calendarCtx, setCalendarCtx] = useState<CalendarContext | undefined>(undefined)
  const [roundingToleranceMin, setRoundingToleranceMin] = useState(8)
  // Turno teórico de HOY en minutos desde 00:00 (para avisos de fichaje anticipado).
  const [todayShift, setTodayShift] = useState<{ startMin: number; endMin: number; start: string; end: string } | null>(null)
  // Aviso de fichaje anticipado pendiente de confirmación.
  const [earlyWarn, setEarlyWarn] = useState<null | {
    kind: 'entrada' | 'salida'; theoreticalTime: string; minutesEarly: number
    mode: ClockMode; distM: number
  }>(null)
  // AVISO DE CONTEXTO (30/08). La app decide sola el tipo del fichaje -- hay un
  // solo boton -- asi que cuando el contexto es raro tiene que enseñar QUE va a
  // escribir antes de escribirlo. Informa y deja pasar: quien confirma, ficha.
  const [ctxWarn, setCtxWarn] = useState<
    null | (AvisoContexto & { mode: ClockMode; distM: number; earlyExitMin?: number })
  >(null)
  // Lo ULTIMO escrito de verdad, para que la pantalla de exito no diga
  // "entrada" cuando se corrigio a salida.
  const [written, setWritten] = useState<null | { type: 'entrada' | 'salida'; datetime: string }>(null)

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
      .catch(() => {
        // GPS no disponible (permiso denegado / timeout): NO bloqueamos. Dejamos elegir
        // local y fichar igual, marcando "sin ubicación" para revisión. El GPS de
        // navegador falla a menudo (WiFi/red); bloquear dejaría al empleado sin fichar.
        setPosition(null)
        if (allowedLocations.length === 1) setSelectedLocId(allowedLocations[0].id)
        if (allowedLocations.length === 0) {
          setStep('error')
          setErrorMsg('No tienes ningún local asignado. Contacta con tu encargado.')
        } else {
          setStep('idle')
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cargar el turno PUBLICADO del empleado para HOY + la tolerancia de redondeo.
  // Construye el CalendarContext que buildClockEntry necesita para redondear al
  // horario teórico. Modelo A: solo cuenta el horario publicado.
  useEffect(() => {
    let cancel = false
    async function loadRoundingCtx() {
      // Local donde va a fichar (si aún no eligió, usa el primero permitido).
      const locId = selectedLocId
        || (allowedLocations.length === 1 ? allowedLocations[0].id : employee.locationId)
      if (!locId) return

      const today = new Date()
      const weekStart = toISODate(getMondayOfWeek(today))
      // scheduler: 0=lunes..6=domingo ; JS getDay(): 0=domingo..6=sábado
      const schedulerDay = (today.getDay() + 6) % 7

      const [settings, templates, schedule] = await Promise.all([
        fetchAppSettings(),
        listShiftTemplates(locId),
        getSchedule(locId, weekStart),
      ])
      if (cancel) return

      setRoundingToleranceMin(settings.roundingToleranceMin ?? 8)

      // Solo el horario PUBLICADO cuenta (Modelo A). Borrador → sin redondeo.
      if (!schedule || schedule.status !== 'published') {
        setCalendarCtx(undefined)
        return
      }

      // Buscar el turno de HOY donde este empleado está asignado.
      const typesById = new Map<string, ShiftTypeInfo>()
      const assignmentsByDate = new Map<string, ScheduledShift | null>()
      const todayIso = toISODate(today)

      const cells = schedule.cells || {}
      // Recoger TODOS los turnos del empleado hoy (puede tener varios: mañana y noche).
      const myTemplateIds: string[] = []
      for (const tid of Object.keys(cells)) {
        const dayCell = cells[tid]?.[String(schedulerDay)]
        if (dayCell && dayCell.includes(employee.id)) {
          myTemplateIds.push(tid)
        }
      }

      // Referencia horaria para elegir el turno correcto:
      // - si ya tiene entrada abierta (va a fichar salida) → su hora de entrada real
      // - si no (va a fichar entrada) → la hora actual
      const openEntry = (currentEmp.clockEntries || [])
        .filter(e => !e.voided && e.type === 'entrada' && e.datetime.slice(0, 10) === todayIso)
        .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())[0]
      const refDate = openEntry ? new Date(openEntry.datetime) : today
      const refMin = refDate.getHours() * 60 + refDate.getMinutes()

      // Elegir el turno cuyo start_time esté MÁS CERCA de la referencia.
      let myTemplateId: string | null = null
      let bestDist = Infinity
      for (const tid of myTemplateIds) {
        const t = templates.find(x => x.id === tid)
        if (!t) continue
        const [sh, sm] = t.start_time.slice(0, 5).split(':').map(Number)
        const startMin = sh * 60 + sm
        const dist = Math.abs(refMin - startMin)
        if (dist < bestDist) {
          bestDist = dist
          myTemplateId = tid
        }
      }

      if (myTemplateId) {
        const t = templates.find(x => x.id === myTemplateId)
        if (t) {
          const start = t.start_time.slice(0, 5)
          const end = t.end_time.slice(0, 5)
          typesById.set(myTemplateId, {
            startTime: start,
            endTime: end,
            hours: shiftDurationHours(start, end),
            isOff: false,
          })
          assignmentsByDate.set(todayIso, { shiftTypeId: myTemplateId })
          // Guardar el turno de hoy en minutos para los avisos de fichaje anticipado.
          const [sh, sm] = start.split(':').map(Number)
          const [eh, em] = end.split(':').map(Number)
          const startMin = sh * 60 + sm
          let endMin = eh * 60 + em
          if (endMin <= startMin) endMin += 24 * 60  // cruce medianoche
          setTodayShift({ startMin, endMin, start, end })
        } else {
          setTodayShift(null)
        }
      } else {
        setTodayShift(null)
      }

      setCalendarCtx({ assignmentsByDate, typesById })
    }
    loadRoundingCtx()
    return () => { cancel = true }
  }, [selectedLocId, allowedLocations, employee.id, employee.locationId, currentEmp.clockEntries])

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

  // Margen (min) para avisar de salida anticipada. Independiente del redondeo.
  const EARLY_EXIT_WARN_MIN = 3

  // ¿Hay que avisar de fichaje anticipado? Devuelve el aviso o null.
  // - Entrada antes de su hora (más de la tolerancia): avisa que se redondeará.
  // - Salida antes de su hora (más de 3 min): avisa siempre, sin importar cuánto.
  function earlyClockWarning(type: 'entrada' | 'salida'): null | { kind: 'entrada' | 'salida'; theoreticalTime: string; minutesEarly: number } {
    if (!todayShift) return null
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()

    if (type === 'entrada') {
      const diff = todayShift.startMin - nowMin  // positivo = llega antes
      if (diff > roundingToleranceMin) {
        return { kind: 'entrada', theoreticalTime: todayShift.start, minutesEarly: diff }
      }
    } else {
      // salida: comparar contra endMin (ojo cruce medianoche: si el turno cruta las 00:00,
      // endMin puede ser > 1440; ajustamos nowMin al mismo marco si ya pasó medianoche)
      let effNowMin = nowMin
      if (todayShift.endMin > 24 * 60 && nowMin < todayShift.startMin) effNowMin += 24 * 60
      const diff = todayShift.endMin - effNowMin  // positivo = sale antes
      if (diff >= EARLY_EXIT_WARN_MIN) {
        return { kind: 'salida', theoreticalTime: todayShift.end, minutesEarly: diff }
      }
    }
    return null
  }

  function doClockAction() {
    if (!selectedLoc) return

    // Sin GPS (permiso denegado / timeout): en warn se ficha igual, marcando "sin
    // ubicación". Nunca bloquea.
    if (!position) {
      void tramitar('nogps', 0)
      return
    }

    const config = { ...defaultKioskoConfig(selectedLoc.id), geofenceRadiusM: radiusForLoc(selectedLoc) }
    const result = buildClockEntry(currentEmp, selectedLoc, config, position, undefined, roundingToleranceMin, calendarCtx)

    if (!result.withinGeofence && geofenceMode === 'block') {
      setStep('error')
      setErrorMsg(`Estás a ${Math.round(result.distanceM)}m del local. Acércate para fichar.`)
      return
    }

    // Modo 'warn' y FUERA de zona: no fichamos directo. Mostramos un aviso rojo muy
    // visible y exigimos confirmación explícita (fricción + transparencia). El fichaje
    // queda igualmente marcado con la distancia para el manager.
    if (!result.withinGeofence && geofenceMode === 'warn') {
      setPendingDist(Math.round(result.distanceM))
      setStep('warn-confirm')
      return
    }

    // Dentro de zona: sigue por el embudo normal (anticipado → contexto → escribir).
    void tramitar('in', 0)
  }

  /**
   * Embudo único: aviso de fichaje anticipado primero, aviso de contexto después
   * (es el último antes de escribir, y por eso lo comprueban TODOS los caminos,
   * incluido el de confirmar una salida anticipada).
   */
  async function tramitar(mode: ClockMode, distM: number) {
    const warn = earlyClockWarning(nextType)
    if (warn) {
      setEarlyWarn({ ...warn, mode, distM })
      setStep('early-confirm')
      return
    }
    await comprobarContextoYEscribir(mode, distM)
  }

  /**
   * AVISO DE CONTEXTO. La app decide sola el tipo del fichaje — hay UN solo botón —
   * así que antes de escribir enseña QUÉ va a escribir cuando el contexto es raro.
   * El contexto se lee EN VIVO de employee_clock_status al pulsar, NUNCA del array
   * hidratado: esa fue la lección de la ficha del empleado del 29/08, donde cuatro
   * personas que estaban trabajando leían "Sin entrada" porque se dedujo del array.
   * Informa y deja pasar: quien confirma, ficha.
   */
  async function comprobarContextoYEscribir(mode: ClockMode, distM: number, earlyExitMin?: number) {
    setStep('confirming')
    let status: EmployeeClockStatus | null
    try {
      status = await fetchEmployeeClockStatus(currentEmp.id)
    } catch {
      status = null
    }
    // Si la BBDD no contesta no inventamos contexto ni bloqueamos: se ficha como
    // siempre. El trigger de orden sigue siendo la última defensa.
    const warn = status ? avisoDeContexto(nextType, status) : null
    if (warn) {
      setCtxWarn({ ...warn, mode, distM, earlyExitMin })
      setStep('contexto-confirm')
      return
    }
    await writeEntry(mode, distM, { earlyExitMin })
  }

  // Escribe el fichaje. mode: dónde ficha. earlyExitMin: salida anticipada
  // confirmada (hora real, sin redondear hacia arriba, marcada para el manager).
  // forzarTipo: la persona ha corregido el tipo contra el estado real de la BBDD.
  async function writeEntry(
    mode: ClockMode, distM: number,
    opts: { forzarTipo?: 'entrada' | 'salida'; earlyExitMin?: number } = {},
  ) {
    if (!selectedLoc) return
    const { forzarTipo, earlyExitMin } = opts
    setStep('confirming')
    const config = { ...defaultKioskoConfig(selectedLoc.id), geofenceRadiusM: radiusForLoc(selectedLoc) }
    // En salida anticipada NO pasamos calendarCtx: así buildClockEntry no redondea
    // hacia la hora teórica (regalaría minutos no trabajados). Se guarda la hora real.
    // Al forzar el tipo tampoco: el redondeo se calculó para el tipo contrario.
    const ctxForBuild = (earlyExitMin != null || forzarTipo) ? undefined : calendarCtx
    const result = buildClockEntry(currentEmp, selectedLoc, config, position, undefined, roundingToleranceMin, ctxForBuild)
    let entry = result.entry
    const marcas: string[] = []
    if (mode === 'outside') marcas.push(`Fuera de zona · ${distM}m`)
    else if (mode === 'nogps') marcas.push('Sin ubicación (GPS no disponible)')
    if (earlyExitMin != null) marcas.push(`Salida anticipada · ${earlyExitMin} min antes`)
    if (forzarTipo && forzarTipo !== entry.type) {
      marcas.push(`Corregido por el trabajador · la app ofrecía ${entry.type}`)
      entry = {
        ...entry,
        type: forzarTipo,
        datetime: entry.realDatetime || entry.datetime,
        scheduled: undefined,
        roundingApplied: false,
        diffMinutes: 0,
      }
    }
    if (marcas.length > 0) entry = { ...entry, address: marcas.join(' · ') }

    // Hasta el 30/08 esto era `await addClockEntry(...)` seguido de `setStep('success')`
    // pasara lo que pasara: si la BBDD rechazaba la fila, la pantalla decía
    // "¡Entrada registrada!" igual y el fichaje no existía. Regla 8.
    try {
      await addClockEntry(currentEmp.id, entry)
    } catch (e) {
      console.error('[fichaje] escritura rechazada:', e)
      setErrorMsg(mensajeDeFalloDeFichaje(e))
      setStep('error')
      return
    }
    setWritten({ type: entry.type, datetime: entry.datetime })
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

  if (step === 'warn-confirm') {
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center border-2 border-danger">
            <div className="flex justify-center mb-3">
              <AlertTriangle size={56} className="text-danger" />
            </div>
            <p className="font-bold text-danger text-xl">Estás fichando FUERA del local</p>
            <p className="text-3xl font-extrabold text-danger mt-2">a {pendingDist} m</p>
            <p className="text-sm text-text-secondary mt-3">
              Estás a {pendingDist} metros de <b>{selectedLoc?.name}</b>. El fichaje se registrará
              con esta distancia y tu encargado podrá verlo. Ficha solo si de verdad estás en el local.
            </p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setStep('idle')}
                className="flex-1 py-3 rounded-xl bg-accent-bg text-text-primary font-medium hover:bg-page transition-base">
                Cancelar
              </button>
              <button
                onClick={() => { void tramitar('outside', pendingDist) }}
                className="flex-1 py-3 rounded-xl bg-danger text-text-on-accent font-bold hover:opacity-90 transition-base">
                Fichar igualmente
              </button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'early-confirm' && earlyWarn) {
    const isEntry = earlyWarn.kind === 'entrada'
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className={`p-6 text-center border-2 ${isEntry ? 'border-warning' : 'border-danger'}`}>
            <div className="flex justify-center mb-3">
              {isEntry
                ? <Clock size={56} className="text-warning" />
                : <AlertTriangle size={56} className="text-danger" />}
            </div>
            {isEntry ? (
              <>
                <p className="font-bold text-warning text-xl">Fichas antes de tu turno</p>
                <p className="text-sm text-text-secondary mt-3">
                  Tu turno empieza a las <b>{earlyWarn.theoreticalTime}</b> y llegas
                  {' '}<b>{earlyWarn.minutesEarly} min</b> antes. Se computará desde tu hora
                  de entrada, salvo que sean horas extra aprobadas. Tu hora real queda registrada.
                </p>
                <div className="flex gap-2 mt-6">
                  <button
                    onClick={() => { setEarlyWarn(null); setStep('idle') }}
                    className="flex-1 py-3 rounded-xl bg-accent-bg text-text-primary font-medium hover:bg-page transition-base">
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      const w = earlyWarn; setEarlyWarn(null)
                      void comprobarContextoYEscribir(w.mode, w.distM)
                    }}
                    className="flex-1 py-3 rounded-xl bg-accent text-text-on-accent font-bold hover:bg-accent-hover transition-base">
                    Entendido, fichar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="font-bold text-danger text-xl">Sales antes de tu hora</p>
                <p className="text-3xl font-extrabold text-danger mt-2">faltan {earlyWarn.minutesEarly} min</p>
                <p className="text-sm text-text-secondary mt-3">
                  Tu turno acaba a las <b>{earlyWarn.theoreticalTime}</b>. Si fichas salida ahora,
                  se registrará tu hora real y tu encargado podrá verlo. ¿Seguro que te vas?
                </p>
                <div className="flex gap-2 mt-6">
                  <button
                    onClick={() => { setEarlyWarn(null); setStep('idle') }}
                    className="flex-1 py-3 rounded-xl bg-accent-bg text-text-primary font-medium hover:bg-page transition-base">
                    No, cancelar
                  </button>
                  <button
                    onClick={() => {
                      const w = earlyWarn; setEarlyWarn(null)
                      void comprobarContextoYEscribir(w.mode, w.distM, w.minutesEarly)
                    }}
                    className="flex-1 py-3 rounded-xl bg-danger text-text-on-accent font-bold hover:opacity-90 transition-base">
                    Sí, me voy
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'contexto-confirm' && ctxWarn) {
    const cerrar = () => { setCtxWarn(null); setStep('idle') }
    return (
      <div className="min-h-screen bg-page p-4">
        <div className="max-w-md mx-auto pt-12">
          <Card className="p-6 text-center border-2 border-warning">
            <div className="flex justify-center mb-3">
              <AlertTriangle size={56} className="text-warning" />
            </div>
            <p className="font-bold text-warning text-xl">{ctxWarn.titulo}</p>
            <p className="text-sm text-text-secondary mt-3">{ctxWarn.texto}</p>
            <div className="mt-6 space-y-2">
              <button
                onClick={() => {
                  const w = ctxWarn; setCtxWarn(null)
                  void writeEntry(w.mode, w.distM, { earlyExitMin: w.earlyExitMin })
                }}
                className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-bold hover:bg-accent-hover transition-base">
                Sí, fichar {ctxWarn.accion === 'entrada' ? 'ENTRADA' : 'SALIDA'}
              </button>
              {ctxWarn.alternativa && (
                <button
                  onClick={() => {
                    const w = ctxWarn; setCtxWarn(null)
                    void writeEntry(w.mode, w.distM, { forzarTipo: w.alternativa!, earlyExitMin: w.earlyExitMin })
                  }}
                  className="w-full py-3 rounded-xl bg-danger text-text-on-accent font-bold hover:opacity-90 transition-base">
                  No, fichar {ctxWarn.alternativa === 'entrada' ? 'ENTRADA' : 'SALIDA'}
                </button>
              )}
              <button
                onClick={cerrar}
                className="w-full py-3 rounded-xl bg-accent-bg text-text-primary font-medium hover:bg-page transition-base">
                Cancelar
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
              {(written?.type ?? nextType) === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!'}
            </p>
            <p className="text-sm text-text-secondary mt-2">
              {horaCorta(written ? new Date(written.datetime) : new Date())} · {selectedLoc?.name}
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
