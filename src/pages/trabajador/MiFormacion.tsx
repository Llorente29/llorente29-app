// src/pages/trabajador/MiFormacion.tsx
// Formación C1 — Móvil del empleado. Hermana de MisChecklistsPage/MisDocumentos.
// Flujo: tarjetas (pendiente/en curso/suspendido/firmado) → teoría → test (una
// pregunta por pantalla) → resultados (con explicación) → firma → diploma.
//
// Pensado para hacerse EN TURNO, en 10-15 minutos, con una mano. Todo pasa por
// las RPC de mobileCoursesService: este componente nunca decide la nota ni
// resuelve su propia identidad — eso lo hace el servidor con auth.uid().

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import {
  ArrowLeft, GraduationCap, BookOpen, ListChecks, CheckCircle2, XCircle,
  Clock, AlertTriangle, Download, RotateCcw, PenLine, Eraser,
} from 'lucide-react'
import type { Employee } from '../../types'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import * as mobile from '../../services/mobileCoursesService'
import type { PendingCourse, StartAttemptResult, SubmitResult } from '../../services/mobileCoursesService'
import { generateDiplomaPdf, issueDiplomaCertificate, blobToDataUrl } from '../../services/courseCertificatePdfService'
import { getSignedSectionImageUrls } from '../../services/courseImagesService'

interface Props {
  employee: Employee
  onBack?: () => void
}

type Step = 'lista' | 'teoria' | 'test' | 'resultados' | 'firma' | 'practica_pendiente' | 'diploma'

// Markdown del contenido didáctico: negrita, listas, encabezados y párrafos
// con cuerpo 16px (se lee de pie, en cocina, con prisa). Blockquote (>) es el
// recuadro de "dato técnico/legal" — se pinta como caja aparte, no como cita.
// Sin rehype-raw a propósito: el contenido lo escribe la oficina, pero el
// portal del trabajador no debe renderizar HTML crudo.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="text-base text-text-primary leading-relaxed mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 mb-3 text-base text-text-primary leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 mb-3 text-base text-text-primary leading-relaxed">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <h3 className="font-display text-lg text-accent mt-4 mb-2">{children}</h3>,
  h2: ({ children }) => <h3 className="font-display text-lg text-accent mt-4 mb-2">{children}</h3>,
  h3: ({ children }) => <h4 className="font-display text-base font-semibold text-accent mt-3 mb-1.5">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="mt-3 mb-3 pl-4 pr-3 py-2.5 border-l-4 border-accent bg-accent-bg rounded-r-md text-sm text-text-primary">
      {children}
    </blockquote>
  ),
}

// Imagen de sección con fallback silencioso: si falla la carga, se oculta el
// hueco entero y el texto sigue sin layout roto (regla explícita del encargo).
function SectionImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt={alt}
      className="w-full rounded-xl object-contain mb-3 bg-page max-h-64"
      onError={() => setFailed(true)}
    />
  )
}

const STATUS_LABEL: Record<PendingCourse['status'], { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-page text-text-secondary' },
  en_curso: { label: 'En curso', color: 'bg-warning-bg text-warning' },
  suspendido: { label: 'Suspendido — repite', color: 'bg-danger-bg text-danger' },
  pendiente_practica: { label: 'Falta verificar práctica', color: 'bg-warning-bg text-warning' },
  firmado: { label: 'Superado', color: 'bg-success-bg text-success' },
}

