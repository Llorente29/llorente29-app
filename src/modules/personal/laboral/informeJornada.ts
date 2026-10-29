// src/modules/personal/laboral/informeJornada.ts
//
// L1a · PR 2 (28/10/2026). El informe del registro de jornada para la
// Inspección (tablero 5 de la maqueta): de los datos de la base
// (informe_registro_jornada o informe_por_enlace) a filas de leer, sin
// códigos, con fechas «12/10/2026», horas «09:05» y nombres de personas.
// Y la hoja de cálculo. Lo comparten la pantalla de la empresa, el enlace para
// la Inspección y el PDF.

import {
  diaCorto, diaMadrid, fechaLarga, fechaYHora, horaMadrid, horasYMinutos, jornadasPorDia, totalesJornada,
  type MarcaJornada, type TipoMarca, type TotalesJornada,
} from './calculoJornada'
import { etiquetaDeAusencia } from '@/types/personal'

// ── Lo que llega de la base ─────────────────────────────────────────────────

export interface MarcaInforme {
  id: string
  tipo: TipoMarca
  hora: string
  declarada: string | null
  llegada: string | null
  origen: string | null
  local: string | null
  distancia_m: number | null
  dentro_del_radio: boolean | null
  anulada: boolean
  /** La última vez que se corrigió SOLO su origen (0733): de qué venía y cuándo. */
  origen_corregido?: { antes: string | null; cuando: string; motivo: string | null } | null
}

export interface CambioInforme {
  id: string
  marca: string | null
  accion: 'create_manual' | 'edit' | 'void' | 'restore'
  cuando: string
  quien: string | null
  papel: string | null
  es_la_persona: boolean
  motivo: string | null
  antes: { type?: string; real_datetime?: string; datetime?: string } | null
  despues: { type?: string; real_datetime?: string; datetime?: string } | null
  conformidad: 'pendiente' | 'conforme' | 'desacuerdo' | null
  conformidad_at: string | null
  conformidad_nota: string | null
  peticion: { pedida_at: string; motivo: string; tipo: string } | null
  /** Solo cambió el origen (p. ej. «kiosko» que era el móvil): no toca la hora. */
  solo_origen?: boolean
}

export interface FirmaInforme {
  mes: string
  firmado_at: string
  invalidada_at: string | null
  invalidada_motivo: string | null
  vigente: boolean
}

export interface DatosInforme {
  generado_at: string
  periodo: { desde: string; hasta: string }
  empresa: { nombre: string; cif: string | null }
  persona: {
    id: string; nombre: string; dni: string | null; puesto: string | null; local: string | null
    tipo_contrato: string | null; horas_semana: number | null; alta: string | null
  }
  marcas: MarcaInforme[]
  cambios: CambioInforme[]
  firmas: FirmaInforme[]
  ausencias: { desde: string; hasta: string; tipo: string }[]
  festivos: { dia: string; nombre: string }[]
  enlace?: { caduca_at: string; creado_at: string }
}

// ── Lo que se enseña ────────────────────────────────────────────────────────

export interface TramoInforme {
  entrada: string
  pausas: string
  salida: string
  /** La salida es de otro día: «00:04 (del 24)». */
  total: string
  sinSalida: boolean
  larga: boolean
}

export interface FilaInforme {
  dia: string
  diaTexto: string
  tramos: TramoInforme[]
  minutos: number
  total: string
  /** Libre, vacaciones, festivo…: cuando no hay tramos. */
  sinJornada: string | null
  /** «Cómo se registró»: una frase por cosa, sin códigos. */
  registro: string[]
  corregido: boolean
  enDesacuerdo: boolean
}

export interface SemanaInforme {
  texto: string
  trabajadas: string
  contrato: string
  ordinarias: string
  extra: string
}

export interface InformeJornada {
  titulo: string
  subtitulo: string
  filas: FilaInforme[]
  semanas: SemanaInforme[]
  totales: { total: string; ordinarias: string; extra: string; corregidas: string; contrato: string }
  firma: string
  ley: string
  avisos: string[]
  totalesCrudos: TotalesJornada
}

const NOMBRE_TIPO: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', pausa_inicio: 'Pausa', pausa_fin: 'Vuelta de la pausa',
}
const PAPEL: Record<string, string> = { admin: 'administración', manager: 'encargado', worker: 'trabajador' }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «octubre de 2026». */
export function mesYAnio(dia: string): string {
  const [y, m] = dia.split('-').map(Number)
  return `${MESES[m - 1]} de ${y}`
}

/** El periodo en palabras: «octubre de 2026» si es un mes entero; si no, «del 01/10/2026 al 15/10/2026». */
export function textoPeriodo(desde: string, hasta: string): string {
  const [y, m] = desde.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (desde.endsWith('-01') && hasta === `${desde.slice(0, 8)}${String(ultimo).padStart(2, '0')}`) return mesYAnio(desde)
  return `del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`
}

