// src/modules/conta/lib/propuestaImportacion.ts
//
// C02c · Traer el plan de otro programa: PROPUESTA y REVISIÓN (reglas puras,
// con pruebas en tests/unit/modules/conta/importarPlanC02c.test.ts). La base
// (company_chart_import_apply, 20261008T0110) vuelve a comprobar todo lo que
// importa: aquí se decide qué se enseña y qué se propone.
//
// Encargo §4 y respuesta 1 de Julio:
//   · Enlace con lo que ya hay, con confianza y porqué:
//       seguro   = mismo NIF (proveedor) o mismo IBAN (banco);
//       probable = nombre igual o casi, sin NIF; o NIF en un lado y no en el otro;
//       decide tú = sin ficha y sin NIF, nombre repetido, o dos cuentas para el mismo tercero.
//   · Tercero de Diez sin ficha en Folvy: con NIF se CREA la ficha de proveedor
//     «Traída de Diez · por completar»; sin NIF va a «Decide tú» con tres
//     salidas: Es este / Crear ficha por completar / Cuenta mía sin ficha.
//   · La 430 de quien también es proveedor se enlaza a su ficha con el papel
//     de PAGO (la compensación); la de quien solo es cliente entra sin ficha,
//     marcada «cliente · ficha en el C03».
//   · El IVA: el 47200000/47700000 del programa entra como la hoja común; Folvy
//     crea además las 472/477 por tipo. Cambia: se cuenta y se dice.
//   · Retenciones (4751…): cada una se asigna a un modelo (111 o 115) o a
//     ninguno; dos con el mismo nombre → decide tú.
//   · Lo seguro viene marcado; solo «decide tú» sin contestar bloquea el paso 3.

import { claveNombre, ibanEnNombre, parecido, type CuentaClasificada, type TerceroLeido } from '@/modules/conta/lib/importarPlan'

export type Confianza = 'seguro' | 'probable' | 'decide'

export type ClaseFila = 'proveedor' | 'acreedor' | 'cliente' | 'banco' | 'retencion' | 'iva' | 'otra'

export type Modelo = '111' | '115'

/** Lo que se hará con una cuenta del fichero. */
export type Decision =
  /** Se enlaza con una ficha que ya existe (proveedor o banco). Pago = la 430 de un proveedor (compensación). */
  | { tipo: 'enlazar'; entity: 'supplier' | 'bank_account'; entityId: string; nombreFicha: string; papel: 'principal' | 'pago' }
  /** Se enlaza con la ficha que CREA otra fila de esta importación (la 430 de un proveedor nuevo). */
  | { tipo: 'enlazar_creada'; codigoCreadora: string; papel: 'pago' }
  /** Se crea la ficha de proveedor «Traída de … · por completar». */
  | { tipo: 'crear_proveedor'; nombre: string; nif: string | null }
  /** Cuenta tuya, sin ficha: no estorba. «cliente_c03»: la de un cliente, hasta que el C03 traiga su ficha. */
  | { tipo: 'sin_ficha'; nota: 'cuenta' | 'cliente_c03' }
  /** Una 4751 propia: a qué modelo va (null = a ninguno, cuenta tuya). */
  | { tipo: 'retencion'; modelo: Modelo | null }
  /** Una cuenta de serie (sufijo 0000): se conserva el nombre oficial. */
  | { tipo: 'serie' }
  /** Falta que la persona diga qué es. */
  | { tipo: 'pendiente' }

export interface Opcion { id: string; texto: string; decision: Decision }

export interface FilaRevision {
  code: string
  hoja: string
  clase: ClaseFila
  /** Cómo se llamaba allí, tal cual. */
  enOrigen: string
  nif: string | null
  decision: Decision
  confianza: Confianza
  /** El porqué, en una línea («mismo NIF B…», «sin NIF; mismo nombre que el 41000002»). */
  porque: string
  /** Las salidas que se le ofrecen a la persona (además de «Cambiar» con buscador de fichas). */
  opciones: Opcion[]
  /** true si es una cuenta de serie que cambia (472/477: aquí van por tipo). */
  cambia: boolean
}

