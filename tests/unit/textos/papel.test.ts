// tests/unit/textos/papel.test.ts
//
// Regla de Julio (21/10): nunca «papel» ni «papeles» en lo que ve alguien.
// Cada documento se llama por lo que es (albarán, factura…); si agrupa varios,
// se dicen; si no se sabe, «documento». En Contactos era el rol: «como
// cliente, plataforma o socio». Solo queda fuera el papel impreso de la
// impresora (scripts/textos/papel.mjs, IMPRESO).
//
// El detector se prueba contra los textos REALES que había en main antes de
// la limpieza (regla 31), no contra ejemplos inventados: si deja de verlos,
// la prueba de la app entera en verde no valdría nada.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IMPRESO, papelEnLaApp, textosDe } from '../../../scripts/textos/papel.mjs'
import { cuantosDocumentos, elDocumento, verDocumentos } from '@/modules/conta/lib/compras'

/**
 * El fichero tal como estaba antes de la limpieza: copia de main en 6595a15f,
 * en fixtures/antes (con .txt, para que no lo compile nadie ni lo mire el detector).
 */
const antes = (f: string) => readFileSync(`tests/unit/textos/fixtures/antes/${f.replace(/^.*\//, '')}.txt`, 'utf8')

describe('nunca «papel» en lo que se ve', () => {
  it('ningún texto de la app dice «papel» (salvo el papel impreso de la impresora)', () => {
    const r = papelEnLaApp()
    expect(r.map((x) => `${x.fichero}:${x.linea} ${x.texto}`)).toEqual([])
  }, 30_000) // lee todo src: con margen en una máquina lenta

  it('el detector ve los textos que había: «Ver el papel», «Ver los 2 papeles», el rol de Contactos…', () => {
    const qm = textosDe(antes('src/modules/conta/compras/QueMirar.tsx'), 'QueMirar.tsx').map((x) => x.texto)
    // Los dos del ejemplo de Julio: «Ver los N papeles» (texto JSX suelto) y «Ver el papel» (VerPapel).
    expect(qm).toContain('papeles')
    expect(qm).toContain('Un papel va')
    expect(qm.length).toBeGreaterThanOrEqual(14)
    expect(textosDe(antes('src/modules/conta/compras/VerPapel.tsx'), 'VerPapel.tsx').map((x) => x.texto)).toContain('Ver el papel')
    expect(textosDe(antes('src/modules/conta/terceros/TercerosPage.tsx'), 'TercerosPage.tsx').map((x) => x.texto))
      .toEqual(expect.arrayContaining(['Papeles', 'Añadirle el papel de cliente', 'No se pudo añadir el papel.']))
  })

  it('no confunde un nombre con una palabra: claves, clases, columnas, tipos y comentarios', () => {
    const codigo = [
      "// Ver el papel: un comentario no se ve",
      "const a = 'papel_y_ficha'; const b = 'sin_papel'; const c = `${id}:papel:${x}`",
      "const d = <span className=\"cxt-papeles\">{x.papel}</span>",
      "const e = tabla('m').select('brand_id, papel, company_account_id')",
      "type F = Pick<Factura, 'papel'>",
      "import { VerPapel } from './VerPapel'",
    ].join('\n')
    expect(textosDe(codigo, 'x.tsx')).toEqual([])
  })

  it('sí ve «papel» suelto cuando puede ser una palabra que se ve', () => {
    const codigo = "const t = n === 1 ? 'papel' : 'papeles'\nconst j = <b>Ver los {n} papeles</b>\nconst k = `Sin ${'x'} papel`"
    expect(textosDe(codigo, 'x.tsx').map((x) => x.texto)).toEqual(['papel', 'papeles', 'papeles', 'papel'])
  })

  it('solo queda fuera el papel impreso: tres frases de impresora, y cada una sigue existiendo', () => {
    expect(IMPRESO).toHaveLength(3)
    const sitios = ['src/modules/printing/components/PrintersSettingsPage.tsx', 'src/modules/pase/PaseBoard.tsx', 'src/modules/pos/pages/TpvSalePage.tsx']
    for (const [i, f] of sitios.entries()) expect(IMPRESO[i].test(readFileSync(f, 'utf8').replace(/\s+/g, ' ')), f).toBe(true)
    // Un «papel» de documento en Cocina sí cuenta (la pantalla de recepciones, 21/10).
    expect(textosDe("const t = 'Total del papel'", 'x.tsx').map((x) => x.texto)).toEqual(['Total del papel'])
  })
})

describe('cada documento por lo que es', () => {
  it('uno: el albarán, la factura (también el albarán-factura), el documento si no se sabe', () => {
    expect(['albaran', 'factura', 'albaran_factura', 'ticket', null, 'otra cosa'].map(elDocumento))
      .toEqual(['el albarán', 'la factura', 'la factura', 'el ticket', 'el documento', 'el documento'])
  })

  it('varios: «Ver el albarán y la factura», «Ver los 2 albaranes» (los ejemplos de Julio)', () => {
    expect(`Ver ${verDocumentos(['albaran', 'factura'])}`).toBe('Ver el albarán y la factura')
    expect(`Ver ${verDocumentos(['albaran', 'albaran'])}`).toBe('Ver los 2 albaranes')
    expect(verDocumentos(['albaran', 'albaran', 'albaran_factura'])).toBe('los 2 albaranes y la factura')
    expect(verDocumentos([null, null])).toBe('los 2 documentos')
  })

  it('el recuento de una fila: «un albarán», «3 facturas», «2 albaranes y 1 factura»', () => {
    expect(cuantosDocumentos(['albaran'])).toBe('un albarán')
    expect(cuantosDocumentos(['factura', 'albaran_factura', 'factura'])).toBe('3 facturas')
    expect(cuantosDocumentos(['albaran', 'factura', 'albaran'])).toBe('2 albaranes y 1 factura')
    expect(cuantosDocumentos([null])).toBe('un documento')
  })
})
