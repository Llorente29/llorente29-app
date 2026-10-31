// supabase/functions/_shared/lecturaFactura.ts
//
// D01 · Tarea 2 · LA LECTURA DE UNA FACTURA RECIBIDA, de lo que devuelve el
// modelo (ocr-albaran con modo «factura») a una factura con sus comprobaciones,
// su confianza y su porqué. Núcleo puro: sin red, sin base, sin Deno ni Node.
// Lo usan ocr-albaran (al leer), la base (lo guarda tal cual en la sesión) y
// la pantalla N23 «Revisar factura».
//
// Lo que se saca (encargo D01, punto 2): proveedor por NIF, número (y su clave
// normalizada para las repetidas), fecha, bases y cuotas por tipo de IVA,
// recargo de equivalencia, retención, total, vencimiento y, si es
// rectificativa, la factura que rectifica.
//
// Lo que se comprueba, cada cosa con su frase:
//   · la suma: bases + cuotas + recargos − retención = total, al céntimo;
//   · cada cuota: base × tipo, con medio céntimo de margen por redondeo;
//   · cada recargo: base × su tipo de recargo;
//   · la retención: base × su porcentaje;
//   · lo que pide la norma para deducir: número, fecha, NIF del emisor y la
//     cuota desglosada (RD 1619/2012, art. 6; Ley 37/1992, art. 97);
//   · que no haya pasado el plazo de cuatro años para deducir (Ley 37/1992,
//     art. 99.Tres);
//   · el vencimiento a más de 60 días (Ley 3/2004, art. 4.3), como en el C01b.
// La cita literal de cada artículo está en docs/conta/d01/norma.md.
//
// La confianza, como en todo el módulo:
//   · «seguro»: todo cuadra, hay NIF, número, fecha y total, el papel no es
//     manuscrito y el modelo está seguro;
//   · «duda»: no cuadra la suma, o falta algo que hace falta para apuntar;
//   · «probable»: el resto (cuadra, pero hay algo que mirar).

/** Lo que el prompt del modo factura añade a lo de siempre (ParsedDoc). */
export type FacturaModelo = {
  invoice_kind?: 'completa' | 'simplificada' | 'rectificativa' | null
  corrects_number?: string | null
  due_date?: string | null
  tax_breakdown?: { vat_pct: number | null; base: number | null; vat_amount: number | null; surcharge_pct?: number | null; surcharge_amount?: number | null }[] | null
  withholding_pct?: number | null
  withholding_amount?: number | null
  iban?: string | null
  payment_terms_text?: string | null
  /** PC01 · E2b · Cómo se paga, si el papel lo dice: transfer, direct_debit, card o cash. */
  payment_method?: string | null
  /** S01b · El teléfono y la web del proveedor, si el papel los trae. */
  supplier_phone?: string | null
  supplier_website?: string | null
}

/** Lo que devuelve el modelo con el modo factura: lo de siempre y «factura». */
export type LecturaModelo = {
  document?: {
    supplier_name?: string | null
    supplier_tax_id?: string | null
    supplier_email?: string | null
    supplier_address?: string | null
    /** S01b2 · El prompt de siempre ya lo pedía (Tramo A, ocrAlbaranNucleo): de reserva si la parte de factura no lo trae. */
    supplier_phone?: string | null
    doc_number?: string | null
    doc_date?: string | null
    doc_type?: string | null
    bill_to_name?: string | null
    bill_to_tax_id?: string | null
    handwritten?: boolean | null
    tax_base_total?: number | null
    tax_total?: number | null
    grand_total?: number | null
  } | null
  lines?: { raw_text?: string | null; line_amount?: number | null; vat_pct?: number | null }[] | null
  factura?: FacturaModelo | null
  confidence?: number | null
}

export type TipoLeido = { tipo: number; base: number; cuota: number; recargoTipo: number | null; recargo: number }
export type Comprobacion = { id: string; ok: boolean; grave: boolean; texto: string }
export type Confianza = 'seguro' | 'probable' | 'duda'

