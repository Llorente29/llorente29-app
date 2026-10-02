// src/config/navegacion.ts
//
// EL ÚNICO SITIO de la navegación de lo que toca el C01: la entrada de menú
// de Proveedores, la dirección de la lista y de la ficha, y las migas.
//
// Por qué existe (respuesta 1 de Julio al C01, 01/10/2026): toda la
// navegación de Folvy se va a reorganizar pronto. Cuando pase, se cambia
// AQUÍ y no en cada pantalla:
//   · las pantallas no escriben rutas a mano: piden `rutaFichaProveedor(id)`;
//   · las migas salen de `migasProveedores`, no de cada página;
//   · si una dirección cambia, la vieja se apunta en `REDIRECCIONES` y sigue
//     funcionando: los enlaces guardados no se rompen.
//
// Nace solo con lo de este encargo, a propósito. Lo demás de Folvy se irá
// trayendo cuando se reorganice; no se mueve hoy lo que nadie ha pedido.

/** Una miga: la etiqueta y, si lleva a algún sitio, su dirección. */
export interface Miga {
  etiqueta: string
  ruta?: string
}

/**
 * Dónde vive cada pantalla. `modulo` es el basePath del módulo del Shell que
 * la monta; las rutas son relativas a él (es como las declara el Shell).
 *
 * HOY: dentro de Cocina, porque es donde está la entrada de menú. La pantalla
 * no depende de Cocina para nada: si mañana se monta en otro módulo, se
 * cambia `modulo` y se apunta la redirección.
 */
export const PROVEEDORES = {
  modulo: 'kitchen',
  etiquetaMenu: 'Proveedores',
  /** Lista de proveedores. */
  lista: 'proveedores',
  /** Ficha de un proveedor (pestaña Resumen). */
  ficha: 'proveedores/:supplierId',
  /** Un apartado de la ficha: pestaña en ordenador, pantalla en el móvil. */
  apartado: 'proveedores/:supplierId/:apartado',
} as const

/** Lo que va delante de «Proveedores» en las migas. Hoy: «Cocina». */
const MIGA_SECCION: Miga = { etiqueta: 'Cocina', ruta: `/${PROVEEDORES.modulo}` }

function absoluta(relativa: string): string {
  return `/${PROVEEDORES.modulo}/${relativa}`.replace(/\/+$/, '')
}

export function rutaListaProveedores(): string {
  return absoluta(PROVEEDORES.lista)
}

export function rutaFichaProveedor(supplierId: string, apartado?: string): string {
  const base = absoluta(PROVEEDORES.ficha.replace(':supplierId', encodeURIComponent(supplierId)))
  return apartado ? `${base}/${encodeURIComponent(apartado)}` : base
}

/**
 * «Subir factura» / «Foto factura» de la ficha: la pantalla de facturas de
 * proveedor, abriendo directamente el escaneo con este proveedor por defecto.
 * `camara` = desde el móvil, con la cámara.
 */
export function rutaSubirFacturaProveedor(supplierId: string, camara = false): string {
  const q = new URLSearchParams({ escanear: camara ? 'camara' : '1', proveedor: supplierId })
  return `/supply/facturas?${q.toString()}`
}

/** Migas de la lista: Cocina › Proveedores. */
export function migasProveedores(): Miga[] {
  return [MIGA_SECCION, { etiqueta: PROVEEDORES.etiquetaMenu }]
}

/** Migas de la ficha: Cocina › Proveedores › nombre. */
export function migasFichaProveedor(nombre: string): Miga[] {
  return [
    MIGA_SECCION,
    { etiqueta: PROVEEDORES.etiquetaMenu, ruta: rutaListaProveedores() },
    { etiqueta: nombre },
  ]
}

// ── Redirecciones ──────────────────────────────────────────────────────────
// Cuando una dirección cambie, la vieja se apunta aquí con la nueva. Las dos
// son ABSOLUTAS y pueden llevar parámetros (`:supplierId`), que pasan de una a
// otra con el mismo nombre. El módulo que tenga el basePath de `desde` la
// monta como ruta que redirige.
//
// Hoy está vacía: la ficha estrena dirección y no hay ninguna vieja que
// conservar (la de antes se abría encima de la lista, sin dirección propia).
export interface Redireccion {
  desde: string
  hasta: string
}

export const REDIRECCIONES: Redireccion[] = []

/** Las redirecciones que le tocan montar a un módulo, con `desde` relativo a él. */
export function redireccionesDelModulo(
  basePath: string,
  lista: Redireccion[] = REDIRECCIONES,
): { path: string; hasta: string }[] {
  const prefijo = `/${basePath}/`
  return lista
    .filter(r => r.desde.startsWith(prefijo))
    .map(r => ({ path: r.desde.slice(prefijo.length), hasta: r.hasta }))
}

/** Rellena los parámetros de `hasta` con los de la ruta vieja. */
export function resolverRedireccion(hasta: string, params: Record<string, string | undefined>): string {
  return hasta.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, nombre: string) =>
    encodeURIComponent(params[nombre] ?? ''),
  )
}
