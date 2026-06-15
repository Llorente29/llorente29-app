// src/pages/trabajador/MiAutoinventario.tsx
// Autoinventario en el móvil del TRABAJADOR — wizard guiado paso a paso.
//
// Pensado para formación BAJA o NULA: un artículo por pantalla, frases cortas,
// botón grande, teclado numérico directo, cero jerga. El trabajador SOLO cuenta;
// no ve el stock del sistema, ni variación, ni %, ni € (eso es del gestor). El
// conteo lo cierra y aprueba el gestor en su pantalla; aquí no hay "aprobar".
//
// Aviso de variación (paso 3): antes de avanzar, el SERVIDOR compara lo tecleado
// contra el stock esperado sin enseñarlo (blind) y devuelve solo un veredicto;
// si se sale de lo normal (un cero de más/menos), se le pregunta con suavidad
// si quiere volver a contar. Caza el error de dedo sin frustrar.

import { useEffect, useState } from 'react'
import { ArrowLeft, AlertTriangle, Check, Loader2, Boxes } from 'lucide-react'
import type { Employee } from '../../types'
import {
  getMyDailyQueue,
  checkCountVariance,
  type DailyQueueLine,
} from '../../modules/supply/services/autoinventoryService'
import { saveCountedQty } from '../../modules/supply/services/inventoryCountService'

interface Props {
  employee: Employee
  onBack: () => void
}

type Phase = 'loading' | 'intro' | 'counting' | 'warn' | 'done' | 'empty' | 'error'

