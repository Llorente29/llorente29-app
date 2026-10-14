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
  // D01 R4 · Las dos que no están consolidadas: su texto publicado en el BOE del día.
  for (const c of PUBLICADAS) {
    const f = registro[c.fuente]
    if (!f) throw new Error(`${c.fuente} no está en registro.json`)
    const texto = trozo(readFileSync(`${FUENTES}/textos/${c.fuente}.txt`, 'utf8'), c)
    l.push(`## ${c.corto}`, '', `*Para qué:* ${c.usa}`, '',
      `*Fuente:* ${f.nombre} · texto publicado (no está consolidada) · [${f.url}](${f.url}) · sha256 del texto \`${String(f.sha256 ?? '').slice(0, 16)}…\``, '',
      ...(c.nota ? [`*Ojo:* ${c.nota}`, ''] : []),
      ...(c.notaCita ? [...trozo(readFileSync(`${FUENTES}/textos/${c.notaCita.fuente}.txt`, 'utf8'), c.notaCita).map((x) => `> ${x}`), '', `*La Orden:*`, ''] : []),
      ...texto.map((x) => `> ${x}`), '')
  }
  return l.join('\n')
}

/**
 * Lo que dice la pantalla de la digitalización (Julio, R4): sin software
 * homologado por la AEAT, el papel se conserva; nunca decimos que se pueda
 * tirar.
 */
const PUBLICADAS = [
  {
    fuente: 'orden-eha-962-2007', corto: 'Orden EHA/962/2007, art. 7.1 y 7.2', desde: /^Artículo 7\./, hasta: /^3\. Las entidades desarrolladoras/,
    usa: 'Prescindir del papel solo con digitalización certificada: software homologado por la AEAT, cada imagen firmada y la base de datos firmada al cierre de cada periodo. Folvy no lo es: la pantalla nunca dice que se pueda tirar el papel, y el PDF se guarda como copia.',
    nota: 'la Orden se dictó bajo el Real Decreto 1496/2003 (Reglamento de facturación), hoy sustituido por el Real Decreto 1619/2012. Sus remisiones a aquel se leen hechas a este, por la disposición adicional quinta del Real Decreto 1619/2012 (texto consolidado, en el mismo registro):',
    notaCita: { fuente: 'rd-1619-2012', frase: /^Las referencias hechas al Reglamento por el que se regulan las obligaciones de facturación aprobado por el Real Decreto 1496\/2003/ },
  },
  {
    fuente: 'resolucion-aeat-2007-10-24', corto: 'Resolución de la AEAT de 24/10/2007 (homologación)', frase: /software de digitalización certificado/,
    usa: 'Cómo se homologa ese software (y qué garantiza: imagen fiel e íntegra firmada y base de datos documental). Mientras Folvy no esté homologado, no hay digitalización certificada.',
  },
]

/** Las líneas de un artículo (de «desde» a «hasta», sin él), o la frase que casa. */
function trozo(texto, c) {
  const lineas = String(texto).split('\n')
  if (c.frase) {
    const frases = lineas.join(' ').split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])/)
    const f = frases.find((x) => c.frase.test(x))
    if (!f) throw new Error(`${c.fuente}: no está la frase ${c.frase}`)
    // Sin lo que el texto consolidado pone detrás («## [dasexta] ### versión …»).
    return [f.split(/\s+##\s/)[0].trim()]
  }
  const ini = lineas.findIndex((x) => c.desde.test(x.trim()))
  if (ini < 0) throw new Error(`${c.fuente}: no está ${c.desde}`)
  const fin = lineas.findIndex((x, i) => i > ini && c.hasta.test(x.trim()))
  if (fin < 0) throw new Error(`${c.fuente}: no está ${c.hasta}`)
  return lineas.slice(ini, fin).map((x) => x.trim()).filter(Boolean)
}

const md = escribir()
if (process.argv[2] === 'comprobar') {
  if (readFileSync('docs/conta/d01/norma.md', 'utf8') !== md) { console.error('norma.md no es lo que sale de los textos oficiales: node scripts/conta/d01/norma.mjs'); process.exit(1) }
  console.log('norma.md: igual a los textos oficiales.')
} else {
  writeFileSync('docs/conta/d01/norma.md', md)
  console.log(`norma.md: ${CITAS.length + PUBLICADAS.length} citas.`)
}