export default function MiFormacion({ employee, onBack }: Props) {
  const { activeAccountId, activeAccount } = useApp()
  const [courses, setCourses] = useState<PendingCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState<Step>('lista')
  const [active, setActive] = useState<PendingCourse | null>(null)
  const [attempt, setAttempt] = useState<StartAttemptResult | null>(null)
  const [sectionIdx, setSectionIdx] = useState(0)
  const [theoryStartedAt, setTheoryStartedAt] = useState<number>(0)
  const [questionIdx, setQuestionIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [sectionImageUrls, setSectionImageUrls] = useState<Record<string, string>>({})
  const [signaturePath, setSignaturePath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      setCourses(await mobile.fetchMyPendingCourses())
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function openCourse(c: PendingCourse) {
    setActive(c)
    setError(null)
    setBusy(true)
    try {
      const started = await mobile.startAttempt(c.assignmentId)
      setAttempt(started)
      setSectionIdx(0)
      setQuestionIdx(0)
      setAnswers({})
      setResult(null)
      setSignaturePath(null)
      setSectionImageUrls({})
      setTheoryStartedAt(Date.now())
      setStep(started.sections.length > 0 ? 'teoria' : 'test')
      // Firmadas en lote (no una por sección) — la sección body ya vino, esto
      // solo resuelve imágenes; si falla, SectionImage oculta el hueco solo.
      const paths = started.sections.map(s => s.mediaUrl).filter((p): p is string => !!p)
      if (paths.length > 0) {
        getSignedSectionImageUrls(paths).then(setSectionImageUrls).catch(() => {})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el curso')
    } finally {
      setBusy(false)
    }
  }

  function backToList() {
    setStep('lista')
    setActive(null)
    setAttempt(null)
    load()
  }

  async function submitTest() {
    if (!attempt) return
    setBusy(true)
    setError(null)
    try {
      const timeSpent = Math.round((Date.now() - theoryStartedAt) / 1000)
      const res = await mobile.submitAttempt(attempt.attemptId, answers, timeSpent)
      setResult(res)
      setStep('resultados')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo corregir el test')
    } finally {
      setBusy(false)
    }
  }

  if (!activeAccountId) return null

  if (step === 'lista') {
    return (
      <div className="min-h-screen bg-page pb-8">
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-secondary uppercase tracking-wide">Mi Formación</p>
              <p className="font-display text-xl text-accent">Cursos</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-accent-bg flex items-center justify-center">
              <GraduationCap size={20} className="text-accent" />
            </div>
          </div>
        </div>

        <div className="px-4 space-y-3">
          {loading ? (
            <div className="bg-card border border-border-default rounded-xl p-8 text-center">
              <p className="text-sm text-text-secondary">Cargando…</p>
            </div>
          ) : loadError ? (
            <div className="bg-danger-bg border border-danger/30 rounded-xl p-4 text-center">
              <p className="text-sm text-danger">No se pudo cargar tu formación. Reintenta más tarde.</p>
            </div>
          ) : courses.length === 0 ? (
            <div className="bg-card border border-border-default rounded-xl p-8 text-center">
              <CheckCircle2 size={40} className="text-success mx-auto mb-2" />
              <p className="font-semibold text-text-primary">Sin formación pendiente</p>
              <p className="text-xs text-text-secondary mt-1">Cuando te asignen un curso, aparecerá aquí.</p>
            </div>
          ) : (
            courses.map(c => (
              <button
                key={c.assignmentId}
                onClick={() => openCourse(c)}
                disabled={busy}
                className="w-full bg-card border-2 border-border-default hover:border-accent rounded-xl p-4 text-left transition-base active:scale-[0.98]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-text-primary">{c.courseTitle}</p>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${STATUS_LABEL[c.status].color}`}>
                    {STATUS_LABEL[c.status].label}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-text-secondary">
                  {c.estimatedMinutes && <span className="flex items-center gap-1"><Clock size={12} /> {c.estimatedMinutes} min</span>}
                  {c.dueAt && <span>Antes del {new Date(c.dueAt).toLocaleDateString('es-ES')}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  if (!active || !attempt) return null

  if (step === 'teoria') {
    const section = attempt.sections[sectionIdx]
    const isLast = sectionIdx === attempt.sections.length - 1
    const imageUrl = section.mediaUrl ? sectionImageUrls[section.mediaUrl] : undefined
    return (
      <MobileShell title={active.courseTitle} subtitle={`Teoría · ${sectionIdx + 1}/${attempt.sections.length}`} onBack={backToList} icon={BookOpen}>
        <div className="bg-card border border-border-default rounded-xl p-5">
          {imageUrl && <SectionImage src={imageUrl} alt={section.title} />}
          <p className="font-semibold text-text-primary mb-3">{section.title}</p>
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{section.body}</ReactMarkdown>
        </div>
        <div className="flex gap-2 mt-4">
          {sectionIdx > 0 && (
            <button onClick={() => setSectionIdx(i => i - 1)} className="flex-1 py-3 rounded-xl border border-border-default text-text-secondary font-medium">
              Atrás
            </button>
          )}
          <button
            onClick={() => isLast ? setStep('test') : setSectionIdx(i => i + 1)}
            className="flex-1 py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base"
          >
            {isLast ? 'Empezar el test' : 'Siguiente'}
          </button>
        </div>
      </MobileShell>
    )
  }

  if (step === 'test') {
    const question = attempt.questions[questionIdx]
    const isLast = questionIdx === attempt.questions.length - 1
    const answered = !!answers[question.id]
    return (
      <MobileShell title={active.courseTitle} subtitle={`Pregunta ${questionIdx + 1}/${attempt.questions.length}`} onBack={backToList} icon={ListChecks}>
        {error && <p className="text-sm text-danger mb-3">{error}</p>}
        <p className="font-semibold text-text-primary text-lg mb-4">{question.text}</p>
        <div className="space-y-2.5">
          {question.options.map(o => {
            const selected = answers[question.id] === o.id
            return (
              <button
                key={o.id}
                onClick={() => setAnswers(a => ({ ...a, [question.id]: o.id }))}
                className={`w-full text-left p-4 rounded-xl border-2 transition-base active:scale-[0.98] ${
                  selected ? 'border-accent bg-accent-bg text-text-primary font-medium' : 'border-border-default bg-card text-text-primary'
                }`}
              >
                {o.text}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 mt-5">
          {questionIdx > 0 && (
            <button onClick={() => setQuestionIdx(i => i - 1)} className="flex-1 py-3 rounded-xl border border-border-default text-text-secondary font-medium">
              Atrás
            </button>
          )}
          <button
            disabled={!answered || busy}
            onClick={() => isLast ? submitTest() : setQuestionIdx(i => i + 1)}
            className="flex-1 py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base disabled:opacity-40"
          >
            {busy ? 'Corrigiendo…' : isLast ? 'Terminar test' : 'Siguiente'}
          </button>
        </div>
      </MobileShell>
    )
  }

  if (step === 'resultados' && result) {
    return (
      <MobileShell title={active.courseTitle} subtitle="Resultado" onBack={backToList} icon={result.passed ? CheckCircle2 : AlertTriangle}>
        <div className={`rounded-xl p-5 text-center mb-4 ${result.passed ? 'bg-success-bg' : 'bg-danger-bg'}`}>
          {result.passed ? <CheckCircle2 size={40} className="text-success mx-auto mb-2" /> : <XCircle size={40} className="text-danger mx-auto mb-2" />}
          <p className={`font-display text-2xl ${result.passed ? 'text-success' : 'text-danger'}`}>{result.scorePct}%</p>
          <p className="text-sm text-text-secondary mt-1">
            {result.correct}/{result.total} correctas · mínimo para superar {result.passThresholdPct}%
          </p>
        </div>

        <div className="space-y-3">
          {result.results.map((r, i) => (
            <div key={r.questionId} className={`rounded-xl border p-3 ${r.isCorrect ? 'border-success/30 bg-success-bg/40' : 'border-danger/30 bg-danger-bg/40'}`}>
              <div className="flex items-start gap-2">
                {r.isCorrect ? <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> : <XCircle size={16} className="text-danger shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-sm text-text-primary font-medium">Pregunta {i + 1}</p>
                  {!r.isCorrect && r.correctText && (
                    <p className="text-xs text-text-secondary mt-1">Respuesta correcta: {r.correctText}</p>
                  )}
                  {r.explanation && <p className="text-xs text-text-secondary mt-1">{r.explanation}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          {result.passed ? (
            <button onClick={() => setStep('firma')} className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base">
              Continuar a la firma
            </button>
          ) : (
            <button
              onClick={() => openCourse(active)}
              className="w-full py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base flex items-center justify-center gap-2"
            >
              <RotateCcw size={16} /> Repetir el curso
            </button>
          )}
        </div>
      </MobileShell>
    )
  }

  if (step === 'firma') {
    return (
      <FirmaStep
        employee={employee}
        accountId={activeAccountId}
        attemptId={attempt.attemptId}
        courseTitle={active.courseTitle}
        onBack={() => setStep('resultados')}
        onSigned={(path) => {
          setSignaturePath(path)
          setStep(attempt.course.requiresPractical ? 'practica_pendiente' : 'diploma')
        }}
      />
    )
  }

  if (step === 'practica_pendiente') {
    return (
      <MobileShell title={active.courseTitle} subtitle="Falta la práctica" onBack={backToList} icon={AlertTriangle}>
        <div className="bg-warning-bg border border-warning/30 rounded-xl p-6 text-center">
          <AlertTriangle size={44} className="text-warning mx-auto mb-3" />
          <p className="font-display text-xl text-warning">Has superado la teoría</p>
          <p className="text-sm text-text-secondary mt-2">
            Tu firma ya ha quedado registrada. Falta que tu responsable verifique la parte práctica en el puesto
            antes de que este curso cuente como completado.
          </p>
        </div>
        <button onClick={backToList} className="w-full mt-4 py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base">
          Volver a mi formación
        </button>
      </MobileShell>
    )
  }

  if (step === 'diploma' && result) {
    return (
      <DiplomaStep
        employee={employee}
        accountId={activeAccountId}
        accountLegalName={activeAccount?.legalName || activeAccount?.name || 'Tu empresa'}
        attempt={attempt}
        result={result}
        signaturePath={signaturePath}
        onBack={backToList}
      />
    )
  }

  return null
}

// ============================================================
// Shell común
// ============================================================

function MobileShell({ title, subtitle, onBack, icon: Icon, children }: {
  title: string; subtitle: string; onBack: () => void
  icon: typeof BookOpen
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-page pb-8">
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-secondary uppercase tracking-wide truncate">{title}</p>
            <p className="font-display text-lg text-accent">{subtitle}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
            <Icon size={18} className="text-accent" />
          </div>
        </div>
      </div>
      <div className="px-4">{children}</div>
    </div>
  )
}

// ============================================================
// Firma — canvas HTML5 (Pointer Events: dedo, ratón o lápiz por igual)
// ============================================================

function FirmaStep({ employee, accountId, attemptId, courseTitle, onBack, onSigned }: {
  employee: Employee
  accountId: string
  attemptId: string
  courseTitle: string
  onBack: () => void
  onSigned: (signaturePath: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const [signerName, setSignerName] = useState(employee.name)
  const [signerDocId, setSignerDocId] = useState(employee.dni || '')
  const [accepted, setAccepted] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2421'
  }, [])

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const ctx = canvas.getContext('2d')!
    const p = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    drawing.current = true
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const p = pointFromEvent(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    hasStroke.current = true
    setEmpty(false)
  }
  function onPointerUp() { drawing.current = false }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    setEmpty(true)
  }

  async function submit() {
    setError(null)
    if (empty) { setError('Firma en el recuadro con el dedo antes de continuar'); return }
    if (!signerName.trim()) { setError('Falta tu nombre'); return }
    if (!signerDocId.trim()) { setError('Falta tu DNI/NIE'); return }
    if (!accepted) { setError('Confirma la frase de compromiso'); return }

    setBusy(true)
    try {
      const canvas = canvasRef.current!
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo generar la firma')), 'image/png')
      })
      const path = await mobile.uploadSignaturePng(accountId, employee.id, attemptId, blob)
      await mobile.signAttempt(attemptId, path, signerName.trim(), signerDocId.trim())
      onSigned(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo firmar. Reintenta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <MobileShell title={courseTitle} subtitle="Firma" onBack={onBack} icon={PenLine}>
      {error && <p className="text-sm text-danger mb-3">{error}</p>}

      <div className="mb-3">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Nombre</label>
        <input
          value={signerName}
          onChange={e => setSignerName(e.target.value)}
          className="w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary mt-1"
        />
      </div>
      <div className="mb-3">
        <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">DNI / NIE</label>
        <input
          value={signerDocId}
          onChange={e => setSignerDocId(e.target.value)}
          className="w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary mt-1"
        />
      </div>

      <div className="relative bg-card border-2 border-dashed border-border-default rounded-xl" style={{ height: 180, touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="w-full h-full rounded-xl"
        />
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-text-secondary pointer-events-none">
            Firma aquí con el dedo
          </p>
        )}
        <button onClick={clearCanvas} className="absolute top-2 right-2 p-1.5 rounded-md bg-page/80 text-text-secondary" aria-label="Borrar firma">
          <Eraser size={14} />
        </button>
      </div>

      <label className="flex items-start gap-2 mt-4 text-sm text-text-primary">
        <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1" />
        <span>Declaro que he recibido y superado esta formación, y que la firma anterior es mía.</span>
      </label>
      <p className="text-xs text-text-secondary mt-2">
        Firma manuscrita electrónica (no cualificada). Sello de tiempo automático al firmar.
      </p>

      <button
        disabled={busy}
        onClick={submit}
        className="w-full mt-4 py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base disabled:opacity-50"
      >
        {busy ? 'Firmando…' : 'Firmar y terminar'}
      </button>
    </MobileShell>
  )
}

// ============================================================
// Diploma
// ============================================================

function DiplomaStep({ employee, accountId, accountLegalName, attempt, result, signaturePath, onBack }: {
  employee: Employee
  accountId: string
  accountLegalName: string
  attempt: StartAttemptResult
  result: SubmitResult
  signaturePath: string | null
  onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(false)

  async function downloadDiploma() {
    setBusy(true)
    setError(null)
    try {
      // Recupera el PNG de la firma ya subida (mismo intento) para incrustarla en el PDF.
      let signatureDataUrl = ''
      if (signaturePath && supabase) {
        const { data: sigBlob, error: dlErr } = await supabase.storage.from('course-signatures').download(signaturePath)
        if (dlErr) console.error('[MiFormacion] descarga de firma para el diploma', dlErr)
        if (sigBlob) signatureDataUrl = await blobToDataUrl(sigBlob)
      }

      const pdfData = generateDiplomaPdf({
        accountLegalName,
        courseTitle: attempt.course.title,
        courseLegalBasis: attempt.course.legalBasis,
        courseVersion: attempt.course.version,
        employeeName: employee.name,
        employeeDni: employee.dni || '—',
        scorePct: result.scorePct,
        signedAtLabel: new Date().toLocaleString('es-ES'),
        signatureDataUrl,
        serial: `FORM-${attempt.course.code.toUpperCase().slice(0, 10)}-${attempt.attemptId.slice(0, 8)}`,
      })

      await issueDiplomaCertificate({
        accountId,
        employeeId: employee.id,
        attemptId: attempt.attemptId,
        courseCode: attempt.course.code,
        pdfBlob: pdfData.blob,
      })

      const url = URL.createObjectURL(pdfData.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = pdfData.filename
      a.click()
      URL.revokeObjectURL(url)
      setDownloaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el diploma')
    } finally {
      setBusy(false)
    }
  }

  return (
    <MobileShell title={attempt.course.title} subtitle="Diploma" onBack={onBack} icon={GraduationCap}>
      <div className="bg-success-bg border border-success/30 rounded-xl p-6 text-center">
        <CheckCircle2 size={44} className="text-success mx-auto mb-3" />
        <p className="font-display text-xl text-success">¡Formación superada!</p>
        <p className="text-sm text-text-secondary mt-2">
          Firma registrada. Ya puedes descargar tu diploma.
        </p>
      </div>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      <button
        disabled={busy}
        onClick={downloadDiploma}
        className="w-full mt-4 py-3 rounded-xl bg-accent text-text-on-accent font-semibold active:scale-95 transition-base disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Download size={16} /> {busy ? 'Generando…' : downloaded ? 'Descargar de nuevo' : 'Descargar diploma'}
      </button>

      <button onClick={onBack} className="w-full mt-3 py-3 rounded-xl border border-border-default text-text-secondary font-medium">
        Volver a mi formación
      </button>
    </MobileShell>
  )
}
