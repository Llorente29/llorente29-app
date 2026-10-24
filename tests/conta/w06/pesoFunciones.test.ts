// W06 · Una función no puede llevar dentro un paquete que Supabase no admite.
// El 22/10 conta-lote-releer importaba npm:pdfjs-dist: el CLI metió el paquete
// entero (35 MB) y el despliegue cayó con 413 «request entity too large». Para
// leer PDF en el servidor, npm:unpdf (pdfjs preparado para servidor, 1,7 MB).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = 'supabase/functions'
const PESADOS = [/["']npm:pdfjs-dist[@/"']/]

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? ficheros(p) : /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : []
  })
}

describe('las funciones no llevan paquetes que no caben', () => {
  it('ninguna importa npm:pdfjs-dist (usa npm:unpdf)', () => {
    const malas = ficheros(RAIZ).filter((f) => PESADOS.some((r) => r.test(readFileSync(f, 'utf8'))))
    expect(malas).toEqual([])
  })
})
