// src/services/courseFromRecipeService.ts
// Formación C7 — Generar curso desde el escandallo (docs/folvy_formacion_catalogo_v2.md
// §7 nivel 1). La jugada que ningún LMS puede copiar: Folvy tiene pasos de
// receta vinculados a ingredientes (recipe_item_step_line, E8) y puede
// convertir eso en un curso sin escribir nada.
//
// Reparto de trabajo (ver comentario largo en la migración
// 20260810T1200_formacion_c7_curso_desde_escandallo.sql): este servicio LEE
// la receta con los servicios de Kitchen ya existentes (listStepsByRecipe,
// getRecipeBreakdown, listItemAllergens — no se reinventa esa lógica),
// CONSTRUYE el contenido (secciones, test, gesto práctico) y se lo pasa
// COMPLETO a la RPC generate_course_from_recipe, que lo persiste de forma
// atómica. Las fotos NO viajan en la RPC — Postgres no puede copiar bytes
// entre buckets de Storage — así que este servicio, DESPUÉS de que la RPC
// devuelva los ids de sección, descarga cada foto de recipe-uploads y la
// vuelve a subir a course-section-images (copia, no referencia: si la foto
// de la receta cambia luego, el curso ya generado no muta). Un fallo al
// copiar UNA foto no aborta el curso — se registra en `warnings` y la
// sección se queda sin imagen (cae sola a la capa 3 de courseImagesService).

import { supabase } from '../lib/supabase'
import { fmtQty } from '../lib/format'
import { getRecipeItemById } from '@/modules/kitchen/services/recipeItemService'
import { listStepsByRecipe } from '@/modules/kitchen/services/recipeStepService'
import { getRecipeBreakdown, type RecipeLineBreakdown } from '@/modules/kitchen/services/recipeLineService'
import { listItemAllergens } from '@/modules/kitchen/services/recipeItemAllergenService'
import { ALLERGEN_CODES, allergenLabel, type AllergenCode } from '@/modules/kitchen/lib/allergens'
import type { RecipeItemStep } from '@/types/kitchen'

const RECIPE_BUCKET = 'recipe-uploads'
const COURSE_BUCKET = 'course-section-images'
const MAX_RECOMMENDED_MINUTES = 10

export interface GenerateCourseResult {
  courseId: string
  version: number
  regenerated: boolean
  warnings: string[]
}

// ============================================================
// Helpers de formato/aleatoriedad
// ============================================================