export interface FichaProveedor { id: string; name: string; nif: string | null }
export interface FichaBanco { id: string; name: string; iban: string | null }

export interface EntradaPropuesta {
  /** Las cuentas leídas y clasificadas (resumir().cuentas). */
  cuentas: readonly CuentaClasificada[]
  /** Los terceros de los listados (con NIF y dirección), por código. */
  terceros: readonly TerceroLeido[]
  proveedores: readonly FichaProveedor[]
  bancos: readonly FichaBanco[]
  /** Nombre del programa, para los textos («Traída de Cegid Diez»). */
  programa: string
}

export const esProveedor = (hoja: string) => hoja.startsWith('400') || hoja.startsWith('401') || hoja.startsWith('403') || hoja.startsWith('404') || hoja.startsWith('405') || hoja.startsWith('406')
export const esAcreedor = (hoja: string) => hoja.startsWith('41')
export const esCliente = (hoja: string) => hoja.startsWith('43') || hoja.startsWith('44')

export function claseDe(hoja: string): ClaseFila {
  if (esProveedor(hoja)) return 'proveedor'
  if (esAcreedor(hoja)) return 'acreedor'
  if (esCliente(hoja)) return 'cliente'
  if (hoja === '572') return 'banco'
  if (hoja === '4751') return 'retencion'
  if (hoja === '472' || hoja === '477') return 'iva'
  return 'otra'
}

const SALIDAS_SIN_NIF = (nombre: string): Opcion[] => [
  { id: 'crear', texto: 'Crear ficha por completar', decision: { tipo: 'crear_proveedor', nombre, nif: null } },
  { id: 'sin_ficha', texto: 'Cuenta mía sin ficha', decision: { tipo: 'sin_ficha', nota: 'cuenta' } },
]

/** Pistas de modelo en el nombre de una 4751 («alquiler» → 115; «profesional», «trabajo» → 111). */
export function modeloPorNombre(nombre: string): Modelo | null {
  const k = claveNombre(nombre)
  if (/alquil|arrend|local/.test(k)) return '115'
  if (/profesion|trabaj|nomin|personal/.test(k)) return '111'
  return null
}

/**
 * La propuesta: una fila por cuenta propia del fichero, y las dos de serie que
 * cambian (472/477). Las demás de serie entran tal cual y no se enseñan.
 */
