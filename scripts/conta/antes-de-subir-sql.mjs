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
//   5. Lo que cuenta la tanda se toma ANTES de aplicarla, cuando sus tablas
//      nuevas aún no existen, y Postgres resuelve todas las tablas de una
//      consulta al analizarla, aunque vayan en la rama de un case que no se
//      toma. Una cuenta que nombra fuera de una cadena una tabla que crea la
//      propia tanda falla antes de empezar; va dentro de query_to_xml('…'),
//      que solo se analiza si se llama. (15/10, ensayo #89 de la E05:
//      «relation public.supplier_batch_store does not exist» a los 31 s.)
//   6. El orden dentro de cada fichero SQL de las dos tandas (producción y
//      staging) y de sus vueltas atrás: una función «language sql» o una vista
//      no lee una tabla o columna que el mismo fichero crea más abajo. Postgres
//      comprueba su cuerpo al crearla; en una base limpia falla, y en staging,
//      que ya las tiene de una pasada anterior, no se ve. (16/10, ensayo #92 de
//      la D01: 42703 en _conta_liquidacion_solape, que leía
//      channel_settlement.store_id antes de añadirlo. Staging, verde.)
//   7. Los nombres ambiguos en PL/pgSQL, en esos mismos ficheros (tanda y
//      vuelta atrás pasan el MISMO control): una variable, parámetro o columna
//      de «returns table» que se llama como una columna de una tabla que su
//      bloque nombra y se usa sin cualificar; y un «execute format('… select %s
//      from A a, B b …')» que rellena la lista con columnas sin cualificar.
//      Las dos paran con 42702 al EJECUTAR, no al crear. Las columnas salen de
//      src/types/database.ts y de lo que crean los propios ficheros. (16/10,
//      ensayo #103 de la D01: la vuelta atrás de la 0110 metía «id» sin
//      cualificar sobre la copia y el registro devuelto, que lo tienen los dos;
//      en staging no hay Foodint y la vuelta atrás salía sin hacer nada.)
//   8. Cada vuelta atrás de producción (supabase/produccion/vuelta-atras.txt)
//      la ejecuta de verdad («\i <fichero>») alguna prueba de staging
//      (supabase/staging/sql/*_prueba.sql), sobre datos, o dice por qué no con
//      «-- sin prueba con datos: …». Todas las pruebas de la carpeta, no solo
//      las del manifiesto de staging: el manifiesto de cada rama nombra lo suyo
//      y se vacía al fusionar, y la prueba sigue ahí (16/10: la de C06b, #215,
//      corrió en staging y no está en el manifiesto de main).
//      Una vuelta atrás que en staging no encuentra nada que deshacer no ha
//      ejecutado ni una de sus sentencias. Vale «\i» (desde la raíz) y «\ir»
//      (desde la carpeta de la prueba). La que ya estaba viva el 16/10 (B02 ·
//      T1) va nombrada en ANTES_DE_LA_REGLA_8.
// Sale con 1 si algo no cumple.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { posix } from 'node:path'
import { ordenEnElFichero, ambiguosEnPlpgsql, columnasConocidas } from './produccion/analizar.mjs'
import { carpetaDeTanda, ficherosDeTanda, ramaActual } from './produccion/tanda.mjs'
import { textoDelManifiesto } from './staging-tanda.mjs'

// C10 (23/10): la tanda de producción es la de la RAMA (supabase/produccion/tandas/<producto>/<rama>/),
// y el manifiesto de staging, el cerrado más las tandas de cada rama (staging-tanda.mjs).
const CARPETA_TANDA = carpetaDeTanda(process.env.TANDA || ramaActual())
const TANDA_APLICAR = CARPETA_TANDA ? ficherosDeTanda(CARPETA_TANDA).aplicar : null
const TANDA_VUELTA = CARPETA_TANDA ? ficherosDeTanda(CARPETA_TANDA).vueltaAtras : null
const lineasDe = (texto) => texto.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

