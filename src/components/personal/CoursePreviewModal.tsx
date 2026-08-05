// src/components/personal/CoursePreviewModal.tsx
// ENCARGO CODE — Vista previa de curso desde CoursesPage: abre el curso
// completo (teoría + test con corrección) SIN crear course_attempt, sin
// asignación y sin employee_id. Ventana de verificación para que el admin
// revise contenido, imágenes y preguntas antes de publicar.
//
// NO llama a start_course_attempt/submit_course_attempt/sign_course_attempt
// ni modifica ninguna tabla. La corrección del test es local (compara la
// opción elegida contra course_option.is_correct, que fetchCoursePreview sí
// trae al cliente porque esto no es el test real del empleado).
//
// Presentación calcada de MiFormacion.tsx (teoría → test → resultados) pero
// con los componentes de oficina (Modal/Button/Card) en vez del shell móvil,
// y MARKDOWN_COMPONENTS/SectionImage copiados aquí a propósito (el encargo
// no autoriza tocar MiFormacion.tsx).

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { CheckCircle2, XCircle, AlertTriangle, ClipboardCheck, Eye } from 'lucide-react'
import { Button, Card, Modal, Alert } from '../ui'
import { fetchCoursePreview } from '../../services/coursePreviewService'
import type { CoursePreview } from '../../services/coursePreviewService'
import { getSignedSectionImageUrls } from '../../services/courseImagesService'

interface Props {
  courseId: string
  onClose: () => void
}

type Step = 'teoria' | 'test' | 'resultados'

// Copiado de MiFormacion.tsx (mismo criterio: cuerpo 16px, blockquote como
// recuadro aparte, sin rehype-raw). Ver nota de cabecera — no se extrae a un
// fichero compartido para no tocar MiFormacion.tsx.
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

// Fallback silencioso: si falla la carga, se oculta el hueco entero (mismo
// criterio que MiFormacion.tsx).
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

interface LocalResultItem {
  questionId: string
  questionText: string
  isCorrect: boolean
  correctText: string | null
  explanation: string | null
}

interface LocalCorrection {
  scorePct: number
  passed: boolean
  correct: number
  total: number
  results: LocalResultItem[]
}

function correctLocally(preview: CoursePreview, answers: Record<string, string>): LocalCorrection {
  const results: LocalResultItem[] = preview.questions.map(q => {
    const correctOption = q.options.find(o => o.isCorrect) ?? null
    const chosen = q.options.find(o => o.id === answers[q.id]) ?? null
    return {
      questionId: q.id,
      questionText: q.text,
      isCorrect: !!chosen && chosen.isCorrect,
      correctText: correctOption?.text ?? null,
      explanation: chosen?.explanation ?? null,
    }
  })
  const total = results.length
  const correct = results.filter(r => r.isCorrect).length
  const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0
  return { scorePct, passed: scorePct >= preview.passThresholdPct, correct, total, results }
}

export default function CoursePreviewModal({ courseId, onClose }: Props) {
  const [preview, setPreview] = useState<CoursePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState<Step>('teoria')
  const [sectionIdx, setSectionIdx] = useState(0)
  const [questionIdx, setQuestionIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<LocalCorrection | null>(null)
  const [sectionImageUrls, setSectionImageUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setLoadError(false)
    setPreview(null)
    setStep('teoria')
    setSectionIdx(0)
    setQuestionIdx(0)
    setAnswers({})
    setResult(null)
    setSectionImageUrls({})
    fetchCoursePreview(courseId)
      .then(p => {
        if (cancel) return
        setPreview(p)
        setStep(p.sections.length > 0 ? 'teoria' : 'test')
        const paths = p.sections.map(s => s.mediaUrl).filter((m): m is string => !!m)
        if (paths.length > 0) {
          getSignedSectionImageUrls(paths).then(map => { if (!cancel) setSectionImageUrls(map) }).catch(() => {})
        }
      })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [courseId])

  function finishTest() {
    if (!preview) return
    setResult(correctLocally(preview, answers))
    setStep('resultados')
  }

  const title = preview?.title ?? 'Vista previa'

  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <div className="flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-md px-3 py-2 mb-4">
        <Eye size={15} className="shrink-0" />
        Vista previa — no se registra ningún intento
      </div>

      {loading && <p className="text-sm text-text-secondary text-center py-10">Cargando…</p>}

      {!loading && (loadError || !preview) && (
        <Alert type="error">No se pudo cargar el contenido de este curso.</Alert>
      )}

      {!loading && preview && step === 'teoria' && (
        <TeoriaStep
          preview={preview}
          sectionIdx={sectionIdx}
          setSectionIdx={setSectionIdx}
          sectionImageUrls={sectionImageUrls}
          onDoneTheory={() => setStep('test')}
        />
      )}

      {!loading && preview && step === 'test' && preview.questions.length === 0 && (
        <SinTestCard onClose={onClose} />
      )}

      {!loading && preview && step === 'test' && preview.questions.length > 0 && (
        <TestStep
          preview={preview}
          questionIdx={questionIdx}
          setQuestionIdx={setQuestionIdx}
          answers={answers}
          setAnswers={setAnswers}
          onFinish={finishTest}
        />
      )}

      {!loading && preview && step === 'resultados' && result && (
        <ResultadosStep preview={preview} result={result} onClose={onClose} />
      )}
    </Modal>
  )
}

