#!/usr/bin/env node
// scripts/conta/antes-de-subir-sql.mjs
//
// Paso 7 de antes-de-subir.sh (C04b R7, regla de Julio del 13/10): «se prueba
// el fichero ENTERO y COMO USUARIO, nunca un trozo ni como superusuario».
// Lo que se puede comprobar sin base de datos, se comprueba:
//   1. Cada prueba de staging del manifiesto (supabase/staging/aplicar.txt,
//      los *_prueba.sql) entra como usuario —«set local role authenticated»—
//      o dice por qué no con una línea «-- sin usuario: …». (R6: la 0100 quitó
//      un permiso a authenticated y el Libro diario no abría; la prueba corría
//      como superusuario y no lo vio.)
//   2. En los SQL de los agentes (scripts/conta/agente-*.sql) un «\gset» de
//      psql va en su propia sentencia, empezando por «select», nunca dentro de
//      otra. (R6: un \gset metido entre «with libro as (…)» y su select rompió
//      el agente entero; se había probado solo el trozo.)
//   3. R9 (Julio, 13/10) · «Un ensayo en verde no garantiza el real si la
//      comprobación de después mira algo que el ensayo no ve.» Lo que se puede
//      mirar sin base: la tanda de producción DECLARA qué cuenta antes y
//      después («cuenta: scripts/conta/produccion/cuentas/<f>.sql»), que es lo
//      que el ensayo de la vuelta atrás compara dentro de su transacción y
//      deshacer.sh tras una vuelta atrás automática. Lo demás (agentes, salud
//      del pedido, lo que hagan otros procesos después) el ensayo no lo ve, y
//      lo dice su informe.
//   4. R9 · «Una retirada nunca deja un hueco que tape otro proceso más tarde:
//      se rehace en la misma transacción.» Un fichero de la tanda que borra
//      asientos o resúmenes del día (journal_entry, sales_day_summary) los
//      vuelve a proponer en el mismo fichero (conta_proponer_dias) o dice por
//      qué no con una línea «-- sin hueco: …». (13/10: la 0130 retiraba los 24
//      y esperaba al cierre de los :07; la comprobación de después vio 22
//      días×local sin asiento y el real se deshizo.)
// Sale con 1 si algo no cumple.
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const mal = []
const manifiesto = 'supabase/staging/aplicar.txt'
if (existsSync(manifiesto)) {
  const pruebas = readFileSync(manifiesto, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /_prueba\.sql$/.test(l))
  for (const f of pruebas) {
    const t = readFileSync(f, 'utf8')
    if (!/^\s*set\s+local\s+role\s+authenticated\s*;/mi.test(t) && !/^--\s*sin usuario:\s*\S/m.test(t)) {
      mal.push(`${f}: no entra como usuario («set local role authenticated») ni dice por qué («-- sin usuario: …»)`)
    }
  }
}
for (const n of readdirSync('scripts/conta').filter((x) => /^agente-.*\.sql$/.test(x))) {
  const f = `scripts/conta/${n}`
  let buf = ''
  for (const [i, linea] of readFileSync(f, 'utf8').split('\n').entries()) {
    const l = linea.replace(/--.*$/, '')
    if (/\\gset\b/.test(l)) {
      const sentencia = (buf + ' ' + l.replace(/\\gset.*$/, '')).trim()
      if (!/^select\b/i.test(sentencia) || /\bwith\s+\w+\s+as\s*\(/i.test(sentencia)) mal.push(`${f}:${i + 1}: \\gset dentro de otra sentencia (empieza por «${sentencia.slice(0, 30)}…»)`)
      buf = ''
      continue
    }
    if (/^\s*\\/.test(l)) continue
    buf += ' ' + l
    if (/;\s*$/.test(l)) buf = ''
  }
}
const tanda = 'supabase/produccion/aplicar.txt'
if (existsSync(tanda)) {
  const lineas = readFileSync(tanda, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lineas.some((l) => /^cuenta:\s*scripts\/conta\/produccion\/cuentas\/[A-Za-z0-9_-]+\.sql$/.test(l))) {
    mal.push(`${tanda}: no declara qué cuenta antes y después («cuenta: scripts/conta/produccion/cuentas/<f>.sql»)`)
  }
  for (const f of lineas.filter((l) => !l.startsWith('cuenta:') && existsSync(l))) {
    const t = readFileSync(f, 'utf8')
    const sinComentarios = t.replace(/--.*$/gm, '')
    if (/\bdelete\s+from\s+(public\.)?(journal_entry|sales_day_summary)\b/i.test(sinComentarios)
        && !/\bconta_proponer_dias\s*\(/.test(sinComentarios) && !/^--\s*sin hueco:\s*\S/m.test(t)) {
      mal.push(`${f}: retira asientos o resúmenes del día y no los rehace en el mismo fichero (conta_proponer_dias) ni dice por qué («-- sin hueco: …»)`)
    }
  }
}
if (mal.length) { console.error(mal.map((m) => `✗ ${m}`).join('\n')); process.exit(1) }
console.log('Pruebas de staging como usuario, \\gset en su sitio, la tanda dice qué cuenta y no deja huecos.')
console.log('Lo que esto no ve, y se hace igual: el fichero ENTERO, no un trozo, y como usuario; lo prueba staging con la base real antes del real de producción.')
console.log('Y lo que el ensayo no ve (los agentes de después, la salud del pedido, lo que hacen otros procesos más tarde): un ensayo en verde no garantiza el real. Lo prueba staging con «real-con-fallo» y «real».')
