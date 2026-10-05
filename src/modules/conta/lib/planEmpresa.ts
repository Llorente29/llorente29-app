// src/modules/conta/lib/planEmpresa.ts
//
// C02 · El plan contable de UNA empresa: reglas puras, con pruebas
// (tests/unit/modules/conta/planEmpresaC02.test.ts). La base guarda lo que
// esto decide (company_chart_activate y compañía, 20261007T0120); la regla
// está escrita una vez, aquí, y la función de la base la repite en SQL con la
// misma prueba sobre las mismas entradas.
//
// Decisiones de Julio (respuesta 1 del C02):
//   D2 · a la empresa le llegan SOLO las hojas del cuadro (las cuentas sin
//        hijas), rellenadas a su longitud (4700 → 47000000), más sus
//        subcuentas. Las de serie con hijas no se copian: se enseñan como
//        cabecera desde pgc_account.
//   D3 · longitud de 6 a 12 dígitos; 8 por defecto; fija desde el primer asiento.
//   D4 · pymes → general: se añaden las hojas que faltan y, para lo que cuelga
//        de una hoja de pymes que en el general no lo es, la persona elige una
//        a una (supabase/conta/pgc/equivalencias.json). General → pymes: se
//        bloquea si hay algo en una cuenta que pymes no tiene.
//   D5 · 430: solo la hoja común (43000000) hasta el C03.

import { DIGITOS_MAXIMOS, DIGITOS_MINIMOS } from '@/modules/conta/lib/pgc'

export { DIGITOS_MAXIMOS, DIGITOS_MINIMOS }
export const DIGITOS_POR_DEFECTO = 8

export type Plan = 'pymes' | 'general'
export type EstadoCuenta = 'activa' | 'oculta' | 'cerrada'
export type Entidad = 'supplier' | 'customer' | 'bank_account' | 'expense_category' | 'tax_rate' | 'withholding_rate'
/**
 * Para un tipo de IVA, la cuenta del IVA que pagas (472) y la del que cobras (477).
 * Para un proveedor (0160): su cuenta (principal) y, si los tiene propios, dónde
 * van sus facturas (gasto), desde dónde se le paga (pago) y sus suplidos.
 */
export type Papel = 'principal' | 'soportado' | 'repercutido' | 'gasto' | 'pago' | 'suplidos'

export interface HojaSerie { code: string; name: string; plainName: string | null }

export interface CuentaEmpresa {
  code: string
  /** La hoja del cuadro de la que cuelga (para una de serie, ella misma). */
  templateCode: string
  name: string
  kind: 'template' | 'own'
  status: EstadoCuenta
  /** Cuenta común de un tipo de terceros: la hoja rellenada, para todos los que no tienen la suya. */
  isCommon?: boolean
}

export interface Enlace { entity: Entidad; entityId: string; role: Papel; code: string }

/** Las tres entidades que llevan una subcuenta POR CABEZA (salvo cuenta común). */
export const TERCEROS: readonly Entidad[] = ['supplier', 'customer', 'bank_account']

export const digitosValidos = (d: number): boolean => Number.isInteger(d) && d >= DIGITOS_MINIMOS && d <= DIGITOS_MAXIMOS

/** 4700 con 8 dígitos → 47000000. Nunca corta: un código más largo que la longitud es un error. */
export function rellenar(code: string, digitos: number): string {
  if (!/^\d{1,5}$/.test(code)) throw new Error(`«${code}» no es un código del cuadro.`)
  if (!digitosValidos(digitos)) throw new Error(`La longitud tiene que ir de ${DIGITOS_MINIMOS} a ${DIGITOS_MAXIMOS} dígitos.`)
  if (code.length >= digitos) throw new Error(`«${code}» no cabe en ${digitos} dígitos con sitio para subcuentas.`)
  return code.padEnd(digitos, '0')
}

/** Subcuenta número n de un prefijo: (4000, 8, 12) → 40000012. Null si no cabe. */
export function subcuenta(prefijo: string, digitos: number, n: number): string | null {
  const sitio = digitos - prefijo.length
  if (sitio < 1 || !Number.isInteger(n) || n < 1 || String(n).length > sitio) return null
  return prefijo + String(n).padStart(sitio, '0')
}

/**
 * El siguiente código libre bajo un prefijo. El 0 (la hoja rellenada) es la
 * cuenta común, así que se empieza en 1. Null si la numeración está agotada.
 */