export type FacturaLeida = {
  /** S01b · Además, el teléfono y la web del proveedor si el papel los trae (para su ficha). */
  proveedor: { nombre: string | null; nif: string | null; email: string | null; direccion: string | null; telefono: string | null; web: string | null }
  destinatario: { nombre: string | null; nif: string | null }
  numero: string | null
  /** La clave para las repetidas (igual que la base: mayúsculas y solo letras y números). */
  numeroClave: string | null
  fecha: string | null
  vencimiento: string | null
  clase: 'completa' | 'simplificada' | 'rectificativa'
  rectificaA: string | null
  tipos: TipoLeido[]
  base: number
  cuota: number
  recargo: number
  retencion: { tipo: number | null; importe: number } | null
  total: number | null
  iban: string | null
  /** PC01 · E2b · La forma de pago prevista que trae el papel (null si no lo dice). */
  forma: FormaLeida
  /** De dónde salen las bases: el desglose del papel o, si no lo trae, las líneas. */
  desgloseDe: 'papel' | 'lineas' | 'ninguno'
}

/** PC01 · E2b · Las formas de pago que puede traer una factura (las de supplier_invoice.payment_method). */
export type FormaLeida = 'transfer' | 'direct_debit' | 'card' | 'cash' | null
const FORMAS_LEIDAS = new Set(['transfer', 'direct_debit', 'card', 'cash'])

/**
 * PC01 · E2b · La forma de pago: la clave del modelo si es una de las cuatro;
 * si no, la que diga el texto de la forma de pago. La domiciliación va primero
 * (un recibo domiciliado suele traer también la palabra «cuenta» o un IBAN, que
 * es el NUESTRO). «Al contado» solo dice cuándo, no cómo: no cuenta como efectivo.
 */
export function formaDePago(clave: string | null | undefined, texto: string | null | undefined): FormaLeida {
  const k = (clave ?? '').trim().toLowerCase()
  if (FORMAS_LEIDAS.has(k)) return k as FormaLeida
  const s = (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!s.trim()) return null
  if (/domicili|adeudo|recibo bancario|cargo en (su |vuestra |la )?(c\/c|cuenta)|sepa (core|b2b)/.test(s)) return 'direct_debit'
  if (/tarjeta|datafono|\btpv\b|\bvisa\b|mastercard/.test(s)) return 'card'
  if (/efectivo|metalico/.test(s)) return 'cash'
  if (/transferencia|ingreso en (la |nuestra )?cuenta|abonar en (la |nuestra )?cuenta|\biban\b/.test(s)) return 'transfer'
  return null
}

export type Lectura = { factura: FacturaLeida; comprobaciones: Comprobacion[]; confianza: Confianza; porque: string[] }

// ── Normalizar ──────────────────────────────────────────────────────────────

const c = (x: number) => Math.round(x * 100)
const e = (x: number) => x / 100
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const txt = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : null)

/** La clave de un número de factura: la misma regla que la base (mayúsculas, solo letras y números). */
export function claveNumero(n: string | null | undefined): string | null {
  const k = (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  // «s/n», «sin número», «0» no son número: no sirven para buscar repetidas.
  // («sin número» con tilde se queda en SINNMERO: la Ú no es [A-Z0-9].)
  return k === '' || /^(SN|SINNUMERO|SINNMERO|SINNUM|0+)$/.test(k) ? null : k
}

/** El NIF como se compara: mayúsculas, sin espacios ni guiones, sin el «ES» delante. */
export function normalizarNif(n: string | null | undefined): string | null {
  const k = (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '')
  return k === '' ? null : k
}

/** ¿Tiene forma de NIF español (persona, NIE o sociedad)? La letra de control la comprueba la ficha al guardar. */
export const formaDeNif = (n: string | null): boolean => !!n && /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[A-HJNP-SUVW][0-9]{7}[0-9A-J])$/.test(n)

/**
 * Una fecha leída, a 'YYYY-MM-DD'. El modelo la pide así, pero a veces la copia
 * como está en el papel: «10/11/2026», o «10/11/2026 · transferencia». En
 * España el día va primero (10/11 es el 10 de noviembre). Una fecha que no
 * existe (31/02) no vale. Lo demás, null: no se adivina.
 */
