// tests/unit/modules/conta/k02/mapa.test.ts
//
// K02 · El mapa del núcleo (src/modules/conta/nucleo/mapa.ts). Regla 7: TODA
// pantalla de Sumied tiene sitio en el marco nuevo. Las pantallas salen del
// CÓDIGO (regla 31), no de una lista escrita aquí: cada ruta de module.tsx que
// va con marco (`enMarco`). Si alguien añade una pantalla y no la pone en el
// mapa, esta prueba sale en rojo y dice cuál.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTA, INDICE_AJUSTES } from '@/config/navegacion'
import { AREAS_LIBROS } from '@/modules/conta/libros/navegacion'
import { cintaVisible, MENU_PERSONA, menuPersonaVisible, MODULOS, modulosVisibles, nombreDePestana, sitioDe, TODOS_LOS_BOTONES } from '@/modules/conta/nucleo/mapa'
import { PRODUCTOS, pestanasVisibles } from '@/modules/conta/esqueleto/productos'
import type { Contexto } from '@/modules/conta/esqueleto/productos'

const R = CONTA.rutas as Record<string, string>
const MODULE = readFileSync('src/modules/conta/module.tsx', 'utf8')

/** Las claves de CONTA.rutas que module.tsx monta con marco (`enMarco(`), sacadas del fichero. */
function rutasConMarco(): string[] {
  const claves = new Set<string>()
  for (const linea of MODULE.split('\n')) {
    if (!linea.includes('enMarco(')) continue
    const m = /path:\s*(?:`\$\{)?CONTA\.rutas\.(\w+)/.exec(linea)
    if (m) claves.add(m[1])
  }
  return [...claves]
}

/** Direcciones de verdad para una ruta con parámetros: una por cada valor que existe. */
function direcciones(clave: string): string[] {
  const r = R[clave]
  if (clave === 'librosArea') return AREAS_LIBROS.map((a) => `libros/${a.id}`)
  if (clave === 'librosAccion') return AREAS_LIBROS.flatMap((a) => a.grupos.flatMap((g) => g.acciones.map((x) => `libros/${a.id}/${x.id}`)))
  if (clave === 'ajustesEntrada') return INDICE_AJUSTES.flatMap((g) => g.entradas.map((e) => e.ruta))
  if (clave === 'bancosPestana') return ['subir', 'hecho', 'reglas', 'cuentas', 'prestamos', 'cierre'].map((p) => `bancos/${p}`)
  if (clave === 'impuestosPestana') return ['trimestre', 'presentados', 'sociedades', 'certificados'].map((p) => `impuestos/${p}`)
  if (clave === 'laboralPagina') return (MODULOS.find((m) => m.id === 'personal')?.pestanas ?? []).flatMap((p) => p.grupos.flatMap((g) => g.botones.map((x) => x.ruta ?? '')))
  if (clave === 'clienteGestoria') return [`${r}/x`]
  return [r.replace(/:[A-Za-z_]+/g, 'x')]
}

const TODO: Contexto = {
  hosteleria: true, gestoria: true, diez: true, asesoria: true, demo: true, solo: false,
  interruptores: new Set(['conta_facturacion', 'conta_laboral', 'conta_impuestos']),
}
const NADA: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }

describe('K02 · el mapa del núcleo', () => {
  const claves = rutasConMarco()

  it('lee las pantallas de module.tsx (si no encuentra casi ninguna, la lectura está mal)', () => {
    expect(claves.length).toBeGreaterThan(50)
    expect(claves).toContain('revisarFactura')
    expect(claves).toContain('laboralPersona')
  })

  it('toda pantalla con marco tiene sitio en el mapa (regla 7)', () => {
    const sinSitio = claves.flatMap((c) => direcciones(c).filter((d) => sitioDe(d) === null).map((d) => `${c} (${d})`))
    expect(sinSitio, `Estas pantallas no tienen sitio en nucleo/mapa.ts: ${sinSitio.join(', ')}`).toEqual([])
  })

  it('Inicio es Inicio, y la puerta no (es Importaciones › Documentos)', () => {
    expect(sitioDe('inicio')).toEqual({ tipo: 'inicio' })
    expect(sitioDe('')).toEqual({ tipo: 'inicio' })
    const puerta = sitioDe(R.puerta)
    expect(puerta?.tipo === 'cinta' && [puerta.modulo.id, puerta.pestana.id, puerta.boton.id]).toEqual(['contabilidad', 'importaciones', 'documentos'])
  })

  it('una factura recibida es de Contabilidad › Asientos › Recibidas (donde la pone la maqueta)', () => {
    const s = sitioDe('documentos/recibidas/abc')
    expect(s?.tipo === 'cinta' && [s.modulo.id, s.pestana.id, s.boton.id]).toEqual(['contabilidad', 'asientos', 'recibidas'])
    expect(nombreDePestana(s)).toBe('Facturas recibidas')
  })

  it('un atajo solo se marca si la persona está en su módulo', () => {
    const desde = sitioDe('documentos', '', 'facturacion')
    expect(desde?.tipo === 'cinta' && desde.modulo.id).toBe('facturacion')
    const sin = sitioDe('documentos', '', 'personal')
    expect(sin?.tipo === 'cinta' && sin.modulo.id).toBe('contabilidad')
  })

  it('las vistas de Contactos van por su ?ver=', () => {
    const p = sitioDe(R.terceros, '?ver=proveedores')
    expect(p?.tipo === 'cinta' && p.boton.id).toBe('proveedores')
    const t = sitioDe(R.terceros)
    expect(t?.tipo === 'cinta' && t.boton.id).toBe('terceros')
  })

  it('Ajustes y Novedades van al menú de la persona; «Tu empresa» y «Ejercicio», a Definiciones › Empresa', () => {
    expect(sitioDe('ajustes/impuestos')?.tipo).toBe('persona')
    expect(sitioDe(R.novedades)?.tipo).toBe('persona')
    for (const d of ['ajustes', 'ajustes/empresa', 'ajustes/ejercicio']) {
      const s = sitioDe(d)
      expect(s?.tipo === 'cinta' && [s.pestana.id, s.boton.id.length > 0], d).toEqual(['definiciones', true])
    }
    // K03 · arreglo 2: Tu empresa y Ejercicio, ADEMÁS en el menú de la persona.
    expect(MENU_PERSONA.some((e) => e.id === 'ajustes.empresa')).toBe(true)
    expect(MENU_PERSONA.some((e) => e.id === 'ajustes.ejercicio')).toBe(true)
  })

  it('las palabras de la maqueta: la cinta de Contabilidad, en su orden', () => {
    const c = MODULOS.find((m) => m.id === 'contabilidad')
    expect(c?.pestanas.map((p) => p.etiqueta)).toEqual(['Definiciones', 'Asientos', 'Importaciones', 'Listados', 'Utilidades', 'Impuestos'])
    expect(MODULOS.map((m) => m.etiqueta)).toEqual(['Contabilidad', 'Facturación', 'Impuestos', 'Personal', 'Despacho'])
  })

  it('un botón sin pantalla detrás no sale (decisión 7): ni Amortización, ni Duplicadas, ni Borrado', () => {
    const etiquetas = TODOS_LOS_BOTONES.map((x) => x.etiqueta)
    for (const no of ['Amortización', 'Duplicadas', 'Borrado']) expect(etiquetas).not.toContain(no)
    expect(etiquetas).toContain('Apertura')
    // Y todo botón lleva a algún sitio: una dirección o una acción.
    expect(TODOS_LOS_BOTONES.filter((x) => !x.ruta && !x.accion).map((x) => x.id)).toEqual([])
  })

  it('cada botón con dirección lleva a una dirección que es suya o de su sitio (no a otra pantalla)', () => {
    const mal = TODOS_LOS_BOTONES.filter((x) => x.ruta && x.prefijos.length > 0).filter((x) => {
      const s = sitioDe(x.ruta!.split('?')[0], x.ruta!.includes('?') ? `?${x.ruta!.split('?')[1]}` : '')
      return !(s?.tipo === 'cinta' && s.boton.id === x.id)
    }).map((x) => x.id)
    expect(mal).toEqual([])
  })

  it('lo que pide algo de la empresa sale solo si lo tiene', () => {
    expect(modulosVisibles(TODO).map((m) => m.id)).toEqual(['contabilidad', 'facturacion', 'impuestos', 'personal', 'despacho'])
    expect(modulosVisibles(NADA).map((m) => m.id)).toEqual(['contabilidad', 'facturacion'])
    const conta = MODULOS[0]
    const sin = cintaVisible(conta, NADA, { produccion: true })
    expect(sin.map((p) => p.id)).toEqual(['definiciones', 'asientos', 'importaciones', 'listados', 'utilidades'])
    const botones = sin.flatMap((p) => p.grupos.flatMap((g) => g.botones.map((x) => x.id)))
    expect(botones).not.toContain('ventasDia')
    expect(botones).not.toContain('diez')
    expect(botones).not.toContain('diseno')
    expect(cintaVisible(conta, TODO).flatMap((p) => p.grupos.flatMap((g) => g.botones.map((x) => x.id)))).toContain('diseno')
  })
})

describe('K02 · Ventas del día sigue a la barra de hoy (R05, decisión 9)', () => {
  it('sale con hostelería o con «ventas por día» encendido', () => {
    const conta = MODULOS[0]
    const botones = (ctx: Contexto) => cintaVisible(conta, ctx).flatMap((p) => p.grupos.flatMap((g) => g.botones.map((x) => x.id)))
    const base: Contexto = { hosteleria: false, diez: false, interruptores: new Set() }
    expect(botones(base)).not.toContain('ventasDia')
    expect(botones({ ...base, ventasPorDia: true })).toContain('ventasDia')
    expect(botones({ ...base, hosteleria: true })).toContain('ventasDia')
  })
})

describe('K03 · el menú de la persona trae todo Ajustes de hoy (respuesta K02 · 2, arreglo 2)', () => {
  const ajustes = PRODUCTOS.find((p) => p.id === 'ajustes')!
  const casos: [string, Contexto][] = [
    ['con Folvy', { hosteleria: false, diez: false, interruptores: new Set(), solo: false }],
    ['vendido solo (Sumied)', { hosteleria: false, diez: false, interruptores: new Set(), solo: true }],
    ['cuenta de demostración', { hosteleria: false, diez: false, interruptores: new Set(), solo: true, demo: true }],
  ]
  for (const [nombre, ctx] of casos) {
    it(`${nombre}: las mismas entradas, en el mismo orden, que el apartado Ajustes de hoy`, () => {
      const hoy = pestanasVisibles(ajustes, ctx).map((t) => t.ruta)
      const menu = menuPersonaVisible(ctx).filter((e) => e.id !== 'novedades').map((e) => e.ruta)
      expect(menu).toEqual(hoy)
    })
  }
  it('Tu empresa y Ejercicio están en el menú y también en Definiciones › Empresa (decisión 5)', () => {
    const def = MODULOS[0].pestanas.find((p) => p.id === 'definiciones')!.grupos.find((g) => g.titulo === 'Empresa')!
    expect(def.botones.map((b) => b.etiqueta)).toEqual(['Tu empresa', 'Ejercicio'])
    const menu = menuPersonaVisible({ hosteleria: false, diez: false, interruptores: new Set(), solo: true }).map((e) => e.etiqueta)
    expect(menu).toContain('Tu empresa')
    expect(menu).toContain('Ejercicio')
  })
  it('Certificados y accesos: con Folvy sale; vendido solo, no (es un hueco, como hoy en la barra)', () => {
    const con = menuPersonaVisible({ hosteleria: false, diez: false, interruptores: new Set(), solo: false }).map((e) => e.etiqueta)
    const sin = menuPersonaVisible({ hosteleria: false, diez: false, interruptores: new Set(), solo: true }).map((e) => e.etiqueta)
    expect(con).toContain('Certificados y accesos')
    expect(sin).not.toContain('Certificados y accesos')
  })
})