export function siguienteLibre(prefijo: string, digitos: number, ocupados: ReadonlySet<string>): string | null {
  const max = 10 ** (digitos - prefijo.length) - 1
  for (let n = 1; n <= max; n++) {
    const c = subcuenta(prefijo, digitos, n)
    if (c && !ocupados.has(c)) return c
  }
  return null
}

export type SalidaAgotada =
  | { tipo: 'ampliar'; digitos: number; porque: string }
  | { tipo: 'prefijo'; prefijo: string; porque: string }
  | { tipo: 'nada'; porque: string }

/**
 * Numeración agotada (encargo §3; Holded amplía sola, Folvy no):
 *   · antes del primer asiento → propone ampliar la longitud (y renumerar);
 *   · después → propone un prefijo libre dentro de la misma cuenta de 3
 *     dígitos que no sea un código del cuadro (400 → 4001 si 4000 se agotó).
 * Solo propone: lo hace la persona.
 */
export function salidaNumeracionAgotada(
  hoja: string, digitos: number, bloqueada: boolean, codigosDelCuadro: ReadonlySet<string>, prefijosUsados: ReadonlySet<string>,
): SalidaAgotada {
  if (!bloqueada && digitos < DIGITOS_MAXIMOS) {
    return { tipo: 'ampliar', digitos: digitos + 1, porque: `Las subcuentas de ${hoja} con ${digitos} dígitos se han acabado. Aún no hay asientos: se puede pasar a ${digitos + 1} dígitos y renumerar todas.` }
  }
  const cuenta = hoja.slice(0, 3)
  if (hoja.length === 4) {
    for (let i = 0; i <= 9; i++) {
      const p = cuenta + String(i)
      if (p !== hoja && !codigosDelCuadro.has(p) && !prefijosUsados.has(p)) {
        return { tipo: 'prefijo', prefijo: p, porque: `Las subcuentas de ${hoja} se han acabado y la longitud ya no se puede cambiar. ${p} no es una cuenta del cuadro y sigue dentro de ${cuenta}: las nuevas pueden ir ahí.` }
      }
    }
  }
  return { tipo: 'nada', porque: `Las subcuentas de ${hoja} se han acabado y no queda prefijo libre dentro de ${cuenta}. Hay que hablarlo con el asesor.` }
}

/** El sufijo de 472/477 por tipo de IVA: el tipo en enteros (21 → …021); 9,5 % → 95. */
/** 21 → «21 %»; 7,5 → «7,5 %». El nombre de una subcuenta de IVA. */
export const textoTipo = (rate: number): string => `${String(rate).replace('.', ',')} %`

export function sufijoDeTipo(rate: number): number {
  return Number.isInteger(rate) ? rate : Math.round(rate * 10)
}

export interface EntradaActivacion {
  hojas: readonly HojaSerie[]
  digitos: number
  /** Tipos de IVA (o IGIC) vigentes de la empresa, con tributación normal. */
  ivas: readonly { id: string; rate: number }[]
  retenciones: readonly { id: string; pgcHint: string | null }[]
  gastos: readonly { id: string; pgcHint: string | null }[]
  bancos: readonly { id: string; name: string }[]
  /** gastoPista: la cuenta del 6 de su tipo de gasto; hoja: la marca del tipo de gasto (expense_category.supplier_account_leaf), si la tiene. */
  proveedores: readonly { id: string; name: string; gastoPista?: string | null; hoja?: HojaProveedor | null }[]
  cuentaComun: { proveedores: boolean }
}

export interface SalidaActivacion { cuentas: CuentaEmpresa[]; enlaces: Enlace[]; avisos: string[] }

/**
 * Al activar el plan en una empresa (encargo §3, D2, D5):
 *   · todas las hojas del cuadro, rellenadas, como «template»;
 *   · 472/477 por cada tipo de IVA vigente (47200021, 47700021…);
 *   · cada retención a su 4751 (o la que diga su pista), cada tipo de gasto a su 6xx;
 *   · 572 por cada banco (57200001…);
 *   · 400 por cada proveedor (40000001…) o, si se elige, la cuenta común 40000000;
 *   · 430: solo la común (D5), sin subcuentas.
 */