export function proponer(e: EntradaPropuesta): FilaRevision[] {
  const tercero = new Map(e.terceros.map((t) => [t.code, t]))
  const porNif = new Map<string, FichaProveedor[]>()
  for (const p of e.proveedores) if (p.nif) porNif.set(p.nif, [...(porNif.get(p.nif) ?? []), p])
  const filas: FilaRevision[] = []

  // Nombres repetidos dentro del fichero (47510015 y 47510019 «acreedora por retenciones IRPF»).
  const repetidos = new Map<string, string[]>()
  for (const c of e.cuentas) if (c.clase === 'propia') { const k = claveNombre(c.nombre); repetidos.set(k, [...(repetidos.get(k) ?? []), c.code]) }
  const otroIgual = (c: CuentaClasificada) => (repetidos.get(claveNombre(c.nombre)) ?? []).filter((x) => x !== c.code)

  for (const c of e.cuentas) {
    const clase = claseDe(c.hoja)
    const t = tercero.get(c.code)
    const nif = t?.nif ?? null
    const base = { code: c.code, hoja: c.hoja, clase, enOrigen: c.nombreOrigen || c.nombre, nif, opciones: [] as Opcion[], cambia: false }
    if (c.clase === 'serie') {
      if (clase === 'iva') filas.push({ ...base, decision: { tipo: 'serie' }, confianza: 'seguro', cambia: true, porque: 'en Folvy el IVA va por tipo; el 303 suma igual' })
      continue
    }
    if (clase === 'proveedor' || clase === 'acreedor') { filas.push(terceroProveedor(base, c, nif, porNif, e)); continue }
    if (clase === 'banco') {
      const iban = ibanEnNombre(c.nombre)
      const b = iban ? e.bancos.find((x) => x.iban === iban) : undefined
      if (b) { filas.push({ ...base, decision: { tipo: 'enlazar', entity: 'bank_account', entityId: b.id, nombreFicha: b.name, papel: 'principal' }, confianza: 'seguro', porque: 'mismo IBAN en Bancos' }); continue }
      // Con IBAN en los dos lados y distintos, no es el mismo banco aunque se llame parecido.
      const porNombre = e.bancos.filter((x) => parecido(x.name, c.nombre) && !(iban && x.iban && x.iban !== iban))
      if (porNombre.length === 1) {
        filas.push({ ...base, decision: { tipo: 'enlazar', entity: 'bank_account', entityId: porNombre[0].id, nombreFicha: porNombre[0].name, papel: 'principal' }, confianza: 'probable',
          porque: iban ? 'nombre parecido, pero el IBAN no es el de Bancos' : 'nombre parecido; sin IBAN para comprobarlo' })
        continue
      }
      filas.push({ ...base, decision: { tipo: 'sin_ficha', nota: 'cuenta' }, confianza: 'probable', porque: iban ? 'ese IBAN no está en Bancos; entra como cuenta tuya y lo enlazas cuando lo des de alta' : 'no está en Bancos; entra como cuenta tuya' })
      continue
    }
    if (clase === 'retencion') {
      const otros = otroIgual(c)
      if (otros.length) {
        filas.push({ ...base, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: `hay ${otros.length + 1} iguales: ${[c.code, ...otros].sort().join(' y ')}. ¿Cuál es cuál?`,
          opciones: [
            { id: '111', texto: '111', decision: { tipo: 'retencion', modelo: '111' } },
            { id: '115', texto: '115', decision: { tipo: 'retencion', modelo: '115' } },
            { id: 'ninguno', texto: 'Ninguno', decision: { tipo: 'retencion', modelo: null } },
          ] })
        continue
      }
      const m = modeloPorNombre(c.nombre)
      filas.push(m
        ? { ...base, decision: { tipo: 'retencion', modelo: m }, confianza: 'probable', porque: m === '115' ? 'por el nombre, retenciones de alquileres (115)' : 'por el nombre, retenciones de trabajo y profesionales (111)' }
        : { ...base, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: '¿qué retenciones van aquí?',
            opciones: [
              { id: '111', texto: '111', decision: { tipo: 'retencion', modelo: '111' } },
              { id: '115', texto: '115', decision: { tipo: 'retencion', modelo: '115' } },
              { id: 'ninguno', texto: 'Ninguno', decision: { tipo: 'retencion', modelo: null } },
            ] })
      continue
    }
    if (clase === 'cliente') { filas.push(terceroCliente(base, c, nif, porNif, filas)); continue }
    // Gastos, socios, préstamos, IVA propio por tipo de otro programa…: entran tal cual, sin ficha.
    filas.push({ ...base, decision: { tipo: 'sin_ficha', nota: 'cuenta' }, confianza: 'seguro', porque: 'entra con su número' })
  }
  // Una 430 que se apoyaba en una fila anterior (Glovo cliente → Glovo proveedor) ya está resuelta; ahora,
  // los dobles: dos cuentas que acaban en el mismo tercero y el mismo papel pasan a «decide tú».
  return marcarDobles(filas)
}

type Base = Omit<FilaRevision, 'decision' | 'confianza' | 'porque'>