function truncate(text: string, max = 90): string {
  const t = text.trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

/** "200.000" molesta al leer; recorta ceros sobrantes y usa coma española. */
function fmtQtyReadable(n: number): string {
  const rounded = Number(fmtQty(n, 3))
  return rounded.toString().replace('.', ',')
}

function isExternalUrl(path: string): boolean {
  return /^https?:\/\//i.test(path)
}

/** Fisher-Yates in place. Math.random() aquí es código de app normal (no un
 * script de workflow) — se usa para que la opción correcta no caiga siempre
 * en la misma letra (guía §5: "si todas caen en la misma letra, se aprueba
 * marcando siempre igual sin leer"). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface OptionDraft { text: string; explanation: string }
interface QuestionDraft { question: string; correct: OptionDraft; distractors: OptionDraft[] }

function toGeneratedQuestion(ord: number, d: QuestionDraft) {
  const options = shuffle([
    { text: d.correct.text, explanation: d.correct.explanation, isCorrect: true },
    ...d.distractors.map(o => ({ ...o, isCorrect: false })),
  ])
  return { ord, text: d.question, options }
}

// ============================================================
// Generación de preguntas — honesta: sin datos suficientes, no hay pregunta.
// Nunca se fabrica un hecho; los distractores son datos REALES del propio
// plato (otro paso, otra cantidad, otro alérgeno) mal emparejados a
// propósito, o variaciones numéricas plausibles cuando no hay más remedio.
// ============================================================

function buildOrderQuestion(dishName: string, steps: RecipeItemStep[]): QuestionDraft | null {
  if (steps.length < 2) return null
  const first = steps[0]
  const distractors = steps.slice(1, 4).map(s => ({
    text: truncate(s.text),
    explanation: 'No es el primer paso — va después en la elaboración.',
  }))
  return {
    question: `Al elaborar ${dishName}, ¿qué paso va PRIMERO?`,
    correct: { text: truncate(first.text), explanation: `Es el primer paso de la elaboración: "${truncate(first.text, 140)}".` },
    distractors,
  }
}

function buildQuantityQuestions(dishName: string, breakdown: RecipeLineBreakdown[]): QuestionDraft[] {
  const withQty = breakdown.filter(b => (b.quantityNet ?? b.quantity) != null && b.unitAbbr)
  if (withQty.length < 2) return []

  return withQty.slice(0, 2).map((target): QuestionDraft | null => {
    const qty = target.quantityNet ?? target.quantity
    const pool = withQty.filter(b => b.lineId !== target.lineId)
    const sameUnit = pool.filter(b => b.unitAbbr === target.unitAbbr)
    const source = sameUnit.length > 0 ? sameUnit : pool
    const distractors = source.slice(0, 3).map(b => ({
      text: `${fmtQtyReadable(b.quantityNet ?? b.quantity)} ${b.unitAbbr}`,
      explanation: `Esa cantidad es de ${b.childName}, no de ${target.childName}.`,
    }))
    if (distractors.length === 0) return null
    return {
      question: `¿Cuánta cantidad de ${target.childName} lleva ${dishName}?`,
      correct: {
        text: `${fmtQtyReadable(qty)} ${target.unitAbbr}`,
        explanation: `Es la cantidad de ${target.childName} que marca la ficha del plato.`,
      },
      distractors,
    }
  }).filter((q): q is QuestionDraft => q !== null)
}

function buildAllergenQuestion(
  dishName: string,
  declared: { code: AllergenCode }[],
): QuestionDraft | null {
  if (declared.length === 0) return null
  const correctCode = declared[0].code
  const notDeclared = ALLERGEN_CODES.filter(c => !declared.some(d => d.code === c))
  const distractors = shuffle(notDeclared).slice(0, 3).map(c => ({
    text: allergenLabel(c),
    explanation: `${allergenLabel(c)} no está declarado en este plato.`,
  }))
  if (distractors.length === 0) return null
  return {
    question: `¿Qué alérgeno de declaración obligatoria lleva ${dishName}?`,
    correct: { text: allergenLabel(correctCode), explanation: `${allergenLabel(correctCode)} está declarado en la ficha de alérgenos de este plato.` },
    distractors,
  }
}

function buildTempOrTimeQuestion(dishName: string, steps: RecipeItemStep[]): QuestionDraft | null {
  const withTemp = steps.filter((s): s is RecipeItemStep & { temperatureC: number } => s.temperatureC != null)
  if (withTemp.length >= 1) {
    const target = withTemp[0]
    const otherReal = withTemp.slice(1).map(s => s.temperatureC)
    const distractorValues = otherReal.length > 0
      ? otherReal.slice(0, 3)
      : [target.temperatureC + 20, Math.max(1, target.temperatureC - 15), target.temperatureC + 40]
    return {
      question: `En ${dishName}, ¿a qué temperatura se hace el paso "${truncate(target.text, 60)}"?`,
      correct: { text: `${target.temperatureC} °C`, explanation: `Es la temperatura que marca la ficha para este paso.` },
      distractors: distractorValues.map(v => ({ text: `${v} °C`, explanation: 'No es la temperatura de este paso según la ficha.' })),
    }
  }

  const withDuration = steps.filter((s): s is RecipeItemStep & { durationMin: number } => s.durationMin != null)
  if (withDuration.length >= 1) {
    const target = withDuration[0]
    const otherReal = withDuration.slice(1).map(s => s.durationMin)
    const distractorValues = otherReal.length > 0
      ? otherReal.slice(0, 3)
      : [target.durationMin + 10, Math.max(1, target.durationMin - 5), target.durationMin * 2]
    return {
      question: `En ${dishName}, ¿cuánto tiempo lleva el paso "${truncate(target.text, 60)}"?`,
      correct: { text: `${target.durationMin} min`, explanation: 'Es el tiempo que marca la ficha para este paso.' },
      distractors: distractorValues.map(v => ({ text: `${Math.round(v)} min`, explanation: 'No es el tiempo de este paso según la ficha.' })),
    }
  }

  return null
}

// ============================================================
// Contenido de secciones
// ============================================================

interface SectionDraft { title: string; body: string; sourcePhotoPath: string | null }

function buildIngredientsList(breakdown: RecipeLineBreakdown[]): string {
  if (breakdown.length === 0) return '_Sin ingredientes registrados en el escandallo._'
  return breakdown
    .map(b => `- ${fmtQtyReadable(b.quantityNet ?? b.quantity)} ${b.unitAbbr} de ${b.childName}`)
    .join('\n')
}

function buildIntroSection(dishName: string, kitchenPhotoUrl: string | null, totalMinutes: number, breakdown: RecipeLineBreakdown[]): SectionDraft {
  return {
    title: 'Qué vas a preparar',
    body: `**${dishName}**\n\nTiempo total estimado de elaboración: **${totalMinutes} min**.\n\nIngredientes:\n${buildIngredientsList(breakdown)}`,
    sourcePhotoPath: kitchenPhotoUrl,
  }
}

function buildStepSection(step: RecipeItemStep, lines: RecipeLineBreakdown[]): SectionDraft {
  const parts: string[] = [step.text]
  if (step.temperatureC != null) parts.push(`> Temperatura: **${step.temperatureC} °C**`)
  if (step.durationMin != null) parts.push(`> Tiempo: **${step.durationMin} min**`)
  if (lines.length > 0) {
    parts.push(`Ingredientes de este paso:\n${lines.map(l => `- ${fmtQtyReadable(l.quantityNet ?? l.quantity)} ${l.unitAbbr} de ${l.childName}`).join('\n')}`)
  }
  return {
    title: `Paso ${step.position + 1}`,
    body: parts.join('\n\n'),
    sourcePhotoPath: step.photoUrl,
  }
}

function buildAllergensSection(dishName: string, declared: { code: AllergenCode; state: string }[]): SectionDraft {
  if (declared.length === 0) {
    return {
      title: 'Alérgenos de este plato',
      body: `No hay alérgenos de declaración obligatoria registrados para **${dishName}**.\n\n> Antes de darlo por bueno, confirma que la ficha de alérgenos del plato esté completa — un alérgeno sin declarar es un riesgo real, no un descuido.`,
      sourcePhotoPath: null,
    }
  }
  const stateLabel: Record<string, string> = { contains: 'lo contiene', may_contain: 'puede contener trazas' }
  const list = declared.map(a => `- **${allergenLabel(a.code)}** (${stateLabel[a.state] ?? a.state})`).join('\n')
  return {
    title: 'Alérgenos de este plato',
    body: `**${dishName}** lleva declarados estos alérgenos de declaración obligatoria:\n\n${list}\n\n> Verifica siempre la ficha de alérgenos actualizada antes de servir a un cliente con alergia — esta lista es la que ya calcula el motor de herencia de alérgenos, no la recalcules a ojo.`,
    sourcePhotoPath: null,
  }
}

// ============================================================
// Copia de fotos cross-bucket (recipe-uploads -> course-section-images)
// ============================================================

async function copyRecipePhotoToCourse(accountId: string, courseId: string, sectionKey: string, sourcePath: string): Promise<string> {
  if (!supabase) throw new Error('Supabase no disponible')
  const { data: blob, error: downErr } = await supabase.storage.from(RECIPE_BUCKET).download(sourcePath)
  if (downErr || !blob) throw new Error(downErr?.message ?? 'No se pudo descargar la foto de origen')
  const ext = (sourcePath.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const destPath = `${accountId}/from-recipe/${courseId}-${sectionKey}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from(COURSE_BUCKET).upload(destPath, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  if (upErr) throw new Error(upErr.message)
  return destPath
}

async function resolveSectionPhoto(
  accountId: string,
  courseId: string,
  section: { id: string; ord: number; sourcePhotoPath: string | null },
  title: string,
  warnings: string[],
): Promise<void> {
  if (!section.sourcePhotoPath || !supabase) return

  // URL externa (enlace pegado en la receta, no un archivo en recipe-uploads):
  // pasa tal cual, courseImagesService ya la sirve directa sin firmar.
  if (isExternalUrl(section.sourcePhotoPath)) {
    const { error } = await supabase.from('course_section').update({ media_url: section.sourcePhotoPath }).eq('id', section.id)
    if (error) warnings.push(`No se pudo enlazar la foto de "${title}": ${error.message}`)
    return
  }

  try {
    const copiedPath = await copyRecipePhotoToCourse(accountId, courseId, section.id, section.sourcePhotoPath)
    const { error } = await supabase.from('course_section').update({ media_url: copiedPath }).eq('id', section.id)
    if (error) throw error
  } catch (e) {
    warnings.push(`No se pudo copiar la foto de "${title}": ${e instanceof Error ? e.message : 'error desconocido'}`)
  }
}

// ============================================================
// Orquestación
// ============================================================

export async function generateCourseFromRecipe(recipeItemId: string): Promise<GenerateCourseResult> {
  if (!supabase) throw new Error('Supabase no disponible')

  const recipe = await getRecipeItemById(recipeItemId)
  if (!recipe) throw new Error('Plato no encontrado')

  const [steps, breakdown, allergens] = await Promise.all([
    listStepsByRecipe(recipeItemId),
    getRecipeBreakdown(recipeItemId),
    listItemAllergens(recipeItemId),
  ])
  const declaredAllergens = allergens.filter(a => a.state === 'contains' || a.state === 'may_contain')
  const breakdownByLineId = new Map(breakdown.map(b => [b.lineId, b]))

  const totalStepMinutes = steps.reduce((sum, s) => sum + (s.durationMin ?? 0), 0)

  const sectionDrafts: SectionDraft[] = [
    buildIntroSection(recipe.name, recipe.kitchenPhotoUrl, 0, breakdown), // duración real se calcula abajo con el total de secciones
    ...steps.map(s => buildStepSection(s, s.lineIds.map(id => breakdownByLineId.get(id)).filter((b): b is RecipeLineBreakdown => !!b))),
    buildAllergensSection(recipe.name, declaredAllergens),
  ]
  const estimatedMinutes = Math.max(5, Math.round(totalStepMinutes + sectionDrafts.length))
  sectionDrafts[0] = buildIntroSection(recipe.name, recipe.kitchenPhotoUrl, estimatedMinutes, breakdown)

  const warnings: string[] = []

  const questionDrafts: QuestionDraft[] = []
  const order = buildOrderQuestion(recipe.name, steps)
  if (order) questionDrafts.push(order); else warnings.push(
    steps.length === 0
      ? 'Este plato no tiene pasos registrados en el escandallo: no se generó pregunta de orden.'
      : 'Este plato solo tiene un paso registrado: no se generó pregunta de orden (hacen falta al menos dos).',
  )
  const quantityQs = buildQuantityQuestions(recipe.name, breakdown)
  questionDrafts.push(...quantityQs)
  if (quantityQs.length === 0) warnings.push('Muy pocos ingredientes con cantidad en el escandallo: no se generaron preguntas de cantidades.')
  const allergenQ = buildAllergenQuestion(recipe.name, declaredAllergens)
  if (allergenQ) questionDrafts.push(allergenQ); else warnings.push('Este plato no tiene alérgenos declarados: no se generó pregunta de alérgenos.')
  const tempTimeQ = buildTempOrTimeQuestion(recipe.name, steps)
  if (tempTimeQ) questionDrafts.push(tempTimeQ); else warnings.push('Ningún paso tiene temperatura ni tiempo registrados: no se generó esa pregunta.')

  warnings.push(`Se han generado ${questionDrafts.length} pregunta${questionDrafts.length === 1 ? '' : 's'}. Revísalas y añade las que falten.`)
  if (estimatedMinutes > MAX_RECOMMENDED_MINUTES) {
    warnings.push(`El curso dura unos ${estimatedMinutes} min, por encima de los ${MAX_RECOMMENDED_MINUTES} min recomendados para un curso de producto. Es la receta la que es larga — revisa si conviene dividirla en vez de recortar el curso.`)
  }

  const rpcSections = sectionDrafts.map((s, i) => ({ ord: i + 1, title: s.title, body: s.body, sourcePhotoPath: s.sourcePhotoPath }))
  const rpcQuestions = questionDrafts.map((d, i) => toGeneratedQuestion(i + 1, d))

  const { data, error } = await supabase.rpc('generate_course_from_recipe', {
    p_recipe_item_id: recipeItemId,
    p_title: recipe.name,
    p_summary: `Curso generado desde el escandallo de ${recipe.name}.`,
    p_estimated_minutes: estimatedMinutes,
    p_sections: rpcSections,
    p_questions: rpcQuestions,
    p_practical_item_text: 'Elabora el plato siguiendo la ficha y enséñaselo a tu responsable.',
  })
  if (error) { console.error('[courseFromRecipeService] generate_course_from_recipe', error); throw error }

  const result = data as unknown as {
    courseId: string; version: number; regenerated: boolean
    sections: { id: string; ord: number; sourcePhotoPath: string | null }[]
  }

  await Promise.all(
    result.sections.map(s => resolveSectionPhoto(
      recipe.accountId,
      result.courseId,
      s,
      sectionDrafts[s.ord - 1]?.title ?? `sección ${s.ord}`,
      warnings,
    )),
  )

  return { courseId: result.courseId, version: result.version, regenerated: result.regenerated, warnings }
}
