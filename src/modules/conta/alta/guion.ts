// src/modules/conta/alta/guion.ts
//
// El alta conversada (encargo C00 §6.4; maquetas N1Alta y M1Alta), en puro:
// qué se pregunta en cada paso, cuál es la respuesta normal (marcada) con su
// porqué, y el «No lo sé» de cada pregunta, que deja la normal y la apunta
// como duda para el asesor.
//
// Respuesta 1 de Julio:
//   D2  lo que ya tiene la cuenta (razón social, CIF, dirección) se PROPONE,
//       marcado como importado y con su origen; la persona lo confirma.
//   D3  no hay fuente gratuita de la razón social por NIF: se pregunta «¿Cómo
//       se llama la empresa?», proponiendo lo de la cuenta si lo hay.
//   D4  sin asesor en el alta.
//
// Cinco pasos, como el «3 de 5» de la maqueta: quién eres, a qué te dedicas,
// tus impuestos, tus cuentas y tu banco. Se guarda cada respuesta; el paso va
// en company.setup_step y se sigue desde otro dispositivo.

import type { DatosDeLaCuenta } from '@/modules/conta/cuenta/contratoCuenta'
import { proponerAlta } from '@/modules/conta/lib/propuestaAlta'
import { modelosQuePresenta, type ClaseActividad, type Territorio, type TipoEmpresa } from '@/modules/conta/lib/modelos'
import { provinciaPorCp } from '@/modules/conta/lib/direccion'

export type PasoAlta = 'nif' | 'nombre' | 'actividad' | 'impuestos' | 'cuentas' | 'banco' | 'hecho'
export type ClavePregunta = 'nif' | 'nombre' | 'direccion' | 'actividad' | 'periodo' | 'retiene' | 'alquiler' | 'retenido70' | 'cuentas' | 'banco'

export interface OpcionAlta { valor: string; texto: string }

export interface Pregunta {
  clave: ClavePregunta
  /** La pregunta, en palabras de la calle. */
  texto: string
  /** Por qué la respuesta normal es esa (regla 2 de la IA). */
  porque: string | null
  /** Las respuestas de un toque; la primera es la normal (va marcada). */
  opciones: OpcionAlta[]
  /** Si además se puede escribir: qué. */
  entrada: 'nif' | 'texto' | 'direccion' | 'actividad' | 'iban' | null
  /** El valor normal: lo que se deja con «No lo sé». */
  normal: string
  /** El texto del «No lo sé» de esta pregunta. */
  noLoSe: string
}

/** Lo que se sabe al hacer una pregunta. */
export interface ContextoAlta {
  cuenta: DatosDeLaCuenta
  tipo: TipoEmpresa | null
  /** Código postal de la dirección fiscal, si ya se sabe. */
  cp: string | null
  clases: ClaseActividad[]
  respuestas: Partial<Record<ClavePregunta, string>>
  hoy: string
}

export const PASOS: PasoAlta[] = ['nif', 'nombre', 'actividad', 'impuestos', 'cuentas', 'banco', 'hecho']
/** El número que sale en «N de 5». */
export const NUMERO_PASO: Record<PasoAlta, number> = { nif: 1, nombre: 1, actividad: 2, impuestos: 3, cuentas: 4, banco: 5, hecho: 5 }
export const TOTAL_PASOS = 5

export function pasoSiguiente(p: PasoAlta): PasoAlta {
  return PASOS[Math.min(PASOS.indexOf(p) + 1, PASOS.length - 1)]
}

// ── Territorio ──────────────────────────────────────────────────────────────

/** Dónde está la empresa a efectos de impuestos, por su código postal. */
export function territorioPorCp(cp: string | null): { territorio: Territorio; porque: string } {
  const provincia = cp ? provinciaPorCp(cp) : null
  if (cp && (cp.startsWith('35') || cp.startsWith('38'))) {
    return { territorio: 'canarias', porque: `Tu código postal (${cp}) es de ${provincia}, en Canarias: allí no hay IVA, sino IGIC (Ley 37/1992, art. 3).` }
  }
  if (cp && (cp.startsWith('51') || cp.startsWith('52'))) {
    return { territorio: 'ceuta_melilla', porque: `Tu código postal (${cp}) es de ${provincia}: allí no hay IVA, sino IPSI (Ley 37/1992, art. 3).` }
  }
  return {
    territorio: 'peninsula_baleares',
    porque: provincia ? `Tu código postal (${cp}) es de ${provincia}: llevas IVA.` : 'Sin código postal todavía: lo normal es la península o Baleares, con IVA.',
  }
}

