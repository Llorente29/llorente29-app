// src/modules/conta/lib/cuentasProveedor.ts
//
// C02, tarea 6 · La pestaña «Contabilidad» de la ficha de proveedor (maqueta
// N7FichaConta, encargo §5b y respuesta 2). Puro y probado
// (tests/unit/modules/conta/cuentasProveedorC02.test.ts): la pantalla solo
// pinta lo que sale de aquí.
//
//   · «Sus cuentas»: su cuenta (enlace principal), dónde van sus facturas (lo
//     suyo propio o, si no, lo de su tipo de gasto), el IVA que te cobra (las
//     472 de sus tipos; con ISP o compra en la UE también la 477, porque el
//     IVA lo declaras tú), su retención, desde dónde le pagas y sus suplidos.
//     Lo que viene de «Lo que he aprendido» lleva la marca IA.
//   · Los datos que SOLO salen si aplican a la empresa (respuesta 2): tipo de
//     identificador, tipo de operación (303/349), IVA deducible si hay
//     prorrata, recargo y criterio de caja si la empresa está en esos
//     regímenes. Cada uno con su fuente: las del C00 (tax_form, vat_scheme) se
//     reciben leídas de la base; las dos que el C00 no tiene en tabla
//     (prorrata y suplidos) van citadas aquí y una prueba comprueba la cita
//     contra el texto descargado del BOE.
//   · «Va al 347 este año» y el extracto en dos vistas (por apunte y por mes).
//     Los apuntes llegan con el C04: hasta entonces, vacío y dicho.

import type { CuentaPlan, EnlacePlan } from '@/modules/conta/lib/planVista'
import type { Papel } from '@/modules/conta/lib/planEmpresa'
import { ESTADOS_UE } from '@/modules/conta/lib/vatEu'
import { euros } from '@/modules/conta/lib/formato'

export interface EnlaceCuenta extends EnlacePlan { source: 'serie' | 'manual' | 'ai_accepted' }

export interface ProveedorConta {
  id: string
  name: string
  entityKind: 'company' | 'self_employed' | null
  taxIdType: 'nif_es' | 'vat_eu' | 'foreign' | null
  countryCode: string
  vatRegime: string | null
  usualTaxRateIds: readonly string[]
  irpfWithholdingPct: number | null
  expenseCategoryId: string | null
}

/** Lo que dice el perfil fiscal de la empresa (company_tax_profile, C00). */
export interface PerfilConta {
  vatProrata: boolean
  vatProrataPct: number | null
  vatSurcharge: boolean
  vatCashBasis: boolean
  /** ¿Presenta el 347? (el 347 está en sus modelos; quien lleva el SII no lo presenta). */
  presenta347: boolean
}

export interface TasaConta { id: string; name: string; rate: number; surchargeRate: number | null }
export interface RetencionConta { id: string; name: string; rate: number }
export interface BancoConta { id: string; name: string; iban: string | null }
/** Una fila del C00 con su norma: un régimen (vat_scheme) o un modelo (tax_form). */
export interface FilaConNorma { code: string; name: string; legalRef: string | null }

export interface EntradaCuentas {
  proveedor: ProveedorConta
  perfil: PerfilConta
  cuentas: readonly CuentaPlan[]
  enlaces: readonly EnlaceCuenta[]
  tasas: readonly TasaConta[]
  retenciones: readonly RetencionConta[]
  bancos: readonly BancoConta[]
  /** vat_scheme del C00: se usan recargo_equivalencia y criterio_caja. */
  regimenes: readonly FilaConNorma[]
  /** tax_form del C00: se usan 303 y 349. */
  modelos: readonly FilaConNorma[]
}

export interface CuentaVista { id: string; code: string; titulo: string }

export type ClaveLinea = 'su_cuenta' | 'facturas' | 'iva' | 'retencion' | 'pago' | 'suplidos'
export interface LineaCuenta {
  clave: ClaveLinea
  etiqueta: string
  /** Las cuentas que lleva (puede ser más de una: el IVA). */
  cuentas: CuentaVista[]
  /** Lo que se dice cuando no hay cuenta, o al lado («No lleva · es una sociedad»). */
  texto: string | null
  /** De dónde sale, si no es suyo («por su tipo de gasto Compras de mercaderías»). */
  nota: string | null
  ia: boolean
  /** El papel que se cambia desde la ficha; null si se cambia en otro sitio (el IVA, en el plan). */
  papel: Papel | null
  /** El enlace PROPIO del proveedor, si lo tiene (para «Quitar»). */
  propia: string | null
  opciones: CuentaVista[]
}

