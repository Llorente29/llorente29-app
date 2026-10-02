// src/modules/conta/lib/pgc.ts
//
// Nombre de las cuentas del Plan General de Contabilidad que usa el catálogo
// de tipos de gasto (expense_category.pgc_account_hint). Van en pequeño debajo
// del nombre normal, como pide el encargo (§6): «600 · Compras de mercaderías».
//
// Origen: RD 1514/2007, cuarta parte (cuadro de cuentas): subgrupos 60 y 62
// (tipos de gasto) y, desde el C00, 47 (las cuentas indicadas de impuestos y
// retenciones), 57 (bancos y cajas) y 129 (el resultado). El plan contable llega con
// el C02; esto solo pone nombre a la pista que ya guardan las tablas.
// tests/conta/cumplimiento/pgc.test.ts comprueba cada título, literal, en el
// texto oficial descargado.

export const NOMBRE_CUENTA_PGC: Readonly<Record<string, string>> = {
  '600': 'Compras de mercaderías',
  '601': 'Compras de materias primas',
  '602': 'Compras de otros aprovisionamientos',
  '621': 'Arrendamientos y cánones',
  '622': 'Reparaciones y conservación',
  '623': 'Servicios de profesionales independientes',
  '624': 'Transportes',
  '625': 'Primas de seguros',
  '626': 'Servicios bancarios y similares',
  '627': 'Publicidad, propaganda y relaciones públicas',
  '628': 'Suministros',
  '629': 'Otros servicios',
  '129': 'Resultado del ejercicio',
  '472': 'Hacienda Pública, IVA soportado',
  '477': 'Hacienda Pública, IVA repercutido',
  '4751': 'Hacienda Pública, acreedora por retenciones practicadas',
  '570': 'Caja, euros',
  '572': 'Bancos e instituciones de crédito c/c vista, euros',
}

/** «600 · Compras de mercaderías». Si no se conoce el nombre, solo el número. */
export function cuentaPgc(codigo: string): string {
  const n = NOMBRE_CUENTA_PGC[codigo]
  return n ? `${codigo} · ${n}` : codigo
}
