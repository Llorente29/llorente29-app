// src/modules/conta/diseno/temas.ts
//
// S01 · Cómo pinta cada marca el sistema de diseño. La identidad (tinta,
// apoyo, acción, acento, letra) sigue viviendo en un solo sitio,
// supabase/functions/_shared/marcas.ts. Aquí va solo lo que necesita la
// aplicación y no los correos ni la entrada: superficies, barra, estados y
// radio de los bloques. Vive en el front a propósito: si estuviera en _shared,
// cada cambio de pintura obligaría a desplegar a mano las tres funciones que
// importan marcas.ts.
//
// Los valores de Sumied salen de las maquetas aprobadas del S01 (17/10),
// medidos píxel a píxel, con dos decisiones de Julio (S01, respuestas 1 y 2):
//   · el borde de los CONTROLES es #7F8FA6 (3:1, C06 R4); el #DCE5F0 de la
//     maqueta se queda para lo que solo decora (tarjetas y separadores);
//   · el azul de acción y el gris de apoyo son los de la identidad del 14/10
//     (marcas.ts: #1E63C9 y #4A5B73), no los de las maquetas.
// Medido en tests/unit/modules/conta/s01/diseno.test.tsx.
//
// Sin tema (Folvy y la marca de pruebas) no se escribe nada: mandan los
// valores de serie de diseno/tokens.css, que son los del marco N30.

import type { IdMarca, Marca } from '../../../../supabase/functions/_shared/marcas.ts'

export interface TemaDiseno {
  /** Fondo de la página. */
  fondo: string
  /** Fondo suave: la cinta y la cabecera de la tabla. */
  suave: string
  /** Borde de lo que hay que ver para usarlo (campos, desplegables, casillas): ≥ 3:1. */
  bordeControl: string
  /** Borde que solo ordena: tarjetas, separadores de tabla, cinta, botones. */
  bordeDecorativo: string
  /** La barra de productos. */
  barra: string
  barraTexto: string
  barraActivo: string
  barraActivoTexto: string
  /** El chip de lo que pide una decisión en la barra (S01c): su fondo y su número. */
  barraDestacado: string
  barraDestacadoTexto: string
  /** Fondo de la píldora neutra. */
  neutroFondo: string
  /** Lo seguro / hecho. */
  ok: string
  okFondo: string
  /** La duda / lo pendiente. */
  duda: string
  dudaFondo: string
  /** Lo que falta / el error. */
  falta: string
  faltaFondo: string
  /** Radio de tarjetas y bloques. */
  radioBloque: string
}

export const TEMAS_DISENO: Partial<Record<IdMarca, TemaDiseno>> = {
  sumied: {
    fondo: '#F4F7FB',
    suave: '#FBFCFE',
    bordeControl: '#7F8FA6',
    bordeDecorativo: '#DCE5F0',
    barra: '#0B1F3B',
    barraTexto: '#C9D6E8',
    barraActivo: '#172E52',
    barraActivoTexto: '#FFFFFF',
    barraDestacado: '#00D1B2',
    // El turquesa, solo de fondo y con texto oscuro encima (identidad del 14/10).
    barraDestacadoTexto: '#0B1F3B',
    neutroFondo: '#EAF2F8',
    ok: '#0B6B58',
    okFondo: '#E3F8F3',
    duda: '#7A4A00',
    dudaFondo: '#FFF3DC',
    falta: '#8A1F12',
    faltaFondo: '#FFE4E1',
    radioBloque: '10px',
  },
}

/**
 * Las variables `--s-*` de una marca con tema, o null si no tiene. Mezcla la
 * identidad de marcas.ts con la pintura de aquí; lo que no se nombra se queda
 * con el valor de serie.
 */
export function variablesDeMarca(m: Marca): Record<string, string> | null {
  const t = m.tema
  if (!t) return null
  const d = TEMAS_DISENO[m.id]
  const v: Record<string, string> = {
    '--s-tinta': t.tinta,
    '--s-apoyo': t.apoyo,
    '--s-accion': t.accion,
    '--s-accion-encima': `color-mix(in srgb, ${t.accion} 82%, #000)`,
    '--s-accion-suave': t.accionSuave,
    '--s-accion-borde': t.accionBorde,
    '--s-acento': t.acento,
    '--s-letra': t.letra,
  }
  if (d) {
    Object.assign(v, {
      '--s-fondo': d.fondo,
      '--s-suave': d.suave,
      '--s-borde-control': d.bordeControl,
      '--s-borde-decorativo': d.bordeDecorativo,
      '--s-barra': d.barra,
      '--s-barra-texto': d.barraTexto,
      '--s-barra-activo': d.barraActivo,
      '--s-barra-activo-texto': d.barraActivoTexto,
      '--s-barra-destacado': d.barraDestacado,
      '--s-barra-destacado-texto': d.barraDestacadoTexto,
      '--s-neutro-fondo': d.neutroFondo,
      '--s-ok': d.ok,
      '--s-ok-fondo': d.okFondo,
      '--s-duda': d.duda,
      '--s-duda-fondo': d.dudaFondo,
      '--s-falta': d.falta,
      '--s-falta-fondo': d.faltaFondo,
      '--s-radio-bloque': d.radioBloque,
    })
  }
  return v
}