export type ClaveDato = 'identificador' | 'operacion' | 'deducible' | 'recargo' | 'caja'
export interface DatoConta { clave: ClaveDato; etiqueta: string; valor: string; fuente: string | null }

/**
 * Las dos citas que el C00 no tiene en una tabla. Literales del texto
 * consolidado de la Ley 37/1992 (docs/conta/fuentes/textos/ley-37-1992.txt):
 * la prueba las busca ahí.
 */
export const CITAS = {
  prorrata: { norma: 'Ley 37/1992, art. 102', fuente: 'ley-37-1992', literal: 'La regla de prorrata será de aplicación cuando el sujeto pasivo' },
  suplidos: { norma: 'Ley 37/1992, art. 78.Tres.3.º', fuente: 'ley-37-1992', literal: 'Las sumas pagadas en nombre y por cuenta del cliente en virtud de mandato expreso del mismo.' },
  limite347: { norma: 'RD 1065/2007, art. 33.1', fuente: 'rd-1065-2007', literal: 'hayan superado la cifra de 3.005,06 euros durante el año natural correspondiente' },
  excluidas347: { norma: 'RD 1065/2007, art. 33.2', fuente: 'rd-1065-2007', literal: 'quedan excluidas del deber de declaración las siguientes operaciones' },
} as const

/** El límite del 347, en céntimos (CITAS.limite347). */
const LIMITE_347 = 300506

const titulo = (c: CuentaPlan, nombre?: string) => `${c.code} · ${nombre ?? c.name}`
const vista = (c: CuentaPlan, nombre?: string): CuentaVista => ({ id: c.id, code: c.code, titulo: titulo(c, nombre) })
/** «Orden EHA/3786/2008, de 29 de diciembre, por la que…» → «Orden EHA/3786/2008». */
const normaCorta = (r: string | null) => (r ? r.split(',')[0].trim() : null)
const pct = (n: number) => `${String(n).replace('.', ',')} %`
/** «ES9121000418450200051332» → «ES91 ···· 1332». */
export const ibanCorto = (iban: string) => `${iban.slice(0, 4)} ···· ${iban.slice(-4)}`

export type TipoOperacion = 'espana' | 'ue' | 'fuera'
export const TEXTO_OPERACION: Record<TipoOperacion, string> = {
  espana: 'Compra en España', ue: 'Compra en la UE', fuera: 'Compra fuera de la UE',
}

/** Lo que manda al 303 y al 349: el régimen de la ficha si lo dice; si no, su país. */
export function tipoDeOperacion(p: Pick<ProveedorConta, 'vatRegime' | 'countryCode'>): TipoOperacion {
  if (p.vatRegime === 'intracomunitario') return 'ue'
  if (p.vatRegime === 'extranjero') return 'fuera'
  if (!p.countryCode || p.countryCode === 'ES') return 'espana'
  return ESTADOS_UE.includes(p.countryCode) ? 'ue' : 'fuera'
}

/** ¿El IVA de sus facturas lo declaras tú? (inversión del sujeto pasivo o compra en la UE). */
export const ivaLoDeclarasTu = (p: Pick<ProveedorConta, 'vatRegime' | 'countryCode'>) =>
  p.vatRegime === 'inversion_sujeto_pasivo' || tipoDeOperacion(p) === 'ue'

