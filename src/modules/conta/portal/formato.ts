// src/modules/conta/portal/formato.ts
//
// GP · Tarea 3 (Code 3, 09/11/2026) · Lo puro de las pantallas del portal del
// cliente: euros, fechas y meses en palabras, iniciales, el color de cada estado
// y cómo se lee un recibo de Code 1 (sus líneas y por qué cambia). Sin React ni
// red: lo prueban tests/unit/portal/formato.test.ts.
//
// Palabras de la calle: recibo, factura, pagar, devuelto. Nunca «mandato»,
// «payment» ni «SEPA».

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)

/** 15730 → «157,30 €». */
export const euros = (cent: number | null | undefined): string => (cent == null ? '—' : `${fmt.format(cent / 100)} €`)
/** 157.3 → «157,30 €» (lo que viene en euros de la base: facturas, impuestos). */
export const eurosDe = (e: number | string | null | undefined): string => (e == null || e === '' ? '—' : `${fmt.format(Number(e))} €`)

/** «2026-11-04» o una marca de tiempo → «4 de noviembre» (y el año si no es este). */
export function fecha(x: string | null | undefined, hoy: Date = new Date()): string {
  if (!x) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x)
  if (!m) return '—'
  const d = x.length > 10 ? new Date(x) : null
  const [a, mes, dia] = d && !Number.isNaN(d.getTime())
    ? madrid(d)
    : [Number(m[1]), Number(m[2]), Number(m[3])]
  return `${dia} de ${MESES[mes - 1]}${a !== madrid(hoy)[0] ? ` de ${a}` : ''}`
}

