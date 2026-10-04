#!/usr/bin/env node
// scripts/conta/normativa-aviso.mjs
//
// Agente «Normativa al día» (C00 §9.2), segunda mitad: lee lo que dejó
// `fuentes.mjs comparar` (docs/conta/fuentes/cambios.md) y lo separa en lo
// NUEVO y lo YA SABIDO (docs/conta/fuentes/sabido.json, cada cosa con su
// motivo y su fecha). El informe enseña las dos cosas; solo lo nuevo abre un
// aviso (sale con código 1). Regla 7: el umbral decide lo que interrumpe, no
// lo que existe.
//
//   node scripts/conta/normativa-aviso.mjs [informe.md]

import { readFileSync, writeFileSync } from 'node:fs'

const salida = process.argv[2] ?? 'informe-normativa.md'
const cambios = readFileSync('docs/conta/fuentes/cambios.md', 'utf8')
const fuentes = JSON.parse(readFileSync('docs/conta/fuentes/fuentes.json', 'utf8')).fuentes
const sabido = JSON.parse(readFileSync('docs/conta/fuentes/sabido.json', 'utf8')).sabido

// Cada cambio es un bloque que empieza por «- **Nombre de la fuente**».
const bloques = cambios.split(/\n(?=- \*\*)/).filter((b) => b.startsWith('- **'))
const cabecera = cambios.split('\n')[0]
const nombreDe = (b) => b.match(/^- \*\*(.+?)\*\*/)?.[1] ?? ''
const sabidoDe = (b) => {
  const f = fuentes.find((x) => x.nombre === nombreDe(b))
  return f ? sabido.find((s) => s.clave === f.clave) : undefined
}

const nuevos = bloques.filter((b) => !sabidoDe(b))
const viejos = bloques.filter((b) => sabidoDe(b))
const l = [cabecera, '']
if (bloques.length === 0) l.push('Ninguna fuente ha cambiado desde la última descarga, y todas se han podido comprobar.', '')
if (nuevos.length) {
  l.push(`**${nuevos.length === 1 ? 'Una novedad' : `${nuevos.length} novedades`}.** No se ha cambiado nada en Folvy: hay que revisarlo y, si toca, cargar los valores nuevos con su referencia.`, '')
  l.push(...nuevos.map((b) => b.trim()), '')
} else if (bloques.length) {
  l.push('**Nada nuevo.** Lo que sigue ya estaba avisado y apuntado como pendiente.', '')
}
if (viejos.length) {
  l.push(`## Ya sabido · ${viejos.length}`, '', 'Sigue pasando; ya está apuntado y no abre otro aviso. Se quita de `docs/conta/fuentes/sabido.json` cuando se arregle.', '')
  for (const b of viejos) {
    const s = sabidoDe(b)
    l.push(`- **${nombreDe(b)}**, desde el ${s.desde}: ${s.por}`)
  }
  l.push('')
}
// Las órdenes de los modelos anuales que se vigilan una a una (respuesta 3 del
// C00, punto 4): 180, 190, 200 y 347. Cada una, con la orden que tenemos y si
// es la que vale. El 200 se aprueba cada año: se mira de qué ejercicio es.
const registro = JSON.parse(readFileSync('docs/conta/fuentes/registro.json', 'utf8')).fuentes
const VIGILADAS = [['180', 'orden-modelo-180'], ['190', 'orden-modelo-190'], ['200', 'orden-modelo-200'], ['347', 'orden-modelo-347']]
const anoActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date()))
l.push('## Las órdenes de los modelos anuales', '')
for (const [modelo, clave] of VIGILADAS) {
  const r = registro[clave]
  if (!r || r.http !== 200) { l.push(`- **${modelo}**: la orden no se ha podido descargar del BOE.`); continue }
  const titulo = String(r.titulo).replace(/,? por la que .*/, '')
  const ejercicio = Number((String(r.titulo).match(/iniciados entre el 1 de enero y el 31 de diciembre de (\d{4})/) ?? [])[1])
  if (modelo === '200' && (!ejercicio || ejercicio < anoActual - 1)) {
    l.push(`- **${modelo}**: ${titulo}, que es la del ejercicio ${ejercicio || '¿?'}. La del ejercicio vigente no está en la base consolidada del BOE: pendiente, se busca a mano.`)
  } else {
    l.push(`- **${modelo}**: ${titulo}${ejercicio ? `, ejercicio ${ejercicio}` : ''}. Comprobada en el BOE el ${String(r.fecha ?? '').slice(0, 10) || 'día de la última descarga'}.`)
  }
}
l.push('')
const texto = l.join('\n')
writeFileSync(salida, texto)
console.log(texto)
process.exitCode = nuevos.length ? 1 : 0