/** El periodo de un mes «AAAA-MM»: del día 1 al último, o hasta hoy si es el mes en curso. */
export function periodoDelMes(mes: string, hoy: string = diaMadrid(new Date().toISOString())): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  return { desde: `${mes}-01`, hasta: ultimo > hoy && `${mes}-01` <= hoy ? hoy : ultimo }
}

/** Cómo se llamaba cada origen guardado, para decir de qué se corrigió. */
const NOMBRE_ORIGEN: Record<string, string> = {
  kiosko: 'quiosco del portal antiguo', movil: 'móvil', tablet: 'tablet del local', manual: 'puesta a mano',
}

/** Cómo se fichó una marca, en palabras. */
export function textoOrigen(m: MarcaInforme): string {
  const en = m.local ? ` en ${m.local}` : ''
  let t: string
  switch (m.origen) {
    case 'movil': t = `Fichado desde el móvil${en}`; break
    case 'tablet': t = `Fichado en la tablet del local${en}`; break
    case 'manual': t = 'Puesta a mano'; break
    // Lo que queda en «kiosko» después de la corrección del 29/10 (0732) no
    // tuvo ubicación: el portal antiguo no dejaba saber si fue el móvil o la tablet.
    case 'kiosko': t = 'Portal antiguo, sin ubicación: no se sabe si desde el móvil o la tablet'; break
    default: t = 'Sin origen guardado'
  }
  if (m.origen_corregido) {
    const antes = m.origen_corregido.antes ? `figuraba como «${NOMBRE_ORIGEN[m.origen_corregido.antes] ?? m.origen_corregido.antes}»` : 'no tenía origen'
    const porque = m.origen_corregido.antes === 'kiosko' && m.origen === 'movil' ? '; la marca tuvo ubicación del móvil' : ''
    t += ` · origen corregido el ${fechaYHora(m.origen_corregido.cuando)} (${antes}${porque})`
  }
  if (m.dentro_del_radio === false && m.distancia_m != null) t += ` · fuera del radio, a ${m.distancia_m} m`
  if (m.declarada && m.llegada) t += ` · sin cobertura: hora del móvil ${horaMadrid(m.declarada)}, llegó a las ${horaMadrid(m.llegada)}`
  return t
}

const quienTexto = (c: CambioInforme) => c.es_la_persona
  ? 'el propio trabajador'
  : `${c.quien ?? 'alguien sin nombre'}${c.papel && PAPEL[c.papel] ? ` (${PAPEL[c.papel]})` : ''}`

const horaDe = (s: CambioInforme['antes']) => (s?.real_datetime ?? s?.datetime) ? horaMadrid((s!.real_datetime ?? s!.datetime)!) : null

/** Una corrección, en una frase: qué, cuándo, quién, por qué y qué dice la persona. */
export function textoCambio(c: CambioInforme, marca: MarcaInforme | undefined): string {
  const tipo = NOMBRE_TIPO[c.despues?.type ?? c.antes?.type ?? marca?.tipo ?? ''] ?? 'Marca'
  let que: string
  if (c.accion === 'create_manual') que = `${tipo} añadida después (${horaDe(c.despues) ?? '—'})`
  else if (c.accion === 'edit') {
    const antes = horaDe(c.antes); const ahora = horaDe(c.despues)
    const cambioTipo = c.antes?.type && c.despues?.type && c.antes.type !== c.despues.type
      ? ` (antes era ${NOMBRE_TIPO[c.antes.type]?.toLowerCase() ?? c.antes.type})` : ''
    que = `${tipo} cambiada después: de las ${antes ?? '—'} a las ${ahora ?? '—'}${cambioTipo}`
  } else if (c.accion === 'void') que = `${tipo} de las ${horaDe(c.antes) ?? '—'} anulada después`
  else que = `${tipo} de las ${horaDe(c.despues) ?? '—'} recuperada`

  const partes = [que]
  if (c.peticion) {
    partes.push(`la pidió el trabajador el ${fechaYHora(c.peticion.pedida_at)} («${c.peticion.motivo}»), aprobada por ${quienTexto(c)} el ${fechaYHora(c.cuando)}`)
  } else {
    partes.push(`el ${fechaYHora(c.cuando)} por ${quienTexto(c)}`)
    if (c.motivo) partes.push(`motivo: «${c.motivo}»`)
  }
  if (c.conformidad === 'conforme') partes.push(`el trabajador está de acuerdo (${fechaYHora(c.conformidad_at!)})`)
  else if (c.conformidad === 'desacuerdo') partes.push(`EL TRABAJADOR NO ESTÁ DE ACUERDO (${fechaYHora(c.conformidad_at!)})${c.conformidad_nota ? `: «${c.conformidad_nota}»` : ''}`)
  else if (c.conformidad === 'pendiente') partes.push('el trabajador aún no ha dicho si está de acuerdo')
  return partes.join(' · ')
}