function TeoriaStep({ preview, sectionIdx, setSectionIdx, sectionImageUrls, onDoneTheory }: {
  preview: CoursePreview
  sectionIdx: number
  setSectionIdx: (fn: (i: number) => number) => void
  sectionImageUrls: Record<string, string>
  onDoneTheory: () => void
}) {
  const section = preview.sections[sectionIdx]
  const isLast = sectionIdx === preview.sections.length - 1
  const imageUrl = section.mediaUrl ? sectionImageUrls[section.mediaUrl] : undefined

  return (
    <div>
      <p className="text-xs text-text-secondary uppercase tracking-wide mb-3">
        Teoría · {sectionIdx + 1}/{preview.sections.length}
      </p>
      <Card className="p-5">
        {imageUrl && <SectionImage src={imageUrl} alt={section.title} />}
        <p className="font-semibold text-text-primary mb-3">{section.title}</p>
        <ReactMarkdown components={MARKDOWN_COMPONENTS}>{section.body}</ReactMarkdown>
      </Card>
      <div className="flex gap-2 mt-4">
        {sectionIdx > 0 && (
          <Button variant="outline" onClick={() => setSectionIdx(i => i - 1)}>Atrás</Button>
        )}
        <Button onClick={() => isLast ? onDoneTheory() : setSectionIdx(i => i + 1)}>
          {isLast ? 'Empezar el test' : 'Siguiente'}
        </Button>
      </div>
    </div>
  )
}

function SinTestCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-10">
      <AlertTriangle size={32} className="text-text-secondary mx-auto mb-3" />
      <p className="font-medium text-text-primary">Este curso no tiene test</p>
      <Button className="mt-5" onClick={onClose}>Cerrar vista previa</Button>
    </div>
  )
}

function TestStep({ preview, questionIdx, setQuestionIdx, answers, setAnswers, onFinish }: {
  preview: CoursePreview
  questionIdx: number
  setQuestionIdx: (fn: (i: number) => number) => void
  answers: Record<string, string>
  setAnswers: (fn: (a: Record<string, string>) => Record<string, string>) => void
  onFinish: () => void
}) {
  const question = preview.questions[questionIdx]
  const isLast = questionIdx === preview.questions.length - 1
  const answered = !!answers[question.id]

  return (
    <div>
      <p className="text-xs text-text-secondary uppercase tracking-wide mb-3">
        Pregunta {questionIdx + 1}/{preview.questions.length}
      </p>
      <p className="font-semibold text-text-primary text-lg mb-4">{question.text}</p>
      <div className="space-y-2.5">
        {question.options.map(o => {
          const selected = answers[question.id] === o.id
          return (
            <button
              key={o.id}
              onClick={() => setAnswers(a => ({ ...a, [question.id]: o.id }))}
              className={`w-full text-left p-4 rounded-xl border-2 transition-base ${
                selected ? 'border-accent bg-accent-bg text-text-primary font-medium' : 'border-border-default bg-card text-text-primary hover:border-accent/50'
              }`}
            >
              {o.text}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2 mt-5">
        {questionIdx > 0 && (
          <Button variant="outline" onClick={() => setQuestionIdx(i => i - 1)}>Atrás</Button>
        )}
        <Button disabled={!answered} onClick={() => isLast ? onFinish() : setQuestionIdx(i => i + 1)}>
          {isLast ? 'Corregir' : 'Siguiente'}
        </Button>
      </div>
    </div>
  )
}

function ResultadosStep({ preview, result, onClose }: {
  preview: CoursePreview
  result: LocalCorrection
  onClose: () => void
}) {
  return (
    <div>
      <div className={`rounded-xl p-5 text-center mb-4 ${result.passed ? 'bg-success-bg' : 'bg-danger-bg'}`}>
        {result.passed ? <CheckCircle2 size={40} className="text-success mx-auto mb-2" /> : <XCircle size={40} className="text-danger mx-auto mb-2" />}
        <p className={`font-display text-2xl ${result.passed ? 'text-success' : 'text-danger'}`}>{result.scorePct}%</p>
        <p className="text-sm text-text-secondary mt-1">
          {result.correct}/{result.total} correctas · mínimo para superar {preview.passThresholdPct}%
        </p>
      </div>

      <div className="space-y-3">
        {result.results.map((r, i) => (
          <div key={r.questionId} className={`rounded-xl border p-3 ${r.isCorrect ? 'border-success/30 bg-success-bg/40' : 'border-danger/30 bg-danger-bg/40'}`}>
            <div className="flex items-start gap-2">
              {r.isCorrect ? <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> : <XCircle size={16} className="text-danger shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-medium">Pregunta {i + 1}. {r.questionText}</p>
                {!r.isCorrect && r.correctText && (
                  <p className="text-xs text-text-secondary mt-1">Respuesta correcta: {r.correctText}</p>
                )}
                {r.explanation && <p className="text-xs text-text-secondary mt-1">{r.explanation}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {preview.requiresPractical && (
        <div className="mt-5">
          <h3 className="font-semibold text-text-primary flex items-center gap-2 mb-1"><ClipboardCheck size={16} /> Verificación práctica</h3>
          <p className="text-xs text-text-secondary mb-2">Solo lectura — gestos que se pedirán al empleado en el puesto.</p>
          <div className="space-y-1.5">
            {preview.practicalItems.map(item => (
              <div key={item.id} className="text-sm text-text-primary border border-border-default rounded-lg p-3">
                <p>{item.ord}. {item.text}</p>
                {item.helpText && <p className="text-xs text-text-secondary mt-1">{item.helpText}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <Button className="w-full" onClick={onClose}>Cerrar vista previa</Button>
      </div>
    </div>
  )
}