// ── Las preguntas ───────────────────────────────────────────────────────────

const dirDeCuenta = (c: DatosDeLaCuenta): string | null => {
  const d = c.direccion
  if (!d) return null
  const t = [d.calle, [d.codigoPostal, d.poblacion].filter(Boolean).join(' ')].filter((x) => x && x.trim() !== '').join(', ')
  return t || null
}

function preguntasDe(paso: PasoAlta, ctx: ContextoAlta): Pregunta[] {
  const c = ctx.cuenta
  switch (paso) {
    case 'nif':
      return [{
        clave: 'nif',
        texto: c.nif ? `En tu cuenta de Folvy pone el NIF ${c.nif}. ¿Es el de la empresa?` : '¿Cuál es el NIF de la empresa?',
        porque: c.nif ? 'Es el que tiene tu cuenta de Folvy.' : null,
        opciones: c.nif ? [{ valor: 'cuenta', texto: `Sí, ${c.nif}` }] : [],
        entrada: 'nif', normal: c.nif ? 'cuenta' : '', noLoSe: 'No lo sé ahora',
      }]
    case 'nombre': {
      const nombre = c.razonSocial ?? c.nombre
      const dir = dirDeCuenta(c)
      return [
        {
          clave: 'nombre', texto: '¿Cómo se llama la empresa? El nombre que sale en el NIF.',
          porque: nombre ? `Es el que tiene tu cuenta de Folvy${c.razonSocial ? ' como razón social' : ''}.` : null,
          opciones: nombre ? [{ valor: 'cuenta', texto: `Sí, «${nombre}»` }] : [],
          entrada: 'texto', normal: nombre ? 'cuenta' : '', noLoSe: 'No lo sé ahora',
        },
        {
          clave: 'direccion', texto: dir ? `¿La dirección fiscal es ${dir}?` : '¿Cuál es la dirección fiscal?',
          porque: dir ? 'Es la de facturación de tu cuenta de Folvy.' : null,
          opciones: dir ? [{ valor: 'cuenta', texto: 'Sí, esa' }] : [],
          entrada: 'direccion', normal: dir ? 'cuenta' : '', noLoSe: 'La pongo luego',
        },
      ]
    }
    case 'actividad':
      return [{
        clave: 'actividad', texto: '¿A qué os dedicáis? Dímelo con tus palabras: «Restaurante, y también repartimos a domicilio».',
        porque: null, opciones: [], entrada: 'actividad', normal: '', noLoSe: 'No lo sé, que lo mire mi asesor',
      }]
    case 'impuestos': {
      const { territorio } = territorioPorCp(ctx.cp)
      const tipo = ctx.tipo ?? 'company'
      const prop = proponerAlta({
        tipo, territorio, actividades: ctx.clases, retiene: null, alquilaConRetencion: null,
        volumenAnoAnterior: null, inicioActividad: null, hoy: ctx.hoy,
      })
      const out: Pregunta[] = []
      if (territorio === 'peninsula_baleares') {
        out.push({
          clave: 'periodo', texto: '¿Presentas el IVA cada tres meses? Es lo normal en tu caso.', porque: prop.periodoIva.porque,
          opciones: [{ valor: 'quarterly', texto: 'Sí, cada tres meses' }, { valor: 'monthly', texto: 'Cada mes' }],
          entrada: null, normal: 'quarterly', noLoSe: 'No lo sé, pregúntaselo a mi asesor',
        })
      }
      out.push({
        clave: 'retiene', texto: '¿Pagas nóminas o facturas de profesionales (asesor, abogado…) con retención?',
        porque: 'Casi todos los negocios con empleados o con gestoría retienen IRPF; eso se declara cada trimestre en el 111.',
        opciones: [{ valor: 'si', texto: 'Sí' }, { valor: 'no', texto: 'No' }],
        entrada: null, normal: 'si', noLoSe: 'No lo sé',
      })
      out.push({
        clave: 'alquiler', texto: '¿Pagas el alquiler de un local con retención?',
        porque: 'Si el local es alquilado a una empresa o a un particular que te factura con retención, esa retención va al 115.',
        opciones: [{ valor: 'si', texto: 'Sí' }, { valor: 'no', texto: 'No' }],
        entrada: null, normal: 'si', noLoSe: 'No lo sé',
      })
      if (tipo === 'self_employed' && ctx.clases.length > 0 && ctx.clases.every((x) => x === 'professional')) {
        out.push({
          clave: 'retenido70', texto: 'El año pasado, ¿al menos el 70 % de tus ingresos llevó retención?',
          porque: 'Si es así, no adelantas el IRPF cada trimestre (RD 439/2007, art. 109.2).',
          opciones: [{ valor: 'no', texto: 'No' }, { valor: 'si', texto: 'Sí' }],
          entrada: null, normal: 'no', noLoSe: 'No lo sé',
        })
      }
      return out
    }
    case 'cuentas': {
      const prop = proponerAlta({
        tipo: ctx.tipo ?? 'company', territorio: territorioPorCp(ctx.cp).territorio, actividades: ctx.clases, retiene: null,
        alquilaConRetencion: null, volumenAnoAnterior: null, inicioActividad: null, hoy: ctx.hoy,
      })
      const e = prop.ejercicio.valor
      return [{
        clave: 'cuentas',
        texto: `Te dejo el plan de pymes, con cuentas de 8 dígitos, y el ejercicio ${e.code} del ${fecha(e.startsOn)} al ${fecha(e.endsOn)}. ¿Lo dejo así?`,
        porque: `${prop.plan.porque} ${prop.ejercicio.porque}`,
        opciones: [{ valor: 'si', texto: 'Sí, déjalo así' }], entrada: null, normal: 'si', noLoSe: 'No lo sé, que lo mire mi asesor',
      }]
    }
    case 'banco':
      return [{
        clave: 'banco', texto: 'Por último: ¿cuál es el IBAN de la cuenta del banco de la empresa?',
        porque: null, opciones: [], entrada: 'iban', normal: '', noLoSe: 'Lo pongo luego',
      }]
    case 'hecho':
      return []
  }
}