function terceroProveedor(base: Base, c: CuentaClasificada, nif: string | null, porNif: Map<string, FichaProveedor[]>, e: EntradaPropuesta): FilaRevision {
  if (nif) {
    const mismos = porNif.get(nif) ?? []
    if (mismos.length === 1) return { ...base, decision: { tipo: 'enlazar', entity: 'supplier', entityId: mismos[0].id, nombreFicha: mismos[0].name, papel: 'principal' }, confianza: 'seguro', porque: `mismo NIF ${nif}` }
    if (mismos.length > 1) {
      return { ...base, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: `hay ${mismos.length} fichas con el NIF ${nif}`,
        opciones: mismos.map((p) => ({ id: p.id, texto: `Es ${p.name}`, decision: { tipo: 'enlazar', entity: 'supplier', entityId: p.id, nombreFicha: p.name, papel: 'principal' } })) }
    }
    // Con NIF y sin ficha con ese NIF: ¿una ficha sin NIF con el mismo nombre? Probable. Si no, se crea.
    const sinNif = e.proveedores.filter((p) => !p.nif && parecido(p.name, c.nombre) === 'igual')
    if (sinNif.length === 1) {
      return { ...base, decision: { tipo: 'enlazar', entity: 'supplier', entityId: sinNif[0].id, nombreFicha: sinNif[0].name, papel: 'principal' }, confianza: 'probable',
        porque: `mismo nombre; el NIF ${nif} viene del fichero y la ficha no lo tiene`,
        opciones: [{ id: 'crear', texto: 'Crear ficha nueva', decision: { tipo: 'crear_proveedor', nombre: c.nombre, nif } }] }
    }
    return { ...base, decision: { tipo: 'crear_proveedor', nombre: c.nombre, nif }, confianza: 'seguro', porque: `no tiene ficha aquí: se crea con su NIF ${nif}, por completar` }
  }
  // Sin NIF: por nombre.
  const iguales = e.proveedores.filter((p) => parecido(p.name, c.nombre) === 'igual')
  const parecidos = e.proveedores.filter((p) => parecido(p.name, c.nombre) === 'parecido')
  const candidato = iguales.length === 1 ? iguales[0] : iguales.length === 0 && parecidos.length === 1 ? parecidos[0] : null
  if (candidato) {
    return { ...base, decision: { tipo: 'enlazar', entity: 'supplier', entityId: candidato.id, nombreFicha: candidato.name, papel: 'principal' }, confianza: 'probable',
      porque: iguales.length ? 'sin NIF; mismo nombre' : `sin NIF; nombre parecido («${candidato.name}»)`, opciones: SALIDAS_SIN_NIF(c.nombre) }
  }
  const varios = [...iguales, ...parecidos]
  return { ...base, decision: { tipo: 'pendiente' }, confianza: 'decide',
    porque: varios.length > 1 ? `sin NIF; se parece a ${varios.length} fichas` : 'sin NIF y sin ficha que se le parezca',
    opciones: [...varios.map((p) => ({ id: p.id, texto: `Es ${p.name}`, decision: { tipo: 'enlazar' as const, entity: 'supplier' as const, entityId: p.id, nombreFicha: p.name, papel: 'principal' as const } })), ...SALIDAS_SIN_NIF(c.nombre)] }
}

