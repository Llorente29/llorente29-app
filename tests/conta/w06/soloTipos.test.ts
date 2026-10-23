// W06 · La comprobación de lo desplegado solo exige lo que Deno mete en el
// paquete. Un fichero que solo se importa con «import type» no se despliega:
// el 22/10 conta-lote-releer salió igual a main en sus 7 ficheros y la
// comprobación se puso en rojo por catcherTipos.ts, que no estaba (ni podía).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ficherosDeFuncion } from '../../../scripts/pr/importsDeFunciones.mjs'

describe('lo que va de verdad en lo desplegado', () => {
  it('conta-lote-releer: los 7 ficheros que quedaron desplegados el 22/10 (v1), sin catcherTipos.ts', () => {
    const r = 'supabase/functions/'
    expect(ficherosDeFuncion('conta-lote-releer', 'supabase/functions', { soloEjecucion: true }).map((f) => f.slice(r.length))).toEqual([
      '_shared/catcherCruces.ts', '_shared/catcherCuenta.ts', '_shared/catcherPdf.ts', '_shared/catcherReleer.ts',
      '_shared/euros.ts', '_shared/lecturaFactura.ts', 'conta-lote-releer/index.ts',
    ])
    // Para decidir qué redesplegar sí cuenta: cambiar un tipo de _shared redespliega a quien lo usa.
    expect(ficherosDeFuncion('conta-lote-releer')).toContain('supabase/functions/_shared/catcherTipos.ts')
  })
  it('import type y export type … from no cuentan; un import con algún valor, sí', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'w06-'))
    mkdirSync(join(raiz, 'f')); mkdirSync(join(raiz, '_shared'))
    for (const n of ['valor', 'mixto', 'tipo', 'reexporta', 'dinamico']) writeFileSync(join(raiz, '_shared', `${n}.ts`), 'export const x = 1\n')
    writeFileSync(join(raiz, 'f', 'index.ts'), [
      "import { a } from '../_shared/valor.ts'",
      "import { b, type B } from '../_shared/mixto.ts'",
      "import type { T } from '../_shared/tipo.ts'",
      "export type { R } from '../_shared/reexporta.ts'",
      "const d = await import('../_shared/dinamico.ts')",
    ].join('\n'))
    const de = (o?: { soloEjecucion: boolean }) => ficherosDeFuncion('f', raiz, o).map((f) => f.slice(raiz.length + 1))
    expect(de({ soloEjecucion: true })).toEqual(['_shared/dinamico.ts', '_shared/mixto.ts', '_shared/valor.ts', 'f/index.ts'])
    expect(de()).toHaveLength(6)
  })
})
