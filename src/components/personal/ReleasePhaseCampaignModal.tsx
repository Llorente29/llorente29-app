// src/components/personal/ReleasePhaseCampaignModal.tsx
// Formación — Lanzamiento, Pieza A: la "campaña". Liberar una fase concreta
// (no necesariamente "la siguiente") a todo un local y/o puesto de una vez.
// docs/folvy_formacion_itinerario_fases_rediseno.md §2.3 — caso real: "la
// formación de igualdad, a todo el equipo de Alcalá".
//
// Previsualiza ANTES de confirmar (nunca lanzar a ciegas: toca a mucha gente
// a la vez) y es idempotente — lanzar la misma campaña dos veces no duplica
// ni reinicia plazos de quien ya la tenía (lo garantiza release_phase_for_group
// en el servidor; aquí solo se refleja en el conteo "ya la tienen").

import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Select, Alert, Label } from '../ui'
import { useApp } from '../../context/AppContext'
import {
  listTrainingPaths, listPhaseProgressForPath, releasePhaseForGroup,
  type TrainingPathSummary, type TrainingPhaseName, type ReleasePhaseForGroupResult,
} from '../../services/trainingPathService'

const PHASE_OPTIONS: { value: TrainingPhaseName; label: string }[] = [
  { value: 'dia_1', label: 'Fase 1 (día 1)' },
  { value: 'dias_30', label: 'Fase 2 (30 días)' },
  { value: 'dias_90', label: 'Fase 3 (90 días)' },
]

interface Props {
  onClose: () => void
}

export default function ReleasePhaseCampaignModal({ onClose }: Props) {
  const { activeAccountId, staff, locations } = useApp()
  const [paths, setPaths] = useState<TrainingPathSummary[]>([])
  const [pathId, setPathId] = useState('')
  const [phase, setPhase] = useState<TrainingPhaseName>('dia_1')
  const [locationId, setLocationId] = useState('')
  const [role, setRole] = useState('')
  const [progressMap, setProgressMap] = useState<Map<string, string>>(new Map())
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [pathsError, setPathsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReleasePhaseForGroupResult | null>(null)

  const positions = useMemo(() => [...new Set(staff.map(e => e.position).filter(Boolean))].sort(), [staff])

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    listTrainingPaths(activeAccountId)
      .then(ps => { if (cancel) return; setPaths(ps); if (ps.length > 0) setPathId(p => p || ps[0].id) })
      .catch(() => { if (!cancel) setPathsError('No se pudieron cargar los itinerarios') })
    return () => { cancel = true }
  }, [activeAccountId])

  useEffect(() => {
    if (!pathId) { setProgressMap(new Map()); return }
    let cancel = false
    setLoadingPreview(true)
    listPhaseProgressForPath(pathId, phase)
      .then(m => { if (!cancel) setProgressMap(m) })
      .catch(() => { if (!cancel) setProgressMap(new Map()) })
      .finally(() => { if (!cancel) setLoadingPreview(false) })
    return () => { cancel = true }
  }, [pathId, phase])

  // Mismo criterio de coincidencia que release_phase_for_group en el
  // servidor (activo + local/puesto), acotado además a quien YA tiene esta
  // fase en su itinerario (progressMap.has) -- si el itinerario no le
  // aplica, ni cuenta ni se toca, igual que en la RPC.
  const matched = useMemo(() => {
    return staff.filter(e =>
      e.active
      && (!locationId || e.locationId === locationId)
      && (!role || e.position === role)
      && progressMap.has(e.id),
    )
  }, [staff, locationId, role, progressMap])

  const toRelease = matched.filter(e => progressMap.get(e.id) === 'pendiente')
  const alreadyDone = matched.length - toRelease.length
  const hasFilter = !!locationId || !!role
  const canSubmit = !!activeAccountId && !!pathId && hasFilter && !busy && !loadingPreview && toRelease.length > 0

  async function handleConfirm() {
    if (!activeAccountId || !pathId) return
    setBusy(true)
    setError(null)
    try {
      const res = await releasePhaseForGroup(activeAccountId, pathId, phase, {
        locationId: locationId || undefined,
        role: role || undefined,
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo lanzar la campaña')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Liberar una fase a un grupo">
      <div className="space-y-4">
        {result ? (
          <>
            <Alert type="success">
              Fase liberada a {result.released} persona{result.released === 1 ? '' : 's'}.
              {result.alreadyReleased > 0 && (
                <> {result.alreadyReleased} ya la tení{result.alreadyReleased === 1 ? 'a' : 'an'} liberada y no se {result.alreadyReleased === 1 ? 'vio' : 'vieron'} afectad{result.alreadyReleased === 1 ? 'a' : 'as'}.</>
              )}
            </Alert>
            <Button className="w-full" onClick={onClose}>Cerrar</Button>
          </>
        ) : (
          <>
            {pathsError && <Alert type="error">{pathsError}</Alert>}
            {error && <Alert type="error">{error}</Alert>}

            <div>
              <Label>Itinerario</Label>
              <Select className="mt-1" value={pathId} onChange={e => setPathId(e.target.value)}>
                {paths.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>

            <div>
              <Label>Fase a liberar</Label>
              <Select className="mt-1" value={phase} onChange={e => setPhase(e.target.value as TrainingPhaseName)}>
                {PHASE_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Local</Label>
                <Select className="mt-1" value={locationId} onChange={e => setLocationId(e.target.value)}>
                  <option value="">(cualquiera)</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Puesto</Label>
                <Select className="mt-1" value={role} onChange={e => setRole(e.target.value)}>
                  <option value="">(cualquiera)</option>
                  {positions.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
            </div>
            {!hasFilter && (
              <p className="text-xs text-warning">Indica al menos un local o un puesto — no se puede lanzar a toda la cuenta de golpe.</p>
            )}

            <div className="bg-page rounded-lg p-3 text-sm min-h-[2.5rem] flex items-center">
              {!hasFilter ? (
                <p className="text-text-secondary">Elige un local o un puesto para ver a quién afecta.</p>
              ) : loadingPreview ? (
                <p className="text-text-secondary">Calculando a quién afecta…</p>
              ) : matched.length === 0 ? (
                <p className="text-text-secondary">Nadie con este itinerario encaja con el filtro.</p>
              ) : (
                <p className="text-text-primary">
                  Se liberará la fase a <strong>{toRelease.length}</strong> persona{toRelease.length === 1 ? '' : 's'}.
                  {alreadyDone > 0 && (
                    <> {alreadyDone} ya la tiene{alreadyDone === 1 ? '' : 'n'} liberada y no se {alreadyDone === 1 ? 'verá' : 'verán'} afectad{alreadyDone === 1 ? 'a' : 'as'}.</>
                  )}
                </p>
              )}
            </div>

            <Button className="w-full" disabled={!canSubmit} onClick={handleConfirm}>
              {busy ? 'Liberando…' : 'Confirmar y liberar'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