function terceroCliente(base: Base, c: CuentaClasificada, nif: string | null, porNif: Map<string, FichaProveedor[]>, previas: readonly FilaRevision[]): FilaRevision {
  const soloCliente: Opcion = { id: 'cliente_c03', texto: 'Solo es cliente', decision: { tipo: 'sin_ficha', nota: 'cliente_c03' } }
  const sinFicha: Opcion = { id: 'sin_ficha', texto: 'Cuenta mía sin ficha', decision: { tipo: 'sin_ficha', nota: 'cuenta' } }
  // ¿Es también proveedor? 1) por NIF con una ficha; 2) por NIF o nombre con una fila de proveedor de este fichero.
  if (nif) {
    const mismos = porNif.get(nif) ?? []
    if (mismos.length === 1) return { ...base, decision: { tipo: 'enlazar', entity: 'supplier', entityId: mismos[0].id, nombreFicha: mismos[0].name, papel: 'pago' }, confianza: 'seguro', porque: `mismo NIF que la ficha de proveedor ${mismos[0].name}: se compensa con ella`, opciones: [soloCliente] }
  }
  const prov = previas.filter((f) => (f.clase === 'proveedor' || f.clase === 'acreedor') && f.decision.tipo !== 'pendiente' && f.decision.tipo !== 'sin_ficha'
    && ((nif && f.nif === nif)
      // Con NIF en los dos lados y distintos, no son el mismo aunque se llamen igual.
      || (!(nif && f.nif && f.nif !== nif) && (!!parecido(f.enOrigen, c.nombre) || (f.decision.tipo === 'enlazar' && !!parecido(f.decision.nombreFicha, c.nombre))))))
  if (prov.length === 1) {
    const p = prov[0]
    const porNifIgual = !!nif && p.nif === nif
    const como = porNifIgual ? `mismo NIF que el ${p.code}` : `${nif ? '' : 'sin NIF en el fichero; '}mismo nombre que el ${p.code}`
    const decision: Decision = p.decision.tipo === 'enlazar'
      ? { tipo: 'enlazar', entity: 'supplier', entityId: p.decision.entityId, nombreFicha: p.decision.nombreFicha, papel: 'pago' }
      : { tipo: 'enlazar_creada', codigoCreadora: p.code, papel: 'pago' }
    return { ...base, decision, confianza: porNifIgual ? 'seguro' : 'probable', porque: `también es proveedor: ${como}; se enlazan los dos`, opciones: [soloCliente, sinFicha] }
  }
  if (prov.length > 1) {
    return { ...base, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: `se parece a ${prov.length} proveedores de este fichero (${prov.map((x) => x.code).join(', ')})`,
      opciones: [...prov.map((p) => ({ id: p.code, texto: `Es el ${p.code}`, decision: p.decision.tipo === 'enlazar'
        ? { tipo: 'enlazar' as const, entity: 'supplier' as const, entityId: p.decision.entityId, nombreFicha: p.decision.nombreFicha, papel: 'pago' as const }
        : { tipo: 'enlazar_creada' as const, codigoCreadora: p.code, papel: 'pago' as const } })), soloCliente, sinFicha] }
  }
  // Con NIF es un tercero de verdad: cliente, hasta que el C03 traiga su ficha.
  // Sin NIF puede ser un cliente o una cuenta tuya («Glovo Ventas»): lo dice la persona.
  return nif
    ? { ...base, decision: { tipo: 'sin_ficha', nota: 'cliente_c03' }, confianza: 'seguro', porque: 'solo es cliente: entra con su número; su ficha llega con el C03', opciones: [sinFicha] }
    : { ...base, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: 'sin NIF y no es ninguno de tus proveedores: ¿es un cliente o una cuenta tuya?', opciones: [soloCliente, sinFicha] }
}

/** Clave del tercero y papel al que acaba enlazada una decisión (null si no enlaza a nadie). */
export function destino(f: FilaRevision): string | null {
  const d = f.decision
  if (d.tipo === 'enlazar') return `${d.entity}:${d.entityId}:${d.papel}`
  if (d.tipo === 'enlazar_creada') return `creada:${d.codigoCreadora}:${d.papel}`
  if (d.tipo === 'crear_proveedor') return `creada:${f.code}:principal`
  if (d.tipo === 'retencion' && d.modelo) return `modelo:${d.modelo}`
  return null
}

/**
 * Dos cuentas no pueden ser la misma ficha en el mismo papel (la base lo
 * prohíbe: un tercero, una subcuenta por papel). Cuando la propuesta las junta
 * (Glovo cliente y «Glovo Ventas», las dos como pago de Glovo), la segunda y
 * siguientes pasan a «decide tú» con el porqué; la primera se queda.
 */
export function marcarDobles(filas: FilaRevision[]): FilaRevision[] {
  const visto = new Map<string, string>()
  return filas.map((f) => {
    const k = destino(f)
    if (!k || f.confianza === 'decide') return f
    const primero = visto.get(k)
    if (!primero) { visto.set(k, f.code); return f }
    const opciones = f.opciones.length ? f.opciones : [{ id: 'sin_ficha', texto: 'Cuenta mía sin ficha', decision: { tipo: 'sin_ficha', nota: 'cuenta' } as Decision }]
    return { ...f, decision: { tipo: 'pendiente' }, confianza: 'decide', porque: `dos cuentas para lo mismo: ${primero} y ${f.code}. ¿Qué es esta?`, opciones }
  })
}

// ── La revisión: contar, decidir, validar ───────────────────────────────────

export interface Cifras { tal: number; revisar: number; cambian: number; nuevas: number; todas: number; pendientes: number }