export function fechaLeida(s: string | null): string | null {
  if (!s) return null
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/)
  const dmy = iso ? null : s.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2].padStart(2, '0'), dmy[1].padStart(2, '0')] : []
  if (!y) return null
  const r = `${y}-${m}-${d}`
  const t = new Date(`${r}T12:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === r ? r : null
}
const fechaIso = fechaLeida
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const masAnios = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`

/**
 * Los tipos del recargo de equivalencia (Ley 37/1992, art. 161), por tipo de
 * IVA. Lo que no está aquí no se adivina: se dice «no sé qué recargo va con
 * el X %».
 */
export const RECARGO_POR_TIPO: Record<string, number> = { '21': 5.2, '10': 1.4, '4': 0.5, '0': 0 }

// ── Leer ────────────────────────────────────────────────────────────────────

export function leerFactura(m: LecturaModelo, o: { hoy: string; minConfianza?: number }): Lectura {
  const d = m.document ?? {}
  const f = m.factura ?? {}
  const com: Comprobacion[] = []
  const add = (id: string, ok: boolean, grave: boolean, texto: string) => com.push({ id, ok, grave, texto })

  // El desglose: el del papel si lo trae; si no, por las líneas.
  let tipos: TipoLeido[] = []
  let desgloseDe: FacturaLeida['desgloseDe'] = 'ninguno'
  const papel = (f.tax_breakdown ?? []).filter((t) => num(t.base) != null)
  if (papel.length) {
    desgloseDe = 'papel'
    const porTipo = new Map<number, TipoLeido>()
    for (const t of papel) {
      const k = num(t.vat_pct) ?? 0
      const x = porTipo.get(k) ?? { tipo: k, base: 0, cuota: 0, recargoTipo: num(t.surcharge_pct), recargo: 0 }
      x.base = e(c(x.base) + c(t.base!))
      x.cuota = e(c(x.cuota) + c(num(t.vat_amount) ?? (t.base! * k) / 100))
      x.recargo = e(c(x.recargo) + c(num(t.surcharge_amount) ?? 0))
      if (x.recargoTipo == null) x.recargoTipo = num(t.surcharge_pct)
      porTipo.set(k, x)
    }
    tipos = [...porTipo.values()]
  } else if ((m.lines ?? []).some((l) => num(l.line_amount) != null)) {
    desgloseDe = 'lineas'
    const porTipo = new Map<number, number>()
    for (const l of m.lines ?? []) {
      if (num(l.line_amount) == null) continue
      const k = num(l.vat_pct) ?? -1
      porTipo.set(k, (porTipo.get(k) ?? 0) + c(l.line_amount!))
    }
    tipos = [...porTipo.entries()].map(([k, b]) => ({ tipo: k < 0 ? 0 : k, base: e(b), cuota: e(Math.round((b * (k < 0 ? 0 : k)) / 100)), recargoTipo: null, recargo: 0 }))
    if (porTipo.has(-1)) add('tipo_linea', false, true, 'Alguna línea no dice su tipo de IVA: lo he puesto al 0 % y hay que mirarlo.')
    // Sin desglose del papel, la cuota calculada se compara con la cuota total que trae.
    const cuotaPapel = num(d.tax_total)
    if (cuotaPapel != null && tipos.length === 1) tipos[0].cuota = cuotaPapel
  }
  tipos.sort((a, b) => b.tipo - a.tipo)

  // S01h · Un abono: lo dice el papel (rectificativa, «ABONO») o lo dicen sus importes en negativo.
  // Entonces TODO va en negativo: bases, cuotas, recargo, retención y total. El modelo a veces deja
  // las cuotas en positivo con las bases en negativo (el 1506416 de Europastry, 31/10): así las
  // comprobaciones decían «sobran 29,00 €» y «debería ser −13,44 y dice 13,44» sin haber error.
  const totalLeido = num(d.grand_total)
  const esAbono = f.invoice_kind === 'rectificativa' || (totalLeido != null && totalLeido < 0)
    || tipos.some((t) => t.base < 0 || t.cuota < 0 || t.recargo < 0)
  const neg = (x: number) => -Math.abs(x)
  if (esAbono) for (const t of tipos) { t.base = neg(t.base); t.cuota = neg(t.cuota); t.recargo = neg(t.recargo) }

  const base = e(tipos.reduce((t, x) => t + c(x.base), 0))
  const cuota = e(tipos.reduce((t, x) => t + c(x.cuota), 0))
  const recargo = e(tipos.reduce((t, x) => t + c(x.recargo), 0))
  const retLeida = num(f.withholding_amount)
  const retImporte = retLeida != null && esAbono ? neg(retLeida) : retLeida
  const retTipo = num(f.withholding_pct)
  const retencion = retImporte != null || retTipo != null
    ? { tipo: retTipo, importe: retImporte ?? e(Math.round((c(base) * (retTipo ?? 0)) / 100)) }
    : null
  const total = totalLeido != null && esAbono ? neg(totalLeido) : totalLeido

  const numero = txt(d.doc_number)
  const fecha = fechaIso(txt(d.doc_date))
  const vencimiento = fechaIso(txt(f.due_date))
  const clase: FacturaLeida['clase'] = esAbono ? 'rectificativa' : f.invoice_kind === 'simplificada' ? 'simplificada' : 'completa'
  const nif = normalizarNif(d.supplier_tax_id)
  const factura: FacturaLeida = {
    proveedor: { nombre: txt(d.supplier_name), nif, email: txt(d.supplier_email), direccion: txt(d.supplier_address), telefono: txt(f.supplier_phone) ?? txt(d.supplier_phone), web: txt(f.supplier_website) },
    destinatario: { nombre: txt(d.bill_to_name), nif: normalizarNif(d.bill_to_tax_id) },
    numero, numeroClave: claveNumero(numero), fecha, vencimiento, clase, rectificaA: txt(f.corrects_number),
    tipos, base, cuota, recargo, retencion, total, iban: txt(f.iban)?.replace(/\s+/g, '').toUpperCase() ?? null,
    forma: formaDePago(txt(f.payment_method), txt(f.payment_terms_text)), desgloseDe,
  }

  // ── Comprobaciones ───────────────────────────────────────────────────────
  if (total == null) add('total', false, true, 'No he leído el total de la factura.')
  else if (desgloseDe === 'ninguno') add('suma', false, true, 'No he leído las bases: no puedo comprobar que el total cuadre.')
  else {
    const calc = c(base) + c(cuota) + c(recargo) - c(retencion?.importe ?? 0)
    const dif = c(total) - calc
    add('suma', dif === 0, true, dif === 0
      ? `Cuadra: bases + IVA${recargo ? ' + recargo' : ''}${retencion ? ' − retención' : ''} = total, al céntimo.`
      : `No cuadra: bases + IVA${recargo ? ' + recargo' : ''}${retencion ? ' − retención' : ''} dan ${fmt(e(calc))} y el total es ${fmt(total)} (${dif > 0 ? 'faltan' : 'sobran'} ${fmt(e(Math.abs(dif)))}).`)
  }
  for (const t of tipos) {
    const esperada = Math.round((c(t.base) * t.tipo) / 100)
    if (Math.abs(esperada - c(t.cuota)) > 1) add(`cuota_${t.tipo}`, false, true, `El IVA al ${t.tipo} % debería ser ${fmt(e(esperada))} sobre ${fmt(t.base)} y la factura dice ${fmt(t.cuota)}.`)
    if (t.recargo) {
      const rt = t.recargoTipo ?? RECARGO_POR_TIPO[String(t.tipo)]
      if (rt == null) add(`recargo_${t.tipo}`, false, false, `Trae recargo de equivalencia con el IVA al ${t.tipo} % y no sé qué tipo de recargo le toca: míralo.`)
      else if (Math.abs(Math.round((c(t.base) * rt) / 100) - c(t.recargo)) > 1) add(`recargo_${t.tipo}`, false, true, `El recargo al ${rt} % debería ser ${fmt(e(Math.round((c(t.base) * rt) / 100)))} sobre ${fmt(t.base)} y la factura dice ${fmt(t.recargo)}.`)
    }
    if (![0, 4, 5, 10, 21].includes(t.tipo)) add(`tipo_${t.tipo}`, false, false, `Un IVA al ${t.tipo} % no es de los tipos de siempre (21, 10, 4): míralo.`)
  }
  if (retencion && retencion.tipo != null && Math.abs(Math.round((c(base) * retencion.tipo) / 100) - c(retencion.importe)) > 1) {
    add('retencion', false, true, `La retención al ${retencion.tipo} % debería ser ${fmt(e(Math.round((c(base) * retencion.tipo) / 100)))} y la factura dice ${fmt(retencion.importe)}.`)
  }
  if (!numero) add('numero', false, true, 'No trae número de factura: sin él no es una factura completa (RD 1619/2012, art. 6.1.a).')
  if (!fecha) add('fecha', false, true, 'No he leído la fecha de la factura.')
  else {
    if (dias(o.hoy, fecha) > 1) add('fecha_futura', false, true, `La fecha (${fecha}) es posterior a hoy.`)
    if (masAnios(fecha, 4) < o.hoy) add('cuatro_anios', false, true, 'Tiene más de cuatro años: ya no se puede deducir su IVA (Ley 37/1992, art. 99.Tres).')
  }
  if (!nif) add('nif', false, true, cuota ? 'No trae el NIF del proveedor: así no se puede deducir su IVA (Ley 37/1992, art. 97; RD 1619/2012, art. 6.1.d).' : 'No trae el NIF del proveedor.')
  else if (!formaDeNif(nif) && !/^[A-Z]{2}/.test(nif)) add('nif_forma', false, false, `El NIF leído (${nif}) no tiene forma de NIF español: míralo.`)
  if (clase === 'simplificada' && cuota) add('simplificada', false, false, 'Es una factura simplificada (ticket): para deducir su IVA tiene que traer tu NIF y la cuota aparte (RD 1619/2012, art. 7.2).')
  if (clase === 'rectificativa' && !factura.rectificaA) add('rectifica', false, true, 'Es rectificativa y no dice qué factura rectifica.')
  // Un vencimiento que viene y no se entiende no se calla: si no, la pantalla diría «sin vencimiento» y mandaría el de la ficha.
  if (!vencimiento && txt(f.due_date)) add('vencimiento_ilegible', false, false, `Trae un vencimiento que no entiendo («${txt(f.due_date)}»): míralo en el papel.`)
  if (vencimiento && fecha && dias(fecha, vencimiento) > 60) add('morosidad', false, false, `Vence a ${dias(fecha, vencimiento)} días: supera los 60 días que permite la ley de morosidad entre empresas (Ley 3/2004, art. 4.3).`)
  if (vencimiento && fecha && vencimiento < fecha) add('vencimiento', false, true, 'Vence antes de la fecha de la factura.')
  if (d.handwritten) add('manuscrita', false, false, 'Está escrita a mano: la he leído con cuidado, pero mírala.')

  const conf = num(m.confidence) ?? 0
  const graves = com.filter((x) => !x.ok && x.grave)
  const leves = com.filter((x) => !x.ok && !x.grave)
  const confianza: Confianza = graves.length ? 'duda' : leves.length || conf < (o.minConfianza ?? 0.85) ? 'probable' : 'seguro'
  const porque = confianza === 'seguro'
    ? ['Todo cuadra y trae lo que pide la norma.']
    : [...graves, ...leves].map((x) => x.texto).concat(conf < (o.minConfianza ?? 0.85) && !graves.length ? ['El papel no se lee del todo bien: míralo.'] : [])
  return { factura, comprobaciones: com, confianza, porque }
}

const fmt = (x: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)} €`

// ── Repetidas ───────────────────────────────────────────────────────────────

export type FacturaExistente = { id: string; proveedorId: string | null; nif: string | null; numero: string | null; fecha: string | null; total: number | null; anulada?: boolean }
export type Repetida = { nivel: 'repetida' | 'posible'; con: string; texto: string }

/**
 * La regla de repetidas (Julio, R1 y R2 del D01), la misma que la base (0260)
 * y que el C01b (src/modules/conta/lib/repetidas.ts):
 *   · repetida: el mismo proveedor, la misma clave de número Y el mismo total;
 *   · posible: el mismo proveedor, la misma fecha y el mismo total (que no sea
 *     0), con OTRO número (o sin número ninguna de las dos);
 *   · nada más: el mismo número con OTRO total no es nada (C01b, medido).
 * Por qué así, con la población real (regla 31): en los 179 albaranes de
 * Foodint hay un proveedor que pone «01» en albaranes de fecha e importe
 * distintos; con «mismo número, otro total → posible» cada factura suya
 * preguntaría. El C01b midió su regla: 0 repetidas y 0 posibles en los reales.
 * El proveedor es el mismo si coincide su id o, si aún no tiene ficha, su NIF.
 */
export function buscarRepetida(n: { proveedorId: string | null; nif: string | null; numero: string | null; fecha: string | null; total: number | null }, existentes: readonly FacturaExistente[]): Repetida | null {
  const k = claveNumero(n.numero)
  const nif = normalizarNif(n.nif)
  const mismo = (x: FacturaExistente) => (n.proveedorId && x.proveedorId === n.proveedorId) || (!!nif && normalizarNif(x.nif) === nif)
  const vivas = existentes.filter((x) => !x.anulada && mismo(x))
  const mismoTotal = (x: FacturaExistente) => n.total != null && x.total != null && c(x.total) === c(n.total)
  const r = k ? vivas.find((x) => claveNumero(x.numero) === k && mismoTotal(x)) : undefined
  if (r) return { nivel: 'repetida', con: r.id, texto: `Ya está: el mismo proveedor, el mismo número (${r.numero}) y el mismo total. No la apunto dos veces.` }
  // Con el mismo número y total habría salido arriba: aquí el número es otro, o no lo trae ninguna.
  const p = n.fecha && n.total != null && c(n.total) !== 0 ? vivas.find((x) => x.fecha === n.fecha && mismoTotal(x)) : undefined
  if (p) return { nivel: 'posible', con: p.id, texto: `¿Repetida? El mismo proveedor, la misma fecha y el mismo total que la ${p.numero ?? 'sin número'}, con otro número.` }
  return null
}

// ── El prompt del modo factura ──────────────────────────────────────────────

/**
 * Lo que el modo «factura» de ocr-albaran AÑADE al prompt de siempre (que no
 * cambia: lo fija tests/conta/d01/ocrAlbaran.test.ts). Pide una clave más,
 * «factura», en el mismo JSON.
 */
export const PROMPT_FACTURA =
  `\n\nMODO FACTURA: este documento es una FACTURA de proveedor. Además de lo anterior, añade al MISMO\n` +
  `objeto JSON una clave "factura" con esta forma EXACTA:\n` +
  `  "factura": {\n` +
  `    "invoice_kind": "<completa|simplificada|rectificativa>",\n` +
  `    "corrects_number": "<si es rectificativa, el número de la factura que rectifica, o null>",\n` +
  `    "due_date": "<fecha de VENCIMIENTO YYYY-MM-DD si aparece, o null>",\n` +
  `    "tax_breakdown": [ { "vat_pct": <tipo de IVA>, "base": <base a ese tipo>, "vat_amount": <cuota de IVA a ese tipo>,\n` +
  `                         "surcharge_pct": <% de recargo de equivalencia a ese tipo, o null>, "surcharge_amount": <importe del recargo, o null> } ],\n` +
  `    "withholding_pct": <% de retención (IRPF) si la hay, o null>,\n` +
  `    "withholding_amount": <importe de la retención, en positivo, o null>,\n` +
  `    "iban": "<IBAN para el pago si aparece, o null>",\n` +
  `    "payment_terms_text": "<forma o plazo de pago tal cual aparece, o null>",\n` +
  `    "payment_method": "<transfer (transferencia), direct_debit (domiciliación o recibo), card (tarjeta), cash (efectivo), o null si no lo dice>",\n` +
  `    "supplier_phone": "<teléfono del PROVEEDOR que emite si aparece, o null>",\n` +
  `    "supplier_website": "<web del PROVEEDOR que emite si aparece, o null>"\n` +
  `  }\n` +
  `REGLAS DEL MODO FACTURA:\n` +
  `- "tax_breakdown" es el CUADRO DE IMPUESTOS del pie (una fila por tipo de IVA), tal cual aparece. Si el papel\n` +
  `  no trae cuadro, déjalo en [] (no lo calcules tú desde las líneas).\n` +
  `- Una rectificativa o abono lleva las bases y cuotas en NEGATIVO, y "grand_total" también.\n` +
  `- Si el papel dice ABONO, NOTA DE ABONO, RECTIFICATIVA o «anula documento …», es rectificativa: "invoice_kind"\n` +
  `  es "rectificativa" y "corrects_number" es el número del documento que anula o rectifica.\n` +
  `- "simplificada" es un ticket o factura simplificada (sin los datos del cliente o sin desglose completo).\n` +
  `- La retención resta del total: "grand_total" es lo que se paga después de restarla.\n` +
  `- "iban" es la cuenta del PROVEEDOR para pagarle. En una domiciliación, el IBAN que aparece suele ser el del\n` +
  `  cliente (donde se carga el recibo): ese NO va en "iban".\n` +
  `- "supplier_phone" y "supplier_website" son los del PROVEEDOR que emite, nunca los del cliente ni los de la\n` +
  `  plataforma por la que se pidió.\n` +
  `- NO inventes NADA: lo que no esté, null.`
