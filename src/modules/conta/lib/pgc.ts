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

/**
 * «600 · Compras de mercaderías»: el código CORTO del plan. Solo como título de
 * grupo (respuesta 3 del C00, punto 3). Donde se enseña una cuenta en la que
 * se apunta, va cuentaDeApunte.
 */
export function cuentaPgc(codigo: string): string {
  const n = NOMBRE_CUENTA_PGC[codigo]
  return n ? `${codigo} · ${n}` : codigo
}

/**
 * Las longitudes de cuenta que se dejan elegir (company_tax_profile.account_digits).
 * De 6 a 12 desde el C02 (D3 de Julio): las hojas del cuadro llegan a 4 dígitos
 * (y diez a 5), y con menos de 6 no queda sitio para subcuentas.
 */
export const DIGITOS_MINIMOS = 6
export const DIGITOS_MAXIMOS = 12

/**
 * El código de la subcuenta de apunte con la longitud que eligió la empresa:
 * «472» con 8 dígitos es «47200000». El PGC (RD 1514/2007) define las cuentas
 * hasta 4 dígitos; los demás son de la empresa y se rellenan con ceros. Un
 * código que ya es más largo que la longitud se deja como está: no se corta.
 */
export function codigoDeApunte(codigo: string, digitos: number): string {
  const c = codigo.replace(/\s+/g, '')
  if (!/^\d+$/.test(c)) return c
  const n = Number.isInteger(digitos) && digitos >= DIGITOS_MINIMOS && digitos <= DIGITOS_MAXIMOS ? digitos : 8
  return c.length >= n ? c : c.padEnd(n, '0')
}

/** «47200000 · Hacienda Pública, IVA soportado»: una cuenta de apunte, completa (respuesta 3, punto 3). */
export function cuentaDeApunte(codigo: string, digitos: number): string {
  const n = NOMBRE_CUENTA_PGC[codigo.replace(/\s+/g, '')]
  const c = codigoDeApunte(codigo, digitos)
  return n ? `${c} · ${n}` : c
}
