// tests/unit/modules/conta/s02/pr2-bancos-patron.test.ts
//
// S02 · PR 2 · Bancos con el patrón único de pantallas, en lo que se puede
// probar sin pantalla:
//   · cada página: su título (el del mapa), su frase con lo que se ve, UN
//     principal («Subir extracto»), como mucho dos blancos, y nada que se
//     ofrezca a sí misma; en el móvil, ningún blanco (van a «Más acciones»);
//   · el mes y «Tus bancos» solo donde la página los lee;
//   · el cierre del mes del banco se mudó a Contabilidad › Cierre y Registro, y
//     la dirección de antes lleva allí con su mes y su banco;
//   · las cabeceras viejas (la fila con su propio «Subir extracto», «‹ Bancos»,
//     la portada por niveles del móvil) ya no están.
// Los títulos se comparan con los del mapa (productos.ts), no con una lista
// escrita aquí: si el mapa cambia, la prueba lo dice (regla 31).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rutaConta, rutaLibros } from '@/config/navegacion'
import { PRODUCTOS, dondeEsta } from '@/modules/conta/esqueleto/productos'
import { BLANCOS } from '@/modules/conta/marco/acciones'
import { accionesDeLaPagina } from '@/modules/conta/bancos/acciones'
import {
  PESTANAS_BANCOS, PESTANA_CIERRE_ANTIGUA, destinoDelCierre, encabezadoDe, leeElBanco, leeElMes, mesDelCierre, pestanaDe, resolverVista, type VistaBancos,
} from '@/modules/conta/bancos/navegacion'
import { LO_HECHO } from '@/modules/conta/bancos/marca'

const VISTAS: VistaBancos[] = ['movimientos', 'cuentas', 'reglas', 'subir', 'hecho']
const BANCO = { nombre: 'Banco Norte', iban: 'ES12 3456 7890 1234 5678 9012' }
const de = (path: string) => { const d = dondeEsta(path); return d ? (d.pestana ? `${d.producto.id}.${d.pestana.id}` : d.producto.id) : null }

describe('las páginas de Bancos son las del mapa', () => {
  const bancos = PRODUCTOS.find((p) => p.id === 'bancos')!
  it('las mismas, con el mismo nombre (y sin «Cierre del mes»)', () => {
    expect(PESTANAS_BANCOS.map((p) => p.id).sort()).toEqual(bancos.pestanas.map((p) => p.id).sort())
    for (const p of PESTANAS_BANCOS) expect(p.nombre).toBe(bancos.pestanas.find((x) => x.id === p.id)!.etiqueta)
  })
  it('el título de cada página es el nombre de su página en el mapa', () => {
    for (const p of bancos.pestanas) expect(encabezadoDe(p.id as VistaBancos, { banco: BANCO, mes: '2026-09' }).titulo).toBe(p.etiqueta)
  })
  it('«Subir extracto» y «Lo que he hecho» cuelgan de Movimientos, con su miga', () => {
    expect(pestanaDe('subir')).toBe('movimientos')
    expect(encabezadoDe('subir', { banco: BANCO, mes: '2026-09' }).migasExtra).toEqual([{ etiqueta: 'Subir extracto' }])
    expect(encabezadoDe('hecho', { banco: BANCO, mes: '2026-09' })).toMatchObject({ titulo: LO_HECHO, migasExtra: [{ etiqueta: LO_HECHO }] })
  })
})

describe('la frase dice lo que se ve', () => {
  it('Movimientos: el banco (con los 4 últimos del IBAN) y el mes', () => {
    expect(encabezadoDe('movimientos', { banco: BANCO, mes: '2026-09' }).frase).toBe('Banco Norte ···9012, septiembre: lo que trae el banco, para casarlo con contabilidad.')
    expect(encabezadoDe('movimientos', { banco: { nombre: 'Caja', iban: null }, mes: '2026-10' }).frase).toMatch(/^Caja, octubre:/)
  })
  it('sin bancos, lo dice y qué hacer', () => {
    expect(encabezadoDe('movimientos', { banco: null, mes: '2026-09' }).frase).toMatch(/ningún banco: dalo de alta/)
  })
  it('«Lo que he hecho»: el mes y que es de todos los bancos', () => {
    expect(encabezadoDe('hecho', { banco: BANCO, mes: '2026-10' }).frase).toMatch(/^En octubre, en todos tus bancos/)
  })
  it('ningún texto nombra la marca (B02: lo automático habla en primera persona)', () => {
    for (const v of VISTAS) {
      const e = encabezadoDe(v, { banco: BANCO, mes: '2026-09' })
      expect(`${e.titulo} ${e.frase}`).not.toMatch(/Folvy|Sumied/)
    }
  })
})