/** El informe, listo para enseñar, imprimir o exportar. */
export function armarInforme(d: DatosInforme, ahora: Date = new Date()): InformeJornada {
  const { desde, hasta } = d.periodo
  const marcasJ: MarcaJornada[] = d.marcas.map(m => ({ id: m.id, tipo: m.tipo, hora: m.hora, anulada: m.anulada }))
  const dias = jornadasPorDia(marcasJ, desde, hasta, ahora)
  const totales = totalesJornada(dias, d.persona.horas_semana)
  const porId = new Map(d.marcas.map(m => [m.id, m]))
  const cambiosPorMarca = new Map<string, CambioInforme[]>()
  // Las que solo corrigen el origen se cuentan en la marca (textoOrigen), no
  // como «corregido después»: no cambian ninguna hora.
  for (const c of d.cambios) if (c.marca && !c.solo_origen) cambiosPorMarca.set(c.marca, [...(cambiosPorMarca.get(c.marca) ?? []), c])

  const ausenciaDe = (dia: string) => d.ausencias.find(a => a.desde <= dia && a.hasta >= dia)
  const festivoDe = (dia: string) => d.festivos.find(f => f.dia === dia)

  const filas: FilaInforme[] = dias.map(dj => {
    // Las marcas de este día: las de sus tramos y las anuladas que caían en él.
    const ids = new Set<string>()
    for (const t of dj.tramos) { ids.add(t.entradaId); if (t.salidaId) ids.add(t.salidaId) }
    for (const m of d.marcas) {
      if (diaMadrid(m.hora) !== dj.dia) continue
      if (m.anulada || m.tipo === 'pausa_inicio' || m.tipo === 'pausa_fin') ids.add(m.id)
    }
    const marcasDia = [...ids].map(id => porId.get(id)).filter((m): m is MarcaInforme => !!m)
      .sort((a, b) => a.hora.localeCompare(b.hora))
    const origenes = [...new Set(marcasDia.filter(m => !m.anulada && m.origen !== 'manual').map(textoOrigen))]
    const cambios = marcasDia.flatMap(m => (cambiosPorMarca.get(m.id) ?? []).map(c => textoCambio(c, m)))
    const tramos: TramoInforme[] = dj.tramos.map(t => {
      const salidaOtroDia = t.salida && diaMadrid(t.salida) !== dj.dia ? ` (del ${Number(diaMadrid(t.salida).slice(8))})` : ''
      return {
        entrada: horaMadrid(t.entrada),
        pausas: t.pausas.length ? t.pausas.map(p => `${horaMadrid(p.inicio)}–${p.fin ? horaMadrid(p.fin) : '¿?'}`).join(', ') : '—',
        salida: t.salida ? horaMadrid(t.salida) + salidaOtroDia : (t.estado === 'abierto' ? 'en curso' : 'sin salida'),
        total: t.estado === 'cerrado' ? horasYMinutos(t.minutosTrabajados) : '—',
        sinSalida: t.estado === 'sin_salida',
        larga: t.larga,
      }
    })
    const aus = ausenciaDe(dj.dia); const fest = festivoDe(dj.dia)
    const sinJornada = tramos.length ? null
      : aus ? etiquetaDeAusencia(aus.tipo)
      : fest ? `Festivo · ${fest.nombre}`
      : 'Libre'
    return {
      dia: dj.dia, diaTexto: diaCorto(dj.dia), tramos, minutos: dj.minutosTrabajados,
      total: tramos.length ? horasYMinutos(dj.minutosTrabajados) : '',
      sinJornada,
      registro: [...origenes, ...cambios],
      corregido: cambios.length > 0,
      enDesacuerdo: marcasDia.some(m => (cambiosPorMarca.get(m.id) ?? []).some(c => c.conformidad === 'desacuerdo')),
    }
  })

  const semanas: SemanaInforme[] = totales.semanas.map(s => ({
    texto: `Semana del ${fechaLarga(s.lunes)}${s.diasEnElPeriodo < 7 ? ` (${s.diasEnElPeriodo} días en el periodo)` : ''}`,
    trabajadas: horasYMinutos(s.minutosTrabajados),
    contrato: s.minutosContrato === null ? 'sin jornada en el contrato' : horasYMinutos(s.minutosContrato),
    ordinarias: horasYMinutos(s.minutosOrdinarios),
    extra: s.minutosExtra === null ? '—' : horasYMinutos(s.minutosExtra),
  }))

  const marcasVivas = d.marcas.filter(m => {
    const dia = diaMadrid(m.hora); return dia >= desde && dia <= hasta
  })
  const corregidas = marcasVivas.filter(m => cambiosPorMarca.has(m.id)).length

  const p = d.persona
  const subtitulo = [
    d.empresa.nombre, d.empresa.cif,
    p.dni ? `${p.nombre} · ${p.dni}` : null,
    p.local ? `Centro: ${p.local}` : null, p.puesto,
    p.horas_semana ? `${String(p.horas_semana).replace('.', ',')} h a la semana` : 'Jornada del contrato sin poner',
  ].filter(Boolean).join(' · ')

  const avisos: string[] = []
  if (totales.tramosSinSalida > 0) avisos.push(`${totales.tramosSinSalida === 1 ? 'Una entrada no tiene' : `${totales.tramosSinSalida} entradas no tienen`} salida: esas horas no se cuentan hasta que se corrija.`)
  const largas = filas.reduce((n, f) => n + f.tramos.filter(t => t.larga).length, 0)
  if (largas > 0) avisos.push(`${largas === 1 ? 'Una jornada pasa' : `${largas} jornadas pasan`} de 12 horas.`)
  if (!p.horas_semana) avisos.push('El contrato no tiene la jornada puesta: no se pueden separar las horas ordinarias de las extra.')

  return {
    titulo: `Registro de jornada · ${p.nombre} · ${textoPeriodo(desde, hasta)}`,
    subtitulo,
    filas, semanas,
    totales: {
      total: horasYMinutos(totales.minutosTrabajados),
      ordinarias: horasYMinutos(totales.minutosOrdinarios),
      extra: totales.minutosExtra === null ? '—' : horasYMinutos(totales.minutosExtra),
      corregidas: `${corregidas} de ${marcasVivas.length}`,
      contrato: totales.minutosContrato === null ? '—' : horasYMinutos(totales.minutosContrato),
    },
    firma: textoFirma(d, desde, hasta),
    ley: textoLey(hasta),
    avisos,
    totalesCrudos: totales,
  }
}

