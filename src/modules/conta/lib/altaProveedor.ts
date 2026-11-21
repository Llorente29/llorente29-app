// src/modules/conta/lib/altaProveedor.ts
//
// S01d · Dar de alta un proveedor desde Contactos y desde «Subir factura»
// (Julio: «dar de alta un proveedor desde Contactos y desde "Subir factura"»).
// Lo que no pinta nada: con qué se rellena el formulario (lo que leyó el
// papel), qué se comprueba antes de crear (el nombre, el NIF y el NIF repetido)
// y las frases con las que se confirma (regla 8: con contenido).
//
// Un solo sitio para las dos pantallas y para la lista de Proveedores de
// Cocina: el alta no puede comprobar distinto según desde dónde se haga.

import { nifClave, normalizarNif, validarNifEs } from '@/modules/conta/lib/nif'

/** Lo que ya hay en la cuenta, para no dar dos veces el mismo NIF. */
export interface ProveedorExistente {
  /** Para «Abrirlo» (X24); sin él, la frase va sin enlace. */
  id?: string
  name: string
  taxId: string | null
}

export interface ValoresAlta {
  nombre: string
  nif: string
}

/**
 * Con qué empieza el formulario. El nombre leído va tal cual (sin espacios
 * sobrantes). El NIF leído, solo si es un NIF español válido, ya normalizado:
 * uno mal leído (o de otro país) no se pone, porque el formulario lo marcaría
 * en rojo antes de que la persona haya escrito nada.
 */
export function valoresInicialesAlta(nombreLeido?: string | null, nifLeido?: string | null): ValoresAlta {
  const nombre = (nombreLeido ?? '').replace(/\s+/g, ' ').trim()
  const r = nifLeido && nifLeido.trim() ? validarNifEs(nifLeido) : null
  return { nombre, nif: r && r.ok ? r.normalizado : '' }
}

/** El aviso del NIF mientras se escribe; null si está vacío o es válido. */
export function avisoNifAlta(nif: string): string | null {
  if (!nif.trim()) return null
  const r = validarNifEs(nif)
  return r.ok ? null : `${r.motivo} Si es de otro país, déjalo vacío y ponlo luego en su ficha.`
}

export interface RevisionAlta {
  errores: { nombre?: string; nif?: string }
  /** El NIF normalizado que se guarda, o null si se deja vacío. */
  nif: string | null
  /** X24 · El que ya tiene ese NIF (comparado como la base: nifClave), para «Ya tienes a … con este NIF: abrirlo». */
  repetido: ProveedorExistente | null
}

/** X24 · «Ya tienes a Frutas Inventadas con este NIF.» (con «Abrirlo» al lado, si se sabe cuál es). */
export function textoNifRepetido(nombre: string): string {
  return `Ya tienes a ${nombre.trim()} con este NIF.`
}

/** Lo que hay que corregir antes de crear: el nombre, el NIF y el NIF que ya tiene otro proveedor. */
export function revisarAlta(v: ValoresAlta, otros: readonly ProveedorExistente[]): RevisionAlta {
  const errores: RevisionAlta['errores'] = {}
  if (!v.nombre.trim()) errores.nombre = 'Pon el nombre con el que lo conocéis.'
  const aviso = avisoNifAlta(v.nif)
  if (aviso) errores.nif = aviso
  const nif = v.nif.trim() ? normalizarNif(v.nif) : null
  // X24 · Comparado con la misma clave que la base (la del índice único): «B-00000000» es «B00000000».
  const clave = nif && !aviso ? nifClave(nif) : null
  const repe = clave ? otros.find((o) => nifClave(o.taxId) === clave) ?? null : null
  if (repe) errores.nif = textoNifRepetido(repe.name)
  return { errores, nif, repetido: repe }
}

/** «Proveedor Hermanos Ruiz dado de alta. Ya puedes subir sus facturas.» (Contactos). */
export function fraseAltaProveedor(nombre: string): string {
  return `Proveedor ${nombre.trim()} dado de alta. Ya puedes subir sus facturas.`
}

/** «Proveedor Hermanos Ruiz dado de alta y elegido para esta factura.» («Subir factura»). */
export function fraseAltaEnFactura(nombre: string): string {
  return `Proveedor ${nombre.trim()} dado de alta y elegido para esta factura.`
}

/** El botón de «Subir factura»: con el nombre que leyó el papel, o sin él. */
export function textoBotonAlta(proveedorLeido: string | null | undefined): string {
  const n = (proveedorLeido ?? '').replace(/\s+/g, ' ').trim()
  return n ? `+ Dar de alta «${n}»` : '+ Dar de alta un proveedor'
}
