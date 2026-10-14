// src/marca/marca.ts
//
// La marca con la que se enseña esta pestaña (C06). Se decide UNA vez, al
// cargar, por el dominio (y fuera de producción por ?marca=, recordado en la
// sesión del navegador): ver resolverMarca. Las marcas y todo lo que depende
// del nombre viven en supabase/functions/_shared/marcas.ts, el único sitio.
//
// Sin navegador (pruebas unitarias, node) es Folvy: lo de siempre.

import {
  MARCAS, MARCA_POR_DEFECTO, resolverMarca, type Marca, type IdMarca,
} from '../../supabase/functions/_shared/marcas.ts'

export { MARCAS, type Marca, type IdMarca }

const CLAVE_SESION = 'producto.marca'

function leerRecordada(): string | null {
  try { return window.sessionStorage.getItem(CLAVE_SESION) } catch { return null }
}

function recordar(id: IdMarca | null): void {
  try {
    if (id === null) window.sessionStorage.removeItem(CLAVE_SESION)
    else window.sessionStorage.setItem(CLAVE_SESION, id)
  } catch { /* sin almacenamiento: vale para esta carga */ }
}

function decidir(): Marca {
  if (typeof window === 'undefined' || !window.location) return MARCAS[MARCA_POR_DEFECTO]
  const r = resolverMarca({ host: window.location.hostname, buscar: window.location.search, recordada: leerRecordada() })
  if (r.recordar !== undefined) recordar(r.recordar)
  return MARCAS[r.id]
}

/** La marca de esta pestaña. */
export const MARCA: Marca = decidir()

/** ¿Se enseña con una marca propia (no Folvy)? */
export const CON_MARCA: boolean = MARCA.id !== MARCA_POR_DEFECTO

/**
 * Pone la marca en lo que el navegador enseña fuera de la página: el título de
 * la pestaña, el icono, el manifiesto y el nombre de la aplicación instalada.
 * Con Folvy no toca nada (el index.html ya lo dice).
 */
export function aplicarMarcaAlDocumento(m: Marca = MARCA): void {
  if (typeof document === 'undefined' || m.id === MARCA_POR_DEFECTO) return
  document.title = m.nombre
  const poner = (selector: string, atributo: string, valor: string) => {
    document.querySelectorAll(selector).forEach((el) => el.setAttribute(atributo, valor))
  }
  poner('link[rel="icon"]', 'href', m.favicon)
  poner('link[rel="icon"]', 'type', 'image/svg+xml')
  poner('link[rel="apple-touch-icon"]', 'href', m.favicon)
  poner('link[rel="manifest"]', 'href', m.manifiesto)
  poner('meta[name="apple-mobile-web-app-title"]', 'content', m.nombre)
  poner('meta[name="application-name"]', 'content', m.nombre)
  poner('meta[name="description"]', 'content', m.entrar.lema || m.nombre)
}

/** El título de una pantalla en la pestaña: «Libros · Contabilidad». */
export function tituloDePestana(pantalla: string | null, m: Marca = MARCA): string {
  return pantalla ? `${pantalla} · ${m.nombre}` : m.nombre
}