/** «4 dic». */
export function fechaCorta(x: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x ?? '')
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1].slice(0, 3)}` : '—'
}

/** La hora de un mensaje: «hoy 9:14», «ayer 17:02» o «3 de noviembre 17:02». */
export function cuando(x: string, ahora: Date = new Date()): string {
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return ''
  const hm = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', minute: '2-digit' }).format(d)
  const dia = (y: Date) => madrid(y).join('-')
  if (dia(d) === dia(ahora)) return `hoy ${hm}`
  if (dia(d) === dia(new Date(ahora.getTime() - 86_400_000))) return `ayer ${hm}`
  return `${fecha(x, ahora)} ${hm}`
}

function madrid(d: Date): [number, number, number] {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number)
  return [p[0], p[1], p[2]]
}

/** «2026-11» → «Noviembre» (con el año si no es este). */
export function mes(m: string | null | undefined, hoy: Date = new Date()): string {
  const x = /^(\d{4})-(\d{2})$/.exec(m ?? '')
  if (!x) return m ?? ''
  const n = MESES[Number(x[2]) - 1]
  return `${n[0].toUpperCase()}${n.slice(1)}${Number(x[1]) !== madrid(hoy)[0] ? ` de ${x[1]}` : ''}`
}

/** «Gestoría Demo» → «GD»; «Antonio Ruiz» → «AR». */
export function iniciales(n: string | null | undefined): string {
  const p = (n ?? '').replace(/[,.]/g, ' ').split(/\s+/).filter((w) => w && !/^(s\.?l\.?|s\.?a\.?|de|del|la|el|y)$/i.test(w))
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·'
}

/** El nombre de pila para el saludo: «Antonio Ruiz» → «Antonio»; un correo, nada. */
export const nombreDePila = (n: string | null | undefined): string => (n && !n.includes('@') ? n.trim().split(/\s+/)[0] : '')

export type Tono = 'ok' | 'mal' | 'info' | 'gris' | 'aviso'
export const TONOS: Record<Tono, { fondo: string; tinta: string }> = {
  ok: { fondo: '#E6F5EE', tinta: '#0B6B4F' },
  mal: { fondo: '#FDE8E7', tinta: '#A11B12' },
  info: { fondo: '#E3ECFD', tinta: '#1747AE' },
  gris: { fondo: '#EEF1F6', tinta: '#33445E' },
  aviso: { fondo: '#FFF1DE', tinta: '#8A4B08' },
}

/** El tono de cada estado que enseña el portal. */
export function tonoDe(estado: string): Tono {
  if (/^(Pagad|Cobrad|De alta|Hecha|Firmad|Pagado después)/.test(estado)) return 'ok'
  if (/^(Devuelt|Rechazad|Error)/.test(estado)) return 'mal'
  if (/^(Próximo|En el banco|Alta nueva|Pedida|Pendiente)/.test(estado)) return 'info'
  return 'gris'
}

// ── El recibo de Code 1 ────────────────────────────────────────────────────

export interface LineaVista { texto: string; importe: string; detalle: string | null }

/** Las líneas guardadas por el cobro (LineaDeRecibo: texto, importeCent, cuenta, trabajadores). */
export function lineasDelRecibo(lineas: unknown): LineaVista[] {
  if (!Array.isArray(lineas)) return []
  return lineas.map((l) => {
    const x = l as { texto?: unknown; importeCent?: unknown; importe_cent?: unknown; cuenta?: unknown; trabajadores?: unknown }
    const cent = x.importeCent ?? x.importe_cent
    const trab = Array.isArray(x.trabajadores) ? x.trabajadores.map((t) => nombrePropio(String((t as { nombre?: unknown })?.nombre ?? t))).filter(Boolean) : []
    return {
      texto: String(x.texto ?? 'Servicio'),
      importe: typeof cent === 'number' ? euros(cent) : 'Sin precio',
      detalle: trab.length ? trab.join(', ') : (typeof x.cuenta === 'string' && x.cuenta ? x.cuenta : null),
    }
  })
}

/** Por qué cambia el recibo, en una frase: los textos de sus cambios. */
export function porQueCambia(cambios: unknown): string | null {
  if (!Array.isArray(cambios) || !cambios.length) return null
  const t = cambios.map((c) => String((c as { texto?: unknown; t?: unknown })?.texto ?? (c as { t?: unknown })?.t ?? '')).filter(Boolean)
  return t.length ? t.join(' · ') : null
}

/** «Sube 24,20 €» / «Baja 10,00 €» / null si es igual o no hay anterior. */
export function diferencia(total: number, anterior: number | null | undefined): { texto: string; tono: Tono } | null {
  if (anterior == null || anterior === total) return null
  const d = total - anterior
  return d > 0 ? { texto: `Sube ${euros(d)}`, tono: 'aviso' } : { texto: `Baja ${euros(-d)}`, tono: 'ok' }
}

/** Los últimos dígitos de la cuenta, como en la maqueta: «ES•• •••• •••• •••• •••• 4821». */
export function cuentaEnmascarada(pais: string | null | undefined, final: string | null | undefined): string | null {
  const f = (final ?? '').replace(/\D/g, '')
  if (!f) return null
  return `${(pais || 'ES').toUpperCase()}•• •••• •••• •••• •••• ${f.slice(-4)}`
}

/** El nombre de un fichero para guardarlo: el mismo criterio que el servidor (sin carpetas ni raros). */
export function nombreSeguro(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  const limpio = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return (limpio || 'documento').slice(-80)
}

export const TIPOS_SUBIDA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const BYTES_SUBIDA = 15 * 1024 * 1024

/** Si un fichero se puede subir, y si no, por qué (en palabras). */
export function puedeSubirse(f: { type: string; size: number; name: string }): string | null {
  const tipo = f.type || (/\.heic$/i.test(f.name) ? 'image/heic' : '')
  if (!TIPOS_SUBIDA.includes(tipo)) return `«${f.name}» no se puede subir: solo PDF y fotos (JPG, PNG, WEBP o HEIC).`
  if (f.size > BYTES_SUBIDA) return `«${f.name}» pasa de 15 MB.`
  if (f.size <= 0) return `«${f.name}» está vacío.`
  return null
}

/** El DNI o NIE como lo guarda la base: sin espacios, puntos ni guiones, en mayúsculas. Null si no tiene su forma. */
export function documentoLimpio(x: string): string | null {
  const d = x.toUpperCase().replace(/[\s.-]/g, '')
  return /^[0-9XYZ][0-9]{7}[A-Z]$/.test(d) ? d : null
}

/** Qué es cada impuesto, para el cliente. */
export function nombreImpuesto(modelo: string, periodo: string | null, ejercicio: number | null, hoy: Date = new Date()): string {
  const que: Record<string, string> = { '303': 'IVA', '111': 'Retenciones', '115': 'Retenciones del alquiler', '130': 'Pago a cuenta del IRPF', '202': 'Pago a cuenta de sociedades', '200': 'Impuesto de sociedades', '390': 'Resumen anual del IVA', '190': 'Resumen anual de retenciones', '180': 'Resumen anual del alquiler', '347': 'Operaciones con terceros', '100': 'Renta' }
  const nombre = que[modelo] ?? `Modelo ${modelo}`
  // Lo anual, como en la maqueta: «Impuesto de sociedades 2025», sin el modelo.
  if (!periodo || periodo === '0A') return `${nombre}${ejercicio ? ` ${ejercicio}` : ''}`
  const a = ejercicio && ejercicio !== madrid(hoy)[0] ? ` de ${ejercicio}` : ''
  const ord = ['1.er', '2.º', '3.er', '4.º']
  const p = /^[1-4]T$/.test(periodo) ? ` del ${ord[Number(periodo[0]) - 1]} trimestre${a}`
    : /^(0[1-9]|1[0-2])$/.test(periodo) ? ` de ${MESES[Number(periodo) - 1]}${a}`
    : /^[1-3]P$/.test(periodo) ? `, ${ord[Number(periodo[0]) - 1]} pago${a}` : ` ${periodo}`
  return `${nombre}${p}${que[modelo] ? ` (modelo ${modelo})` : ''}`
}

// ── Documentos · nóminas y seguros sociales, por mes (como la maqueta) ───────

export interface DocLaboral { id: string; nombre: string; carpeta: string; trabajador: string; fecha: string }
export interface GrupoLaboral {
  clave: string
  /** «nominas» o «ss_sepe». */
  carpeta: string
  /** «2026-10». */
  mes: string
  /** «Nóminas de octubre» / «Seguros sociales de octubre». */
  titulo: string
  /** «4 nóminas · listas el 30 de octubre» / «Cargados el 31 de octubre». */
  detalle: string
  ids: string[]
}

/**
 * Las nóminas y los seguros sociales que deja la gestoría, en una fila por mes
 * (el mes en que se dejaron, hora de Madrid): primero el mes más reciente y,
 * dentro, las nóminas antes que los seguros sociales. Ninguno se queda fuera
 * (regla 7): cada documento está en el grupo de su mes.
 */
export function laboralPorMes(docs: DocLaboral[], hoy: Date = new Date()): GrupoLaboral[] {
  const grupos = new Map<string, { carpeta: string; mes: string; docs: DocLaboral[] }>()
  for (const d of docs) {
    const t = new Date(d.fecha)
    const [a, m] = Number.isNaN(t.getTime()) ? [Number(d.fecha.slice(0, 4)), Number(d.fecha.slice(5, 7))] : madrid(t)
    const clave = `${a}-${String(m).padStart(2, '0')}`
    const carpeta = d.carpeta === 'ss_sepe' ? 'ss_sepe' : 'nominas'
    const k = `${clave}:${carpeta}`
    const g = grupos.get(k) ?? { carpeta, mes: clave, docs: [] }
    g.docs.push(d); grupos.set(k, g)
  }
  return [...grupos.entries()]
    .sort(([, x], [, y]) => (x.mes === y.mes ? (x.carpeta === 'nominas' ? -1 : 1) : x.mes < y.mes ? 1 : -1))
    .map(([clave, g]) => {
      const nombreMes = mes(g.mes, hoy).toLowerCase()
      const ultima = g.docs.map((d) => d.fecha).sort().at(-1) ?? ''
      const ss = g.carpeta === 'ss_sepe'
      const n = g.docs.length
      return {
        clave, carpeta: g.carpeta, mes: g.mes,
        titulo: `${ss ? 'Seguros sociales' : 'Nóminas'} de ${nombreMes}`,
        detalle: ss ? `${n > 1 ? `${n} documentos · ` : ''}Cargados el ${fecha(ultima, hoy)}` : `${n} ${n === 1 ? 'nómina' : 'nóminas'} · listas el ${fecha(ultima, hoy)}`,
        ids: g.docs.map((d) => d.id),
      }
    })
}

/** nº 24 · Cuándo se hizo algo, como la maqueta: «hoy», «ayer» o «el 9 de noviembre» (hora de Madrid). */
export function cuandoSeHizo(x: string | null | undefined, ahora: Date = new Date()): string {
  if (!x) return ''
  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return ''
  const dia = (y: Date) => madrid(y).join('-')
  if (dia(d) === dia(ahora)) return 'hoy'
  if (dia(d) === dia(new Date(ahora.getTime() - 86_400_000))) return 'ayer'
  return `el ${fecha(x, ahora)}`
}

/** nº 24 · Lo que dice una petición ya hecha, como la maqueta: «Firmada hoy», «Recibidos: 2 documentos», «Contestada ayer». */
export function peticionHecha(q: { tipo: string; hecha?: string | null; recibidas?: number }, ahora: Date = new Date()): { detalle: string; boton: string } {
  const cuando = cuandoSeHizo(q.hecha, ahora)
  if (q.tipo === 'firmar') return { detalle: `Firmada ${cuando}`.trim(), boton: '✓ Firmada' }
  if (q.tipo === 'subir') return { detalle: q.recibidas ? `${q.recibidas === 1 ? 'Recibido: 1 documento' : `Recibidos: ${q.recibidas} documentos`}` : `Hecho ${cuando}`.trim(), boton: '✓ Hecho' }
  return { detalle: `Contestada ${cuando}`.trim(), boton: '✓ Hecho' }
}

/**
 * nº 24 · Lo que lleva una factura o un recibo, en la calle, como la maqueta:
 * «Gestoría y laboral (4 trabajadores)», «Gestoría y laboral · Cuentas anuales».
 * Junta la cuota de gestoría y la laboral; lo demás va detrás tal cual. Con
 * algo más detrás, los trabajadores no se dicen (la línea sería muy larga).
 */
export function queLleva(textos: (string | null | undefined)[]): string {
  const limpios = textos.map((t) => (t ?? '').trim()).filter(Boolean)
  const gestoria = limpios.some((t) => /^gestor[ií]a\b/i.test(t))
  const laboral = limpios.find((t) => /^gesti[oó]n laboral\b/i.test(t))
  const resto = limpios.filter((t) => !/^gestor[ií]a\b/i.test(t) && !/^gesti[oó]n laboral\b/i.test(t))
  const n = laboral ? Number(/(\d+)\s+trabajador/i.exec(laboral)?.[1] ?? 0) : 0
  const base = gestoria && laboral ? 'Gestoría y laboral' : gestoria ? 'Gestoría' : laboral ? 'Laboral' : ''
  const conTrabajadores = base && laboral && n > 0 && resto.length === 0 ? `${base} (${n} ${n === 1 ? 'trabajador' : 'trabajadores'})` : base
  return [conTrabajadores, ...resto].filter(Boolean).join(' · ')
}

/**
 * nº 24 · 6 · El motivo del devuelto, dicho al cliente de tú, como la maqueta.
 * Code 1 lo guarda en palabras de oficina (conta-gocardless-leer/motivo.ts):
 * «Sin saldo en la cuenta» → «no había saldo suficiente» (Inicio) y «sin saldo»
 * (Pagos). Lo que no dice nada nuevo («El banco lo ha devuelto») no se repite.
 * Un texto que no se conoce se enseña tal cual, en minúscula: nunca se esconde.
 */
const MOTIVOS: Record<string, { frase: string; corto: string } | null> = {
  'Sin saldo en la cuenta': { frase: 'no había saldo suficiente', corto: 'sin saldo' },
  'El banco lo ha devuelto: el cliente tiene que hablar con su banco': { frase: 'habla con tu banco para saber por qué', corto: 'habla con tu banco' },
  'La cuenta está cerrada': { frase: 'la cuenta está cerrada', corto: 'cuenta cerrada' },
  'La cuenta está bloqueada': { frase: 'la cuenta está bloqueada', corto: 'cuenta bloqueada' },
  'El cliente canceló la domiciliación en su banco': { frase: 'cancelaste la domiciliación en tu banco', corto: 'domiciliación cancelada' },
  'La domiciliación ha caducado': { frase: 'la domiciliación ha caducado', corto: 'domiciliación caducada' },
  'Los datos de la cuenta no son válidos': { frase: 'los datos de la cuenta no son válidos', corto: 'datos de la cuenta no válidos' },
  'La cuenta no admite domiciliaciones': { frase: 'la cuenta no admite domiciliaciones', corto: 'la cuenta no admite domiciliaciones' },
  'El cliente lo reclamó a su banco: dice que no lo autorizó': { frase: 'lo reclamaste a tu banco como no autorizado', corto: 'reclamado a tu banco' },
  'El cliente lo reclamó a su banco (en las 8 semanas que tiene para hacerlo)': { frase: 'lo reclamaste a tu banco', corto: 'reclamado a tu banco' },
  'Cancelado antes de cobrarse': { frase: 'se canceló antes de cobrarse', corto: 'cancelado antes de cobrarse' },
  'El banco lo ha devuelto': null,
  'El banco lo ha devuelto sin decir por qué': null,
}
export function motivoParaTi(motivo: string | null | undefined): { frase: string; corto: string } | null {
  const m = (motivo ?? '').trim()
  if (!m) return null
  if (m in MOTIVOS) return MOTIVOS[m]
  const minuscula = m[0].toLowerCase() + m.slice(1)
  return { frase: minuscula, corto: minuscula }
}

/**
 * nº 28 · Un nombre que llega todo en mayúsculas (los trabajadores del CRM, el banco
 * de GoCardless), con mayúscula solo al principio de cada palabra: «ADRIAN MOLINA
 * CASTRO» → «Adrian Molina Castro», «CAIXABANK, S.A.» → «Caixabank, S.A.». Las
 * siglas con punto (S.A., S.L.) se quedan; «de», «del», «la», «y»… en minúscula
 * salvo al empezar. Lo que ya viene bien escrito no se toca.
 */
const MENUDAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i'])
export function nombrePropio(x: string | null | undefined): string {
  const t = (x ?? '').trim()
  if (!t || t !== t.toLocaleUpperCase('es-ES') || t === t.toLocaleLowerCase('es-ES')) return t
  return t.split(/(\s+)/).map((p, i) => {
    if (/^\s+$/.test(p) || /^([A-ZÁÉÍÓÚÑÜ]\.)+,?$/.test(p)) return p
    const m = p.toLocaleLowerCase('es-ES')
    if (i > 0 && MENUDAS.has(m)) return m
    return m.replace(/(^|[-'’])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase('es-ES'))
  }).join('')
}

/** nº 28 · Un teléfono español con espacios: «910000000» → «910 000 000», «+34910000000» → «+34 910 000 000». Lo demás, tal cual. */
export function telefono(x: string | null | undefined): string {
  const t = (x ?? '').trim()
  const d = t.replace(/[\s.-]/g, '')
  const m = /^(\+34|0034)?(\d{3})(\d{3})(\d{3})$/.exec(d)
  if (!m) return t
  return `${m[1] ? '+34 ' : ''}${m[2]} ${m[3]} ${m[4]}`
}

/** nº 28 · Un texto que la base corta (a 120 letras en «Lo último»), con «…» y sin partir una palabra. */
export function cortado(x: string | null | undefined, max = 120): string {
  const t = (x ?? '').trim()
  // Se mira el largo de lo que llega: un corte que cae en un espacio deja, ya sin él, una letra menos.
  if ((x ?? '').length < max) return t
  // Si el corte cayó en mitad de una palabra, esa palabra no se enseña a medias.
  const corte = /\s$/.test((x ?? '').slice(0, max)) ? t : t.slice(0, max).replace(/\s+\S*$/, '')
  return `${(corte || t.slice(0, max)).replace(/[\s,.;:]+$/, '')}…`
}

/** nº 28 · El resultado de un impuesto, como lo guarda la base (to_pay, to_refund…): «a ingresar», «a devolver». */
export function resultadoImpuesto(r: string | null | undefined): string {
  switch (r) {
    case 'to_pay': case 'a_ingresar': return 'a ingresar'
    case 'to_refund': case 'a_devolver': return 'a devolver'
    case 'to_offset': return 'a compensar'
    case 'zero': return 'sin cuota'
    case 'no_activity': return 'sin actividad'
    default: return ''
  }
}

/** nº 28 · Lo contratado, como la maqueta: primero la gestoría y después lo demás (la laboral), en el orden en que vino. */
export function gestoriaPrimero<T extends { texto: string }>(lineas: T[]): T[] {
  const es = (t: string) => /^gestor[ií]a\b/i.test(t.trim())
  return [...lineas.filter((l) => es(l.texto)), ...lineas.filter((l) => !es(l.texto))]
}

/**
 * nº 32 · «Te lleva: Nombre · correo» en Mensajes (punto 7): quien lleva al cliente, el
 * responsable de su ficha del CRM (conta_portal_quien_lleva, de Code 4). Sin nadie
 * (null, o sin nombre ni correo), no hay línea.
 */
export function teLleva(x: { nombre?: string | null; correo?: string | null } | null | undefined): string | null {
  const nombre = nombrePropio(x?.nombre ?? '')
  const correo = (x?.correo ?? '').trim()
  const partes = [nombre, correo].filter(Boolean)
  return partes.length ? `Te lleva: ${partes.join(' · ')}` : null
}
