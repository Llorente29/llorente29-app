// S01d · El PDF de la factura expedida: lo que se decide en el cliente, contra
// lo que la base comprueba (las reglas se leen de las migraciones, no se copian).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  admitePdfExpedida, claseDeFichero, esExpedidaAMano, motivoExpedida, nombreExpedida, problemaDeFichero, rutaExpedida, tamano, textoAdjunta,
} from '@/modules/conta/lib/expedidaPdf'
import { tipoDeAsiento } from '@/modules/conta/lib/tipoAsiento'

const leer = (f: string) => readFileSync(resolve(__dirname, '../../../../../supabase/migrations', f), 'utf8')
const guardar = leer('20261122T0160_s01d_documento_expedida.sql')
const tabla = leer('20261021T0100_conta_documentos.sql')

// La regla del nombre (journal_entry_document.file_name) y la de la ruta (la RPC), tal cual están en la base.
const reglaNombre = new RegExp(/file_name ~ '([^']+)'/.exec(tabla)![1])
const reglaRuta = new RegExp(/substr\(p_ruta, length\(v_prefijo\) \+ 1\) !~ '([^']+)'/.exec(guardar)![1])
const reglaHuella = new RegExp(/p_sha256 !~ '([^']+)'/.exec(guardar)![1])

const CUENTA = '6f1c2a40-1111-4c3b-9a1e-0123456789ab'
const ASIENTO = '0b7e9d10-2222-4f00-8c2d-abcdefabcdef'
const HUELLA = 'a3f1'.repeat(16)

describe('S01d · qué asiento lleva el PDF de la expedida', () => {
  it('la cinta «Expedida» pone la serie que la base pide (1)', () => {
    expect(tipoDeAsiento('expedida')?.serie).toBe(1)
    expect(guardar).toContain("v_e.source_type <> 'manual' or v_e.series <> 1")
  })
  it('a mano y serie 1; se adjunta solo validado', () => {
    expect(esExpedidaAMano({ origen: 'manual', serie: 1, estado: 'borrador' })).toBe(true)
    expect(admitePdfExpedida({ origen: 'manual', serie: 1, estado: 'borrador' })).toBe(false)
    expect(admitePdfExpedida({ origen: 'manual', serie: 1, estado: 'propuesto' })).toBe(false)
    expect(admitePdfExpedida({ origen: 'manual', serie: 1, estado: 'anulado' })).toBe(false)
    expect(admitePdfExpedida({ origen: 'manual', serie: 1, estado: 'validado' })).toBe(true)
    expect(guardar).toContain("v_e.status <> 'validado'")
  })
  it('otra serie u otro origen no la lleva', () => {
    for (const a of [
      { origen: 'manual', serie: 2, estado: 'validado' }, { origen: 'manual', serie: 4, estado: 'validado' },
      { origen: 'sales_day', serie: 1, estado: 'validado' }, { origen: 'supplier_invoice', serie: 1, estado: 'validado' },
      { origen: 'reversal', serie: 1, estado: 'validado' },
    ]) {
      expect(esExpedidaAMano(a)).toBe(false)
      expect(admitePdfExpedida(a)).toBe(false)
    }
  })
})

