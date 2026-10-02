// Los nombres de cuenta que enseña el módulo (src/modules/conta/lib/pgc.ts)
// son, literales, los del cuadro de cuentas del PGC (RD 1514/2007) descargado
// del BOE. Si uno no está, o está escrito de otra forma, falla.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOMBRE_CUENTA_PGC } from '@/modules/conta/lib/pgc'

const texto = readFileSync('docs/conta/fuentes/textos/rd-1514-2007.txt', 'utf8')

describe('los nombres de cuenta del PGC son los del BOE', () => {
  for (const [cuenta, nombre] of Object.entries(NOMBRE_CUENTA_PGC)) {
    it(`${cuenta} · ${nombre}`, () => {
      expect(texto).toContain(`\n${cuenta}.\n${nombre}\n`)
    })
  }
})