/** Las cuatro cifras de arriba (maqueta N8): entran tal cual · para revisar · cambian · nuevas en Folvy. */
export function cifras(filas: readonly FilaRevision[]): Cifras {
  return {
    tal: filas.filter((f) => f.confianza === 'seguro' && !f.cambia && f.decision.tipo !== 'crear_proveedor').length,
    revisar: filas.filter((f) => f.confianza !== 'seguro').length,
    cambian: filas.filter((f) => f.cambia).length,
    nuevas: filas.filter((f) => f.decision.tipo === 'crear_proveedor').length,
    todas: filas.length,
    pendientes: filas.filter((f) => f.decision.tipo === 'pendiente').length,
  }
}

export type Filtro = 'revisar' | 'todas' | 'proveedores' | 'clientes' | 'bancos'

export function filtrar(filas: readonly FilaRevision[], filtro: Filtro, q: string): FilaRevision[] {
  const k = claveNombre(q)
  return filas.filter((f) => {
    if (filtro === 'revisar' && f.confianza === 'seguro') return false
    if (filtro === 'proveedores' && f.clase !== 'proveedor' && f.clase !== 'acreedor') return false
    if (filtro === 'clientes' && f.clase !== 'cliente') return false
    if (filtro === 'bancos' && f.clase !== 'banco') return false
    if (!q.trim()) return true
    const nombreFicha = f.decision.tipo === 'enlazar' ? f.decision.nombreFicha : ''
    return f.code.startsWith(q.trim()) || claveNombre(f.enOrigen).includes(k) || claveNombre(nombreFicha).includes(k)
  })
}

/** Lo que la persona decide en una fila (una de sus opciones, o una ficha del buscador de «Cambiar»). Lo decidido por ella es seguro. */
export function decidir(filas: readonly FilaRevision[], code: string, decision: Decision, porque?: string): FilaRevision[] {
  return filas.map((f) => (f.code === code ? { ...f, decision, confianza: decision.tipo === 'pendiente' ? 'decide' : 'seguro', porque: porque ?? 'lo has decidido tú' } : f))
}

export interface Problema { code: string; texto: string }

/**
 * ¿Se puede traer? No mientras quede algo por decidir, ni si dos cuentas
 * acaban en el mismo tercero y papel, ni si dos retenciones van al mismo
 * modelo, ni si una 430 se apoya en una fila que ya no crea ficha.
 */
export function validar(filas: readonly FilaRevision[]): Problema[] {
  const out: Problema[] = []
  const destinos = new Map<string, string>()
  const creadoras = new Set(filas.filter((f) => f.decision.tipo === 'crear_proveedor').map((f) => f.code))
  for (const f of filas) {
    if (f.decision.tipo === 'pendiente') { out.push({ code: f.code, texto: `${f.code}: falta decir qué es.` }); continue }
    if (f.decision.tipo === 'enlazar_creada' && !creadoras.has(f.decision.codigoCreadora)) {
      out.push({ code: f.code, texto: `${f.code} se enlazaba con la ficha que iba a crear el ${f.decision.codigoCreadora}, y ya no se crea.` })
    }
    const k = destino(f)
    if (!k) continue
    const otro = destinos.get(k)
    if (otro) {
      out.push({ code: f.code, texto: f.decision.tipo === 'retencion' ? `${otro} y ${f.code} van los dos al modelo ${f.decision.modelo}: elige uno.` : `${otro} y ${f.code} acaban en la misma ficha con el mismo papel: elige una.` })
    } else destinos.set(k, f.code)
  }
  return out
}

/** Nombre que enseña Folvy para una cuenta traída (el código siempre es el del fichero). */
export function nombreEnFolvy(f: FilaRevision, nombreLeido: string): string {
  const d = f.decision
  const titulo = f.clase === 'acreedor' ? 'Acreedores' : f.clase === 'cliente' ? 'Clientes' : 'Proveedores'
  if (d.tipo === 'enlazar') return d.entity === 'bank_account' ? `Bancos · ${d.nombreFicha}` : `${titulo} · ${d.nombreFicha}`
  if (d.tipo === 'crear_proveedor') return `${titulo} · ${d.nombre}`
  return nombreLeido
}