describe('S01d · el fichero', () => {
  it('PDF y fotos JPG o PNG, por tipo o, sin tipo, por extensión', () => {
    expect(claseDeFichero('f.pdf', 'application/pdf')).toBe('pdf')
    expect(claseDeFichero('F-123.PDF', '')).toBe('pdf')
    expect(claseDeFichero('foto.jpg', 'image/jpeg')).toBe('image/jpeg')
    expect(claseDeFichero('foto.JPEG', '')).toBe('image/jpeg')
    expect(claseDeFichero('captura.png', 'image/png')).toBe('image/png')
    expect(claseDeFichero('IMG_0001.HEIC', 'image/heic')).toBeNull()
    expect(claseDeFichero('factura.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeNull()
    // El tipo manda sobre la extensión: un .pdf que el navegador dice que es otra cosa, no.
    expect(claseDeFichero('raro.pdf', 'text/plain')).toBeNull()
  })
  it('dice por qué no vale', () => {
    expect(problemaDeFichero('IMG_0001.HEIC', 'image/heic', 2000)).toBe('«IMG_0001.HEIC» no es un PDF ni una foto JPG o PNG.')
    expect(problemaDeFichero('vacia.pdf', 'application/pdf', 0)).toBe('«vacia.pdf» está vacío.')
    expect(problemaDeFichero('F-2026-118.pdf', 'application/pdf', 84211)).toBeNull()
  })
})

describe('S01d · la ruta y el nombre, contra la base', () => {
  it('la ruta es <cuenta>/<asiento>/<huella>.pdf y pasa la regla de la RPC', () => {
    const r = rutaExpedida(CUENTA, ASIENTO, HUELLA)
    expect(r).toBe(`${CUENTA}/${ASIENTO}/${HUELLA.slice(0, 16)}.pdf`)
    expect(reglaRuta.test(r.slice(`${CUENTA}/${ASIENTO}/`.length))).toBe(true)
    expect(reglaHuella.test(HUELLA)).toBe(true)
  })
  it('sin un sha256 de verdad no hay ruta', () => {
    expect(() => rutaExpedida(CUENTA, ASIENTO, 'abc')).toThrow('sha256')
    expect(() => rutaExpedida(CUENTA, ASIENTO, HUELLA.toUpperCase())).toThrow('sha256')
  })
  it('el nombre siempre pasa la regla de journal_entry_document.file_name', () => {
    const casos: [string, string][] = [
      ['Factura 2026-118.pdf', 'Factura-2026-118.pdf'],
      ['Fra. Señor Pérez nº 12.pdf', 'Fra.-Senor-Perez-n-12.pdf'],
      ['WhatsApp Image 2026-10-18 at 13.04.22.jpeg', 'WhatsApp-Image-2026-10-18-at-13.04.22.pdf'],
      ['captura.PNG', 'captura.pdf'],
      ['F_001.pdf', 'F_001.pdf'],
      ['ñññ.pdf', 'nnn.pdf'],
      ['€€€.pdf', 'factura.pdf'],
      ['.pdf', 'factura.pdf'],
      ['   ', 'factura.pdf'],
      ['factura (1).pdf', 'factura-1.pdf'],
    ]
    for (const [de, a] of casos) {
      expect(nombreExpedida(de)).toBe(a)
      expect(reglaNombre.test(nombreExpedida(de))).toBe(true)
    }
    const largo = nombreExpedida(`${'x'.repeat(300)}.pdf`)
    expect(largo.length).toBeLessThanOrEqual(104)
    expect(reglaNombre.test(largo)).toBe(true)
  })
})

describe('S01d · lo que dice la pantalla', () => {
  it('con el nombre del fichero (regla 8)', () => {
    expect(textoAdjunta('Factura-123.pdf', false)).toBe('Factura adjunta: Factura-123.pdf.')
    expect(textoAdjunta('Factura-123.pdf', true)).toBe('La factura ya estaba adjunta: Factura-123.pdf.')
  })
  it('el motivo de la base, sin el nombre de la función ni el punto', () => {
    expect(motivoExpedida('conta_documento_expedida_guardar: Ese asiento ya tiene su factura (guardada el 18/10/2026 13:04 por Julio): no se cambia.'))
      .toBe('Ese asiento ya tiene su factura (guardada el 18/10/2026 13:04 por Julio): no se cambia')
    expect(motivoExpedida('no se ha podido subir el PDF (The resource already exists)')).toBe('no se ha podido subir el PDF (The resource already exists)')
  })
  it('el tamaño, legible', () => {
    expect(tamano(500)).toBe('1 KB')
    expect(tamano(84211)).toBe('82 KB')
    expect(tamano(5 * 1024 * 1024)).toBe('5 MB')
  })
})