export function cuentasDelProveedor(e: EntradaCuentas): { lineas: LineaCuenta[]; datos: DatoConta[] } {
  const p = e.proveedor
  const porId = new Map(e.cuentas.map((c) => [c.id, c]))
  const activa = (c: CuentaPlan) => c.status === 'activa'
  const enlace = (entity: EnlacePlan['entity'], entityId: string | null, role: Papel) =>
    entityId === null ? undefined : e.enlaces.find((l) => l.entity === entity && l.entityId === entityId && l.role === role)
  const cuentaDe = (l: EnlaceCuenta | undefined) => (l ? porId.get(l.companyAccountId) ?? null : null)
  const grupo6 = e.cuentas.filter((c) => activa(c) && c.code.startsWith('6')).map((c) => vista(c))

  // Su cuenta: las subcuentas del 400/410 libres (o suya) y las comunes.
  const principales = new Map<string, EnlaceCuenta>()
  for (const l of e.enlaces) if (l.role === 'principal' && ['supplier', 'customer', 'bank_account'].includes(l.entity)) principales.set(l.companyAccountId, l)
  const suya = enlace('supplier', p.id, 'principal')
  const cSuya = cuentaDe(suya)
  const lineas: LineaCuenta[] = [{
    clave: 'su_cuenta', etiqueta: 'Su cuenta',
    cuentas: cSuya ? [vista(cSuya, cSuya.kind === 'own' ? undefined : cSuya.name)] : [],
    texto: cSuya ? (cSuya.isCommon ? 'la común de proveedores' : null) : 'Sin cuenta: se le da al activar el plan',
    nota: null, ia: suya?.source === 'ai_accepted', papel: 'principal', propia: null,
    opciones: e.cuentas.filter((c) => activa(c) && /^4[01]0/.test(c.templateCode) && (c.isCommon || c.kind === 'own')
      && (c.isCommon || !principales.has(c.id) || principales.get(c.id)!.entityId === p.id)).map((c) => vista(c)),
  }]

  // Sus facturas: lo suyo o lo de su tipo de gasto.
  const gastoPropio = enlace('supplier', p.id, 'gasto')
  const gastoTipo = enlace('expense_category', p.expenseCategoryId, 'principal')
  const cGasto = cuentaDe(gastoPropio) ?? cuentaDe(gastoTipo)
  lineas.push({
    clave: 'facturas', etiqueta: 'Sus facturas se apuntan en', cuentas: cGasto ? [vista(cGasto)] : [],
    texto: cGasto ? null : p.expenseCategoryId ? 'Su tipo de gasto aún no tiene cuenta' : 'Sin tipo de gasto: elige su cuenta',
    nota: gastoPropio ? null : gastoTipo ? 'por su tipo de gasto' : null,
    ia: (gastoPropio ?? gastoTipo)?.source === 'ai_accepted', papel: 'gasto', propia: gastoPropio ? gastoPropio.companyAccountId : null, opciones: grupo6,
  })

  // El IVA: la cuenta de cada tipo es de la EMPRESA (se cambia en el plan), no del proveedor.
  const suyoTambien = ivaLoDeclarasTu(p)
  const ivas: CuentaVista[] = []
  let ivaIa = false
  for (const id of p.usualTaxRateIds) {
    const t = e.tasas.find((x) => x.id === id)
    for (const papel of suyoTambien ? (['soportado', 'repercutido'] as const) : (['soportado'] as const)) {
      const l = enlace('tax_rate', id, papel)
      const c = cuentaDe(l)
      if (!c) continue
      ivaIa ||= l!.source === 'ai_accepted'
      if (!ivas.some((x) => x.id === c.id)) ivas.push(vista(c, `${c.name}${t ? ` ${pct(t.rate)}` : ''}`))
    }
  }
  lineas.push({
    clave: 'iva', etiqueta: 'IVA que te cobra', cuentas: ivas,
    texto: p.usualTaxRateIds.length === 0 ? 'Sin decir: ponlo en Datos fiscales' : ivas.length === 0 ? 'Sus tipos de IVA aún no tienen cuenta' : null,
    nota: suyoTambien && ivas.length ? (p.vatRegime === 'inversion_sujeto_pasivo' ? 'inversión del sujeto pasivo: lo declaras tú' : 'compra en la UE: lo declaras tú') : null,
    ia: ivaIa, papel: null, propia: null, opciones: [],
  })

  // La retención.
  const irpf = p.irpfWithholdingPct ?? 0
  const deRetencion = irpf > 0
    ? [...new Map(e.retenciones.filter((r) => r.rate === irpf).map((r) => cuentaDe(enlace('withholding_rate', r.id, 'principal')))
      .filter((c): c is CuentaPlan => c !== null).map((c) => [c.id, vista(c)])).values()]
    : []
  lineas.push({
    clave: 'retencion', etiqueta: 'Retención', cuentas: deRetencion,
    texto: irpf > 0 ? `${pct(irpf)}${deRetencion.length ? '' : ' · sin cuenta en tu plan'}` : p.entityKind === 'company' ? 'No lleva · es una sociedad' : 'No lleva',
    nota: null, ia: false, papel: null, propia: null, opciones: [],
  })

  // Le pagas desde: los bancos (su 572). La compensación con su 430 llega con el C03.
  const bancoDe = new Map<string, BancoConta>()
  for (const b of e.bancos) { const l = enlace('bank_account', b.id, 'principal'); if (l) bancoDe.set(l.companyAccountId, b) }
  const nombreBanco = (c: CuentaPlan) => { const b = bancoDe.get(c.id); return b ? `${b.name}${b.iban ? ` · ${ibanCorto(b.iban)}` : ''}` : c.name }
  const pago = enlace('supplier', p.id, 'pago')
  const cPago = cuentaDe(pago)
  lineas.push({
    clave: 'pago', etiqueta: 'Le pagas desde', cuentas: cPago ? [vista(cPago, nombreBanco(cPago))] : [],
    texto: cPago ? null : bancoDe.size ? 'Sin decir' : 'Aún no tienes bancos en tu empresa',
    nota: cPago && cPago.templateCode.startsWith('43') ? 'se compensa con lo que te debe' : null,
    ia: pago?.source === 'ai_accepted', papel: 'pago', propia: pago ? pago.companyAccountId : null,
    opciones: e.cuentas.filter((c) => activa(c) && bancoDe.has(c.id)).map((c) => vista(c, nombreBanco(c))),
  })

  // Suplidos.
  const sup = enlace('supplier', p.id, 'suplidos')
  const cSup = cuentaDe(sup)
  lineas.push({
    clave: 'suplidos', etiqueta: 'Sus suplidos van a', cuentas: cSup ? [vista(cSup)] : [],
    texto: cSup ? null : 'No lleva', nota: cSup ? `no son base del IVA (${CITAS.suplidos.norma})` : null,
    ia: sup?.source === 'ai_accepted', papel: 'suplidos', propia: sup ? sup.companyAccountId : null, opciones: grupo6,
  })

  // Los datos que solo salen si aplican.
  const datos: DatoConta[] = []
  if (p.taxIdType) {
    datos.push({ clave: 'identificador', etiqueta: 'Tipo de identificador', valor: { nif_es: 'NIF', vat_eu: 'NIF-IVA de la UE', foreign: 'Otro' }[p.taxIdType], fuente: null })
  }
  const op = tipoDeOperacion(p)
  const m = (code: string) => e.modelos.find((x) => x.code === code)
  const fuenteOp = [m('303') && `Modelo 303 (${normaCorta(m('303')!.legalRef)})`, op === 'ue' && m('349') ? `modelo 349 (${normaCorta(m('349')!.legalRef)})` : null].filter(Boolean).join(' y ')
  datos.push({ clave: 'operacion', etiqueta: 'Tipo de operación', valor: TEXTO_OPERACION[op], fuente: fuenteOp || null })
  if (e.perfil.vatProrata) {
    datos.push({ clave: 'deducible', etiqueta: 'IVA deducible al', valor: e.perfil.vatProrataPct === null ? 'Falta el porcentaje en tu perfil fiscal' : pct(e.perfil.vatProrataPct), fuente: CITAS.prorrata.norma })
  }
  const reg = (code: string) => e.regimenes.find((x) => x.code === code) ?? null
  if (e.perfil.vatSurcharge) {
    const conRecargo = p.usualTaxRateIds.map((id) => e.tasas.find((t) => t.id === id)).filter((t): t is TasaConta => !!t && t.surchargeRate !== null && t.surchargeRate > 0)
    datos.push({
      clave: 'recargo', etiqueta: 'Recargo de equivalencia',
      valor: conRecargo.length ? `Te lo cobra: ${conRecargo.map((t) => `${pct(t.surchargeRate!)} con el ${pct(t.rate)}`).join(' y ')}` : 'Sus tipos de IVA no llevan recargo',
      fuente: reg('recargo_equivalencia')?.legalRef ?? null,
    })
  }
  if (e.perfil.vatCashBasis) {
    datos.push({ clave: 'caja', etiqueta: 'Criterio de caja', valor: 'El IVA de sus facturas se deduce cuando le pagas', fuente: reg('criterio_caja')?.legalRef ?? null })
  }
  return { lineas, datos }
}

