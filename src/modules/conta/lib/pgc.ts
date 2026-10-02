// src/modules/conta/lib/pgc.ts
//
// Nombre de las cuentas del Plan General de Contabilidad que usa el catálogo
// de tipos de gasto (expense_category.pgc_account_hint). Van en pequeño debajo
// del nombre normal, como pide el encargo (§6): «600 · Compras de mercaderías».
//
// Origen: RD 1514/2007, cuarta parte (cuadro de cuentas), subgrupos 60 y 62.
// El plan contable de cada cuenta llega con el C02; esto solo pone nombre a la
// pista que ya guarda el catálogo.

const NOMBRE: Record<string, string> = {
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
}

/** «600 · Compras de mercaderías». Si no se conoce el nombre, solo el número. */
export function cuentaPgc(codigo: string): string {
  const n = NOMBRE[codigo]
  return n ? `${codigo} · ${n}` : codigo
}
