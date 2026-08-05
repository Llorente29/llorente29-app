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
  Trash2, Pencil, Check, X as XIcon, AlertTriangle, ShieldCheck, ClipboardCheck,
  Image as ImageIcon, Clock, ChefHat, Truck, UtensilsCrossed, Leaf, FolderOpen,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { Button, Input, Select, Textarea, Badge, Card, Tabs, Modal, Label, Alert } from '../components/ui'
import * as coursesService from '../services/coursesService'
import type {
  Course, CourseWithContent, CourseAssignment, CourseAttempt, CourseSignatureRow,
  DeliveryMode, TrackingRow, CourseCategory, CourseLevel,
} from '../services/coursesService'
import { generateSessionActaPdf, blobToDataUrl } from '../services/courseCertificatePdfService'
import { adoptCourseForAccount } from '../services/courseAdoptionService'
import TrainingCalendarView from '../components/personal/TrainingCalendarView'
import ReleasePhaseCampaignModal from '../components/personal/ReleasePhaseCampaignModal'
import CoursePreviewModal from '../components/personal/CoursePreviewModal'
import { getTrainingComplianceMatrix, type TrainingComplianceRow } from '../services/trainingComplianceService'
import {
  getSignedSectionImageUrl, getSignedSectionImageUrls, uploadOwnSectionImage, revertSectionImageToFolvy,
  uploadOwnCoverImage, revertCoverToFolvy,
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

// Orden lógico del catálogo (guía §5.bis / catálogo v2 §6), no alfabético:
// cumplimiento primero (es lo obligatorio), 'sin_categoria' al final para no
// esconder cursos aún sin clasificar (deuda declarada, no un descarte).
const CATEGORY_ORDER: (CourseCategory | 'sin_categoria')[] = [
  'cumplimiento', 'cocina', 'delivery', 'sala', 'equipo', 'producto', 'sostenibilidad', 'sin_categoria',
]
const CATEGORY_LABEL: Record<CourseCategory | 'sin_categoria', string> = {
  cumplimiento: 'Cumplimiento legal',
  cocina: 'Operación de cocina',
  delivery: 'Reparto y delivery',
  sala: 'Sala y cliente',
  equipo: 'Equipo y mandos',
  producto: 'Producto y recetas',
  sostenibilidad: 'Sostenibilidad',
  sin_categoria: 'Sin clasificar',
}
const LEVEL_LABEL: Record<CourseLevel, string> = {
  base: 'Base (toda la plantilla)',
  especialista: 'Especialista',
  mando: 'Mando',
}

// Capa 3 de la portada (C5 §B): si no hay cover_url ni imagen de sección,
// fondo de color + icono por categoría. Nunca gris vacío.
const CATEGORY_ICON: Record<CourseCategory | 'sin_categoria', typeof ShieldCheck> = {
  cumplimiento: ShieldCheck,
  cocina: ChefHat,
  delivery: Truck,
  sala: UtensilsCrossed,
  equipo: Users2,
  producto: ClipboardList,
  sostenibilidad: Leaf,
  sin_categoria: FolderOpen,
}
const CATEGORY_BG: Record<CourseCategory | 'sin_categoria', string> = {
  cumplimiento: 'bg-blue-50 text-blue-400',
  cocina: 'bg-orange-50 text-orange-400',
  delivery: 'bg-teal-50 text-teal-400',
  sala: 'bg-purple-50 text-purple-400',
  equipo: 'bg-indigo-50 text-indigo-400',
  producto: 'bg-pink-50 text-pink-400',
  sostenibilidad: 'bg-green-50 text-green-400',
  sin_categoria: 'bg-gray-50 text-gray-400',
}

export default function CoursesPage() {
  const { activeAccountId, staff, locations } = useApp()
  const [courses, setCourses] = useState<Course[]>([])
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<CourseCategory | 'todas'>('todas')
  const [levelFilter, setLevelFilter] = useState<CourseLevel | 'todos'>('todos')
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const [view, setView] = useState<'catalogo' | 'calendario'>('catalogo')
  const [showCampaign, setShowCampaign] = useState(false)
  const [previewCourseId, setPreviewCourseId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let cancel = false
    setLoading(true)
    setLoadError(false)
    Promise.all([
      coursesService.listCourses(activeAccountId),
      coursesService.getAccountBusinessType(activeAccountId),
    ])
      .then(([rows, bt]) => { if (!cancel) { setCourses(rows); setBusinessType(bt) } })
      .catch(() => { if (!cancel) setLoadError(true) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeAccountId])

  // Resolución de portadas en LOTE (capas 1+2, C5 §B) para toda la rejilla a
  // la vez — una tarjeta por curso sería N llamadas; getSignedSectionImageUrls
  // ya está pensada para recibir varios paths de una sola vez.
  useEffect(() => {
    const candidates = courses
      .map(c => c.coverUrl ?? c.firstSectionMediaUrl)
      .filter((p): p is string => !!p)
    if (candidates.length === 0) { setCoverUrls({}); return }
    let cancel = false
    getSignedSectionImageUrls(candidates).then(map => { if (!cancel) setCoverUrls(map) })
    return () => { cancel = true }
  }, [courses])

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

  // "Añadir a mis cursos" desde el Catálogo Folvy (C6 §A): a diferencia de
  // handleAdopted, aquí NO se navega — es una acción de "añadir a la lista"
  // (la tarjeta pasa sola de zona 2 a zona 1 al refrescar), no de "empezar a
  // editar ahora mismo".
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [adoptCatalogError, setAdoptCatalogError] = useState<string | null>(null)
  async function handleAddFromCatalog(globalCourseId: string) {
    if (!activeAccountId) return
    setAdoptingId(globalCourseId)
    setAdoptCatalogError(null)
    try {
      await adoptCourseForAccount(activeAccountId, globalCourseId)
      await refreshCourses()
    } catch (e) {
      setAdoptCatalogError(e instanceof Error ? e.message : 'No se pudo añadir el curso')
    } finally {
      setAdoptingId(null)
    }
  }

  const selected = courses.find(c => c.id === selectedId) ?? null

  if (!activeAccountId) return null

  if (selected) {
    return (
      <>
        <CourseDetail
          course={selected}
          accountId={activeAccountId}
          staff={staff}
          locations={locations}
          onBack={() => setSelectedId(null)}
          onChanged={refreshCourses}
          onAdopted={handleAdopted}
          onPreview={() => setPreviewCourseId(selected.id)}
        />
        {previewCourseId && (
          <CoursePreviewModal courseId={previewCourseId} onClose={() => setPreviewCourseId(null)} />
        )}
      </>
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowCampaign(true)}><Users2 size={16} /> Liberar fase a un grupo</Button>
          <Button onClick={() => setShowCreate(true)}><Plus size={16} /> Nuevo curso</Button>
        </div>
      </div>

      {showCampaign && <ReleasePhaseCampaignModal onClose={() => setShowCampaign(false)} />}

      <div className="flex gap-1 bg-page p-1 rounded-lg mb-6 w-fit">
        <button
          onClick={() => setView('catalogo')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-base ${view === 'catalogo' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
        >
          Catálogo
        </button>
        <button
          onClick={() => setView('calendario')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-base ${view === 'calendario' ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
        >
          Calendario
        </button>
      </div>

      {view === 'calendario' ? (
        <TrainingCalendarView />
      ) : (
        <>
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
        (() => {
          const imageUrlFor = (c: Course): string | null => {
            const candidate = c.coverUrl ?? c.firstSectionMediaUrl
            return candidate ? coverUrls[candidate] ?? null : null
          }

          // C6 §A: tres zonas, no una rejilla mezclada. "Mis cursos" (copias
          // adoptadas + propias) es lo primero — es donde se trabaja cada día.
          // "Catálogo Folvy" son plantillas SIN adoptar todavía: en cuanto se
          // adopta una, desaparece de aquí y aparece en "Mis cursos" — así el
          // duplicado no existe por diseño, no por filtro a posteriori.
          const own = courses.filter(c => c.accountId !== null)
          const adoptedOriginIds = new Set(
            own.map(c => c.adoptedFromCourseId).filter((id): id is string => !!id),
          )
          const mine = own.filter(c => c.deliveryMode !== 'solo_archivo')
          const catalog = courses.filter(c =>
            c.accountId === null
            && c.deliveryMode !== 'solo_archivo'
            && !adoptedOriginIds.has(c.id)
            && coursesService.courseAppliesToBusinessType(c, businessType),
          )
          // Certificados externos: si la cuenta ya adoptó su copia, se enseña
          // ESA (puede llevar notas/ajustes propios); si no, la plantilla
          // global de solo lectura. Nunca las dos a la vez para el mismo code.
          const soloByCode = new Map<string, Course>()
          for (const c of courses.filter(c => c.deliveryMode === 'solo_archivo')) {
            const existing = soloByCode.get(c.code)
            if (!existing || (c.accountId !== null && existing.accountId === null)) soloByCode.set(c.code, c)
          }
          const external = [...soloByCode.values()]

          const filtered = mine.filter(c =>
            (categoryFilter === 'todas' || c.category === categoryFilter) &&
            (levelFilter === 'todos' || c.level === levelFilter),
          )
          const groups = new Map<CourseCategory | 'sin_categoria', Course[]>()
          for (const c of filtered) {
            const key = c.category ?? 'sin_categoria'
            const list = groups.get(key)
            if (list) list.push(c); else groups.set(key, [c])
          }
          for (const list of groups.values()) {
            list.sort((a, b) => (a.recommendedOrder ?? 9999) - (b.recommendedOrder ?? 9999) || a.title.localeCompare(b.title))
          }
          const orderedGroups = CATEGORY_ORDER.filter(k => groups.has(k))

          return (
            <div className="space-y-10">
              {/* Zona 1 — Mis cursos */}
              <section>
                <h2 className="font-display text-lg text-text-primary mb-3">Mis cursos</h2>
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <div className="w-56">
                    <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as CourseCategory | 'todas')}>
                      <option value="todas">Todas las categorías</option>
                      {(Object.keys(CATEGORY_LABEL) as (CourseCategory | 'sin_categoria')[])
                        .filter((k): k is CourseCategory => k !== 'sin_categoria')
                        .map(k => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
                    </Select>
                  </div>
                  <div className="w-48">
                    <Select value={levelFilter} onChange={e => setLevelFilter(e.target.value as CourseLevel | 'todos')}>
                      <option value="todos">Todos los niveles</option>
                      {(Object.keys(LEVEL_LABEL) as CourseLevel[]).map(k => <option key={k} value={k}>{LEVEL_LABEL[k]}</option>)}
                    </Select>
                  </div>
                </div>

                {mine.length === 0 ? (
                  <Card className="p-8 text-center">
                    <p className="text-sm text-text-secondary">Todavía no tienes ningún curso propio. Añade uno del catálogo Folvy o crea el primero.</p>
                  </Card>
                ) : filtered.length === 0 ? (
                  <Card className="p-8 text-center">
                    <p className="text-sm text-text-secondary">Ningún curso coincide con este filtro.</p>
                  </Card>
                ) : (
                  <div className="space-y-8">
                    {orderedGroups.map(key => (
                      <div key={key}>
                        <h3 className="font-display text-sm uppercase tracking-wide text-text-secondary mb-3">
                          {CATEGORY_LABEL[key]}
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {groups.get(key)!.map(c => (
                            <CourseCard key={c.id} course={c} imageUrl={imageUrlFor(c)} onClick={() => setSelectedId(c.id)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Zona 2 — Catálogo Folvy (plantillas sin adoptar) */}
              {catalog.length > 0 && (
                <section>
                  <h2 className="font-display text-lg text-text-primary mb-1">Catálogo Folvy</h2>
                  <p className="text-sm text-text-secondary mb-4">Plantillas de Folvy que aún no tienes. Añádelas para empezar a asignarlas.</p>
                  {adoptCatalogError && <Alert type="error" className="mb-4">{adoptCatalogError}</Alert>}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {catalog.map(c => (
                      <CatalogCard
                        key={c.id}
                        course={c}
                        imageUrl={imageUrlFor(c)}
                        alreadyAdopted={adoptedOriginIds.has(c.id)}
                        adopting={adoptingId === c.id}
                        onPreview={() => setSelectedId(c.id)}
                        onAdd={() => handleAddFromCatalog(c.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Zona 3 — Certificados externos (Folvy vigila, no imparte) */}
              {external.length > 0 && (
                <section>
                  <h2 className="font-display text-lg text-text-primary mb-1">Certificados externos</h2>
                  <p className="text-sm text-text-secondary mb-4">Formación que Folvy vigila pero no imparte.</p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {external.map(c => (
                      <SoloArchivoCard key={c.id} course={c} imageUrl={imageUrlFor(c)} onClick={() => setSelectedId(c.id)} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        })()
      )}
        </>
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

// Tarjeta del catálogo (C5 §C): portada 16:9 arriba, título grande, UNA línea
// discreta de metadatos. Base legal / is_mandatory / appcc_prerequisite /
// level / "Plantilla Folvy" van al detalle (CourseDetail) — esto es un
// catálogo, no una ficha de auditor. Referencia: Typsy / Flow Learning.
function CourseCard({ course, imageUrl, onClick }: { course: Course; imageUrl: string | null; onClick: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = !!imageUrl && !imageFailed
  const categoryKey = course.category ?? 'sin_categoria'
  const CategoryIcon = CATEGORY_ICON[categoryKey]
  const isDraft = course.status === 'draft'

  return (
    <Card className={`overflow-hidden ${isDraft ? 'opacity-70' : ''}`} onClick={onClick}>
      <div className={`w-full aspect-video flex items-center justify-center ${showImage ? '' : CATEGORY_BG[categoryKey]}`}>
        {showImage ? (
          <img
            src={imageUrl!}
            alt={course.title}
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <CategoryIcon size={32} />
        )}
      </div>
      <div className="p-4">
        <p className="font-semibold text-text-primary line-clamp-2">{course.title}</p>
        <p className="text-xs text-text-secondary mt-1.5 inline-flex items-center gap-1">
          {course.estimatedMinutes && <Clock size={11} />}
          {[
            course.estimatedMinutes ? `${course.estimatedMinutes} min` : null,
            STATUS_BADGE[course.status].label,
            course.deliveryMode === 'solo_archivo' ? 'Solo archivo' : null,
            course.requiresPractical ? 'Requiere práctica' : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
    </Card>
  )
}

// Tarjeta del Catálogo Folvy (C6 §A): plantilla sin adoptar todavía, con CTA
// "Añadir a mis cursos". `alreadyAdopted` es una red de seguridad — por
// construcción esta tarjeta nunca debería recibir un curso ya adoptado (se
// filtra antes), pero si algo se coló (caché desfasada, carrera), la tarjeta
// lo detecta por sí misma y NO deja adoptar dos veces (regla dura del §B).
function CatalogCard({ course, imageUrl, alreadyAdopted, adopting, onPreview, onAdd }: {
  course: Course; imageUrl: string | null; alreadyAdopted: boolean; adopting: boolean
  onPreview: () => void; onAdd: () => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = !!imageUrl && !imageFailed
  const categoryKey = course.category ?? 'sin_categoria'
  const CategoryIcon = CATEGORY_ICON[categoryKey]

  return (
    <Card className="overflow-hidden">
      <div className={`w-full aspect-video flex items-center justify-center cursor-pointer ${showImage ? '' : CATEGORY_BG[categoryKey]}`} onClick={onPreview}>
        {showImage ? (
          <img src={imageUrl!} alt={course.title} className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <CategoryIcon size={32} />
        )}
      </div>
      <div className="p-4">
        <p className="font-semibold text-text-primary line-clamp-2 cursor-pointer" onClick={onPreview}>{course.title}</p>
        <p className="text-xs text-text-secondary mt-1.5 inline-flex items-center gap-1">
          {course.estimatedMinutes && <Clock size={11} />}
          {[course.estimatedMinutes ? `${course.estimatedMinutes} min` : null, course.isMandatory ? 'Obligatorio' : null]
            .filter(Boolean).join(' · ')}
        </p>
        <Button
          size="sm"
          variant={alreadyAdopted ? 'outline' : 'primary'}
          className="w-full mt-3"
          disabled={alreadyAdopted || adopting}
          onClick={(e) => { e.stopPropagation(); onAdd() }}
        >
          {alreadyAdopted ? 'Ya lo tienes' : adopting ? 'Añadiendo…' : 'Añadir a mis cursos'}
        </Button>
      </div>
    </Card>
  )
}

// Tarjeta de Certificados externos (C6 §A): ni se asigna ni se "hace" desde
// aquí — es evidencia que se archiva en la ficha del empleado. Sin duración
// (0 min leería como curso roto) y sin ningún botón de acción.
function SoloArchivoCard({ course, imageUrl, onClick }: { course: Course; imageUrl: string | null; onClick: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = !!imageUrl && !imageFailed
  const categoryKey = course.category ?? 'sin_categoria'
  const CategoryIcon = CATEGORY_ICON[categoryKey]

  return (
    <Card className="overflow-hidden" onClick={onClick}>
      <div className={`w-full aspect-video flex items-center justify-center ${showImage ? '' : CATEGORY_BG[categoryKey]}`}>
        {showImage ? (
          <img src={imageUrl!} alt={course.title} className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <CategoryIcon size={32} />
        )}
      </div>
      <div className="p-4">
        <p className="font-semibold text-text-primary line-clamp-2">{course.title}</p>
        <p className="text-xs text-text-secondary mt-1.5">
          Lo imparte tu servicio de prevención. Súbelo en la ficha del empleado.
        </p>
      </div>
    </Card>
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

function CourseDetail({ course, accountId, staff, locations, onBack, onChanged, onAdopted, onPreview }: {
  course: Course
  accountId: string
  staff: Employee[]
  locations: Location[]
  onBack: () => void
  onChanged: () => void
  onAdopted: (newCourseId: string) => void
  onPreview: () => void
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
        <Button variant="outline" size="sm" onClick={onPreview}>
          <BookOpen size={14} /> Vista previa
        </Button>
      </div>

      {/* Información de "ficha de auditor" (C5 §C): se saca de la tarjeta del
          catálogo y aterriza aquí, donde sí importa. */}
      <div className="mb-5">
        <p className="text-sm text-text-secondary">{course.legalBasis || 'Sin base legal declarada'}</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Badge color="gray">{DELIVERY_LABEL[course.deliveryMode]}</Badge>
          {course.level && <Badge color="gray">{LEVEL_LABEL[course.level]}</Badge>}
          {course.isMandatory && <Badge color="blue">Obligatorio</Badge>}
          {course.appccPrerequisite && <Badge color="yellow">Prerrequisito APPCC</Badge>}
        </div>
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
        <h2 className="font-semibold text-text-primary flex items-center gap-2 mb-2"><ImageIcon size={16} /> Portada</h2>
        <CoverCard
          course={course}
          editable={editable}
          accountId={accountId}
          adoptedFromCourseId={course.adoptedFromCourseId}
          onChanged={load}
        />
      </section>

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

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-text-primary flex items-center gap-2"><ClipboardCheck size={16} /> Verificación práctica</h2>
          {editable && <AddPracticalItemButton courseId={course.id} nextOrd={content.practicalItems.length + 1} onAdded={load} />}
        </div>
        {editable && (
          <label className="flex items-center gap-2 text-sm text-text-primary mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={course.requiresPractical}
              onChange={async (e) => { await coursesService.updateCourse(course.id, { requiresPractical: e.target.checked }); onChanged() }}
            />
            Requiere verificación práctica (aprobar test + firmar no basta: un responsable debe verla en el puesto)
          </label>
        )}
        {course.requiresPractical ? (
          <div className="space-y-2">
            {content.practicalItems.length === 0 && (
              <p className="text-sm text-text-secondary">Sin gestos definidos todavía — añade 3-5 acciones observables.</p>
            )}
            {content.practicalItems.map(item => (
              <PracticalItemCard key={item.id} item={item} editable={editable} onChanged={load} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Este curso no exige verificación práctica.</p>
        )}
      </section>

      {editable && (
        <div className="flex justify-end pt-2">
          <PublishButton course={course} onDone={onChanged} />
        </div>
      )}
    </div>
  )
}

function AddPracticalItemButton({ courseId, nextOrd, onAdded }: { courseId: string; nextOrd: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [helpText, setHelpText] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    if (!text.trim()) return
    setSaving(true)
    try {
      await coursesService.createPracticalItem(courseId, { ord: nextOrd, text: text.trim(), helpText: helpText.trim() || undefined })
      setText(''); setHelpText(''); setOpen(false)
      onAdded()
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus size={14} /> Gesto</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo gesto observable">
        <div className="space-y-3">
          <div><Label>Gesto (qué debe ver hacer el verificador)</Label><Textarea rows={2} value={text} onChange={e => setText(e.target.value)} /></div>
          <div><Label>Ayuda para el verificador (opcional)</Label><Textarea rows={2} value={helpText} onChange={e => setHelpText(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={submit} disabled={saving}>Añadir</Button></div>
        </div>
      </Modal>
    </>
  )
}

function PracticalItemCard({ item, editable, onChanged }: {
  item: coursesService.CoursePracticalItem; editable: boolean; onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [helpText, setHelpText] = useState(item.helpText ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await coursesService.updatePracticalItem(item.id, { text, helpText: helpText.trim() || null })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!confirm('¿Borrar este gesto?')) return
    setBusy(true)
    try { await coursesService.deletePracticalItem(item.id); onChanged() }
    finally { setBusy(false) }
  }

  if (editing) {
    return (
      <Card className="p-4 space-y-2">
        <Textarea rows={2} value={text} onChange={e => setText(e.target.value)} />
        <Textarea rows={2} value={helpText} onChange={e => setHelpText(e.target.value)} placeholder="Ayuda para el verificador" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button size="sm" onClick={save} disabled={busy}>Guardar</Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-primary">{item.ord}. {item.text}</p>
          {item.helpText && <p className="text-xs text-text-secondary mt-1">{item.helpText}</p>}
        </div>
        {editable && (
          <div className="flex gap-1 shrink-0">
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-md hover:bg-accent-bg text-text-secondary" aria-label="Editar"><Pencil size={14} /></button>
            <button onClick={remove} className="p-1.5 rounded-md hover:bg-danger-bg text-danger" aria-label="Borrar" disabled={busy}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
    </Card>
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

function CoverCard({ course, editable, accountId, adoptedFromCourseId, onChanged }: {
  course: Course
  editable: boolean
  accountId: string
  adoptedFromCourseId: string | null
  onChanged: () => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancel = false
    setImageFailed(false)
    getSignedSectionImageUrl(course.coverUrl).then(url => { if (!cancel) setImageUrl(url) })
    return () => { cancel = true }
  }, [course.coverUrl])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadOwnCoverImage(accountId, course.id, file, course.coverUrl)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la portada')
    } finally {
      setBusy(false)
    }
  }

  async function revertToFolvy() {
    setBusy(true)
    setError(null)
    try {
      await revertCoverToFolvy(course.id, accountId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo volver a la portada de Folvy')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="w-full aspect-video rounded-lg overflow-hidden bg-page mb-3">
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt={course.title} className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-secondary">
            <ImageIcon size={28} />
          </div>
        )}
      </div>
      {editable && (
        <div>
          {error && <p className="text-xs text-danger mb-2">{error}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelected} />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {busy ? 'Subiendo…' : 'Cambiar portada'}
            </Button>
            {adoptedFromCourseId && (
              <Button size="sm" variant="ghost" onClick={revertToFolvy} disabled={busy}>
                Volver a la portada de Folvy
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
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
  const [matrix, setMatrix] = useState<TrainingComplianceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [targetType, setTargetType] = useState<'empleado' | 'puesto' | 'local'>('empleado')
  const [employeeId, setEmployeeId] = useState('')
  const [role, setRole] = useState(POSITIONS[0])
  const [locationId, setLocationId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Anti-duplicado (bug real en producción: el mismo curso asignado varias
  // veces a la misma persona, con intentos a medias repartidos entre
  // asignaciones). Si al pulsar "Asignar" ya hay una asignación ACTIVA (no
  // superada ni caducada) para ese destino, no se crea otra: se ofrece
  // actualizar la fecha límite de la que ya existe.
  const [duplicateOf, setDuplicateOf] = useState<CourseAssignment | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const [a, m] = await Promise.all([
        coursesService.listAssignments(course.id),
        getTrainingComplianceMatrix(accountId),
      ])
      setAssignments(a)
      setMatrix(m)
    }
    catch { setLoadError(true) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [course.id])

  /** Asignación ya existente que haría de ésta un duplicado, o null si no la hay. */
  function findDuplicate(): CourseAssignment | null {
    if (targetType === 'empleado') {
      if (!employeeId) return null
      const existing = assignments.find(a => a.employeeId === employeeId)
      if (!existing) return null
      // "Activa" = ni superada (vigente) ni caducada -- si ya la superó o ya
      // le caducó, una asignación nueva es legítima (reevaluación), no un
      // duplicado. Reutiliza training_compliance_matrix (C2): no se
      // recalcula "¿está vigente?" por quinta vez en el módulo.
      const state = matrix.find(r => r.employeeId === employeeId)?.courses[course.code]?.state
      const isActive = state === 'pendiente' || state === 'en_curso' || state === 'pendiente_practica'
      return isActive ? existing : null
    }
    if (targetType === 'puesto') {
      if (!role) return null
      // Por puesto/local no hay "estado de una persona" que consultar -- son
      // reglas estructurales (cualquiera que entre en ese puesto la hereda);
      // una segunda fila con el mismo puesto para el mismo curso nunca añade
      // cobertura nueva, así que se bloquea sin condición.
      return assignments.find(a => a.role === role) ?? null
    }
    if (targetType === 'local') {
      if (!locationId) return null
      return assignments.find(a => a.locationId === locationId) ?? null
    }
    return null
  }

  async function submit() {
    setFormError(null)
    const dup = findDuplicate()
    if (dup) { setDuplicateOf(dup); return }
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

  async function updateDueDateInstead() {
    if (!duplicateOf) return
    setSaving(true)
    setFormError(null)
    try {
      await coursesService.updateAssignment(duplicateOf.id, { dueAt: dueAt ? new Date(dueAt).toISOString() : null })
      setDuplicateOf(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo actualizar la fecha límite')
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
        {duplicateOf && (
          <Alert type="error" className="mb-3">
            <p className="font-medium">{targetLabel(duplicateOf)} ya tiene este curso asignado y sin superar.</p>
            <p className="text-sm mt-1">No se crea una asignación nueva — puedes actualizar la fecha límite de la que ya existe.</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={updateDueDateInstead} disabled={saving}>Actualizar fecha límite</Button>
              <Button size="sm" variant="outline" onClick={() => setDuplicateOf(null)}>Cancelar</Button>
            </div>
          </Alert>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Destino</Label>
            <Select value={targetType} onChange={e => { setTargetType(e.target.value as typeof targetType); setDuplicateOf(null) }}>
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
            <Select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setDuplicateOf(null) }}>
              <option value="">Selecciona…</option>
              {staff.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
        )}
        {targetType === 'puesto' && (
          <div className="mt-3">
            <Label>Puesto</Label>
            <Select value={role} onChange={e => { setRole(e.target.value); setDuplicateOf(null) }}>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
        )}
        {targetType === 'local' && (
          <div className="mt-3">
            <Label>Local</Label>
            <Select value={locationId} onChange={e => { setLocationId(e.target.value); setDuplicateOf(null) }}>
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
  pendiente_practica: { label: 'Falta verificación práctica', color: 'yellow' },
}

function SeguimientoTab({ course, staff }: { course: Course; staff: Employee[] }) {
  const { activeAccount } = useApp()
  const navigate = useNavigate()
  const [rows, setRows] = useState<TrackingRow[]>([])
  const [signatures, setSignatures] = useState<CourseSignatureRow[]>([])
  const [practicalItems, setPracticalItems] = useState<coursesService.CoursePracticalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generatingActa, setGeneratingActa] = useState(false)
  const [actaError, setActaError] = useState<string | null>(null)
  const [verifyingRow, setVerifyingRow] = useState<TrackingRow | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const [assignments, attempts] = await Promise.all([
        coursesService.listAssignments(course.id),
        coursesService.listAttemptsForCourse(course.id),
      ])
      const [sigs, items] = await Promise.all([
        coursesService.listSignaturesForAttempts(attempts.map((a: CourseAttempt) => a.id)),
        course.requiresPractical ? coursesService.listPracticalItems(course.id) : Promise.resolve([]),
      ])
      const checks = course.requiresPractical
        ? await coursesService.listPracticalChecksForAttempts(attempts.map((a: CourseAttempt) => a.id))
        : []
      setSignatures(sigs)
      setPracticalItems(items)
      setRows(coursesService.resolveTrackingRows(assignments, attempts, sigs, staff, {
        requiresPractical: course.requiresPractical,
        practicalItems: items,
        practicalChecks: checks,
      }))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancel = false
    load().catch(() => { if (!cancel) setLoadError(true) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              {course.requiresPractical && <th className="text-left px-3 py-2">Práctica</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.assignmentId}-${r.employeeId}-${i}`} className="border-t border-border-default">
                <td className="px-3 py-2 text-text-primary">
                  {r.employeeName}
                  {(r.employeePosition || r.employeeDepartment) && (
                    <span className="block text-xs text-text-secondary font-normal">
                      {[r.employeePosition, r.employeeDepartment].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2"><Badge color={TRACKING_BADGE[r.status].color}>{TRACKING_BADGE[r.status].label}</Badge></td>
                <td className="px-3 py-2 text-text-secondary">{r.scorePct != null ? `${r.scorePct}%` : '—'}</td>
                <td className="px-3 py-2 text-text-secondary">{r.signedAt ? new Date(r.signedAt).toLocaleString('es-ES') : '—'}</td>
                <td className={`px-3 py-2 ${r.overdue ? 'text-danger font-medium' : 'text-text-secondary'}`}>
                  {r.dueAt ? new Date(r.dueAt).toLocaleDateString('es-ES') : '—'}
                </td>
                {course.requiresPractical && (
                  <td className="px-3 py-2">
                    {r.status === 'pendiente_practica' && r.attemptId ? (
                      <Button size="sm" onClick={() => setVerifyingRow(r)}>Verificar ahora</Button>
                    ) : r.status === 'firmado' ? (
                      <span className="text-xs text-success">Verificado</span>
                    ) : (
                      <span className="text-xs text-text-tertiary">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {verifyingRow && verifyingRow.attemptId && (
        <VerifyPracticalModal
          attemptId={verifyingRow.attemptId}
          employeeName={verifyingRow.employeeName}
          items={practicalItems}
          onClose={() => setVerifyingRow(null)}
          onVerified={async () => { setVerifyingRow(null); await load() }}
        />
      )}
    </div>
  )
}

function VerifyPracticalModal({ attemptId, employeeName, items, onClose, onVerified }: {
  attemptId: string
  employeeName: string
  items: coursesService.CoursePracticalItem[]
  onClose: () => void
  onVerified: () => void
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await coursesService.verifyPracticalItems(
        attemptId,
        items.map(i => ({ itemId: i.id, checked: !!checks[i.id] })),
        notes.trim() || undefined,
      )
      onVerified()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la verificación. Recuerda: el verificador no puede ser quien firmó el intento.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Verificar práctica — ${employeeName}`} size="lg">
      <div className="space-y-3">
        {error && <Alert type="error">{error}</Alert>}
        <p className="text-sm text-text-secondary">
          Marca los gestos que has observado hacer correctamente a {employeeName}. Tu firma (tu identidad
          autenticada) queda registrada junto a la del trabajador.
        </p>
        <div className="space-y-2">
          {items.map(item => (
            <label key={item.id} className="flex items-start gap-2 p-3 rounded-lg border border-border-default cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!checks[item.id]}
                onChange={e => setChecks(c => ({ ...c, [item.id]: e.target.checked }))}
              />
              <span>
                <span className="text-sm text-text-primary">{item.text}</span>
                {item.helpText && <span className="block text-xs text-text-secondary mt-0.5">{item.helpText}</span>}
              </span>
            </label>
          ))}
        </div>
        <div>
          <Label>Notas (opcional)</Label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Guardando…' : 'Registrar verificación'}</Button>
        </div>
      </div>
    </Modal>
  )
}