export default function MiAutoinventario({ employee, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [total, setTotal] = useState(0)        // artículos asignados hoy (8)
  const [doneBefore, setDoneBefore] = useState(0) // ya contados al entrar (reanudar)
  const [queue, setQueue] = useState<DailyQueueLine[]>([]) // los que faltan por contar
  const [idx, setIdx] = useState(0)            // índice dentro de queue
  const [value, setValue] = useState('')       // lo que teclea (texto)
  const [saving, setSaving] = useState(false)
  const [warnKind, setWarnKind] = useState<'low' | 'high'>('low')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        if (!employee.locationId) {
          if (!cancel) setPhase('empty')
          return
        }
        const { lines } = await getMyDailyQueue(employee.locationId, employee.id)
        if (cancel) return
        const pending = lines.filter((l) => l.countedQty == null)
        setTotal(lines.length)
        setDoneBefore(lines.length - pending.length)
        setQueue(pending)
        setIdx(0)
        if (lines.length === 0) setPhase('empty')
        else if (pending.length === 0) setPhase('done')
        else setPhase('intro')
      } catch (e) {
        if (!cancel) {
          setErrMsg(e instanceof Error ? e.message : 'No se pudo cargar')
          setPhase('error')
        }
      }
    }
    void load()
    return () => {
      cancel = true
    }
  }, [employee.id, employee.locationId])

  const current = queue[idx]
  const stepNumber = doneBefore + idx + 1 // "artículo X de N"
  const progressPct = total > 0 ? Math.round(((doneBefore + idx) / total) * 100) : 0

  function parseValue(): number | null {
    const n = Number(value.replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  // Guarda lo contado y comprueba la variación. Si se sale de lo normal → aviso.
  async function onNext() {
    if (!current) return
    const num = parseValue()
    if (num == null) return
    setSaving(true)
    try {
      await saveCountedQty(current.lineId, num)
      const verdict = await checkCountVariance(current.lineId, num)
      setSaving(false)
      if (verdict === 'low' || verdict === 'high') {
        setWarnKind(verdict)
        setPhase('warn')
        return
      }
      advance()
    } catch (e) {
      setSaving(false)
      setErrMsg(e instanceof Error ? e.message : 'No se pudo guardar')
      setPhase('error')
    }
  }

  // Avanza al siguiente artículo (o termina). Lo contado ya está guardado.
  function advance() {
    setValue('')
    if (idx + 1 >= queue.length) {
      setPhase('done')
    } else {
      setIdx(idx + 1)
      setPhase('counting')
    }
  }

  // ─── Pantallas ───

  if (phase === 'loading') {
    return (
      <Centered>
        <Loader2 size={28} className="text-accent animate-spin" />
        <p className="text-sm text-text-secondary mt-3">Cargando…</p>
      </Centered>
    )
  }

  if (phase === 'error') {
    return (
      <Centered>
        <AlertTriangle size={36} className="text-danger" />
        <p className="font-semibold text-text-primary mt-3">No se pudo cargar</p>
        <p className="text-sm text-text-secondary mt-1 max-w-xs">{errMsg}</p>
        <button
          onClick={onBack}
          className="mt-5 px-5 py-3 rounded-xl bg-accent text-white font-semibold transition-base active:scale-95"
        >
          Volver
        </button>
      </Centered>
    )
  }

  if (phase === 'empty') {
    return (
      <div className="min-h-screen bg-page flex flex-col">
        <Header onBack={onBack} title="Conteo de hoy" />
        <Centered>
          <div className="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center">
            <Check size={32} className="text-success" />
          </div>
          <p className="font-display text-xl text-text-primary mt-4">Hoy no te toca contar</p>
          <p className="text-sm text-text-secondary mt-1 max-w-xs">
            No tienes artículos asignados para hoy. Nada que hacer por aquí.
          </p>
          <button
            onClick={onBack}
            className="mt-6 px-6 py-3 rounded-xl bg-accent text-white font-semibold transition-base active:scale-95"
          >
            Volver
          </button>
        </Centered>
      </div>
    )
  }

  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-page flex flex-col">
        <Header onBack={onBack} title="Conteo de hoy" />
        <div className="flex-1 px-5 pt-2">
          <p className="font-display text-2xl text-text-primary">Hola, {employee.name.split(' ')[0]}</p>
          <p className="text-sm text-text-secondary mt-1">Hoy te toca un conteo rápido</p>

          <div className="mt-6 bg-accent-bg rounded-2xl p-6 text-center">
            <div className="font-display text-5xl text-accent leading-none">{queue.length}</div>
            <div className="text-sm text-accent mt-2">
              {queue.length === 1 ? 'artículo por contar' : 'artículos por contar'}
            </div>
            <div className="text-xs text-accent/80 mt-1">≈ {Math.max(1, Math.round(queue.length * 0.4))} minutos</div>
          </div>

          <p className="text-xs text-text-secondary text-center mt-4">Te lo pido de uno en uno</p>
        </div>
        <div className="px-5 pb-8">
          <button
            onClick={() => setPhase('counting')}
            className="w-full py-4 rounded-2xl bg-accent text-white font-semibold text-lg transition-base active:scale-[0.98]"
          >
            Empezar a contar
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'warn') {
    const less = warnKind === 'low'
    return (
      <div className="min-h-screen bg-page flex flex-col">
        <Header title="Un momento" />
        <div className="flex-1 px-6 pt-6 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-warning-bg flex items-center justify-center">
            <AlertTriangle size={30} className="text-warning" />
          </div>
          <p className="font-display text-xl text-text-primary mt-4 leading-snug">
            Eso es mucho {less ? 'menos' : 'más'}
            <br />
            de lo normal
          </p>
          <p className="text-sm text-text-secondary mt-3 max-w-xs leading-relaxed">
            Has puesto{' '}
            <b className="text-text-primary font-semibold">
              {value} {current?.baseUnit ?? ''}
            </b>{' '}
            de {current?.name}. ¿Lo cuentas otra vez para asegurar?
          </p>
        </div>
        <div className="px-5 pb-8 space-y-3">
          <button
            onClick={() => {
              setValue('')
              setPhase('counting')
            }}
            className="w-full py-4 rounded-2xl bg-accent text-white font-semibold text-lg transition-base active:scale-[0.98]"
          >
            Volver a contar
          </button>
          <button
            onClick={advance}
            className="w-full py-3.5 rounded-2xl border border-border-default text-text-secondary font-medium transition-base active:scale-[0.98]"
          >
            Está bien, es correcto
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="min-h-screen bg-page flex flex-col">
        <Header title="Conteo de hoy" />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-success-bg flex items-center justify-center">
            <Check size={40} className="text-success" />
          </div>
          <p className="font-display text-2xl text-text-primary mt-5">¡Listo!</p>
          <p className="text-sm text-text-secondary mt-2 max-w-xs leading-relaxed">
            Has contado {total === 1 ? 'el artículo' : `los ${total} artículos`} de hoy. Gracias.
          </p>
          <div className="mt-6 bg-card border border-border-default rounded-2xl p-4 text-sm text-text-secondary max-w-xs">
            El gestor revisa y ajusta el stock. Tú no tienes que hacer nada más.
          </div>
        </div>
        <div className="px-5 pb-8">
          <button
            onClick={onBack}
            className="w-full py-4 rounded-2xl bg-accent text-white font-semibold text-lg transition-base active:scale-[0.98]"
          >
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  // phase === 'counting'
  const canNext = parseValue() != null
  return (
    <div className="min-h-screen bg-page flex flex-col">
      <Header onBack={onBack} title="Conteo de hoy" />
      <div className="flex-1 px-5 pt-2">
        {/* progreso */}
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>Artículo {stepNumber} de {total}</span>
        </div>
        <div className="h-1.5 bg-border-default/50 rounded-full mt-2 overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>

        {/* artículo */}
        <div className="mt-8 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-accent-bg flex items-center justify-center">
            <Boxes size={38} className="text-accent" />
          </div>
          <p className="font-display text-2xl text-text-primary mt-4">{current?.name}</p>
          <p className="text-sm text-text-secondary mt-1">
            ¿Cuántos <b className="text-text-primary font-semibold">{unitWord(current?.baseUnit)}</b> hay?
          </p>
        </div>

        {/* entrada numérica grande */}
        <div className="mt-6">
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className="w-full text-center font-display text-4xl py-5 rounded-2xl border-2 border-accent/40 focus:border-accent outline-none bg-card text-text-primary"
            />
            {current?.baseUnit && (
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-lg text-text-secondary">
                {current.baseUnit}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 pb-8">
        <button
          onClick={onNext}
          disabled={!canNext || saving}
          className="w-full py-4 rounded-2xl bg-accent text-white font-semibold text-lg transition-base active:scale-[0.98] disabled:opacity-40 inline-flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 size={20} className="animate-spin" /> : null}
          {stepNumber >= total ? 'Terminar' : 'Siguiente'}
        </button>
      </div>
    </div>
  )
}

// ─── Piezas de presentación ───

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="px-4 pt-5 pb-3 flex items-center gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <p className="text-xs text-text-secondary uppercase tracking-wide">{title}</p>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center text-center px-6">
      {children}
    </div>
  )
}

// "gramos" / "mililitros" / "unidades" en lenguaje llano (con fallback al abreviado).
function unitWord(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toLowerCase()) {
    case 'g': return 'gramos'
    case 'kg': return 'kilos'
    case 'ml': return 'mililitros'
    case 'l': return 'litros'
    case 'ud':
    case 'u': return 'unidades'
    default: return abbr || 'unidades'
  }
}
