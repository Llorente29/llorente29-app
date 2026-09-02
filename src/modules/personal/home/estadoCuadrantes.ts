// src/modules/personal/home/estadoCuadrantes.ts
//
// Lo que la tarjeta «Cuadrantes» del Inicio deduce (§1.6 de la maqueta).
//
// La maqueta NO pide una cifra grande aquí: pide una FILA POR LOCAL con su
// estado. Es la decisión de contenido correcta, porque un número único tendría
// que sumar cosas que no se suman.
//
// ── «BORRADOR» Y «SIN PUBLICAR» SON ESTADOS DISTINTOS ──────────────────────
// Un cuadrante en borrador es alguien que empezó y no terminó; uno que no
// existe es que nadie lo ha tocado. Los dos significan «el equipo no sabe
// cuándo trabaja», pero se arreglan de forma distinta, así que se enseñan
// distintos. La PALABRA dice qué es; el COLOR dice cómo de grave.
//
// ── SOLO LOCALES ACTIVOS, Y ESTO COSTÓ UNA ALARMA PERMANENTE ───────────────
// Foodint Plaza Castilla está cerrado (`locations.active = false`) y arrastra
// CATORCE cuadrantes, todos en borrador, incluidos los de septiembre. Una
// tarjeta que no filtre por `active` diría «3 semanas sin publicar» el primer
// día, dos de ellas de un local que no abre. Eso no es un dato con un error:
// es una alarma que nunca se puede apagar, y una alarma que no se puede apagar
// enseña a ignorar las demás — el mismo mecanismo que los 96 correos diarios.

import { semanasEntre } from '@/lib/fechas'

export type EstadoSemana = 'publicado' | 'borrador' | 'sin_publicar'

export interface LocalActivo { id: string; nombre: string }
export interface FilaSchedule { locationId: string; weekStart: string; status: string }

export interface FilaCuadrante {
  locationId: string
  estado: EstadoSemana
  /** Semanas desde el último cuadrante publicado. 0 si la semana en curso lo está. */
  semanasSinPublicar: number
  etiqueta: string
  valor: string
  tono: 'neutral' | 'attention' | 'bad'
}

/** «31» de '2026-08-31', para «· semana del 31». */
function diaDelLunes(lunes: string): string {
  return String(Number(lunes.slice(8, 10)))
}

export function construyeFilas(
  locales: LocalActivo[],
  schedules: FilaSchedule[],
  lunesEnCurso: string,
): FilaCuadrante[] {
  return locales.map(l => {
    const suyos = schedules.filter(s => s.locationId === l.id)
    const enCurso = suyos.find(s => s.weekStart === lunesEnCurso)

    // El último lunes publicado, mirando SOLO hacia atrás: un cuadrante
    // publicado de dentro de tres semanas no arregla que esta semana falte.
    const publicados = suyos
      .filter(s => s.status === 'published' && s.weekStart <= lunesEnCurso)
      .map(s => s.weekStart)
      .sort()
    const ultimoPublicado = publicados.length > 0 ? publicados[publicados.length - 1] : null
    const semanasSinPublicar = ultimoPublicado ? semanasEntre(ultimoPublicado, lunesEnCurso) : 0

    const estado: EstadoSemana =
      enCurso?.status === 'published' ? 'publicado'
      : enCurso ? 'borrador'
      : 'sin_publicar'

    // La palabra dice QUÉ es. La antigüedad se añade cuando lleva dos semanas o
    // más sin publicarse: una semana de retraso es el lunes por la mañana.
    const palabra = estado === 'publicado' ? 'publicado'
      : estado === 'borrador' ? 'borrador' : 'sin publicar'
    const conAntiguedad = estado !== 'publicado' && semanasSinPublicar >= 2
    const valor = conAntiguedad ? `${palabra} · ${semanasSinPublicar} sem.` : palabra

    // El COLOR dice cómo de grave, y no siempre coincide con la palabra: un
    // borrador que lleva cuatro semanas sin publicarse no es ámbar. Un borrador
    // que nadie publica no está publicado.
    const tono: FilaCuadrante['tono'] =
      estado === 'publicado' ? 'neutral'
      : conAntiguedad || estado === 'sin_publicar' ? 'bad'
      : 'attention'

    return {
      locationId: l.id,
      estado,
      semanasSinPublicar,
      etiqueta: `${l.nombre} · semana del ${diaDelLunes(lunesEnCurso)}`,
      valor,
      tono,
    }
  })
}