export function activar(e: EntradaActivacion): SalidaActivacion {
  const avisos: string[] = []
  const d = e.digitos
  const porHoja = new Map(e.hojas.map((h) => [h.code, h]))
  const cuentas: CuentaEmpresa[] = e.hojas.map((h) => ({ code: rellenar(h.code, d), templateCode: h.code, name: h.name, kind: 'template', status: 'activa' }))
  const ocupados = new Set(cuentas.map((c) => c.code))
  const enlaces: Enlace[] = []
  const hojaRellena = (code: string) => (porHoja.has(code) ? rellenar(code, d) : null)
  const comun = (code: string) => { const c = cuentas.find((x) => x.templateCode === code && x.kind === 'template'); if (c) c.isCommon = true }
  comun('4000'); comun('4100'); comun('4300')

  // IVA: una subcuenta por tipo, en 472 y en 477.
  const porTipo = new Map<number, string[]>()
  const tipoDe = new Map<number, number>()
  for (const t of e.ivas) { porTipo.set(sufijoDeTipo(t.rate), [...(porTipo.get(sufijoDeTipo(t.rate)) ?? []), t.id]); tipoDe.set(sufijoDeTipo(t.rate), t.rate) }
  for (const [suf, ids] of [...porTipo].sort((a, b) => b[0] - a[0])) {
    for (const [hoja, papel, nombre] of [['472', 'soportado', 'IVA soportado'], ['477', 'repercutido', 'IVA repercutido']] as const) {
      // Un tipo al 0 % (el IGIC cero) no lleva cuota: va a la hoja, sin subcuenta.
      if (suf === 0) { for (const id of ids) enlaces.push({ entity: 'tax_rate', entityId: id, role: papel, code: rellenar(hoja, d) }); continue }
      const code = subcuenta(hoja, d, suf)
      if (!code || ocupados.has(code)) { avisos.push(`No cabe la subcuenta de ${hoja} para el ${suf} %.`); continue }
      // El nombre lleva el TIPO («7,5 %»); el código, su sufijo (47200075).
      cuentas.push({ code, templateCode: hoja, name: `${nombre} ${textoTipo(tipoDe.get(suf)!)}`, kind: 'own', status: 'activa' })
      ocupados.add(code)
      for (const id of ids) enlaces.push({ entity: 'tax_rate', entityId: id, role: papel, code })
    }
  }
  // Retenciones y tipos de gasto: a su hoja (varias pueden compartirla).
  for (const r of e.retenciones) {
    const c = hojaRellena(r.pgcHint ?? '4751')
    if (c) enlaces.push({ entity: 'withholding_rate', entityId: r.id, role: 'principal', code: c })
    else avisos.push(`La retención ${r.id} apunta a ${r.pgcHint}, que no es una hoja del plan.`)
  }
  for (const g of e.gastos) {
    const c = g.pgcHint ? hojaRellena(g.pgcHint) : null
    if (c) enlaces.push({ entity: 'expense_category', entityId: g.id, role: 'principal', code: c })
    else avisos.push(`El tipo de gasto ${g.id} no tiene una hoja del plan como pista (${g.pgcHint ?? 'ninguna'}).`)
  }
  // Terceros con subcuenta propia.
  const terceros = (lista: readonly { id: string; name: string }[], prefijo: string, entidad: Entidad, titulo: string, enComun: boolean) => {
    for (const t of lista) {
      if (enComun) { enlaces.push({ entity: entidad, entityId: t.id, role: 'principal', code: rellenar(prefijo, d) }); continue }
      const code = siguienteLibre(prefijo, d, ocupados)
      if (!code) { avisos.push(`Numeración agotada en ${prefijo}: ${t.name} se queda sin subcuenta.`); continue }
      cuentas.push({ code, templateCode: prefijo, name: `${titulo} · ${t.name}`, kind: 'own', status: 'activa' })
      ocupados.add(code)
      enlaces.push({ entity: entidad, entityId: t.id, role: 'principal', code })
    }
  }
  terceros(e.bancos, '572', 'bank_account', 'Bancos', false)
  // Proveedores: 4000 si lo que vende es mercancía, 4100 si son servicios
  // (respuesta 2 de Julio, del contraste con Diez). Por orden de nombre en cada hoja.
  for (const hoja of ['4000', '4100'] as const) {
    terceros(e.proveedores.filter((p) => hojaDeProveedor(p.gastoPista ?? null, p.hoja ?? null).hoja === hoja), hoja, 'supplier',
      hoja === '4000' ? 'Proveedores' : 'Acreedores', e.cuentaComun.proveedores)
  }
  return { cuentas: cuentas.sort((a, b) => a.code.localeCompare(b.code)), enlaces, avisos }
}

export type HojaProveedor = '4000' | '4100'

