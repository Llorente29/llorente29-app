#!/usr/bin/env node
// scripts/e2e/area.mjs — qué pruebas corre la e2e de un PUSH, según la rama.
//
// W02 (17/10, gasto de Actions). La e2e de cada push corre solo las pruebas
// del área de la rama, en un trozo. La suite ENTERA no corre nunca en un push:
// solo a mano (workflow_dispatch con «pruebas» vacío), sobre el commit final.
// El 16/10 las e2e gastaron 2.953 min; cada push de una rama sin frente (las
// reparto-**, las conta/c00…c05, las conta/w*) corría la suite entera en 2
// trozos.
//
//   node scripts/e2e/area.mjs <rama>   → las pruebas, separadas por espacios
//
// El reparto:
//   · las de frente (A d*, B b*, C c06*/f*, D m*): su carpeta y el juego común;
//   · una conta/<x> cuya carpeta tests/e2e/conta/<x> existe (c02c, c04, cierre…):
//     esa carpeta (la más larga que casa) y el juego común;
//   · reparto-**: tests/e2e/reparto;
//   · cualquier otra (conta/w02-…, de herramientas): solo el juego común.
// Nunca vacío: vacío sería la suite entera.
//
// Y SIEMPRE la CORTA de pedidos, cocina y reparto (Julio, 19/10): «en cada PR,
// la e2e de la zona que toques y una e2e corta de pedidos, cocina y reparto».
// La entera ya no va en cada PR: corre cada noche sobre main
// (e2e-staging-conta.yml, «schedule») y antes de fusionar solo si el PR toca
// lo común (barra, cabecera, marco o el esqueleto).

import { existsSync, readdirSync } from 'node:fs'

export const COMUN = ['tests/e2e/conta/c00/marco.spec.ts', 'tests/e2e/conta/rls.spec.ts']

/**
 * La e2e CORTA de pedidos, cocina y reparto (Julio, 19/10). Lo que cubre, hoy:
 *   · direccion-falta: Pedidos en el ordenador (/orders y el Despacho), el
 *     ticket de la bolsa, la tablet de cocina (/estacion, con «Listo») y el
 *     permiso por local entre tablets: 9 pruebas, 59,6 s;
 *   · quien-reparte: «Quién reparte» y la etiqueta de reparto en la cocina, y
 *     que la cuenta B no ve ni toca lo de A: 4 pruebas, 31,4 s.
 * 91 s de pruebas en los dos tamaños (tests/e2e/tiempos.json, la misma vara
 * que la entera). Lo que NO cubre, porque no hay e2e de ello: crear un pedido
 * y llevarlo por todos sus estados en cocina.
 */
export const CORTA = ['tests/e2e/reparto/direccion-falta.spec.ts', 'tests/e2e/reparto/quien-reparte.spec.ts']

/** Las de la zona y la corta, sin repetir (una carpeta ya incluye sus ficheros). */
export function conLaCorta(pruebas) {
  const dentro = (f) => pruebas.some((p) => f === p || f.startsWith(`${p.replace(/\/$/, '')}/`))
  return [...pruebas, ...CORTA.filter((f) => !dentro(f))]
}

/** Las carpetas de tests/e2e/conta (b01, c02c, cierre…). */
export function carpetasConta(dir = 'tests/e2e/conta') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
}

export function pruebasDelPush(rama, carpetas = carpetasConta()) {
  return conLaCorta(pruebasDeLaZona(rama, carpetas))
}

/** Solo las de la zona de la rama (sin la corta). */
export function pruebasDeLaZona(rama, carpetas = carpetasConta()) {
  const r = String(rama ?? '')
  // Sin repetir: conta/c00 ya lleva marco.spec.ts dentro.
  const con = (c) => [`tests/e2e/conta/${c}`, ...COMUN.filter((f) => !f.startsWith(`tests/e2e/conta/${c}/`))]
  if (/^reparto-/.test(r)) return ['tests/e2e/reparto']
  if (/^conta\/b\d/.test(r)) return con('b01')   // B01, B02…: las pantallas de Bancos viven en b01
  if (/^conta\/d\d/.test(r)) return con('d01')
  if (/^conta\/(c06|f\d)/.test(r)) return con('c06')
  if (/^conta\/m\d/.test(r)) return con('m01')
  const m = /^conta\/([a-z0-9]+)/.exec(r)
  if (m) {
    // La carpeta más larga que es principio del nombre: conta/c02c-traer → c02c, no c02.
    const c = carpetas.filter((x) => m[1].startsWith(x)).sort((a, b) => b.length - a.length)[0]
    if (c) return con(c)
  }
  return [...COMUN]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = pruebasDelPush(process.argv[2])
  if (!p.length) { console.error('area.mjs: sin pruebas (sería la suite entera)'); process.exit(1) }
  console.log(p.join(' '))
}
