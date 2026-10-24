// src/modules/conta/esqueleto/contadoresPestanas.ts
//
// El contador de cada página de un apartado (S01f, Julio, 20/10: «contador
// donde aplique, en gris, y en rojo lo que vence»). S02: las páginas ya no van
// en pestañas de la cabecera sino debajo del apartado activo, en la barra; el
// contador va con ellas. Núcleo puro: se prueba sin React.
//
// Dos clases, con la misma vara que lo que ya cuenta otro sitio (regla 31):
//   · en GRIS, lo que pide una decisión: las mismas cuentas que el chip de la
//     barra y el «Te toca hoy» del Inicio (useCuentasMenu), ahora puestas en
//     la pestaña donde se resuelven. La barra dice «Compras 7»; la pestaña,
//     cuántas de esas son «Por revisar» y cuántas «Facturas recibidas».
//   · en ROJO, lo que vence: los avisos de impuestos del Inicio
//     (avisosInicio, 15 días): los modelos con el plazo encima o pasado, en
//     «Calendario», y el certificado que caduca, en «Certificados».
//   · y en gris, cuántos hay, donde la maqueta lo pone (maqueta_trimestre_v3):
//     «Presentados 9», lo presentado este año, la misma cifra que la tarjeta
//     «Presentados» del Calendario (calendario.presentados.presentados).
//
// Un contador interrumpe (es un badge, regla 7: aquí el umbral sí filtra), así
// que 0 no se pinta. Y lo que no se ha podido contar (null) tampoco: no dice 0
// de lo que no sabe.

import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import type { AvisoInicio } from '@/modules/conta/impuestos/avisosInicio'
import { frasePartes, frasePendientes, partesDe } from './cuentasBarra'
import type { IdProducto } from './productos'

export type TonoContador = 'neutro' | 'vence'

export interface ContadorPestana {
  n: number
  tono: TonoContador
  /** Lo que dice al lector y al pasar el ratón («3 por revisar»). */
  frase: string
  /**
   * D04 · Si la pestaña suma dos cosas («77 por revisar» y «22 por aclarar»),
   * cada una en su chip con lo que es: un 99 suelto no decía qué contaba y no
   * cuadraba con el «1 de 77» de la ficha.
   */
  partes?: { n: number; frase: string }[]
}

/** Por pestaña: `${producto}.${pestana}`. */
export type ContadoresPestanas = Partial<Record<string, ContadorPestana>>

export const clavePestana = (producto: IdProducto, pestana: string) => `${producto}.${pestana}`

/** De qué cuentas del menú sale el contador gris de cada pestaña (se suman). */
export const CUENTA_DE_PESTANA: Readonly<Record<string, readonly string[]>> = {
  'contabilidad.asientos': ['libros'],
  // S02: «Por revisar» de Compras (las recepciones) cuelga de Facturas recibidas; su
  // número va en el chip del apartado (cuentasBarra), y el de la página es el de sus facturas.
  // S02 · PR 3: sus facturas son las para mirar Y las por aclarar (sus dos pestañas).
  'compras.recibidas': ['recibidas', 'aclarar'],
  'bancos.movimientos': ['bancos'],
  'contactos.todos': ['terceros'],
}

export function contadoresDeCuentas(c: CuentasMenu): ContadoresPestanas {
  const fuera: ContadoresPestanas = {}
  for (const [pestana, cuentas] of Object.entries(CUENTA_DE_PESTANA)) {
    const ns = cuentas.map((k) => c[k]).filter((n): n is number => typeof n === 'number')
    const n = ns.reduce((s, x) => s + x, 0)
    if (n > 0) {
      const partes = cuentas.length > 1 ? partesDe(c, cuentas) : []
      fuera[pestana] = { n, tono: 'neutro', frase: cuentas.length > 1 ? frasePartes(c, cuentas) ?? frasePendientes(n) : frasePendientes(n), ...(partes.length > 1 ? { partes } : {}) }
    }
  }
  return fuera
}

/**
 * Lo que vence en Impuestos, de los avisos del Inicio: los plazos de los
 * modelos (no los cargos que no han llegado al banco: eso no vence, ya está
 * presentado) y el certificado.
 */
export function contadoresDeImpuestos(avisos: readonly AvisoInicio[], presentados = 0): ContadoresPestanas {
  const fuera: ContadoresPestanas = {}
  if (presentados > 0) {
    fuera['impuestos.presentados'] = { n: presentados, tono: 'neutro', frase: presentados === 1 ? '1 presentado este año' : `${presentados} presentados este año` }
  }
  const plazos = avisos.filter((a) => a.modelo !== null && !a.clave.startsWith('pago-')).length
  if (plazos > 0) {
    fuera['impuestos.calendario'] = { n: plazos, tono: 'vence', frase: plazos === 1 ? '1 modelo con el plazo encima o pasado' : `${plazos} modelos con el plazo encima o pasado` }
  }
  if (avisos.some((a) => a.clave === 'certificado')) {
    fuera['impuestos.certificados'] = { n: 1, tono: 'vence', frase: 'El certificado caduca pronto o ya ha caducado' }
  }
  return fuera
}