/** Las dos definiciones de la quinta parte del PGC de pymes que hacen la regla (citadas, literales). */
export const DEFINICION_400 = '400. Proveedores. Deudas con suministradores de mercancías y de los demás bienes definidos en el grupo 3.'
export const DEFINICION_410 = '410. Acreedores por prestaciones de servicios. Deudas con suministradores de servicios que no tienen la condición estricta de proveedores.'

/**
 * De qué hoja cuelga la subcuenta de un proveedor (respuesta 2 de Julio): la
 * marca de su tipo de gasto si la tiene; si no, por su cuenta del 6: compras
 * (grupo 60) → 4000 «Proveedores (euros)»; servicios (62 y demás) → 4100
 * «Acreedores por prestaciones de servicios (euros)». Sin tipo de gasto, 4000
 * hasta que se le ponga: lo dice el porqué y la ficha tiene «Cambiar».
 */
export function hojaDeProveedor(gastoPista: string | null, marca: HojaProveedor | null): { hoja: HojaProveedor; porque: string } {
  if (marca) return { hoja: marca, porque: marca === '4000' ? `Su tipo de gasto va a proveedores: ${DEFINICION_400}` : `Su tipo de gasto va a acreedores: ${DEFINICION_410}` }
  if (!gastoPista) return { hoja: '4000', porque: 'Aún no tiene tipo de gasto: va a 400, proveedores, hasta que se le ponga. Si te vende servicios, cámbialo a 410.' }
  return gastoPista.startsWith('60')
    ? { hoja: '4000', porque: `Le compras mercancía (${gastoPista}): ${DEFINICION_400}` }
    : { hoja: '4100', porque: `Te presta servicios (${gastoPista}): ${DEFINICION_410}` }
}

/** Una subcuenta de la empresa nueva: siguiente código libre bajo su hoja. */
export function nuevaSubcuenta(
  hoja: HojaSerie, digitos: number, cuentas: readonly CuentaEmpresa[], nombre: string,
): { ok: true; cuenta: CuentaEmpresa } | { ok: false; motivo: string } {
  if (!nombre.trim()) return { ok: false, motivo: 'Ponle un nombre.' }
  const code = siguienteLibre(hoja.code, digitos, new Set(cuentas.map((c) => c.code)))
  if (!code) return { ok: false, motivo: `Ya no quedan subcuentas libres en ${hoja.code} con ${digitos} dígitos.` }
  return { ok: true, cuenta: { code, templateCode: hoja.code, name: nombre.trim(), kind: 'own', status: 'activa' } }
}

/**
 * Renumerar al cambiar la longitud (solo antes del primer asiento). Lo que
 * va detrás del prefijo es el número de la subcuenta y se conserva: 40000012
 * (8) → 4000000012 (10). Para encoger, el número tiene que caber.
 */
export function renumerar(
  cuentas: readonly CuentaEmpresa[], de: number, a: number,
): { ok: true; cambios: { antes: string; despues: string }[] } | { ok: false; motivo: string } {
  if (!digitosValidos(a)) return { ok: false, motivo: `La longitud tiene que ir de ${DIGITOS_MINIMOS} a ${DIGITOS_MAXIMOS} dígitos.` }
  if (a === de) return { ok: true, cambios: [] }
  const cambios: { antes: string; despues: string }[] = []
  const vistos = new Set<string>()
  for (const c of cuentas) {
    if (c.code.length !== de) return { ok: false, motivo: `${c.code} no tiene ${de} dígitos: la longitud de la empresa no es coherente.` }
    const n = Number(c.code.slice(c.templateCode.length))
    const despues = n === 0 ? rellenar(c.templateCode, a) : subcuenta(c.templateCode, a, n)
    if (!despues) return { ok: false, motivo: `${c.code} (${c.name}) no cabe en ${a} dígitos.` }
    if (vistos.has(despues)) return { ok: false, motivo: `Con ${a} dígitos, dos cuentas acabarían en ${despues}.` }
    vistos.add(despues)
    cambios.push({ antes: c.code, despues })
  }
  return { ok: true, cambios }
}

export interface Incoherencia { code: string; regla: 'sin_padre' | 'longitud' | 'enlace_doble' | 'oculta_con_enlace' | 'enlace_roto' | 'cerrada_con_enlace'; texto: string }

/**
 * Regla de coherencia (encargo §3), con el caso concreto:
 *   · toda cuenta cuelga de una hoja del cuadro y empieza por ella;
 *   · todas tienen la longitud de la empresa;
 *   · dos terceros no comparten subcuenta, salvo la común;
 *   · un enlace apunta a una cuenta que existe, y no oculta (ni cerrada).
 */
