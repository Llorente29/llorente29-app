// src/modules/conta/lib/modelos.ts
//
// Regla 4 del núcleo del C00 (§5): qué modelos presenta una empresa, deducido
// de su perfil. Cada modelo que sale lleva su porqué y la norma que obliga.
// LO QUE NO SE PUEDE FUNDAMENTAR, NO SE DEDUCE: si falta un dato (¿pagas
// nóminas?, ¿qué parte de tus ingresos lleva retención?), no se adivina; se
// devuelve como pregunta pendiente.
//
// El número de cada modelo lo aprueba una orden ministerial; su referencia va
// en la tabla de modelos (tax_form) con su fuente. Aquí está la OBLIGACIÓN.
//
// Fuera, a propósito (no fundamentado todavía con fuente descargada): 347
// (operaciones con terceros), 349 (intracomunitarias), 200 (declaración anual
// de sociedades), 131 (estimación objetiva) y los del IGIC/IPSI.

import type { ClaveNorma } from '@/modules/conta/lib/normas'

export type Territorio = 'peninsula_baleares' | 'canarias' | 'ceuta_melilla'
export type TipoEmpresa = 'company' | 'self_employed'
export type ClaseActividad = 'business' | 'professional' | 'other'

export interface PerfilParaModelos {
  tipo: TipoEmpresa
  territorio: Territorio
  /** Solo operaciones exentas de los arts. 20 y 26 de la Ley del IVA (RIVA art. 71.1). */
  soloExentas?: boolean
  actividades: ClaseActividad[]
  /** ¿Retiene a trabajadores o profesionales? null = no se sabe todavía. */
  retiene: boolean | null
  /** ¿Paga el alquiler de un local con retención? null = no se sabe. */
  alquilaConRetencion: boolean | null
  /** Autónomo profesional: % de ingresos del año anterior con retención. null = no se sabe. */
  porcentajeIngresosRetenidos?: number | null
}

export interface ModeloDeducido {
  codigo: string
  nombre: string
  porque: string
  norma: ClaveNorma
}

export interface ResultadoModelos {
  modelos: ModeloDeducido[]
  /** Lo que hace falta saber para terminar de decidir. Se pregunta; no se adivina. */
  preguntas: { clave: string; pregunta: string }[]
}

export function modelosQuePresenta(p: PerfilParaModelos): ResultadoModelos {
  const modelos: ModeloDeducido[] = []
  const preguntas: ResultadoModelos['preguntas'] = []

  // IVA: solo en el territorio del impuesto (península y Baleares).
  if (p.territorio === 'peninsula_baleares') {
    if (p.soloExentas) {
      // RIVA 71.1: quien solo hace operaciones exentas no presenta.
    } else {
      modelos.push({ codigo: '303', nombre: 'IVA', norma: 'ivaPeriodoTrimestral',
        porque: 'Declaras el IVA de cada período: lo que cobras menos lo que pagas.' })
      modelos.push({ codigo: '390', nombre: 'Resumen anual del IVA', norma: 'ivaResumenAnual',
        porque: 'Además de cada período, el IVA lleva un resumen del año.' })
    }
  } else {
    preguntas.push({ clave: 'impuesto_territorio', pregunta: p.territorio === 'canarias'
      ? 'En Canarias no hay IVA sino IGIC: sus modelos los confirma tu asesor.'
      : 'En Ceuta y Melilla no hay IVA sino IPSI: sus modelos los confirma tu asesor.' })
  }

  // Retenciones a trabajadores o profesionales.
  if (p.retiene === true) {
    modelos.push({ codigo: '111', nombre: 'Retenciones', norma: 'irpfDeclararRetenciones',
      porque: 'Retienes IRPF en nóminas o facturas de profesionales, y eso se declara cada trimestre.' })
  } else if (p.retiene === null) {
    preguntas.push({ clave: 'retiene', pregunta: '¿Pagas nóminas o facturas de profesionales (asesor, abogado…) con retención?' })
  }

  // Retención del alquiler del local.
  if (p.alquilaConRetencion === true) {
    modelos.push({ codigo: '115', nombre: 'Alquiler', norma: 'irpfRetencionAlquiler',
      porque: 'Pagas el alquiler de un local con retención, y esa retención se declara cada trimestre.' })
  } else if (p.alquilaConRetencion === null) {
    preguntas.push({ clave: 'alquiler', pregunta: '¿Pagas el alquiler de un local con retención?' })
  }

  // Pagos a cuenta del impuesto sobre el beneficio.
  if (p.tipo === 'company') {
    modelos.push({ codigo: '202', nombre: 'Sociedades', norma: 'isPagoFraccionado',
      porque: 'Una sociedad adelanta el Impuesto sobre Sociedades en abril, octubre y diciembre.' })
  } else {
    const soloProfesional = p.actividades.length > 0 && p.actividades.every((a) => a === 'professional')
    if (!soloProfesional) {
      modelos.push({ codigo: '130', nombre: 'Pago a cuenta del IRPF', norma: 'irpfPagoFraccionado',
        porque: 'Como autónomo con actividad empresarial, adelantas el IRPF cada trimestre.' })
    } else if (p.porcentajeIngresosRetenidos === null || p.porcentajeIngresosRetenidos === undefined) {
      preguntas.push({ clave: 'retenido_70', pregunta: 'El año pasado, ¿al menos el 70 % de tus ingresos llevó retención? Si es así, no adelantas el IRPF.' })
    } else if (p.porcentajeIngresosRetenidos < 70) {
      modelos.push({ codigo: '130', nombre: 'Pago a cuenta del IRPF', norma: 'irpfPagoFraccionadoProfesionales',
        porque: `Menos del 70 % de tus ingresos llevó retención (${p.porcentajeIngresosRetenidos} %): adelantas el IRPF cada trimestre.` })
    }
  }
  return { modelos, preguntas }
}
