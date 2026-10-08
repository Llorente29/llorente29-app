// C05 · El .zip de los documentos de un requerimiento. La comprobación no es
// la nuestra: es `unzip -t` (Info-ZIP), que lee el zip como lo leerá la AEAT.

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, crearZip, nombresUnicos } from '@/modules/conta/lib/zip'

const enc = new TextEncoder()

describe('zip sin compresión', () => {
  it('crc32 de la cadena de control del estándar', () => {
    expect(crc32(enc.encode('123456789')).toString(16)).toBe('cbf43926')
  })

  it('unzip lo da por bueno y devuelve los mismos bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zipc05-'))
    try {
      const pdf = new Uint8Array(3000).map((_, i) => (i * 37) % 256)
      const zip = crearZip([
        { nombre: 'F1 2026-0001.pdf', datos: pdf },
        { nombre: 'tique ñandú.txt', datos: enc.encode('hola') },
      ])
      const f = join(dir, 'docs.zip')
      writeFileSync(f, zip)
      const t = spawnSync('unzip', ['-t', f], { encoding: 'utf8' })
      expect(t.status, t.stdout + t.stderr).toBe(0)
      expect(t.stdout).toContain('No errors detected')
      const x = spawnSync('unzip', ['-o', '-d', join(dir, 'fuera'), f], { encoding: 'utf8' })
      expect(x.status).toBe(0)
      expect(Buffer.compare(readFileSync(join(dir, 'fuera', 'F1 2026-0001.pdf')), Buffer.from(pdf))).toBe(0)
      expect(readFileSync(join(dir, 'fuera', 'tique ñandú.txt'), 'utf8')).toBe('hola')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('un zip vacío también es un zip válido', () => {
    expect(crearZip([]).length).toBe(22)
  })

  it('nombres repetidos o con barras no se pisan', () => {
    expect(nombresUnicos(['a.pdf', 'A.pdf', 'x/y.pdf', ''])).toEqual(['a.pdf', 'A (2).pdf', 'x_y.pdf', 'documento'])
  })
})