function textoFirma(d: DatosInforme, desde: string, hasta: string): string {
  const meses: string[] = []
  for (let [y, m] = desde.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= hasta.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
    meses.push(`${y}-${String(m).padStart(2, '0')}-01`)
  }
  return meses.map(mes => {
    const delMes = d.firmas.filter(f => f.mes === mes)
    const vigente = delMes.find(f => f.vigente)
    const nombre = mesYAnio(mes)
    if (vigente) return `${cap(nombre)}: firmado por el trabajador desde su portal el ${fechaYHora(vigente.firmado_at)}.`
    const ultima = delMes.at(-1)
    if (ultima) return `${cap(nombre)}: firmado el ${fechaYHora(ultima.firmado_at)}, pero se corrigió un fichaje después: falta que vuelva a firmar.`
    return `${cap(nombre)}: sin firmar por el trabajador.`
  }).join(' ')
}

function textoLey(hasta: string): string {
  const [y, m] = hasta.split('-').map(Number)
  return `Se guarda hasta ${MESES[m - 1]} de ${y + 4} (Estatuto de los Trabajadores, art. 34.9). Ninguna marca se borra: una corrección deja la original y la nueva, con quién, cuándo y por qué.`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── La hoja de cálculo ──────────────────────────────────────────────────────

const celda = (v: string) => /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

/** El informe como hoja de cálculo (CSV con «;», que Excel en español abre tal cual). */
export function hojaDeCalculo(inf: InformeJornada): string {
  const filas: string[][] = [
    [inf.titulo], [inf.subtitulo], [],
    ['Fecha', 'Día', 'Entrada', 'Pausas', 'Salida', 'Horas', 'Cómo se registró'],
  ]
  for (const f of inf.filas) {
    if (f.tramos.length === 0) {
      filas.push([fechaLarga(f.dia), f.diaTexto, '', '', '', '', f.sinJornada ?? ''])
      continue
    }
    f.tramos.forEach((t, i) => {
      filas.push([fechaLarga(f.dia), f.diaTexto, t.entrada, t.pausas, t.salida, t.total, i === 0 ? f.registro.join(' | ') : ''])
    })
  }
  filas.push([], ['Semana', 'Trabajadas', 'Contrato', 'Ordinarias', 'Extra'])
  for (const s of inf.semanas) filas.push([s.texto, s.trabajadas, s.contrato, s.ordinarias, s.extra])
  filas.push([], ['Total', inf.totales.total], ['Ordinarias', inf.totales.ordinarias], ['Extra', inf.totales.extra], ['Marcas corregidas', inf.totales.corregidas])
  filas.push([], [inf.firma], [inf.ley])
  return '﻿' + filas.map(r => r.map(celda).join(';')).join('\r\n') + '\r\n'
}
