// src/modules/conta/lib/propuestasPlan.ts
//
// C02, tarea 5 · Lo que la IA propone sobre el plan contable (encargo §4 y
// respuesta 2). Puro y probado (tests/unit/modules/conta/propuestasPlanC02.test.ts).
//
// Cada propuesta lleva su porqué, su CONFIANZA y dos respuestas, y nunca se
// hace sola (la contesta una persona: company_plan_propuesta_responder, 0180):
//   · alta  — sale de un enlace o del PGC literal (un tercero sin subcuenta,
//             la pista de la tabla, la 472/477 de un tipo de IVA, sin uso);
//   · media — sale del TÍTULO (todas las palabras del tipo de gasto están en
//             el nombre de la cuenta) o de una práctica (separar el IVA de la
//             UE y del ISP para el 303);
//   · baja  — sale del PARECIDO (alguna palabra): no sale como tarjeta, se
//             queda en la bandeja de revisión.
//
// Casos:
//   1. proveedores sin subcuenta → «¿Les creo la suya en el 400/410?» (o la común);
//   2. bancos sin subcuenta → «¿Le creo la suya en el 572?»;
//   3. tipo de gasto sin cuenta → la de su pista; si no, la del PGC por el título;
//   4. tipo de IVA nuevo sin 472/477 → las suyas;
//   5. cuenta propia sin apuntes en 12 meses → ocultarla (los apuntes llegan
//      con el C04: hasta entonces no sale ninguna; sin apuntes NO es «sin uso»);
//   6. proveedor en 400 que vende servicios, o en 410 que vende mercancía → moverlo;
//   7. un proveedor de la UE o con inversión del sujeto pasivo → las 472/477 de ese IVA.
// Lo contestado (sí o no) no vuelve por el mismo motivo: la clave lo identifica.

import { hojaDeProveedor, subcuenta, sufijoDeTipo, textoTipo, rellenar, type HojaProveedor, type Papel, type Entidad } from '@/modules/conta/lib/planEmpresa'
import type { CuentaPlan, CuentaSeriePlan, EnlacePlan } from '@/modules/conta/lib/planVista'
import { tipoDeOperacion } from '@/modules/conta/lib/cuentasProveedor'

export type Confianza = 'alta' | 'media' | 'baja'
export type OpPlan =
  | { op: 'crear'; hoja: string; nombre: string; plain?: string; code?: string; entity?: Entidad; entity_id?: string }
  | { op: 'enlazar'; entity: Entidad; entity_id: string; role: Papel; code: string }
  | { op: 'ocultar'; code: string }

export type TipoPropuesta = 'proveedores' | 'bancos' | 'gasto' | 'iva' | 'sin_uso' | 'hoja_proveedor' | 'iva_ue' | 'iva_isp'
export interface Propuesta {
  clave: string
  tipo: TipoPropuesta
  titulo: string
  porque: string
  confianza: Confianza
  si: string
  no: string
  ops: OpPlan[]
  /** Una segunda forma de decir que sí («Prefiero una cuenta común»). */
  alternativa: { texto: string; ops: OpPlan[] } | null
}

export interface ProveedorPropuesta {
  id: string; name: string; gastoPista: string | null; marca: HojaProveedor | null; vatRegime: string | null; countryCode: string
}
export interface EntradaPropuestas {
  digitos: number
  serie: readonly CuentaSeriePlan[]
  cuentas: readonly CuentaPlan[]
  enlaces: readonly EnlacePlan[]
  proveedores: readonly ProveedorPropuesta[]
  bancos: readonly { id: string; name: string }[]
  gastos: readonly { id: string; name: string; pgcHint: string | null }[]
  /** Los tipos de IVA (o IGIC) vigentes del territorio de la empresa. */
  tiposIva: readonly { id: string; name: string; rate: number }[]
  /** Último apunte de cada cuenta (id → 'YYYY-MM-DD'). Vacío hasta el C04. */
  ultimoApunte: ReadonlyMap<string, string>
  hoy: string
  /** Claves ya contestadas (sí o no). */
  contestadas: ReadonlySet<string>
}

/** Las dos citas de las propuestas del IVA de la UE y del ISP (literales de la Ley 37/1992; la prueba las busca en el texto). */
export const CITAS_IVA = {
  ue: { norma: 'Ley 37/1992, art. 85', fuente: 'ley-37-1992', literal: 'En las adquisiciones intracomunitarias de bienes los sujetos pasivos del impuesto serán quienes las realicen' },
  isp: { norma: 'Ley 37/1992, art. 84.Uno.2.º', fuente: 'ley-37-1992', literal: 'Los empresarios o profesionales para quienes se realicen las operaciones sujetas al Impuesto en los supuestos que se indican a continuación' },
} as const

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'o', 'u', 'en', 'a', 'por', 'para', 'con', 'sin', 'otros', 'otras', 'demas'])
const palabras = (s: string) => sinAcentos(s).split(/[^a-z0-9ñ]+/).filter((p) => p.length > 2 && !PALABRAS_VACIAS.has(p))
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
/** 'YYYY-MM-DD' de hace n meses. */
function haceMeses(hoy: string, n: number): string {
  const [y, m, d] = hoy.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 - n, d))
  return t.toISOString().slice(0, 10)
}

