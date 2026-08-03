// src/pages/CoursesPage.tsx
// Formación C1 — Oficina (Team): catálogo de cursos, editor sencillo de
// contenido, asignación a empleados/puesto/local y seguimiento de quién ha
// hecho qué. Los cursos plantilla globales (accountId null, ej. el de
// alérgenos) son de solo lectura en "Contenido" — Folvy los redacta, la
// cuenta solo los asigna. Editar/crear contenido propio SÍ está disponible
// para los cursos de la cuenta.
//
// NO toca FormacionesTab.tsx ni employee_formations (certificados externos,
// tabla y pantalla aparte, fuera de alcance de C1).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GraduationCap, Plus, ArrowLeft, BookOpen, ListChecks, Users2, ClipboardList,
  Trash2, Pencil, Check, X as XIcon, AlertTriangle, ShieldCheck,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import * as coursesService from '../services/coursesService'
import type {
  Course, CourseWithContent, CourseAssignment, CourseAttempt, CourseSignatureRow,
  DeliveryMode, TrackingRow,
} from '../services/coursesService'
import { generateSessionActaPdf, blobToDataUrl } from '../services/courseCertificatePdfService'
import { adoptCourseForAccount } from '../services/courseAdoptionService'
import {
  getSignedSectionImageUrl, uploadOwnSectionImage, revertSectionImageToFolvy,
} from '../services/courseImagesService'
import type { Employee, Location } from '../types'

const POSITIONS = ['Encargado', 'Jefe de cocina', 'Cocinero', 'Ayudante cocina', 'Camarero', 'Barra', 'Hostess', 'Limpieza', 'Gerente', 'Otro']

const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  folvy_imparte: 'Folvy imparte',
  solo_archivo: 'Solo archivo',
  mixto: 'Mixto',
}

const STATUS_BADGE: Record<Course['status'], { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'gray' },
  published: { label: 'Publicado', color: 'green' },
  archived: { label: 'Archivado', color: 'gray' },
}

