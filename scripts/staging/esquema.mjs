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
  }).join('\n')
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
]

/** Los sitios del volcado con pinta de secreto: [{ linea, que }]. */
export function buscarSecretos(texto) {
  const fuera = []
  texto.split('\n').forEach((l, i) => {
    for (const [que, re] of SECRETOS) if (re.test(l)) fuera.push({ linea: i + 1, que })
  })
  return fuera
}

/** Los roles que nombra el volcado (sin PUBLIC ni CURRENT_USER). */
export function rolesDelVolcado(texto) {
  const roles = new Set()
  const nombre = '("[^"]+"|[a-z_][a-z0-9_]*)'
  const pon = (r) => { const n = r.replace(/^"|"$/g, ''); if (!/^(public|current_user|session_user|current_role)$/i.test(n)) roles.add(n) }
  for (const m of texto.matchAll(new RegExp(`\\b(?:TO|FROM)\\s+${nombre}((?:\\s*,\\s*${nombre})*)`, 'g'))) {
    pon(m[1]); for (const otro of (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) pon(otro)
  }
  for (const m of texto.matchAll(new RegExp(`\\bFOR ROLE\\s+${nombre}`, 'g'))) pon(m[1])
  for (const m of texto.matchAll(new RegExp(`\\bOWNER TO\\s+${nombre}`, 'g'))) pon(m[1])
  return [...roles].sort()
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
      console.error(`✗ ${hallados.length} sitios con pinta de secreto: NO se publica la estructura.`)
      process.exit(1)
    }
    console.log('Sin nada con pinta de secreto.')
  } else if (orden === 'roles') {
    process.stdout.write(rolesDelVolcado(readFileSync(args[0], 'utf8')).join('\n') + '\n')
  } else {
    console.error('Uso: esquema.mjs limpiar <entrada> <salida> [--para-16] | secretos <fichero> | roles <fichero>'); process.exit(1)
  }
}
