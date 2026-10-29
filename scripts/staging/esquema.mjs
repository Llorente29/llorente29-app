#!/usr/bin/env node
// scripts/staging/esquema.mjs
//
// W09 (Julio, 28/10) · La estructura de staging, sin datos. Lo que hace falta
// alrededor de `pg_dump --schema-only`:
//   · limpiar  <entrada> <salida>  → quita lo que no es estructura ni se puede
//     pasar a otra base: los metacomandos \restrict / \unrestrict (pg_dump 17.6
//     en adelante) y, con --para-16, el `SET transaction_timeout` que la 16 no
//     conoce.
//   · secretos <fichero>           → sale con 1 y dice dónde si el volcado lleva
//     algo con pinta de secreto (un JWT, una clave de Stripe, una URL con
//     contraseña, una clave privada…). El workflow NO publica si sale con 1.
//   · roles    <fichero>           → los roles que nombra (GRANT, REVOKE, TO,
//     políticas): el guion local los crea antes de cargarlo.

import { readFileSync, writeFileSync } from 'node:fs'

/** Quita lo que no es estructura o no carga en otra base. */
export function limpiarVolcado(texto, { para16 = false } = {}) {
  return texto.split('\n').filter((l) => {
    if (/^\\(un)?restrict\b/.test(l)) return false
    if (para16 && /^SET transaction_timeout\b/.test(l)) return false
    return true
  }).map((l) => (para16 && /^(GRANT|REVOKE) /.test(l) ? sinMaintain(l) : l)).join('\n')
}

/** El privilegio MAINTAIN es de la 17: en una 16, fuera de la lista (y la sentencia, si no queda nada). */
function sinMaintain(l) {
  const m = l.match(/^(GRANT|REVOKE) (.+?) ON (.+)$/)
  if (!m || !/\bMAINTAIN\b/.test(m[2])) return l
  const privs = m[2].split(',').filter((p) => p.trim() !== 'MAINTAIN')
  return privs.length ? `${m[1]} ${privs.join(',')} ON ${m[3]}` : `-- (sin MAINTAIN en la 16) ${l}`
}

