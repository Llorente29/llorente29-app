// src/modules/conta/gestoria/actualizarBitrix.ts
//
// R18 · Lo que dice el bloque «Actualizar Bitrix24» de Ajustes › Cobros (lo prueban las unitarias). Palabras de
// la calle: ni «webhook» ni nombres de funciones en pantalla.

import type { EstadoActualizar } from '@/modules/conta/services/gestoriaService'

/** La línea de arriba mientras esté apagado (encargo R18, diseño). */
export const LINEA_APAGADO = 'Bitrix24 no se actualiza: lo enciende Julio en Ajustes.'

const fecha = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null)

/** Lo que se dice del interruptor y de la clave. */
export function textosActualizar(e: EstadoActualizar): { linea: string; tono: 'apagado' | 'encendido'; clave: string; boton: { texto: string; on: boolean } | null } {
  const quien = (q: string | null, c: string | null) => [q ? `por ${q}` : null, fecha(c) ? `el ${fecha(c)}` : null].filter(Boolean).join(' ')
  const linea = e.actualizar
    ? `Encendido${quien(e.quien, e.cuando) ? ` ${quien(e.quien, e.cuando)}` : ''}: Sumied actualiza Bitrix24, solo en la ficha de prueba.`
    : LINEA_APAGADO
  const clave = e.clave
    ? `Clave para actualizar guardada${quien(e.claveQuien, e.claveCuando) ? ` ${quien(e.claveQuien, e.claveCuando)}` : ''}. No se enseña.`
    : 'Aún no hay clave para actualizar Bitrix24.'
  // Apagar lo puede la administradora; encender, solo Julio (y con la clave puesta).
  const boton = e.actualizar ? { texto: 'Apagar', on: false } : e.puedeEncender && e.clave ? { texto: 'Encender', on: true } : null
  return { linea, tono: e.actualizar ? 'encendido' : 'apagado', clave, boton }
}