describe('las acciones: un principal, como mucho dos blancos, lo demás en «Más acciones»', () => {
  it('en cada página, en el ordenador y en el móvil', () => {
    for (const v of VISTAS) for (const movil of [false, true]) {
      const r = accionesDeLaPagina(v, movil)
      expect(r.blancos.length, `${v} ${movil}`).toBeLessThanOrEqual(BLANCOS)
      // Nada sale dos veces.
      expect(new Set([...r.blancos, ...r.mas]).size).toBe(r.blancos.length + r.mas.length)
      if (movil) expect(r.blancos, `${v}: en el móvil los blancos van a «Más acciones»`).toEqual([])
    }
  })
  it('el principal es «Subir extracto» en todas menos en la suya', () => {
    expect(VISTAS.filter((v) => accionesDeLaPagina(v, false).principal)).toEqual(['movimientos', 'cuentas', 'reglas', 'hecho'])
  })
  it('una página no se ofrece a sí misma; Movimientos no repite «Casados solos» (es una de sus bandejas)', () => {
    const todas = (v: VistaBancos) => { const r = accionesDeLaPagina(v, false); return [...r.blancos, ...r.mas] }
    expect(todas('reglas')).not.toContain('reglas')
    expect(todas('hecho')).not.toContain('hecho')
    expect(todas('movimientos')).not.toContain('casados')
    expect(todas('movimientos')).toEqual(['reglas', 'hecho'])
  })
  it('en Cuentas y extractos, «+ Nuevo banco o tarjeta» es el primer blanco (antes, un segundo azul)', () => {
    expect(accionesDeLaPagina('cuentas', false)).toEqual({ principal: true, blancos: ['nuevo-banco', 'casados'], mas: ['reglas', 'hecho'] })
    expect(accionesDeLaPagina('cuentas', true).mas[0]).toBe('nuevo-banco')
  })
})

describe('el mes y «Tus bancos», solo donde la página los lee', () => {
  it('el mes: Movimientos y «Lo que he hecho»', () => {
    expect(VISTAS.filter(leeElMes)).toEqual(['movimientos', 'hecho'])
  })
  it('«Tus bancos»: solo Movimientos (la única página de UN banco)', () => {
    expect(VISTAS.filter(leeElBanco)).toEqual(['movimientos'])
  })
})

describe('el cierre del mes del banco, en Contabilidad › Cierre y Registro', () => {
  const cerrarMes = rutaLibros('cierre', 'cerrar-mes')
  it('la dirección de antes ya no es una vista de Bancos', () => {
    expect(PESTANA_CIERRE_ANTIGUA).toBe('cierre')
    expect(resolverVista(PESTANA_CIERRE_ANTIGUA)).toBe('movimientos')
  })
  it('lleva a Cerrar el mes, con su mes y su banco; lo demás de la consulta se queda atrás', () => {
    expect(destinoDelCierre('')).toBe(cerrarMes)
    expect(destinoDelCierre('?mes=2026-09&banco=b1&ver=todo&mov=m9')).toBe(`${cerrarMes}?mes=2026-09&banco=b1`)
    expect(destinoDelCierre('?mes=septiembre')).toBe(cerrarMes)
  })
  it('y esa página es Contabilidad › Cierre y Registro en el mapa (como bancos/cierre)', () => {
    expect(de(cerrarMes)).toBe('contabilidad.cierre')
    expect(de(rutaConta('bancos/cierre'))).toBe('contabilidad.cierre')
  })
  it('el mes de los bancos: el pedido (aunque sea de otro ejercicio); si no, el último terminado', () => {
    const meses = ['2026-01', '2026-02', '2026-09', '2026-10']
    expect(mesDelCierre(meses, '2026-02', '2026-10-22')).toEqual({ mes: '2026-02', opciones: ['2026-10', '2026-09', '2026-02', '2026-01'] })
    expect(mesDelCierre(meses, '2025-12', '2026-10-22').opciones).toEqual(['2026-10', '2026-09', '2026-02', '2026-01', '2025-12'])
    expect(mesDelCierre(meses, null, '2026-10-22').mes).toBe('2026-09')
    expect(mesDelCierre(meses, '2026-13', '2026-10-22').mes).toBe('2026-09')
    expect(mesDelCierre(['2026-10'], null, '2026-10-22').mes).toBe('2026-10')
    expect(mesDelCierre([], null, '2026-10-22')).toEqual({ mes: '2026-10', opciones: ['2026-10'] })
  })
})

describe('el código: lo de antes ya no está', () => {
  const dir = 'src/modules/conta/bancos'
  const fuentes = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => [f, readFileSync(`${dir}/${f}`, 'utf8')] as const)
  it('la portada por niveles del móvil se fue', () => {
    expect(existsSync(`${dir}/PortadaMovil.tsx`)).toBe(false)
    // En el código, no en los comentarios que cuentan por qué se fue.
    for (const [f, s] of fuentes) expect(s, f).not.toMatch(/import \{ PortadaMovil|<PortadaMovil/)
  })
  it('ninguna página pinta su propia cabecera ni su propio «Subir extracto»; tampoco «‹ Bancos»', () => {
    for (const [f, s] of fuentes) {
      expect(s, f).not.toMatch(/cxl-herramientas|‹ Bancos|<h2 id="cxb-/)
      if (f !== 'BancosPage.tsx' && f !== 'SubirExtracto.tsx') expect(s, f).not.toMatch(/>Subir extracto</)
    }
  })
  it('BancosPage pinta el encabezado del patrón y deja la cinta', () => {
    const s = readFileSync(`${dir}/BancosPage.tsx`, 'utf8')
    expect(s).toMatch(/<EncabezadoPagina/)
    expect(s).toMatch(/<BotonPulgar>/)
    expect(s).not.toMatch(/useEntradasEnCinta|useDatosEnCinta/)
  })
  it('el cierre del banco ya no depende de Bancos y se pinta en Cerrar el mes', () => {
    expect(readFileSync(`${dir}/CierreDelMes.tsx`, 'utf8')).not.toMatch(/useBancos/)
    expect(readFileSync('src/modules/conta/libros/Cierre.tsx', 'utf8')).toMatch(/<CierreDelMes /)
  })
  it('la prueba puede fallar', () => {
    expect('<div className="cxl-herramientas">').toMatch(/cxl-herramientas|‹ Bancos|<h2 id="cxb-/)
    expect(accionesDeLaPagina('subir', false).principal).toBe(false)
  })
})
