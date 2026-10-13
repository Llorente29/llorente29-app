#!/usr/bin/env node
// scripts/conta/d01/norma.mjs
//
// D01 R2 punto 5 · docs/conta/d01/norma.md, escrito DESDE los textos oficiales
// de docs/conta/fuentes/textos/ (los baja fuentes-oficiales-conta.yml desde
// Actions, con su URL y su sha256 en registro.json). La cita es literal: la
// versión vigente del artículo, el apartado que se usa, y de dónde salió.
//
//   node scripts/conta/d01/norma.mjs            # escribe norma.md
//   node scripts/conta/d01/norma.mjs comprobar  # falla si norma.md no es lo que sale de los textos

import { readFileSync, writeFileSync } from 'node:fs'
import { apartados, articuloVigente } from '../lib/citarNorma.mjs'

const FUENTES = 'docs/conta/fuentes'
const registro = JSON.parse(readFileSync(`${FUENTES}/registro.json`, 'utf8')).fuentes

/** Lo que Folvy usa de cada norma, y dónde. */
const CITAS = [
  { fuente: 'rd-1619-2012', art: 6, ap: ['1'], corto: 'RD 1619/2012, art. 6.1', usa: 'Lo que tiene que traer una factura completa: número, fecha, NIF del emisor y del destinatario, base, tipo y cuota. La lectura dice cuál falta (`_shared/lecturaFactura.ts`).' },
  { fuente: 'rd-1619-2012', art: 7, ap: ['2'], corto: 'RD 1619/2012, art. 7.2', usa: 'El ticket (simplificada) solo deduce si trae el NIF y el domicilio del destinatario y la cuota aparte: por eso sale «probable», con su aviso.' },
  { fuente: 'rd-1619-2012', art: 15, ap: ['1', '2'], corto: 'RD 1619/2012, art. 15', usa: 'La rectificativa: «dice qué factura rectifica» (la lectura lo pide; sin él, duda).' },
  { fuente: 'ley-37-1992', art: 97, ap: ['Uno'], corto: 'Ley 37/1992, art. 97.Uno', usa: 'Sin la factura (completa) no se deduce el IVA: lo que no la trae no se apunta como seguro.' },
  { fuente: 'ley-37-1992', art: 99, ap: ['Tres'], corto: 'Ley 37/1992, art. 99.Tres', usa: 'Cuatro años para deducir: una factura de hace más de cuatro años sale en duda.' },
  { fuente: 'ley-37-1992', art: 161, ap: [], corto: 'Ley 37/1992, art. 161', usa: 'Los tipos del recargo de equivalencia: `RECARGO_POR_TIPO` (21 % → 5,2; 10 % → 1,4; 4 % → 0,5).' },
  { fuente: 'rd-1624-1992', art: 64, ap: ['1', '4'], corto: 'RD 1624/1992, art. 64.1 y 4', usa: 'El libro registro de facturas recibidas: numeradas y una por una, con lo que se anota de cada una.' },
  { fuente: 'codigo-comercio', art: 30, ap: ['1'], corto: 'Código de Comercio, art. 30.1', usa: 'Conservar la documentación seis años: el PDF se guarda en conta-documentos y no se borra.' },
  { fuente: 'ley-58-2003', art: 66, ap: [], corto: 'Ley 58/2003 (LGT), art. 66', usa: 'Cuatro años de prescripción: el plazo fiscal, dentro de los seis del Código de Comercio.' },
  { fuente: 'ley-3-2004', art: 4, ap: ['1', '3'], corto: 'Ley 3/2004, art. 4.1 y 4.3', usa: 'Sin plazo pactado, 30 días; pactado, nunca más de 60: un vencimiento a más de 60 días sale con aviso (C01b y D01).' },
]

function escribir() {
  const l = [
    '# D01 · La norma, citada literal desde la fuente oficial',
    '',
    'Escrito por `scripts/conta/d01/norma.mjs` desde los textos oficiales de',
    '`docs/conta/fuentes/textos/`, que baja `fuentes-oficiales-conta.yml` desde',
    'Actions (BOE, datos abiertos de legislación consolidada) con su sha256 en',
    '`registro.json`. De cada artículo, **la versión vigente** y el apartado que',
    'usa Folvy. Nada de memoria: si el texto no está, el guion falla.',
    '',
    '**Falta una:** la Orden EHA/962/2007 (digitalización certificada), que no',
    'estaba en `fuentes.json`. La añado allí; hasta que su texto llegue, la',
    'pantalla no dice que se pueda tirar el papel, que es lo prudente.',
    '',
  ]
  for (const c of CITAS) {
    const f = registro[c.fuente]
    if (!f) throw new Error(`${c.fuente} no está en registro.json`)
    const art = articuloVigente(readFileSync(`${FUENTES}/textos/${c.fuente}.txt`, 'utf8'), c.art, '2026-10-13')
    const texto = apartados(art, c.ap)
    l.push(`## ${c.corto}`, '', `*Para qué:* ${c.usa}`, '',
      `*Fuente:* ${f.nombre} · versión vigente desde ${art.desde} (${art.boe}) · [${f.url}](${f.url}) · sha256 del texto \`${String(f.sha256 ?? '').slice(0, 16)}…\``, '',
      ...texto.map((x) => `> ${x}`), '')
  }
  return l.join('\n')
}

const md = escribir()
if (process.argv[2] === 'comprobar') {
  if (readFileSync('docs/conta/d01/norma.md', 'utf8') !== md) { console.error('norma.md no es lo que sale de los textos oficiales: node scripts/conta/d01/norma.mjs'); process.exit(1) }
  console.log('norma.md: igual a los textos oficiales.')
} else {
  writeFileSync('docs/conta/d01/norma.md', md)
  console.log(`norma.md: ${CITAS.length} citas.`)
}