const mal = []
{
  const pruebas = lineasDe(textoDelManifiesto()).filter((l) => /_prueba\.sql$/.test(l) && existsSync(l))
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
const tanda = TANDA_APLICAR
if (tanda && existsSync(tanda)) {
  const lineas = readFileSync(tanda, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lineas.some((l) => /^cuenta:\s*scripts\/conta\/produccion\/cuentas\/[A-Za-z0-9_-]+\.sql$/.test(l))) {
    mal.push(`${tanda}: no declara qué cuenta antes y después («cuenta: scripts/conta/produccion/cuentas/<f>.sql»)`)
  }
  const ficheros = lineas.filter((l) => !l.startsWith('cuenta:') && existsSync(l))
  const nuevas = new Set(ficheros.flatMap((f) => [...readFileSync(f, 'utf8').replace(/--.*$/gm, '').matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1].toLowerCase())))
  for (const c of lineas.filter((l) => l.startsWith('cuenta:')).map((l) => l.replace(/^cuenta:\s*/, ''))) {
    if (!existsSync(c)) { mal.push(`${tanda}: la cuenta ${c} no existe`); continue }
    // Sin comentarios ni cadenas: lo que queda es lo que Postgres analiza de entrada.
    const fuera = readFileSync(c, 'utf8').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
    for (const m of fuera.matchAll(/\b(?:from|join)\s+(?:public\.)?(\w+)/gi)) {
      if (nuevas.has(m[1].toLowerCase())) mal.push(`${c}: nombra ${m[1]}, que crea la propia tanda y aún no existe al contar ANTES; cuéntala con query_to_xml('…')`)
    }
  }
  for (const f of ficheros) {
    const t = readFileSync(f, 'utf8')
    const sinComentarios = t.replace(/--.*$/gm, '')
    if (/\bdelete\s+from\s+(public\.)?(journal_entry|sales_day_summary)\b/i.test(sinComentarios)
        && !/\bconta_proponer_dias\s*\(/.test(sinComentarios) && !/^--\s*sin hueco:\s*\S/m.test(t)) {
      mal.push(`${f}: retira asientos o resúmenes del día y no los rehace en el mismo fichero (conta_proponer_dias) ni dice por qué («-- sin hueco: …»)`)
    }
  }
}
const sqlDeLasTandas = new Set()
for (const texto of [TANDA_APLICAR, TANDA_VUELTA].filter((m) => m && existsSync(m)).map((m) => readFileSync(m, 'utf8')).concat(textoDelManifiesto())) {
  for (const l of texto.split('\n').map((x) => x.trim())) if (l && !l.startsWith('#') && !l.startsWith('cuenta:') && /\.sql$/.test(l) && existsSync(l)) sqlDeLasTandas.add(l)
}
for (const f of sqlDeLasTandas) {
  for (const x of ordenEnElFichero(readFileSync(f, 'utf8'))) {
    mal.push(`${f}: ${x.objeto} (sentencia ${x.sentencia}) lee ${x.lee}, que este fichero crea más abajo (sentencia ${x.nace}). En una base limpia falla al crearla (42703/42P01); staging no lo ve si ya la tiene. Créala antes.`)
  }
}
const textos = new Map([...sqlDeLasTandas].map((f) => [f, readFileSync(f, 'utf8')]))
const columnas = columnasConocidas(readFileSync('src/types/database.ts', 'utf8'), [...textos.values()])
for (const [f, t] of textos) {
  for (const x of ambiguosEnPlpgsql(t, (tabla) => columnas.get(tabla))) {
    mal.push(x.tipo === 'dinamico'
      ? `${f}: en ${x.bloque}, ${x.nombre} ${x.detalle}.`
      : `${f}: en ${x.bloque}, «${x.nombre}» es ${x.detalle}, y se usa sin cualificar: 42702 al ejecutarlo. Cámbiale el nombre (v_${x.nombre}).`)
  }
}
// La regla 8 es del 16/10. La vuelta atrás que ya estaba en el manifiesto vivo ese día, de una
// tanda ya aplicada (B02 · T1, la 0200), se queda como estaba: nombrada aquí, una por una, y
// ninguna más. La siguiente tanda de ese fichero ya cumple la regla.
const ANTES_DE_LA_REGLA_8 = new Set(['supabase/vuelta-atras/20261101T0200_b02_entrada.down.sql'])
const vueltas = TANDA_VUELTA
if (vueltas && existsSync(vueltas)) {
  // Lo que ejecuta cada prueba: «\i ruta» (desde la raíz, como corre el workflow) y «\ir ruta» (desde la carpeta de la prueba).
  const ejecutadas = new Set()
  const carpeta = 'supabase/staging/sql'
  if (existsSync(carpeta)) {
    for (const p of readdirSync(carpeta).filter((n) => /_prueba\.sql$/.test(n)).map((n) => `${carpeta}/${n}`)) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        const m = l.trim().match(/^\\(i|ir)\s+(\S+)\s*$/)
        if (m) ejecutadas.add(posix.normalize(m[1] === 'ir' ? posix.join(posix.dirname(p), m[2]) : m[2]))
      }
    }
  }
  for (const v of readFileSync(vueltas, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /\.sql$/.test(l))) {
    if (!existsSync(v)) continue
    if (ANTES_DE_LA_REGLA_8.has(v)) continue
    if (!ejecutadas.has(v) && !/^--\s*sin prueba con datos:\s*\S/m.test(readFileSync(v, 'utf8'))) {
      mal.push(`${v}: ninguna prueba de staging (supabase/staging/sql) la ejecuta («\\i ${v}») sobre datos, ni dice por qué no («-- sin prueba con datos: …»).`)
    }
  }
}
if (mal.length) { console.error(mal.map((m) => `✗ ${m}`).join('\n')); process.exit(1) }
console.log('Pruebas de staging como usuario, \\gset en su sitio, la tanda dice qué cuenta (sin tablas que aún no existen), no deja huecos, ninguna función SQL ni vista lee algo que su fichero crea después, ningún nombre es ambiguo en PL/pgSQL y cada vuelta atrás la ejecuta una prueba de staging.')
console.log('Lo que esto no ve, y se hace igual: el fichero ENTERO, no un trozo, y como usuario; lo prueba staging con la base real antes del real de producción.')
console.log('Y lo que el ensayo no ve (los agentes de después, la salud del pedido, lo que hacen otros procesos más tarde): un ensayo en verde no garantiza el real. Lo prueba staging con «real-con-fallo» y «real».')
