// src/modules/conta/textos/textos.ts
//
// S01 (paso 4, inventario §4.1) · El diccionario de textos por nivel. Cada clave
// lleva sus TRES textos (sin experiencia, medio, experto) y TypeScript obliga a
// que estén los tres. En el código y no en la base: van con lo que los usa, se
// revisan en el PR y se prueban (tests/unit/modules/conta/s01/textos.test.ts).
//
// El nivel cambia las palabras, la ayuda y lo que se ofrece por defecto; NUNCA
// dónde está cada cosa ni lo que se puede hacer (maqueta 5). Por eso un texto
// que cambia en un sitio fijo (un botón, una etiqueta) se pinta con <PorNivel>,
// que ocupa siempre lo del más largo de los tres.
//
// Los huecos van entre llaves: «Una compra de {proveedor}». Medio es el texto
// de siempre: subir de nivel o bajar nunca cambia lo que ya conocía quien estaba
// en medio.

import type { Nivel } from '@/modules/conta/esqueleto/preferencias'

export type TextoPorNivel = Readonly<Record<Nivel, string>>

const t = (sin_experiencia: string, medio: string, experto: string): TextoPorNivel => ({ sin_experiencia, medio, experto })

export const TEXTOS = {
  // ── La factura recibida (maquetas 3 y 5) ──
  'recibida.titulo': t('Una compra de {proveedor}', '{proveedor} · {numero}', 'Recibida · {numero} · {proveedor}'),
  'recibida.tituloSinNumero': t('Una compra de {proveedor}', '{proveedor}', 'Recibida · sin número · {proveedor}'),
  'recibida.apuntar': t('Está bien, guardar', 'Está bien · apuntar', 'Validar'),
  'recibida.validarYSiguiente': t('Está bien, guardar y siguiente', 'Validar y siguiente', 'Validar y siguiente'),
  'recibida.leido': t('Lo que pone la factura', 'Lo que he leído', 'Lectura'),
  'recibida.verAsiento': t('Ver cómo lo guardo en tu contabilidad', 'Ver el asiento', 'Asiento propuesto'),

  // ── Inicio como bandeja ──
  'inicio.banco': t('Tienes en el banco', 'En el banco', 'Bancos (572)'),
  'inicio.teDeben': t('Te deben tus clientes', 'Te deben', 'Clientes (43, 44)'),
  'inicio.debes': t('Debes a proveedores', 'Debes', 'Proveedores (40, 41)'),
  // S01e: {impuesto} es IVA, IGIC (Canarias) o IPSI (Ceuta y Melilla).
  'inicio.iva': t('{impuesto} de este trimestre', '{impuesto} del trimestre', '{impuesto} (477 − 472)'),
  'inicio.pendiente': t('Solo necesito que me digas esto', 'Solo necesito que me digas esto', 'Pendiente de ti'),
  'inicio.impuestos': t('Lo que toca presentar a Hacienda', 'Impuestos que vienen', 'Calendario fiscal'),
  'inicio.verGraficas': t('Ver cómo ha ido cada mes', 'Ver la evolución', 'Ver los seis meses'),
  'inicio.ocultarGraficas': t('Quitar los gráficos', 'Ocultar la evolución', 'Ocultar los seis meses'),
} satisfies Record<string, TextoPorNivel>

export type ClaveTexto = keyof typeof TEXTOS

/** Los huecos de un texto, en orden y sin repetir: «{a} y {b}» → ['a', 'b']. */
export function huecos(s: string): string[] {
  return [...new Set([...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]))]
}

/**
 * El texto de una clave en un nivel, con sus huecos rellenos. Un hueco sin
 * dato se queda escrito tal cual ({numero}): se ve en la pantalla y en la
 * prueba, en vez de esconderse.
 */
export function texto(clave: ClaveTexto, nivel: Nivel, datos: Readonly<Record<string, string | number>> = {}): string {
  return TEXTOS[clave][nivel].replace(/\{([a-zA-Z]+)\}/g, (todo, k: string) => (k in datos ? String(datos[k]) : todo))
}