export default function CoursesPage() {
  const { activeAccountId, staff, locations } = useApp()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    setLoading(true)
    setLoadError(false)
    coursesService.listCourses(activeAccountId)
      .then(rows => { if (!cancel) setCourses(rows) })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeAccountId])

  async function refreshCourses() {
    if (!activeAccountId) return
    try {
      const rows = await coursesService.listCourses(activeAccountId)
      setCourses(rows)
    } catch {
      setLoadError(true)
    }
  }

  // Tras adoptar una plantilla global, aterrizar directamente en la copia
  // propia recién creada (donde "Usar foto propia" ya funciona) en vez de
  // dejar al admin de vuelta en la global de solo lectura.
  async function handleAdopted(newCourseId: string) {
    await refreshCourses()
    setSelectedId(newCourseId)
  }

  const selected = courses.find(c => c.id === selectedId) ?? null

  if (!activeAccountId) return null

  if (selected) {
    return (
      <CourseDetail
        course={selected}
        accountId={activeAccountId}
        staff={staff}
        locations={locations}
        onBack={() => setSelectedId(null)}
        onChanged={refreshCourses}
        onAdopted={handleAdopted}
      />
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-bg flex items-center justify-center">
            <GraduationCap size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-text-primary">Formación</h1>
            <p className="text-sm text-text-secondary">Cursos internos, asignación y seguimiento</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)}><Plus size={16} /> Nuevo curso</Button>
      </div>

      {loadError && (
        <Alert type="error" className="mb-4">
          No se pudo cargar el catálogo de cursos. Reintenta o avisa si persiste.
        </Alert>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-secondary">Cargando cursos…</Card>
      ) : courses.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-text-secondary">Todavía no hay cursos. Crea el primero.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map(c => (
            <Card key={c.id} className="p-4" onClick={() => setSelectedId(c.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary truncate">{c.title}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{c.legalBasis || 'Sin base legal declarada'}</p>
                </div>
                {c.accountId === null && <Badge color="blue">Plantilla Folvy</Badge>}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Badge color={STATUS_BADGE[c.status].color}>{STATUS_BADGE[c.status].label}</Badge>
                <Badge color="gray">{DELIVERY_LABEL[c.deliveryMode]}</Badge>
                {c.appccPrerequisite && <Badge color="yellow">Prerrequisito APPCC</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateCourseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        accountId={activeAccountId}
        onCreated={async () => { setShowCreate(false); await refreshCourses() }}
      />
    </div>
  )
}

// ============================================================
// Crear curso
// ============================================================

function CreateCourseModal({ open, onClose, accountId, onCreated }: {
  open: boolean; onClose: () => void; accountId: string; onCreated: () => void
}) {
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [legalBasis, setLegalBasis] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('folvy_imparte')
  const [reevalMonths, setReevalMonths] = useState('12')
  const [passThreshold, setPassThreshold] = useState('70')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!code.trim() || !title.trim()) { setError('Código y título son obligatorios'); return }
    setSaving(true)
    setError(null)
    try {
      await coursesService.createCourse(accountId, {
        code: code.trim(),
        title: title.trim(),
        legalBasis: legalBasis.trim() || undefined,
        deliveryMode,
        reevalMonths: reevalMonths ? Number(reevalMonths) : undefined,
        passThresholdPct: passThreshold ? Number(passThreshold) : undefined,
      })
      setCode(''); setTitle(''); setLegalBasis(''); setReevalMonths('12'); setPassThreshold('70')
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el curso')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo curso">
      <div className="space-y-3">
        {error && <Alert type="error">{error}</Alert>}
        <div>
          <Label>Código interno</Label>
          <Input value={code} onChange={e => setCode(e.target.value)} placeholder="p. ej. prl_basico" />
        </div>
        <div>
          <Label>Título</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Nombre del curso" />
        </div>
        <div>
          <Label>Base legal</Label>
          <Input value={legalBasis} onChange={e => setLegalBasis(e.target.value)} placeholder="p. ej. Reg. UE 1169/2011" />
        </div>
        <div>
          <Label>Modo de entrega</Label>
          <Select value={deliveryMode} onChange={e => setDeliveryMode(e.target.value as DeliveryMode)}>
            <option value="folvy_imparte">Folvy imparte</option>
            <option value="solo_archivo">Solo archivo (Folvy no imparte)</option>
            <option value="mixto">Mixto</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Reevaluación (meses)</Label>
            <Input type="number" value={reevalMonths} onChange={e => setReevalMonths(e.target.value)} />
          </div>
          <div>
            <Label>Nota mínima (%)</Label>
            <Input type="number" value={passThreshold} onChange={e => setPassThreshold(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creando…' : 'Crear curso'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ============================================================
// Detalle de curso
// ============================================================

function CourseDetail({ course, accountId, staff, locations, onBack, onChanged, onAdopted }: {
  course: Course
  accountId: string
  staff: Employee[]
  locations: Location[]
  onBack: () => void
  onChanged: () => void
  onAdopted: (newCourseId: string) => void
}) {
  const [tab, setTab] = useState<'contenido' | 'asignar' | 'seguimiento'>('contenido')
  const editable = course.accountId !== null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center text-text-secondary" aria-label="Volver">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-secondary uppercase tracking-wide">Curso · v{course.version}</p>
          <h1 className="font-display text-xl text-text-primary truncate">{course.title}</h1>
        </div>
        <Badge color={STATUS_BADGE[course.status].color}>{STATUS_BADGE[course.status].label}</Badge>
        {!editable && <Badge color="blue">Plantilla Folvy · solo lectura</Badge>}
      </div>

      <Tabs
        value={tab}
        onChange={v => setTab(v as typeof tab)}
        tabs={[
          { value: 'contenido', label: 'Contenido' },
          { value: 'asignar', label: 'Asignar' },
          { value: 'seguimiento', label: 'Seguimiento' },
        ]}
        className="mb-5"
      />

      {tab === 'contenido' && (
        <ContenidoTab course={course} accountId={accountId} editable={editable} onChanged={onChanged} onAdopted={onAdopted} />
      )}
      {tab === 'asignar' && <AsignarTab course={course} accountId={accountId} staff={staff} locations={locations} />}
      {tab === 'seguimiento' && <SeguimientoTab course={course} staff={staff} />}
    </div>
  )
}

// ============================================================
// Tab: Contenido (secciones de teoría + preguntas del test)
// ============================================================

function ContenidoTab({ course, accountId, editable, onChanged, onAdopted }: {
  course: Course; accountId: string; editable: boolean; onChanged: () => void
  onAdopted: (newCourseId: string) => void
}) {
  const [content, setContent] = useState<CourseWithContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const c = await coursesService.getCourseWithContent(course.id)
      setContent(c)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [course.id])

  async function adoptAndPersonalize() {
    setAdopting(true)
    setAdoptError(null)
    try {
      const { courseId } = await adoptCourseForAccount(accountId, course.id)
      onAdopted(courseId)
    } catch (e) {
      setAdoptError(e instanceof Error ? e.message : 'No se pudo adoptar el curso')
    } finally {
      setAdopting(false)
    }
  }

  if (loading) return <Card className="p-8 text-center text-sm text-text-secondary">Cargando contenido…</Card>
  if (loadError || !content) return <Alert type="error">No se pudo cargar el contenido del curso.</Alert>

  return (
    <div className="space-y-6">
      {!editable && (
        <Alert type="info">
          <p>Este curso es una plantilla de Folvy. Su contenido legal no se edita desde aquí — solo se asigna.</p>
          <p className="mt-2">
            Para poner una foto de tu propia cocina en una sección, primero hay que adoptar el curso a tu cuenta
            (se crea una copia propia; la plantilla de Folvy no se toca y el resto de clientes sigue viendo la suya).
          </p>
          {adoptError && <p className="mt-2 text-danger">{adoptError}</p>}
          <div className="mt-3">
            <Button size="sm" onClick={adoptAndPersonalize} disabled={adopting}>
              {adopting ? 'Adoptando…' : 'Adoptar y personalizar'}
            </Button>
          </div>
        </Alert>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-text-primary flex items-center gap-2"><BookOpen size={16} /> Teoría</h2>
          {editable && <AddSectionButton courseId={course.id} nextOrd={content.sections.length + 1} onAdded={load} />}
        </div>
        <div className="space-y-2">
          {content.sections.length === 0 && <p className="text-sm text-text-secondary">Sin secciones todavía.</p>}
          {content.sections.map(s => (
            <SectionCard
              key={s.id}
              section={s}
              editable={editable}
              accountId={accountId}
              adoptedFromCourseId={course.adoptedFromCourseId}
              onChanged={load}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-text-primary flex items-center gap-2"><ListChecks size={16} /> Test</h2>
          {editable && <AddQuestionButton courseId={course.id} nextOrd={content.questions.length + 1} onAdded={load} />}
        </div>
        <div className="space-y-3">
          {content.questions.length === 0 && <p className="text-sm text-text-secondary">Sin preguntas todavía.</p>}
          {content.questions.map(q => (
            <QuestionCard key={q.id} question={q} editable={editable} onChanged={load} />
          ))}
        </div>
      </section>

      {editable && (
        <div className="flex justify-end pt-2">
          <PublishButton course={course} onDone={onChanged} />
        </div>
      )}
    </div>
  )
}

function PublishButton({ course, onDone }: { course: Course; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  async function publish() {
    setBusy(true)
    try {
      if (course.status === 'published') {
        await coursesService.publishCourseNewVersion(course.id, course.version)
      } else {
        await coursesService.updateCourse(course.id, { status: 'published' })
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button onClick={publish} disabled={busy}>
      <ShieldCheck size={16} />
      {course.status === 'published' ? `Publicar como v${course.version + 1}` : 'Publicar curso'}
    </Button>
  )
}

function AddSectionButton({ courseId, nextOrd, onAdded }: { courseId: string; nextOrd: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    try {
      await coursesService.createSection(courseId, { ord: nextOrd, title: title.trim(), body: body.trim() })
      setTitle(''); setBody(''); setOpen(false)
      onAdded()
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus size={14} /> Sección</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva sección de teoría">
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div><Label>Contenido</Label><Textarea rows={6} value={body} onChange={e => setBody(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={submit} disabled={saving}>Añadir</Button></div>
        </div>
      </Modal>
    </>
  )
}

function SectionCard({ section, editable, accountId, adoptedFromCourseId, onChanged }: {
  section: CourseWithContent['sections'][number]
  editable: boolean
  accountId: string
  adoptedFromCourseId: string | null
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(section.title)
  const [body, setBody] = useState(section.body)
  const [busy, setBusy] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancel = false
    setImageFailed(false)
    getSignedSectionImageUrl(section.mediaUrl).then(url => { if (!cancel) setImageUrl(url) })
    return () => { cancel = true }
  }, [section.mediaUrl])

  async function save() {
    setBusy(true)
    try { await coursesService.updateSection(section.id, { title, body }); setEditing(false); onChanged() }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm(`¿Borrar la sección "${section.title}"?`)) return
    setBusy(true)
    try { await coursesService.deleteSection(section.id); onChanged() }
    finally { setBusy(false) }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo fichero después
    if (!file) return
    setImageBusy(true)
    setImageError(null)
    try {
      await uploadOwnSectionImage(accountId, section.id, file, section.mediaUrl)
      onChanged()
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'No se pudo subir la foto')
    } finally {
      setImageBusy(false)
    }
  }

  async function revertToFolvy() {
    setImageBusy(true)
    setImageError(null)
    try {
      await revertSectionImageToFolvy(section.id, accountId)
      onChanged()
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'No se pudo volver a la imagen de Folvy')
    } finally {
      setImageBusy(false)
    }
  }

  if (editing) {
    return (
      <Card className="p-4 space-y-2">
        <Input value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea rows={5} value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button size="sm" onClick={save} disabled={busy}>Guardar</Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      {imageUrl && !imageFailed && (
        <img
          src={imageUrl}
          alt={section.title}
          className="w-full max-h-48 rounded-lg object-contain bg-page mb-3"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-text-primary">{section.ord}. {section.title}</p>
          <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap line-clamp-3">{section.body}</p>
        </div>
        {editable && (
          <div className="flex gap-1 shrink-0">
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-md hover:bg-accent-bg text-text-secondary" aria-label="Editar"><Pencil size={14} /></button>
            <button onClick={remove} className="p-1.5 rounded-md hover:bg-danger-bg text-danger" aria-label="Borrar" disabled={busy}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      {editable && (
        <div className="mt-3 pt-3 border-t border-border-default">
          {imageError && <p className="text-xs text-danger mb-2">{imageError}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={imageBusy}>
              {imageBusy ? 'Subiendo…' : 'Usar foto propia'}
            </Button>
            {adoptedFromCourseId && (
              <Button size="sm" variant="ghost" onClick={revertToFolvy} disabled={imageBusy}>
                Volver a la imagen de Folvy
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function AddQuestionButton({ courseId, nextOrd, onAdded }: { courseId: string; nextOrd: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    if (!text.trim()) return
    setSaving(true)
    try { await coursesService.createQuestion(courseId, nextOrd, text.trim()); setText(''); setOpen(false); onAdded() }
    finally { setSaving(false) }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus size={14} /> Pregunta</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva pregunta">
        <div className="space-y-3">
          <div><Label>Enunciado</Label><Textarea rows={3} value={text} onChange={e => setText(e.target.value)} /></div>
          <p className="text-xs text-text-secondary">Añade las opciones de respuesta después de crear la pregunta.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={submit} disabled={saving}>Añadir</Button></div>
        </div>
      </Modal>
    </>
  )
}

function QuestionCard({ question, editable, onChanged }: {
  question: CourseWithContent['questions'][number]; editable: boolean; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [addingOption, setAddingOption] = useState(false)
  const [optText, setOptText] = useState('')
  const [optCorrect, setOptCorrect] = useState(false)
  const [optExplanation, setOptExplanation] = useState('')

  async function removeQuestion() {
    if (!confirm('¿Borrar esta pregunta y sus opciones?')) return
    setBusy(true)
    try { await coursesService.deleteQuestion(question.id); onChanged() }
    finally { setBusy(false) }
  }
  async function addOption() {
    if (!optText.trim()) return
    setBusy(true)
    try {
      await coursesService.createOption(question.id, { text: optText.trim(), isCorrect: optCorrect, explanation: optExplanation.trim() || undefined })
      setOptText(''); setOptCorrect(false); setOptExplanation(''); setAddingOption(false)
      onChanged()
    } finally { setBusy(false) }
  }
  async function toggleCorrect(optionId: string, current: boolean) {
    setBusy(true)
    try { await coursesService.updateOption(optionId, { isCorrect: !current }); onChanged() }
    finally { setBusy(false) }
  }
  async function removeOption(optionId: string) {
    setBusy(true)
    try { await coursesService.deleteOption(optionId); onChanged() }
    finally { setBusy(false) }
  }

  const hasCorrect = question.options.some(o => o.isCorrect)

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-text-primary">{question.ord}. {question.text}</p>
        {editable && (
          <button onClick={removeQuestion} className="p-1.5 rounded-md hover:bg-danger-bg text-danger shrink-0" aria-label="Borrar pregunta" disabled={busy}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!hasCorrect && question.options.length > 0 && (
        <p className="text-xs text-danger mt-2 flex items-center gap-1"><AlertTriangle size={12} /> Ninguna opción está marcada como correcta.</p>
      )}

      <div className="mt-3 space-y-1.5">
        {question.options.map(o => (
          <div key={o.id} className="flex items-center gap-2 text-sm">
            {editable ? (
              <button onClick={() => toggleCorrect(o.id, o.isCorrect)} disabled={busy}
                className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${o.isCorrect ? 'bg-success border-success text-white' : 'border-border-default'}`}>
                {o.isCorrect && <Check size={12} />}
              </button>
            ) : (
              o.isCorrect && <Check size={14} className="text-success shrink-0" />
            )}
            <span className={`flex-1 ${o.isCorrect ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>{o.text}</span>
            {editable && (
              <button onClick={() => removeOption(o.id)} className="p-1 rounded hover:bg-danger-bg text-danger" aria-label="Borrar opción" disabled={busy}>
                <XIcon size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        addingOption ? (
          <div className="mt-3 space-y-2 border-t border-border-default pt-3">
            <Input placeholder="Texto de la opción" value={optText} onChange={e => setOptText(e.target.value)} />
            <Textarea placeholder="Explicación (se muestra si el empleado la elige)" rows={2} value={optExplanation} onChange={e => setOptExplanation(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={optCorrect} onChange={e => setOptCorrect(e.target.checked)} /> Es la opción correcta
            </label>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddingOption(false)}>Cancelar</Button>
              <Button size="sm" onClick={addOption} disabled={busy}>Añadir opción</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAddingOption(true)}><Plus size={14} /> Opción</Button>
        )
      )}
    </Card>
  )
}

// ============================================================
// Tab: Asignar
// ============================================================

function AsignarTab({ course, accountId, staff, locations }: {
  course: Course; accountId: string; staff: Employee[]; locations: Location[]
}) {
  const [assignments, setAssignments] = useState<CourseAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [targetType, setTargetType] = useState<'empleado' | 'puesto' | 'local'>('empleado')
  const [employeeId, setEmployeeId] = useState('')
  const [role, setRole] = useState(POSITIONS[0])
  const [locationId, setLocationId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try { setAssignments(await coursesService.listAssignments(course.id)) }
    catch { setLoadError(true) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [course.id])

  async function submit() {
    setFormError(null)
    setSaving(true)
    try {
      await coursesService.createAssignment({
        courseId: course.id,
        accountId,
        employeeId: targetType === 'empleado' ? employeeId || undefined : undefined,
        role: targetType === 'puesto' ? role : undefined,
        locationId: targetType === 'local' ? locationId || undefined : undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        origin: 'manual',
      })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo asignar')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Quitar esta asignación?')) return
    await coursesService.deleteAssignment(id)
    await load()
  }

  function targetLabel(a: CourseAssignment): string {
    if (a.employeeId) return staff.find(e => e.id === a.employeeId)?.name ?? 'Empleado'
    if (a.role) return `Puesto: ${a.role}`
    if (a.locationId) return `Local: ${locations.find(l => l.id === a.locationId)?.name ?? a.locationId}`
    return '—'
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <p className="font-semibold text-text-primary mb-3">Nueva asignación</p>
        {formError && <Alert type="error" className="mb-3">{formError}</Alert>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Destino</Label>
            <Select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)}>
              <option value="empleado">Un empleado</option>
              <option value="puesto">Todo un puesto</option>
              <option value="local">Todo un local</option>
            </Select>
          </div>
          <div>
            <Label>Fecha límite (opcional)</Label>
            <Input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </div>
        </div>
        {targetType === 'empleado' && (
          <div className="mt-3">
            <Label>Empleado</Label>
            <Select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Selecciona…</option>
              {staff.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
        )}
        {targetType === 'puesto' && (
          <div className="mt-3">
            <Label>Puesto</Label>
            <Select value={role} onChange={e => setRole(e.target.value)}>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
        )}
        {targetType === 'local' && (
          <div className="mt-3">
            <Label>Local</Label>
            <Select value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">Selecciona…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
        )}
        <div className="flex justify-end mt-3">
          <Button onClick={submit} disabled={saving}><Plus size={16} /> Asignar</Button>
        </div>
      </Card>

      <div>
        <p className="font-semibold text-text-primary mb-2 flex items-center gap-2"><Users2 size={16} /> Asignaciones activas</p>
        {loadError && <Alert type="error">No se pudieron cargar las asignaciones.</Alert>}
        {loading ? (
          <p className="text-sm text-text-secondary">Cargando…</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-text-secondary">Nadie tiene este curso asignado todavía.</p>
        ) : (
          <div className="space-y-1.5">
            {assignments.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-card border border-border-default rounded-lg px-3 py-2 text-sm">
                <div>
                  <span className="text-text-primary">{targetLabel(a)}</span>
                  {a.dueAt && <span className="text-text-secondary ml-2">· vence {new Date(a.dueAt).toLocaleDateString('es-ES')}</span>}
                </div>
                <button onClick={() => remove(a.id)} className="p-1 rounded hover:bg-danger-bg text-danger" aria-label="Quitar"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Tab: Seguimiento
// ============================================================

const TRACKING_BADGE: Record<TrackingRow['status'], { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'gray' },
  en_curso: { label: 'En curso', color: 'yellow' },
  suspendido: { label: 'Suspendido', color: 'red' },
  firmado: { label: 'Superado y firmado', color: 'green' },
}

function SeguimientoTab({ course, staff }: { course: Course; staff: Employee[] }) {
  const { activeAccount } = useApp()
  const navigate = useNavigate()
  const [rows, setRows] = useState<TrackingRow[]>([])
  const [signatures, setSignatures] = useState<CourseSignatureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generatingActa, setGeneratingActa] = useState(false)
  const [actaError, setActaError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setLoadError(false)
    Promise.all([
      coursesService.listAssignments(course.id),
      coursesService.listAttemptsForCourse(course.id),
    ])
      .then(async ([assignments, attempts]) => {
        const sigs = await coursesService.listSignaturesForAttempts(attempts.map((a: CourseAttempt) => a.id))
        if (cancel) return
        setSignatures(sigs)
        setRows(coursesService.resolveTrackingRows(assignments, attempts, sigs, staff))
      })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [course.id, staff])

  const overdueCount = rows.filter(r => r.overdue).length

  async function downloadActa() {
    setGeneratingActa(true)
    setActaError(null)
    try {
      const content = await coursesService.getCourseWithContent(course.id)
      const attendees = await Promise.all(
        rows.map(async (r) => {
          const sig = signatures.find(s => s.employeeId === r.employeeId && s.signedAt === r.signedAt)
          let signatureDataUrl: string | null = null
          if (sig && supabase) {
            const { data: blob } = await supabase.storage.from('course-signatures').download(sig.signaturePng)
            if (blob) signatureDataUrl = await blobToDataUrl(blob)
          }
          return {
            employeeName: r.employeeName,
            employeeDni: staff.find(e => e.id === r.employeeId)?.dni ?? '',
            scorePct: r.scorePct,
            signedAtLabel: r.signedAt ? new Date(r.signedAt).toLocaleString('es-ES') : null,
            signatureDataUrl,
          }
        }),
      )
      const pdf = generateSessionActaPdf({
        accountLegalName: activeAccount?.legalName || activeAccount?.name || 'Cuenta',
        accountCif: activeAccount?.cif ?? null,
        courseTitle: course.title,
        courseLegalBasis: course.legalBasis,
        generatedAtLabel: new Date().toLocaleString('es-ES'),
        sections: (content?.sections ?? []).map(s => ({ title: s.title })),
        attendees,
      })
      const url = URL.createObjectURL(pdf.blob)
      const a = document.createElement('a')
      a.href = url; a.download = pdf.filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setActaError(e instanceof Error ? e.message : 'No se pudo generar el acta')
    } finally {
      setGeneratingActa(false)
    }
  }

  if (loading) return <Card className="p-8 text-center text-sm text-text-secondary">Cargando seguimiento…</Card>
  if (loadError) return <Alert type="error">No se pudo cargar el seguimiento.</Alert>
  if (rows.length === 0) return <Card className="p-8 text-center text-sm text-text-secondary">Nadie alcanzado por una asignación todavía.</Card>

  return (
    <div className="space-y-3">
      {overdueCount > 0 && (
        <Alert type="warning">
          <ClipboardList size={14} className="inline mr-1" /> {overdueCount} persona{overdueCount === 1 ? '' : 's'} va{overdueCount === 1 ? '' : 'n'} tarde con este curso.
        </Alert>
      )}
      {actaError && <Alert type="error">{actaError}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/appcc/formacion')}>
          Ver informe de inspección
        </Button>
        <Button variant="outline" size="sm" onClick={downloadActa} disabled={generatingActa}>
          {generatingActa ? 'Generando acta…' : 'Descargar acta de sesión'}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-accent-bg text-text-secondary text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Empleado</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Nota</th>
              <th className="text-left px-3 py-2">Firmado</th>
              <th className="text-left px-3 py-2">Vence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.assignmentId}-${r.employeeId}-${i}`} className="border-t border-border-default">
                <td className="px-3 py-2 text-text-primary">{r.employeeName}</td>
                <td className="px-3 py-2"><Badge color={TRACKING_BADGE[r.status].color}>{TRACKING_BADGE[r.status].label}</Badge></td>
                <td className="px-3 py-2 text-text-secondary">{r.scorePct != null ? `${r.scorePct}%` : '—'}</td>
                <td className="px-3 py-2 text-text-secondary">{r.signedAt ? new Date(r.signedAt).toLocaleString('es-ES') : '—'}</td>
                <td className={`px-3 py-2 ${r.overdue ? 'text-danger font-medium' : 'text-text-secondary'}`}>
                  {r.dueAt ? new Date(r.dueAt).toLocaleDateString('es-ES') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