const fecha = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

/** La pregunta que toca: la primera del paso que aún no tiene respuesta. */
export function preguntaActual(paso: PasoAlta, ctx: ContextoAlta): Pregunta | null {
  return preguntasDe(paso, ctx).find((p) => ctx.respuestas[p.clave] === undefined) ?? null
}

export function todasLasPreguntas(paso: PasoAlta, ctx: ContextoAlta): Pregunta[] {
  return preguntasDe(paso, ctx)
}

// ── Lo que se deduce de las respuestas de «Tus impuestos» ───────────────────

/** Las respuestas de un sí o un no; «No lo sé» deja la normal. */
const siNo = (v: string | undefined, normal: boolean): boolean => (v === 'si' ? true : v === 'no' ? false : normal)

/**
 * Los modelos que presenta, con su porqué, a partir de las respuestas. Usa la
 * regla del núcleo (modelosQuePresenta): lo que no se puede fundamentar no se
 * deduce.
 */
export function modelosDeRespuestas(ctx: ContextoAlta): { modelos: string[]; porque: string } {
  const { territorio } = territorioPorCp(ctx.cp)
  const r = ctx.respuestas
  const res = modelosQuePresenta({
    tipo: ctx.tipo ?? 'company', territorio, actividades: ctx.clases,
    retiene: siNo(r.retiene, true), alquilaConRetencion: siNo(r.alquiler, true),
    porcentajeIngresosRetenidos: r.retenido70 === undefined ? null : siNo(r.retenido70, false) ? 70 : 0,
  })
  const modelos = res.modelos.map((m) => m.codigo).sort()
  const porque = res.modelos.length
    ? res.modelos.map((m) => `${m.codigo}: ${m.porque}`).join(' ')
    : 'Con lo que me has dicho, no presentas ningún modelo de los que conozco.'
  return { modelos, porque }
}

/** Lo que se le dice a la persona cuando contesta «No lo sé»: queda como duda. */
export function textoDuda(p: Pregunta): string {
  const normal = p.opciones.find((o) => o.valor === p.normal)?.texto
  return normal
    ? `Lo dejo en «${normal}», que es lo normal, y se lo apunto a tu asesor como duda.`
    : 'Lo dejo sin poner y se lo apunto a tu asesor como duda.'
}
