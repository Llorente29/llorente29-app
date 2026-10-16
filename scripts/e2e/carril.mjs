// scripts/e2e/carril.mjs — la regla del carril, para los scripts de Node.
//
// La misma que scripts/e2e/carril/comun.sql (en_carril, correo_en_carril) y
// que tests/e2e/conta/sesion.ts (enCarril, correoDelCarril); la prueba
// tests/unit/e2e/carril.test.ts comprueba que las tres dicen lo mismo.

/** El id de la plantilla en el carril n: el segundo grupo pasa a ser n en hexadecimal. */
export function enCarril(id, n) {
  if (!Number.isInteger(n) || n < 1 || n > 4095) throw new Error(`carril fuera de rango: ${n}`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error(`no es un uuid: ${id}`)
  return `${id.slice(0, 9)}${n.toString(16).padStart(4, '0')}${id.slice(13)}`
}

/** El correo de la plantilla en el carril n: parte local + «.carril-n». */
export function correoDelCarril(correo, n) {
  const [local, dominio] = correo.toLowerCase().split('@')
  return `${local}.carril-${n}@${dominio}`
}