const SECRETOS = [
  ['un JWT (anon, service_role o de usuario)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['una clave de Stripe', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/],
  ['un secreto de webhook de Stripe', /\bwhsec_[A-Za-z0-9]{10,}/],
  ['una URL con usuario y contraseña', /\b(postgres(ql)?|mysql|https?):\/\/[^\s:/@'"]+:[^\s@'"]+@/],
  ['una clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['una clave de AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['un token Bearer escrito', /\bBearer\s+[A-Za-z0-9._-]{24,}/],
  ['una clave de Supabase nueva', /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/],
  // W10 (Julio, 28/10): los secretos internos de Folvy, como el de
  // order-advance: «fv_<para qué>_<16 o más letras y números>». No confunde los
  // nombres de función que empiezan igual (fv_e164_or_null): después del
  // segundo «_» no viene una tira larga sin «_».
  ['un secreto interno de Folvy (fv_…)', /\bfv_[a-z0-9]+_[A-Za-z0-9]{16,}\b/],
]

/**
 * El `role` de un JWT, leyendo solo su cabecera de datos (sin comprobar la
 * firma), o null si no se puede leer.
 */
export function rolDelJwt(jwt) {
  try {
    const datos = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(datos, 'base64').toString('utf8')).role ?? null
  } catch { return null }
}

/**
 * Los sitios del volcado con pinta de secreto: [{ linea, que }]. Un JWT de rol
 * `anon` NO es secreto: es la clave pública que va dentro del front (28/10:
 * tg_auto_dispatch lleva una escrita). Cualquier otro (service_role, el de un
 * usuario, uno que no se puede leer) sí.
 */
export function buscarSecretos(texto) {
  const fuera = []
  texto.split('\n').forEach((l, i) => {
    for (const [que, re] of SECRETOS) {
      if (!re.test(l)) continue
      if (re === SECRETOS[0][1]) {
        const jwts = l.match(new RegExp(re.source, 'g')) ?? []
        const roles = jwts.map(rolDelJwt)
        if (roles.every((r) => r === 'anon')) continue
        fuera.push({ linea: i + 1, que: `${que}: rol ${roles.filter((r) => r !== 'anon').map((r) => r ?? 'ilegible').join(', ')}` })
        continue
      }
      fuera.push({ linea: i + 1, que })
    }
  })
  return fuera
}

/**
 * Los roles que nombra el volcado (sin PUBLIC ni CURRENT_USER), solo en las
 * sentencias que nombran roles —GRANT, REVOKE, ALTER DEFAULT PRIVILEGES y
 * CREATE POLICY—, no en los cuerpos de las funciones (donde «FROM x» es una
 * tabla).
 */
export function rolesDelVolcado(texto) {
  const roles = new Set()
  const nombre = '("[^"]+"|[a-z_][a-z0-9_]*)'
  const pon = (r) => { const n = r.trim().replace(/^"|"$/g, ''); if (n && !/^(public|current_user|session_user|current_role)$/i.test(n)) roles.add(n) }
  const lista = (t) => t.split(',').map((x) => x.trim().replace(/;$/, '')).filter((x) => new RegExp(`^${nombre}$`, 'i').test(x)).forEach(pon)
  for (const l of texto.split('\n')) {
    let m
    if ((m = l.match(/^GRANT .* TO (.+?)( WITH (GRANT|ADMIN) OPTION)?;$/))) lista(m[1])
    else if ((m = l.match(/^REVOKE .* FROM (.+?)( CASCADE)?;$/))) lista(m[1])
    if ((m = l.match(new RegExp(`^ALTER DEFAULT PRIVILEGES FOR ROLE ${nombre}`)))) pon(m[1])
    if ((m = l.match(/^ALTER DEFAULT PRIVILEGES .* TO (.+?);$/))) lista(m[1])
    if (/^CREATE POLICY /.test(l) && (m = l.match(/ TO ([^;]+?)(?: USING| WITH CHECK|;|$)/))) lista(m[1])
  }
  return [...roles].sort()
}

/**
 * W09 · opción (a): la lista de scripts/staging/catalogos.txt. Una línea por
 * tabla, «esquema.tabla | filtro | columnas | por qué». Se valida aquí para que
 * el volcado no pueda llevarse filas de una cuenta por un descuido:
 *   · el filtro solo puede ser vacío o «account_id is null»;
 *   · sin porqué, no entra;
 *   · auth, vault, storage y las tablas de cuentas y personas, nunca.
 */
export const NUNCA = /^(auth|vault|storage|net|cron)\.|^public\.(accounts|user_profiles|employees|platform_admins|platform_audit_log|security_audit_log|conta_contrasena_intento|tax_certificate|tax_certificate_grant)$/
export function leerCatalogos(texto) {
  const filas = []
  const errores = []
  texto.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (!t || t.startsWith('#')) return
    const partes = t.split('|').map((x) => x.trim())
    const [tabla, filtro = '', columnas = '', ...resto] = partes
    const porque = resto.join('|').trim()
    const donde = `línea ${i + 1} (${tabla})`
    if (partes.length < 4) { errores.push(`${donde}: hacen falta 4 campos separados por «|»`); return }
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(tabla)) errores.push(`${donde}: «esquema.tabla» en minúscula`)
    if (NUNCA.test(tabla)) errores.push(`${donde}: esa tabla no se vuelca nunca (cuentas, personas o secretos)`)
    if (filtro && filtro !== 'account_id is null') errores.push(`${donde}: el filtro solo puede ser vacío o «account_id is null»`)
    if (columnas && !/^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/.test(columnas)) errores.push(`${donde}: columnas separadas por comas`)
    if (!porque) errores.push(`${donde}: falta el porqué`)
    if (filas.some((f) => f.tabla === tabla)) errores.push(`${donde}: repetida`)
    filas.push({ tabla, filtro, columnas: columnas ? columnas.split(',').map((c) => c.trim()) : [], porque })
  })
  return { filas, errores }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [orden, ...args] = process.argv.slice(2)
  if (orden === 'limpiar') {
    const [entrada, salida, opcion] = args
    writeFileSync(salida, limpiarVolcado(readFileSync(entrada, 'utf8'), { para16: opcion === '--para-16' }))
  } else if (orden === 'secretos') {
    const hallados = buscarSecretos(readFileSync(args[0], 'utf8'))
    if (hallados.length) {
      for (const h of hallados.slice(0, 20)) console.error(`✗ línea ${h.linea}: ${h.que}`)
      console.error(`✗ ${hallados.length} sitios con pinta de secreto en ${args[0]}: NO se publica.`)
      process.exit(1)
    }
    console.log('Sin nada con pinta de secreto.')
  } else if (orden === 'catalogos') {
    // Para el workflow: una línea por tabla, «tabla|filtro|columnas» (con «|»: un tabulador vacío se lo come el read de bash).
    const { filas, errores } = leerCatalogos(readFileSync(args[0], 'utf8'))
    if (errores.length) { for (const e of errores) console.error(`✗ ${e}`); process.exit(1) }
    process.stdout.write(filas.map((f) => [f.tabla, f.filtro, f.columnas.join(',')].join('|')).join('\n') + '\n')
  } else if (orden === 'roles') {
    process.stdout.write(rolesDelVolcado(readFileSync(args[0], 'utf8')).join('\n') + '\n')
  } else {
    console.error('Uso: esquema.mjs limpiar <entrada> <salida> [--para-16] | secretos <fichero> | roles <fichero> | catalogos <lista>'); process.exit(1)
  }
}
