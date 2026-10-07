#!/usr/bin/env node
// scripts/conta/agente-datos-maestros.mjs
//
// Agente de cumplimiento «Datos maestros e impuestos» (C00 §9.2). Corre cada
// noche en GitHub Actions contra staging-conta (workflow
// cumplimiento-nocturno-conta.yml):
//
//   psql "$STAGING_CONTA_DB_URL" -At -f scripts/conta/agente-datos-maestros.sql > bd.json
//   node scripts/conta/agente-datos-maestros.mjs bd.json informe.md
//
// C03: con un cuarto argumento, el volcado de agente-terceros.sql (clientes,
// plataformas y socios de marca). Sin él (antes del C03), esa parte no se mira
// y el informe lo dice.
//
// Lee el volcado de la base y docs/conta/referencia/serie.json, y escribe el
// informe en lenguaje normal. No cambia nada: si algo no cuadra, sale con
// código 1 y el workflow abre un aviso. La revisión vive en
// lib/datosMaestros.mjs (pura) y tiene sus pruebas fijas en
// tests/conta/cumplimiento/datosMaestros.test.ts.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { revisar, informe, TABLAS_FILA_A_FILA } from './lib/datosMaestros.mjs'
import { revisarCoherencia, informeCoherencia } from './lib/coherencia.mjs'
import { revisarTerceros, informeTerceros } from './lib/terceros.mjs'
import { anonimizar, informeAnonimo } from './lib/anonimo.mjs'

/** Los ficheros de las pantallas del módulo, para ver qué cuentas enseñan (respuesta 3, punto 3). */
function ficherosDe(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const r = join(dir, n)
    if (statSync(r).isDirectory()) out.push(...ficherosDe(r))
    else if (/\.(ts|tsx)$/.test(n)) out.push({ ruta: r.replace(/\\/g, '/'), texto: readFileSync(r, 'utf8') })
  }
  return out
}

const [, , rutaBd, rutaInforme = 'informe-datos-maestros.md', donde = 'staging-conta', rutaTerceros] = process.argv
if (!rutaBd) { console.error('Uso: node scripts/conta/agente-datos-maestros.mjs <volcado.json> [informe.md] [dónde]'); process.exit(2) }

const bd = JSON.parse(readFileSync(rutaBd, 'utf8'))
const ref = JSON.parse(readFileSync('docs/conta/referencia/serie.json', 'utf8'))
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const filasMiradas = Object.keys(TABLAS_FILA_A_FILA).reduce((n, t) => n + (bd.tablas[t]?.length ?? 0), 0)
  + Object.values(bd.recuentos ?? {}).reduce((n, v) => n + Number(v || 0), 0)

const hallazgos = revisar(bd, ref, hoy)
// Coherencia, no recuento (respuesta 3, punto 4): que lo que hay cumpla las normas.
const coherencia = revisarCoherencia(bd, { ficheros: ficherosDe('src/modules/conta'), hoy })
// C03: los terceros, si la base ya los tiene.
const t = rutaTerceros ? JSON.parse(readFileSync(rutaTerceros, 'utf8') || 'null') : null
const terceros = t ? revisarTerceros(t) : []
const empresasMiradas = (bd.empresas ?? []).filter((e) => e.completa).length
// En producción (CONTA_ANONIMO=1, lo pone su workflow): sin nombres ni conceptos.
const texto = process.env.CONTA_ANONIMO === '1'
  ? informeAnonimo('Datos maestros, coherencia y terceros', [
      ...anonimizar('datos maestros', hallazgos), ...anonimizar('coherencia', coherencia), ...anonimizar('terceros', terceros),
    ], { donde, hoy, mirado: `Mirados: ${filasMiradas} filas de serie, ${empresasMiradas} empresas, ${t?.terceros?.length ?? 0} terceros y ${t?.liquidaciones?.length ?? 0} liquidaciones.` })
  : informe(hallazgos, { donde, hoy, referencia: String(ref.generado_desde).slice(0, 10), filasMiradas })
    + '\n' + informeCoherencia(coherencia, { empresasMiradas })
    + '\n' + (t ? informeTerceros(terceros, { tercerosMirados: t.terceros?.length ?? 0, liquidacionesMiradas: t.liquidaciones?.length ?? 0 })
      : '## Clientes, plataformas y socios de marca\n\nEsta base aún no tiene los terceros del C03: no se miran.\n')
writeFileSync(rutaInforme, texto)
console.log(texto)
// Lo rojo abre aviso; lo ámbar sale en el informe y no interrumpe (regla 7).
process.exitCode = hallazgos.length || coherencia.some((x) => x.nivel === 'rojo') || terceros.some((x) => x.nivel === 'rojo') ? 1 : 0