// ── El 347 ──────────────────────────────────────────────────────────────────

export interface FacturaAnual { fecha: string; total: number; abono: boolean }
export interface Resultado347 { va: boolean | null; texto: string; fuente: string; importe: number }

/**
 * ¿Va al 347 este año? Suma lo del año natural (facturas menos abonos, IVA
 * incluido) y compara con 3.005,06 €. No va si la empresa no lo presenta, ni
 * lo excluido por el art. 33.2: lo de la UE (va al 349) y las importaciones,
 * ni lo que lleva retención (va al 190 o al 180).
 */
export function vaAl347(o: { facturas: readonly FacturaAnual[]; año: number; perfil: Pick<PerfilConta, 'presenta347'>; proveedor: Pick<ProveedorConta, 'vatRegime' | 'countryCode' | 'irpfWithholdingPct'> }): Resultado347 {
  const centimos = o.facturas.filter((f) => f.fecha.startsWith(`${o.año}-`)).reduce((t, f) => t + Math.round(Math.abs(f.total) * 100) * (f.abono ? -1 : 1), 0)
  const importe = centimos / 100
  if (!o.perfil.presenta347) return { va: null, texto: 'Tu empresa no presenta el 347', fuente: CITAS.limite347.norma, importe }
  const op = tipoDeOperacion(o.proveedor)
  if (op === 'ue') return { va: false, texto: 'No · lo de la UE va al 349', fuente: `${CITAS.excluidas347.norma}.i`, importe }
  if (op === 'fuera') return { va: false, texto: 'No · las importaciones no van', fuente: `${CITAS.excluidas347.norma}.g`, importe }
  if ((o.proveedor.irpfWithholdingPct ?? 0) > 0) return { va: false, texto: 'No · lo que lleva retención va al 190 o al 180', fuente: `${CITAS.excluidas347.norma}.i`, importe }
  return centimos > LIMITE_347
    ? { va: true, texto: 'Sí · supera los 3.005,06 €', fuente: CITAS.limite347.norma, importe }
    : { va: false, texto: `No · ${euros(importe)} este año, el límite es 3.005,06 €`, fuente: CITAS.limite347.norma, importe }
}