// ── LA LÍNEA DE CONSECUENCIA ───────────────────────────────────────────────
// «Mirlenys de vacaciones del 7 al 13 — Keilymar se queda como única persona».
//
// Sale de cruzar las ausencias APROBADAS con la plantilla del local. Una
// solicitud rechazada no quita a nadie de su puesto, y contarla inventaría una
// urgencia que no existe.
//
// Si hoy no hay ningún caso, NO SE PINTA NADA. Una tarjeta que siempre tiene
// algo que decir acaba diciendo cosas que no importan, y entonces tampoco se
// lee el día que sí.

export interface Empleado { id: string; nombre: string; locationId: string | null }
export interface Ausencia {
  empleadoId: string
  estado: string
  desde: string          // 'YYYY-MM-DD'
  hasta: string          // 'YYYY-MM-DD'
  tipo: string | null
}

/** «Mirlenys Eloisa Castañeda» → «Mirlenys»; «KEILYMAR ARAUJO LOBO» → «Keilymar». */
export function nombreDePila(completo: string): string {
  const primero = completo.trim().split(/\s+/)[0] ?? completo
  return primero.charAt(0).toLocaleUpperCase('es') + primero.slice(1).toLocaleLowerCase('es')
}

/** «del 7 al 13», o «del 28 de septiembre al 4 de octubre» si cambia el mes. */
export function rangoLegible(desde: string, hasta: string): string {
  const [, mA, dA] = desde.split('-')
  const [, mB, dB] = hasta.split('-')
  const dia = (d: string) => String(Number(d))
  if (mA === mB) return `del ${dia(dA)} al ${dia(dB)}`
  const mes = (m: string) =>
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
     'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m) - 1]
  return `del ${dia(dA)} de ${mes(mA)} al ${dia(dB)} de ${mes(mB)}`
}

/**
 * El primer tramo, dentro de la ventana, en que un local activo se queda con
 * UNA sola persona. null si no hay ninguno.
 */
export function detectaSoledad(
  locales: LocalActivo[],
  empleados: Empleado[],
  ausencias: Ausencia[],
  hoy: string,
  diasVentana = 21,
): string | null {
  const aprobadas = ausencias.filter(a => a.estado === 'aprobada')
  if (aprobadas.length === 0) return null

  for (const a of aprobadas) {
    if (a.hasta < hoy) continue
    const quien = empleados.find(e => e.id === a.empleadoId)
    if (!quien?.locationId) continue
    const local = locales.find(l => l.id === quien.locationId)
    if (!local) continue                       // local inactivo: no es una urgencia

    const plantilla = empleados.filter(e => e.locationId === local.id)
    // Quién más falta en ese mismo tramo (dos ausencias solapadas dejan a
    // menos gente todavía).
    const fuera = new Set(
      aprobadas
        .filter(o => o.desde <= a.hasta && o.hasta >= a.desde)
        .map(o => o.empleadoId),
    )
    const quedan = plantilla.filter(e => !fuera.has(e.id))
    if (quedan.length !== 1) continue

    const desde = a.desde > hoy ? a.desde : hoy
    const ventanaFin = sumaDias(hoy, diasVentana)
    if (desde > ventanaFin) continue

    const motivo = (a.tipo ?? 'vacaciones').toLowerCase() === 'vacaciones'
      ? 'de vacaciones' : `de ${a.tipo}`
    // «se queda como única persona» y no «sola»: el género no está en la ficha
    // del empleado y no se deduce de un nombre. «persona» concuerda consigo
    // misma y no se equivoca con nadie.
    return `${nombreDePila(quien.nombre)} ${motivo} ${rangoLegible(a.desde, a.hasta)} — `
      + `${nombreDePila(quedan[0].nombre)} se queda como única persona`
  }
  return null
}

function sumaDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
