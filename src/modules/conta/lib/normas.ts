// src/modules/conta/lib/normas.ts
//
// Las referencias normativas que usan las reglas del núcleo del C00, en un
// solo sitio. CADA UNA se ha leído en el texto oficial descargado a
// docs/conta/fuentes/textos/ (versión vigente del artículo), no de memoria
// (encargo C00 §8, regla de Julio). `fuente` es la clave de
// docs/conta/fuentes/fuentes.json; la prueba de cumplimiento comprueba que la
// fuente existe y que el texto citado sigue estando en ella.

export interface Norma {
  /** Cómo se cita en pantalla y en las filas de serie. */
  cita: string
  /** Clave de la fuente en docs/conta/fuentes/fuentes.json. */
  fuente: string
  /** Bloque del texto consolidado (artículo) donde está. */
  bloque: string
  /** Un trozo literal del texto vigente: si deja de estar, la norma ha cambiado. */
  literal: string
}

export const NORMAS = {
  ivaTipoGeneral: {
    cita: 'Ley 37/1992, art. 90.Uno', fuente: 'ley-37-1992', bloque: 'a90',
    literal: 'El Impuesto se exigirá al tipo del 21 por ciento',
  },
  ivaTipoReducido: {
    cita: 'Ley 37/1992, art. 91.Uno', fuente: 'ley-37-1992', bloque: 'a91',
    literal: 'Se aplicará el tipo del 10 por ciento a las operaciones siguientes',
  },
  ivaHosteleria: {
    cita: 'Ley 37/1992, art. 91.Uno.2.2.º',
    fuente: 'ley-37-1992', bloque: 'a91',
    literal: 'los de restaurantes y, en general, el suministro de comidas y bebidas para consumir en el acto',
  },
  ivaTipoSuperreducido: {
    cita: 'Ley 37/1992, art. 91.Dos', fuente: 'ley-37-1992', bloque: 'a91',
    literal: 'Se aplicará el tipo del 4 por ciento a las operaciones siguientes',
  },
  ivaFueraCanarias: {
    cita: 'Ley 37/1992, art. 3.Dos.1.º b)', fuente: 'ley-37-1992', bloque: 'a3',
    literal: 'En el Reino de España, Canarias',
  },
  ivaFueraCeutaMelilla: {
    cita: 'Ley 37/1992, art. 3.Dos.1.º a)', fuente: 'ley-37-1992', bloque: 'a3',
    literal: 'en el Reino de España, Ceuta y Melilla',
  },
  ivaRegimenesEspeciales: {
    cita: 'Ley 37/1992, art. 120.Dos', fuente: 'ley-37-1992', bloque: 'a120',
    literal: 'Los regímenes especiales regulados en este Título tendrán carácter voluntario, a excepción de',
  },
  ivaSimplificadoPersonasFisicas: {
    cita: 'Ley 37/1992, art. 122.Uno', fuente: 'ley-37-1992', bloque: 'a122',
    literal: 'El régimen simplificado se aplicará a las personas físicas y a las entidades en régimen de atribución de rentas',
  },
  ivaRecargoPersonasFisicas: {
    cita: 'Ley 37/1992, art. 148.Uno', fuente: 'ley-37-1992', bloque: 'a148',
    literal: 'se aplicará a los comerciantes minoristas que sean personas físicas o entidades en régimen de atribución de rentas',
  },
  ivaPeriodoTrimestral: {
    cita: 'RD 1624/1992 (Reglamento del IVA), art. 71.3', fuente: 'rd-1624-1992', bloque: 'a71',
    literal: 'El período de liquidación coincidirá con el trimestre natural.',
  },
  ivaPeriodoMensualVolumen: {
    cita: 'RD 1624/1992, art. 71.3.1.º', fuente: 'rd-1624-1992', bloque: 'a71',
    literal: 'hubiese excedido durante el año natural inmediato anterior de 6.010.121,04 euros',
  },
  ivaResumenAnual: {
    cita: 'RD 1624/1992, art. 71.7', fuente: 'rd-1624-1992', bloque: 'a71',
    literal: 'los sujetos pasivos deberán formular una declaración-resumen anual',
  },
  pgcPymes: {
    cita: 'RD 1515/2007, art. 2.1', fuente: 'rd-1515-2007', bloque: 'a2',
    literal: 'durante dos ejercicios consecutivos reúnan, a la fecha de cierre de cada uno de ellos, al menos dos de las circunstancias siguientes',
  },
  pgcPymesConstitucion: {
    cita: 'RD 1515/2007, art. 2.1, párrafo tercero', fuente: 'rd-1515-2007', bloque: 'a2',
    literal: 'En el ejercicio social de su constitución, las empresas podrán aplicar este Plan General de Contabilidad de Pymes',
  },
  pgcPymesExcluidas: {
    cita: 'RD 1515/2007, art. 2.2', fuente: 'rd-1515-2007', bloque: 'a2',
    literal: 'En ningún caso podrán aplicar este Plan General de Contabilidad de Pymes',
  },
  irpfPagoFraccionado: {
    cita: 'RD 439/2007 (Reglamento del IRPF), art. 109.1', fuente: 'rd-439-2007', bloque: 'a109',
    literal: 'Los contribuyentes que ejerzan actividades económicas estarán obligados a autoliquidar e ingresar en el Tesoro',
  },
  irpfPagoFraccionadoProfesionales: {
    cita: 'RD 439/2007, art. 109.2', fuente: 'rd-439-2007', bloque: 'a109',
    literal: 'al menos el 70 por ciento de los ingresos de la actividad fueron objeto de retención o ingreso a cuenta',
  },
  irpfAnoNatural: {
    cita: 'Ley 35/2006 (IRPF), art. 12.1', fuente: 'ley-35-2006', bloque: 'a12',
    literal: 'El período impositivo será el año natural.',
  },
  irpfDeclararRetenciones: {
    cita: 'RD 439/2007, art. 108.1', fuente: 'rd-439-2007', bloque: 'a108',
    literal: 'declaración de las cantidades retenidas y de los ingresos a cuenta que correspondan por el trimestre natural inmediato anterior',
  },
  irpfRetencionAlquiler: {
    cita: 'RD 439/2007, art. 100', fuente: 'rd-439-2007', bloque: 'a100',
    literal: 'será el resultado de aplicar el porcentaje del 19 por ciento sobre todos los conceptos que se satisfagan al arrendador',
  },
  isPagoFraccionado: {
    cita: 'Ley 27/2014, art. 40.1', fuente: 'ley-27-2014', bloque: 'a40',
    literal: 'los contribuyentes deberán efectuar un pago fraccionado a cuenta de la liquidación',
  },
  isPeriodoDoceMeses: {
    cita: 'Ley 27/2014, art. 27.3', fuente: 'ley-27-2014', bloque: 'a27',
    literal: 'El período impositivo no excederá de 12 meses.',
  },
  isPeriodoEjercicio: {
    cita: 'Ley 27/2014, art. 27.1', fuente: 'ley-27-2014', bloque: 'a27',
    literal: 'El período impositivo coincidirá con el ejercicio económico de la entidad.',
  },
} as const satisfies Record<string, Norma>

export type ClaveNorma = keyof typeof NORMAS
