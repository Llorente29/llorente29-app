// src/modules/conta/lib/autor.ts
//
// QUIÉN HIZO ALGO: una persona o lo automático (C06, respuesta 1). La lógica
// del módulo pregunta por el CAMPO (`automatico`), nunca por el texto del
// nombre; y en pantalla, con una marca propia, lo automático dice «automático».
//
// De dónde sale el campo. La base no tiene (aún) una columna que lo diga: lo
// automático firma con su nombre en `*_by_name` y deja `*_by` vacío, pero lo
// traído de Diez también deja `*_by` vacío. Así que el campo se calcula en UN
// sitio, aquí, al leer la fila: es automático lo que firmó un escritor
// automático. Los que hay (medido en producción el 13/10, solo lectura):
// «Folvy (cierre del día)», «Folvy (validación automática de ventas)»,
// «Folvy · corte con Diez (C04 R4)» y «Folvy» a secas. Lo guardado se queda
// como está y se lee igual (prueba en tests/unit/modules/conta/marcaC06.test.ts).
// Cuando los escritores (funciones del frente A) guarden el campo, esto pasa a
// leer la columna y la regla de la firma queda solo para lo antiguo.

import { CON_MARCA } from '../cuenta/marca'

const FIRMA_AUTOMATICA = /^Folvy(?=$|[\s(·])/

/** ¿Lo firmó un escritor automático? */
export function esFirmaAutomatica(nombre: string | null | undefined): boolean {
  return !!nombre && FIRMA_AUTOMATICA.test(nombre)
}

/** El nombre que se enseña: el guardado, salvo lo automático con una marca propia, que dice «automático». */
export function autorVisible(nombre: string | null, conMarca: boolean = CON_MARCA): string | null {
  if (nombre === null) return null
  return conMarca && esFirmaAutomatica(nombre) ? 'automático' : nombre
}