export function propuestasDelPlan(e: EntradaPropuestas): Propuesta[] {
  const d = e.digitos
  const out: Propuesta[] = []
  const ocupados = new Set(e.cuentas.map((c) => c.code))
  const porId = new Map(e.cuentas.map((c) => [c.id, c]))
  const hojas = new Map(e.serie.filter((s) => s.isLeaf).map((s) => [s.code, s]))
  const enlace = (entity: Entidad, id: string, role: Papel) => e.enlaces.find((l) => l.entity === entity && l.entityId === id && l.role === role)
  const plantilla = (hoja: string) => e.cuentas.find((c) => c.templateCode === hoja && c.kind === 'template') ?? null
  const reservar = (prefijo: string, desde = 1): string | null => {
    for (let n = desde; ; n++) {
      const c = subcuenta(prefijo, d, n)
      if (!c) return null
      if (!ocupados.has(c)) { ocupados.add(c); return c }
    }
  }
  const nueva = (p: Propuesta) => { if (!e.contestadas.has(p.clave)) out.push(p) }

  // 1. Proveedores sin subcuenta, por hoja (400 mercancía, 410 servicios).
  const sinCuenta = e.proveedores.filter((p) => !enlace('supplier', p.id, 'principal'))
  for (const hoja of ['4000', '4100'] as const) {
    const suyos = sinCuenta.filter((p) => hojaDeProveedor(p.gastoPista, p.marca).hoja === hoja).sort((a, b) => a.name.localeCompare(b.name, 'es'))
    if (!suyos.length || !hojas.has(hoja)) continue
    const ops: OpPlan[] = []
    const pares: string[] = []
    const titulo = hoja === '4000' ? 'Proveedores' : 'Acreedores'
    for (const p of suyos) {
      const code = reservar(hoja)
      if (!code) break
      ops.push({ op: 'crear', hoja, nombre: `${titulo} · ${p.name}`, entity: 'supplier', entity_id: p.id })
      pares.push(`${p.name} → ${code}`)
    }
    if (!ops.length) continue
    const n = ops.length
    const comun = plantilla(hoja)
    nueva({
      clave: `proveedores:${hoja}:${suyos.slice(0, n).map((p) => p.id).sort().join(',')}`,
      tipo: 'proveedores', confianza: 'alta',
      titulo: `${n === 1 ? 'Tienes 1 proveedor nuevo que no tiene' : `Tienes ${n} proveedores nuevos que no tienen`} subcuenta. ¿${n === 1 ? 'Le' : 'Les'} creo la suya en el ${hoja.slice(0, 3)}?`,
      porque: `${lista(pares)}. Así cada uno tiene su extracto. ${hoja === '4000' ? 'Van al 400 porque te venden mercancía' : 'Van al 410 porque te prestan servicios'}, por su tipo de gasto.`,
      si: n === 1 ? 'Sí, créala' : 'Sí, créalas', no: 'Ahora no', ops,
      alternativa: comun?.isCommon && comun.status === 'activa'
        ? { texto: 'Prefiero una cuenta común', ops: suyos.slice(0, n).map((p) => ({ op: 'enlazar', entity: 'supplier', entity_id: p.id, role: 'principal', code: comun.code })) }
        : null,
    })
  }

  // 2. Bancos sin subcuenta.
  const bancos = e.bancos.filter((b) => !enlace('bank_account', b.id, 'principal'))
  if (bancos.length && hojas.has('572')) {
    const ops: OpPlan[] = []
    const pares: string[] = []
    for (const b of bancos) { const code = reservar('572'); if (!code) break; ops.push({ op: 'crear', hoja: '572', nombre: `Bancos · ${b.name}`, entity: 'bank_account', entity_id: b.id }); pares.push(`${b.name} → ${code}`) }
    if (ops.length) {
      nueva({
        clave: `bancos:${bancos.slice(0, ops.length).map((b) => b.id).sort().join(',')}`, tipo: 'bancos', confianza: 'alta',
        titulo: ops.length === 1 ? 'Tienes un banco sin subcuenta. ¿Le creo la suya en el 572?' : `Tienes ${ops.length} bancos sin subcuenta. ¿Les creo la suya en el 572?`,
        porque: `${lista(pares)}. Así cada banco tiene su extracto y se puede conciliar.`,
        si: ops.length === 1 ? 'Sí, créala' : 'Sí, créalas', no: 'Ahora no', ops, alternativa: null,
      })
    }
  }

  // 3. Tipos de gasto sin cuenta: la de su pista (alta); si no, por el título (media) o el parecido (baja).
  const gastos6 = e.serie.filter((s) => s.isLeaf && s.code.startsWith('6'))
  for (const g of e.gastos) {
    if (enlace('expense_category', g.id, 'principal')) continue
    let hoja: string
    let confianza: Confianza = 'alta'
    let porque: string
    if (g.pgcHint && hojas.has(g.pgcHint)) {
      hoja = g.pgcHint
      porque = `Su tabla dice que va a la ${g.pgcHint} (${hojas.get(g.pgcHint)!.name}).`
    } else {
      const suyas = palabras(g.name)
      let mejor: { s: CuentaSeriePlan; aciertos: number } | null = null
      for (const s of gastos6) {
        const texto = new Set(palabras(`${s.name} ${s.plainName ?? ''}`))
        const aciertos = suyas.filter((p) => texto.has(p)).length
        if (aciertos > 0 && (!mejor || aciertos > mejor.aciertos || (aciertos === mejor.aciertos && s.code < mejor.s.code))) mejor = { s, aciertos }
      }
      if (!mejor) continue
      hoja = mejor.s.code
      confianza = mejor.aciertos === suyas.length ? 'media' : 'baja'
      // Se dice DÓNDE coincidió: el título es del BOE; «qué se apunta aquí» es nuestro.
      const enTitulo = new Set(palabras(mejor.s.name))
      const donde = suyas.every((p) => enTitulo.has(p))
        ? `el título de la ${hoja} (${mejor.s.name})`
        : `lo que se apunta en la ${hoja} (${mejor.s.name}: «${mejor.s.plainName ?? ''}»)`
      porque = confianza === 'media'
        ? `Por el nombre: «${g.name}» está entero en ${donde}.`
        : `Por parecido: «${g.name}» se parece a ${donde}. Revísalo antes de aceptarlo.`
    }
    const destino = plantilla(hoja)
    if (!destino || destino.status !== 'activa') continue
    nueva({
      clave: `gasto:${g.id}:${hoja}`, tipo: 'gasto', confianza,
      titulo: `«${g.name}» no tiene cuenta. ¿La apunto en la ${destino.code}?`, porque,
      si: 'Sí, ahí', no: 'No, la elijo yo', ops: [{ op: 'enlazar', entity: 'expense_category', entity_id: g.id, role: 'principal', code: destino.code }], alternativa: null,
    })
  }

  // 4. Tipos de IVA sin su 472/477 (un tipo nuevo por cambio de ley).
  for (const t of e.tiposIva) {
    const ops: OpPlan[] = []
    const codigos: string[] = []
    for (const [hoja, papel, nombre] of [['472', 'soportado', 'IVA soportado'], ['477', 'repercutido', 'IVA repercutido']] as const) {
      if (enlace('tax_rate', t.id, papel) || !hojas.has(hoja)) continue
      const suf = sufijoDeTipo(t.rate)
      if (suf === 0) { const h = rellenar(hoja, d); ops.push({ op: 'enlazar', entity: 'tax_rate', entity_id: t.id, role: papel, code: h }); codigos.push(h); continue }
      const propia = subcuenta(hoja, d, suf)
      const code = propia && !ocupados.has(propia) ? (ocupados.add(propia), propia) : reservar(hoja)
      if (!code) continue
      ops.push({ op: 'crear', hoja, code, nombre: `${nombre} ${textoTipo(t.rate)}` }, { op: 'enlazar', entity: 'tax_rate', entity_id: t.id, role: papel, code })
      codigos.push(code)
    }
    if (!ops.length) continue
    nueva({
      clave: `iva:${t.id}`, tipo: 'iva', confianza: 'alta',
      titulo: `El ${t.name} (${textoTipo(t.rate)}) no tiene sus cuentas. ¿Las creo?`,
      porque: `${lista(codigos)}: el IVA que pagas va a la 472 (${hojas.get('472')?.name ?? 'IVA soportado'}) y el que cobras a la 477 (${hojas.get('477')?.name ?? 'IVA repercutido'}), una subcuenta por tipo.`,
      si: 'Sí, créalas', no: 'Ahora no', ops, alternativa: null,
    })
  }

  // 5. Cuentas propias sin apuntes en 12 meses (solo con apuntes: llegan con el C04).
  const limite = haceMeses(e.hoy, 12)
  const enlazadas = new Set(e.enlaces.map((l) => l.companyAccountId))
  for (const [id, ultimo] of e.ultimoApunte) {
    const c = porId.get(id)
    if (!c || c.kind !== 'own' || c.status !== 'activa' || enlazadas.has(c.id) || ultimo >= limite) continue
    nueva({
      clave: `sin_uso:${c.code}:${ultimo}`, tipo: 'sin_uso', confianza: 'alta',
      titulo: `La ${c.code} · ${c.name} no se usa desde el ${ultimo.split('-').reverse().join('/')}. ¿La oculto?`,
      porque: 'Más de 12 meses sin un apunte y sin nada enlazado. Oculta no sale al elegir, pero sigue en los libros y se puede volver a enseñar.',
      si: 'Sí, ocúltala', no: 'No, la sigo usando', ops: [{ op: 'ocultar', code: c.code }], alternativa: null,
    })
  }

  // 6. Proveedor en la hoja que no le toca (su tipo de gasto cambió).
  for (const p of e.proveedores) {
    const l = enlace('supplier', p.id, 'principal')
    const actual = l ? porId.get(l.companyAccountId) : undefined
    if (!actual || actual.isCommon || (actual.templateCode !== '4000' && actual.templateCode !== '4100')) continue
    if (!p.gastoPista && !p.marca) continue
    const debe = hojaDeProveedor(p.gastoPista, p.marca)
    if (debe.hoja === actual.templateCode || !hojas.has(debe.hoja)) continue
    const code = reservar(debe.hoja)
    if (!code) continue
    nueva({
      clave: `hoja:${p.id}:${debe.hoja}`, tipo: 'hoja_proveedor', confianza: 'alta',
      titulo: `${p.name} está en la ${actual.code} y le toca la ${debe.hoja.slice(0, 3)}. ¿Lo cambio a la ${code}?`,
      porque: `${debe.porque} Su ${actual.code} se queda oculta (sin nada enlazado); se puede volver a enseñar.`,
      si: 'Sí, cámbialo', no: 'Lo dejo donde está',
      ops: [{ op: 'crear', hoja: debe.hoja, nombre: `${debe.hoja === '4000' ? 'Proveedores' : 'Acreedores'} · ${p.name}`, entity: 'supplier', entity_id: p.id }, { op: 'ocultar', code: actual.code }],
      alternativa: null,
    })
  }

  // 7. IVA de la UE y del ISP: lo declaras tú; mejor en sus propias 472/477 para el 303.
  for (const [tipo, quienes, nombre, cita] of [
    ['iva_ue', e.proveedores.filter((p) => tipoDeOperacion(p) === 'ue'), 'compras en la UE', CITAS_IVA.ue],
    ['iva_isp', e.proveedores.filter((p) => p.vatRegime === 'inversion_sujeto_pasivo'), 'inversión del sujeto pasivo', CITAS_IVA.isp],
  ] as const) {
    if (!quienes.length || !hojas.has('472') || !hojas.has('477')) continue
    const yaEstan = e.cuentas.some((c) => c.kind === 'own' && sinAcentos(c.name).includes(sinAcentos(nombre)))
    if (yaEstan) continue
    const s = reservar('472', 101)
    const r = reservar('477', 101)
    if (!s || !r) continue
    nueva({
      clave: tipo, tipo, confianza: 'media',
      titulo: `${quienes[0].name}${quienes.length > 1 ? ` y ${quienes.length - 1} más` : ''}: ${tipo === 'iva_ue' ? 'compras en la UE' : 'inversión del sujeto pasivo'}. ¿Creo sus cuentas de IVA?`,
      porque: `Ese IVA lo declaras tú, a la vez como pagado y como cobrado (${cita.norma}). Con su ${s} y su ${r} propias, el 303 sale separado de tus compras en España.`,
      si: 'Sí, créalas', no: 'Ahora no',
      ops: [{ op: 'crear', hoja: '472', code: s, nombre: `IVA soportado · ${nombre}` }, { op: 'crear', hoja: '477', code: r, nombre: `IVA repercutido · ${nombre}` }],
      alternativa: null,
    })
  }

  // El orden de la bandeja: primero lo seguro.
  const peso: Record<Confianza, number> = { alta: 0, media: 1, baja: 2 }
  return out.sort((a, b) => peso[a.confianza] - peso[b.confianza])
}

/** Las que salen como tarjeta (alta y media) y las que se quedan en la bandeja de revisión (baja). */
export function repartirPropuestas(ps: readonly Propuesta[]): { tarjetas: Propuesta[]; revisar: Propuesta[] } {
  return { tarjetas: ps.filter((p) => p.confianza !== 'baja'), revisar: ps.filter((p) => p.confianza === 'baja') }
}
