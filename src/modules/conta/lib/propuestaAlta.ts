// src/modules/conta/lib/propuestaAlta.ts
//
// Regla 2 del núcleo del C00 (§5): la propuesta por defecto del alta. A partir
// de sociedad o autónomo, territorio y actividad, propone régimen de IVA,
// periodicidad, modelos, plan contable, dígitos y ejercicio. Tabla de reglas
// explícita: CADA propuesta lleva su porqué en una frase y, si la hay, la
// norma (src/modules/conta/lib/normas.ts). Si algo no se puede decidir con
// lo que se sabe, la propuesta lleva `duda`: se deja la opción normal y queda
// apuntado para el asesor (encargo §6.4, «No lo sé»).

import type { ClaveNorma } from '@/modules/conta/lib/normas'
import { modelosQuePresenta, type PerfilParaModelos, type ModeloDeducido, type Territorio, type TipoEmpresa } from '@/modules/conta/lib/modelos'

export interface Propuesta<T> {
  valor: T
  porque: string
  norma: ClaveNorma | null
  /** Si no se puede decidir con seguridad: la pregunta que queda para el asesor. */
  duda: string | null
}

export interface EntradaAlta extends PerfilParaModelos {
  /** Volumen de operaciones del año anterior (IVA). null = no se sabe o no hubo. */
  volumenAnoAnterior: number | null
  /** Fecha en que empezó (o empieza) la actividad. AAAA-MM-DD. */
  inicioActividad: string | null
  /** Hoy, AAAA-MM-DD (la regla es pura: la fecha entra de fuera). */
  hoy: string
}

export interface PropuestaAlta {
  regimenIva: Propuesta<'general' | 'fuera_iva'>
  periodoIva: Propuesta<'quarterly' | 'monthly'>
  modelos: Propuesta<ModeloDeducido[]>
  preguntasModelos: { clave: string; pregunta: string }[]
  plan: Propuesta<'pymes' | 'normal'>
  digitos: Propuesta<number>
  ejercicio: Propuesta<{ code: string; startsOn: string; endsOn: string }>
}

/** Umbral del RIVA art. 71.3.1.º para liquidar el IVA cada mes. */
export const UMBRAL_IVA_MENSUAL = 6010121.04

function regimen(tipo: TipoEmpresa, territorio: Territorio): Propuesta<'general' | 'fuera_iva'> {
  if (territorio === 'canarias') {
    return { valor: 'fuera_iva', norma: 'ivaFueraCanarias', porque: 'En Canarias no se aplica el IVA, sino el IGIC.',
      duda: 'Tu régimen del IGIC lo confirma tu asesor.' }
  }
  if (territorio === 'ceuta_melilla') {
    return { valor: 'fuera_iva', norma: 'ivaFueraCeutaMelilla', porque: 'En Ceuta y Melilla no se aplica el IVA, sino el IPSI.',
      duda: 'Tu régimen del IPSI lo confirma tu asesor.' }
  }
  if (tipo === 'company') {
    return { valor: 'general', norma: 'ivaSimplificadoPersonasFisicas', duda: null,
      porque: 'Una sociedad va en el régimen general: el simplificado y el recargo de equivalencia son solo para personas físicas.' }
  }
  return { valor: 'general', norma: 'ivaSimplificadoPersonasFisicas',
    porque: 'Lo normal es el régimen general.',
    duda: 'Si tu actividad está en módulos, se te aplica el régimen simplificado salvo que renuncies: lo confirma tu asesor.' }
}

function periodo(volumen: number | null): Propuesta<'quarterly' | 'monthly'> {
  if (volumen !== null && volumen > UMBRAL_IVA_MENSUAL) {
    return { valor: 'monthly', norma: 'ivaPeriodoMensualVolumen', duda: null,
      porque: 'El año pasado pasaste de 6.010.121,04 € de operaciones: el IVA se presenta cada mes.' }
  }
  return { valor: 'quarterly', norma: 'ivaPeriodoTrimestral', duda: null,
    porque: 'Lo normal es cada tres meses; solo es cada mes por encima de 6.010.121,04 € al año.' }
}

function plan(tipo: TipoEmpresa, primerEjercicio: boolean): Propuesta<'pymes' | 'normal'> {
  if (tipo === 'self_employed') {
    return { valor: 'pymes', norma: 'pgcPymes', porque: 'Si llevas contabilidad, el plan de pymes es el que corresponde a un negocio de tu tamaño.',
      duda: 'Para un autónomo, si lleva o no contabilidad depende de cómo tribute: lo confirma tu asesor.' }
  }
  return primerEjercicio
    ? { valor: 'pymes', norma: 'pgcPymesConstitucion', duda: null,
        porque: 'El año en que se crea la empresa puede usar el plan de pymes si al cierre cumple dos de tres: activo hasta 4 millones, ventas hasta 8 millones, hasta 50 trabajadores.' }
    : { valor: 'pymes', norma: 'pgcPymes', duda: null,
        porque: 'El plan de pymes vale si dos años seguidos cumples dos de tres: activo hasta 4 millones, ventas hasta 8 millones, hasta 50 trabajadores.' }
}

function ejercicio(tipo: TipoEmpresa, inicio: string | null, hoy: string): Propuesta<{ code: string; startsOn: string; endsOn: string }> {
  const ano = hoy.slice(0, 4)
  const enero = `${ano}-01-01`
  const desde = inicio && inicio > enero && inicio.slice(0, 4) === ano ? inicio : enero
  const valor = { code: ano, startsOn: desde, endsOn: `${ano}-12-31` }
  return tipo === 'company'
    ? { valor, norma: 'isPeriodoDoceMeses', duda: null,
        porque: desde === enero
          ? 'El ejercicio va de enero a diciembre, como el de casi todas las empresas; nunca puede pasar de doce meses.'
          : 'Empezaste este año: el primer ejercicio va desde que empezaste hasta el 31 de diciembre.' }
    : { valor, norma: 'irpfAnoNatural', duda: null, porque: 'Para un autónomo el ejercicio es el año natural, de enero a diciembre.' }
}

export function proponerAlta(e: EntradaAlta): PropuestaAlta {
  const primerEjercicio = e.inicioActividad !== null && e.inicioActividad.slice(0, 4) === e.hoy.slice(0, 4)
  const { modelos, preguntas } = modelosQuePresenta(e)
  return {
    regimenIva: regimen(e.tipo, e.territorio),
    periodoIva: periodo(e.volumenAnoAnterior),
    modelos: { valor: modelos, norma: null, duda: null,
      porque: modelos.length === 0 ? 'Con lo que sé todavía no puedo decir qué modelos presentas.' : 'Salen de tu forma, tu territorio y tu actividad.' },
    preguntasModelos: preguntas,
    plan: plan(e.tipo, primerEjercicio),
    digitos: { valor: 8, norma: null, duda: null, porque: 'Ocho dígitos es lo habitual y deja sitio para crecer; no lo fija ninguna norma.' },
    ejercicio: ejercicio(e.tipo, e.inicioActividad, e.hoy),
  }
}