export function coherencia(
  cuentas: readonly CuentaEmpresa[], enlaces: readonly Enlace[], hojas: ReadonlySet<string>, digitos: number,
): Incoherencia[] {
  const out: Incoherencia[] = []
  const porCodigo = new Map(cuentas.map((c) => [c.code, c]))
  for (const c of cuentas) {
    if (!hojas.has(c.templateCode) || !c.code.startsWith(c.templateCode)) out.push({ code: c.code, regla: 'sin_padre', texto: `${c.code} (${c.name}) no cuelga de una hoja del cuadro (${c.templateCode}).` })
    if (c.code.length !== digitos) out.push({ code: c.code, regla: 'longitud', texto: `${c.code} tiene ${c.code.length} dígitos y la empresa usa ${digitos}.` })
  }
  const terceroPorCuenta = new Map<string, Enlace>()
  for (const l of enlaces) {
    const c = porCodigo.get(l.code)
    if (!c) { out.push({ code: l.code, regla: 'enlace_roto', texto: `Un ${l.entity} apunta a ${l.code}, que no existe.` }); continue }
    if (c.status === 'oculta') out.push({ code: c.code, regla: 'oculta_con_enlace', texto: `${c.code} (${c.name}) está oculta y tiene un enlace activo (${l.entity}).` })
    if (c.status === 'cerrada') out.push({ code: c.code, regla: 'cerrada_con_enlace', texto: `${c.code} (${c.name}) está cerrada y sigue enlazada (${l.entity}): no admite apuntes nuevos.` })
    if (TERCEROS.includes(l.entity) && l.role === 'principal' && !c.isCommon) {
      const otro = terceroPorCuenta.get(l.code)
      if (otro && (otro.entity !== l.entity || otro.entityId !== l.entityId)) out.push({ code: c.code, regla: 'enlace_doble', texto: `${c.code} (${c.name}) es la subcuenta de dos terceros y no es la cuenta común.` })
      terceroPorCuenta.set(l.code, l)
    }
  }
  return out
}

/** ¿Se puede ocultar? No, si tiene un enlace activo (encargo §3). */
export function puedeOcultar(code: string, enlaces: readonly Enlace[]): { ok: true } | { ok: false; motivo: string } {
  const l = enlaces.find((x) => x.code === code)
  return l ? { ok: false, motivo: `Tiene un enlace activo (${l.entity}). Cambia antes ese enlace a otra cuenta.` } : { ok: true }
}

export interface Equivalencia { code: string; name: string; tipo: 'se_divide' | 'no_existe'; padreEnGeneral: string; candidatos: { code: string; name: string; cita: string }[]; propuesta: string | null }

export type CambioDePlan =
  | { ok: true; anadir: string[]; elegir: { cuenta: CuentaEmpresa; equivalencia: Equivalencia }[]; aviso: string }
  | { ok: false; bloquean: CuentaEmpresa[]; motivo: string }

export const AVISO_TAMANO = 'Si la empresa puede usar el plan de pymes depende de su tamaño: lo decidís la empresa y su asesor; Folvy no lo decide.'

/**
 * Cambio de plan (D4):
 *   · pymes → general: se añaden las hojas del general que faltan; lo que
 *     cuelga de una hoja de pymes que en el general no lo es (cuentas de la
 *     empresa sobre ella) queda para elegir, una a una, entre sus candidatos.
 *   · general → pymes: se bloquea si hay una cuenta de la empresa (de serie
 *     con enlaces o suya) sobre una hoja que pymes no tiene; si no, se permite.
 * Nada se mueve solo.
 */
