// tests/unit/demo/salidas.ts
//
// DM1 · PR 2a (31/10/2026) · Qué funciones del servidor hablan con fuera, sin
// red: se lee el código. Lo usa tests/unit/demo/puerta.test.ts.
//
// Una función «sale fuera» si ella, o una pieza de _shared que importa (y las
// que esa importa), lleva escrita la dirección de un servidor de fuera, habla
// con Diez o con el banco (que leen su dirección de una variable de entorno),
// o manda un correo (send-email). Las líneas de comentario no cuentan.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

export const RAIZ = resolve(__dirname, '../../..')
const FUNCIONES = join(RAIZ, 'supabase/functions')

/** Servidores que son nuestros (o de documentación): no son «fuera». */
const NUESTROS = /(^|\.)(supabase\.co|supabase\.com|localhost|example\.(com|org)|folvy\.app|folvy\.es|sumied\.com|github\.com|deno\.land|esm\.sh|jsr\.io|w3\.org|schema\.org|npmjs\.com)$/

/** Piezas de _shared que salen fuera sin llevar la dirección escrita. */
const SALEN_SIN_DIRECCION = ['diezCliente.ts', 'bancoAgregador.ts']

function codigo(f: string): string {
  return readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

function hostsDe(texto: string): string[] {
  return [...texto.matchAll(/https:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1].toLowerCase()).filter((h) => !NUESTROS.test(h))
}

function importsDe(f: string): string[] {
  const t = readFileSync(f, 'utf8')
  return [...t.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => resolve(dirname(f), m[1])).filter((x) => existsSync(x))
}

function ficherosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return ficherosDe(p)
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : []
  })
}

export interface Salida { funcion: string; por: string[]; puerta: boolean }

/** Cada función del servidor que sale fuera, con por qué (servidores, Diez, banco, correo) y si pasa por la puerta. */
export function salidas(): Salida[] {
  const nombres = readdirSync(FUNCIONES).filter((n) => !n.startsWith('_') && statSync(join(FUNCIONES, n)).isDirectory())
  const res: Salida[] = []
  for (const n of nombres) {
    const vistos = new Set<string>()
    const pila = ficherosDe(join(FUNCIONES, n))
    const por = new Set<string>()
    let puerta = false
    while (pila.length) {
      const f = pila.pop()!
      if (vistos.has(f)) continue
      vistos.add(f)
      const t = codigo(f)
      hostsDe(t).forEach((h) => por.add(h))
      if (/functions\/v1\/send-email|['"`]send-email['"`]/.test(t) && n !== 'send-email') por.add('correo (send-email)')
      const base = f.split('/').pop()!
      if (f.includes('/_shared/') && SALEN_SIN_DIRECCION.includes(base)) por.add(base === 'diezCliente.ts' ? 'Diez' : 'el banco')
      if (f.endsWith('/_shared/puerta.ts')) puerta = true
      importsDe(f).forEach((x) => pila.push(x))
    }
    if (por.size) res.push({ funcion: n, por: [...por].sort(), puerta })
  }
  return res.sort((a, b) => a.funcion.localeCompare(b.funcion))
}

/** Las funciones del servidor a las que llama la base (migraciones: funciones, disparadores y tareas). */
export function llamadasDesdeLaBase(): string[] {
  const dir = join(RAIZ, 'supabase/migrations')
  const s = new Set<string>()
  for (const n of readdirSync(dir)) {
    if (!n.endsWith('.sql')) continue
    for (const m of readFileSync(join(dir, n), 'utf8').matchAll(/functions\/v1\/([a-z0-9-]+)/g)) s.add(m[1])
  }
  return [...s].filter((x) => existsSync(join(FUNCIONES, x))).sort()
}

export const relativo = (f: string) => relative(RAIZ, f)