// ── El extracto (los apuntes llegan con el C04) ─────────────────────────────

export interface Apunte {
  fecha: string
  documento: string
  concepto: string
  debe: number
  haber: number
  /** A qué lleva el apunte: la factura o el pago. */
  enlace: { tipo: 'factura' | 'pago'; id: string } | null
}
export interface FilaExtracto extends Apunte { saldo: number }

/**
 * Saldo de una cuenta de proveedor: su saldo natural es acreedor (haber −
 * debe). Positivo = lo que le debes, «a tu cargo».
 */
const mueve = (a: Pick<Apunte, 'debe' | 'haber'>) => Math.round(a.haber * 100) - Math.round(a.debe * 100)
const porFecha = (a: Apunte, b: Apunte) => a.fecha.localeCompare(b.fecha)

/** Vista 1: apunte a apunte, con el saldo acumulado; empieza en la apertura. */
export function extracto(apuntes: readonly Apunte[], apertura = 0): FilaExtracto[] {
  let s = Math.round(apertura * 100)
  return [...apuntes].sort(porFecha).map((a) => { s += mueve(a); return { ...a, saldo: s / 100 } })
}

export interface MesSaldo { mes: string; debe: number; haber: number; saldo: number; acumulado: number }
export interface SaldosEjercicio { apertura: number; meses: MesSaldo[]; debe: number; haber: number; cierre: number }

/**
 * Vista 2: por mes del ejercicio (de `inicio` a `fin`, 'YYYY-MM-DD'), con
 * apertura, cierre y total del año. Lo anterior al inicio entra en la apertura;
 * lo posterior al fin, en ningún mes.
 */
export function saldosPorMes(apuntes: readonly Apunte[], ejercicio: { inicio: string; fin: string }, apertura = 0): SaldosEjercicio {
  let ab = Math.round(apertura * 100)
  for (const a of apuntes) if (a.fecha < ejercicio.inicio) ab += mueve(a)
  const meses: MesSaldo[] = []
  let [y, mm] = ejercicio.inicio.slice(0, 7).split('-').map(Number)
  const ultimo = ejercicio.fin.slice(0, 7)
  let acumulado = ab; let debe = 0; let haber = 0
  for (;;) {
    const mes = `${y}-${String(mm).padStart(2, '0')}`
    const del = apuntes.filter((a) => a.fecha.slice(0, 7) === mes && a.fecha >= ejercicio.inicio && a.fecha <= ejercicio.fin)
    const d = del.reduce((t, a) => t + Math.round(a.debe * 100), 0)
    const h = del.reduce((t, a) => t + Math.round(a.haber * 100), 0)
    acumulado += h - d; debe += d; haber += h
    meses.push({ mes, debe: d / 100, haber: h / 100, saldo: (h - d) / 100, acumulado: acumulado / 100 })
    if (mes >= ultimo) break
    mm += 1; if (mm > 12) { mm = 1; y += 1 }
  }
  return { apertura: ab / 100, meses, debe: debe / 100, haber: haber / 100, cierre: acumulado / 100 }
}

/** «1.283,15 € a tu cargo» / «a su cargo» / «a cero». */
export function textoSaldo(saldo: number): { importe: string; lado: string } {
  if (Math.round(saldo * 100) === 0) return { importe: euros(0), lado: 'a cero' }
  return saldo > 0 ? { importe: euros(saldo), lado: 'a tu cargo' } : { importe: euros(-saldo), lado: 'a su cargo' }
}