export function cambioDePlan(
  de: Plan, a: Plan, cuentas: readonly CuentaEmpresa[], enlaces: readonly Enlace[],
  hojas: { pymes: ReadonlySet<string>; general: ReadonlySet<string> }, equivalencias: readonly Equivalencia[],
): CambioDePlan {
  if (de === a) return { ok: true, anadir: [], elegir: [], aviso: AVISO_TAMANO }
  const tiene = new Set(cuentas.map((c) => c.templateCode))
  const usadas = new Set(enlaces.map((l) => l.code))
  if (a === 'general') {
    const porCodigo = new Map(equivalencias.map((x) => [x.code, x]))
    const elegir = cuentas
      .filter((c) => porCodigo.has(c.templateCode) && (c.kind === 'own' || usadas.has(c.code)))
      .map((cuenta) => ({ cuenta, equivalencia: porCodigo.get(cuenta.templateCode)! }))
    const anadir = [...hojas.general].filter((h) => !tiene.has(h)).sort()
    return { ok: true, anadir, elegir, aviso: AVISO_TAMANO }
  }
  const bloquean = cuentas.filter((c) => !hojas.pymes.has(c.templateCode) && (c.kind === 'own' || usadas.has(c.code)))
  if (bloquean.length) {
    return { ok: false, bloquean, motivo: `No se puede pasar al plan de pymes: ${bloquean.length === 1 ? 'hay una cuenta' : `hay ${bloquean.length} cuentas`} con datos en cuentas que el plan de pymes no tiene (${bloquean.slice(0, 5).map((c) => c.code).join(', ')}${bloquean.length > 5 ? '…' : ''}).` }
  }
  return { ok: true, anadir: [...hojas.pymes].filter((h) => !tiene.has(h)).sort(), elegir: [], aviso: AVISO_TAMANO }
}

// ── Duplicadas, cerrar y palabras clave (encargo §3) ────────────────────────

export type Fusion =
  | { ok: true; modo: 'borrar' | 'fusionar'; mueve: Enlace[]; porque: string }
  | { ok: false; motivo: string }

/**
 * Dos cuentas duplicadas. Antes del primer asiento la que sobra se BORRA y sus
 * enlaces pasan a la que queda; después se FUSIONA (QuickBooks, Pennylane): el
 * historial pasa a la que queda, con registro y «Deshacer» 24 h (eso lo hace
 * el C04, que es quien tiene apuntes). Solo entre cuentas de la misma hoja, y
 * una de serie nunca es la que sobra.
 */
export function fusionar(sobra: CuentaEmpresa, queda: CuentaEmpresa, enlaces: readonly Enlace[], bloqueada: boolean): Fusion {
  if (sobra.code === queda.code) return { ok: false, motivo: 'Es la misma cuenta.' }
  if (sobra.templateCode !== queda.templateCode) return { ok: false, motivo: `${sobra.code} y ${queda.code} no cuelgan de la misma cuenta del plan: no son duplicadas.` }
  if (sobra.kind === 'template') return { ok: false, motivo: `${sobra.code} es de serie: no se puede quitar. Fusiona al revés.` }
  if (queda.status !== 'activa') return { ok: false, motivo: `${queda.code} está ${queda.status}: elige una activa para quedarte.` }
  const mueve = enlaces.filter((l) => l.code === sobra.code).map((l) => ({ ...l, code: queda.code }))
  const terceros = new Set([...enlaces.filter((l) => l.code === queda.code), ...mueve].filter((l) => TERCEROS.includes(l.entity) && l.role === 'principal').map((l) => `${l.entity}:${l.entityId}`))
  if (terceros.size > 1 && !queda.isCommon) return { ok: false, motivo: `Las dos son subcuentas de terceros distintos: no son duplicadas.` }
  return bloqueada
    ? { ok: true, modo: 'fusionar', mueve, porque: `Ya hay asientos: ${sobra.code} pasa su historial a ${queda.code} y queda cerrada. Se puede deshacer durante 24 horas.` }
    : { ok: true, modo: 'borrar', mueve, porque: `Aún no hay asientos: ${sobra.code} se borra y lo que apuntaba a ella pasa a ${queda.code}.` }
}

/** Cerrar es para cuentas con historial; sin asientos, lo que toca es ocultar. */
export function puedeCerrar(cuenta: CuentaEmpresa, enlaces: readonly Enlace[], bloqueada: boolean): { ok: true } | { ok: false; motivo: string } {
  if (!bloqueada) return { ok: false, motivo: 'Aún no hay asientos: no hay nada que cerrar. Si no la usas, ocúltala.' }
  if (cuenta.status === 'cerrada') return { ok: false, motivo: 'Ya está cerrada.' }
  const l = enlaces.find((x) => x.code === cuenta.code)
  return l ? { ok: false, motivo: `Tiene un enlace activo (${l.entity}). Cambia antes ese enlace a otra cuenta.` } : { ok: true }
}

/** Palabras clave de una cuenta (Puzzle): limpias, sin repetir, en minúsculas; como mucho 20. */
export function limpiarPalabras(palabras: readonly string[]): string[] {
  const out: string[] = []
  for (const p of palabras) {
    const w = p.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
    if (w && w.length <= 40 && !out.includes(w)) out.push(w)
  }
  return out.slice(0, 20)
}