/**
 * Lo que se manda a la base para traer el plan (company_chart_import_apply):
 * las cuentas propias con su código, su hoja y sus dos nombres; las fichas que
 * se crean; los enlaces; los modelos de las retenciones. Las de serie no van:
 * las crea la activación, y su nombre del fichero va aparte (nombresSerie).
 */
export interface PlanTraer {
  cuentas: { code: string; hoja: string; nombre: string; nombre_origen: string; nota: 'cuenta' | 'cliente_c03' | null }[]
  crear: { code: string; nombre: string; nif: string | null; direccion: string | null; cp: string | null; poblacion: string | null; provincia: string | null }[]
  enlaces: { code: string; entity: 'supplier' | 'bank_account'; entity_id: string | null; crea_code: string | null; role: 'principal' | 'pago' }[]
  retenciones: { code: string; modelo: Modelo }[]
  nombres_serie: { code: string; nombre_origen: string }[]
}

export function planTraer(filas: readonly FilaRevision[], cuentas: readonly CuentaClasificada[], terceros: readonly TerceroLeido[]): PlanTraer {
  const porCodigo = new Map(filas.map((f) => [f.code, f]))
  const tercero = new Map(terceros.map((t) => [t.code, t]))
  const out: PlanTraer = { cuentas: [], crear: [], enlaces: [], retenciones: [], nombres_serie: [] }
  for (const c of cuentas) {
    if (c.clase === 'serie') { out.nombres_serie.push({ code: c.code, nombre_origen: c.nombreOrigen || c.nombre }); continue }
    const f = porCodigo.get(c.code)
    if (!f) continue
    const d = f.decision
    out.cuentas.push({ code: c.code, hoja: c.hoja, nombre: nombreEnFolvy(f, c.nombre), nombre_origen: c.nombreOrigen || c.nombre, nota: d.tipo === 'sin_ficha' ? d.nota : null })
    if (d.tipo === 'enlazar') out.enlaces.push({ code: c.code, entity: d.entity, entity_id: d.entityId, crea_code: null, role: d.papel })
    if (d.tipo === 'enlazar_creada') out.enlaces.push({ code: c.code, entity: 'supplier', entity_id: null, crea_code: d.codigoCreadora, role: d.papel })
    if (d.tipo === 'crear_proveedor') {
      const t = tercero.get(c.code)
      out.crear.push({ code: c.code, nombre: d.nombre, nif: d.nif, direccion: t?.direccion ?? null, cp: t?.cp ?? null, poblacion: t?.poblacion ?? null, provincia: t?.provincia ?? null })
      out.enlaces.push({ code: c.code, entity: 'supplier', entity_id: null, crea_code: c.code, role: 'principal' })
    }
    if (d.tipo === 'retencion' && d.modelo) out.retenciones.push({ code: c.code, modelo: d.modelo })
  }
  return out
}

/** Cuántas cuentas traídas quedan enlazadas (a una ficha, a un banco o a un modelo de retenciones). La base cuenta lo mismo. */
export const cuentasEnlazadas = (p: PlanTraer): number => new Set([...p.enlaces.map((l) => l.code), ...p.retenciones.map((r) => r.code)]).size

/** «96 cuentas tuyas con su número de Diez · 79 enlazadas · 6 nuevas · el IVA pasa a ir por tipo». */
export function resumenTraer(p: PlanTraer, programa: string, ivaCambia: boolean): string {
  // Enlazada = la cuenta traída va a algo de Folvy: una ficha, un banco o un modelo de retenciones.
  const enlazadas = cuentasEnlazadas(p)
  return [
    `${p.cuentas.length} cuentas tuyas con su número de ${programa}`,
    `${enlazadas} enlazadas`,
    p.crear.length ? `${p.crear.length} ${p.crear.length === 1 ? 'ficha nueva' : 'fichas nuevas'}` : null,
    ivaCambia ? 'el IVA pasa a ir por tipo' : null,
  ].filter(Boolean).join(' · ')
}
