// tests/unit/modules/conta/p01/despacho.test.ts
//
// P01 · El núcleo de «Impuestos de tus clientes», contra la respuesta REAL de
// conta_despacho_trimestre en staging (asesoría de demo, 3T de 2026, «hoy»
// 13/10, como Laura), guardada el 19/10 en fixtures/ (regla 31). Dos filas
// traen domicilia = null: la base de entonces aún no lo cerraba a false (la
// 0100 de ahora sí); el núcleo lo trata como «no domicilia».

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SIN_FILTROS, chipDeCertificado, chipDeModelo, ddmm, filtrar, hayFiltros, hoyDeLaPantalla, lineaDelTrimestre, loteDe, modelosDelTrimestre,
  nombreTrimestre, periodoCorto, porQueNoPresenta, resumenLote, textoPresentar, tipoDeCliente, trimestreDe, trimestresParaElegir,
  type ClienteDespacho, type TrimestreDespacho,
} from '@/modules/conta/impuestos/despacho/despacho'

const T = JSON.parse(readFileSync(join(__dirname, 'fixtures/trimestre-staging-20261019.json'), 'utf8')) as TrimestreDespacho
const de = (nombre: string): ClienteDespacho => {
  const c = T.clientes.find((x) => x.nombre === nombre)
  if (!c) throw new Error(`no está ${nombre}`)
  return c
}

describe('P01 · fechas y trimestres', () => {
  it('el trimestre que se presenta es el último que acabó', () => {
    expect(trimestreDe('2026-10-13')).toEqual({ ejercicio: 2026, periodo: '3T' })
    expect(trimestreDe('2027-01-20')).toEqual({ ejercicio: 2026, periodo: '4T' })
    expect(trimestreDe('2026-04-01')).toEqual({ ejercicio: 2026, periodo: '1T' })
    expect(trimestresParaElegir('2026-10-13', 5).map((t) => `${t.ejercicio}·${t.periodo}`)).toEqual(['2026·3T', '2026·2T', '2026·1T', '2025·4T', '2025·3T'])
  })
  it('la línea del trimestre, como la maqueta', () => {
    expect(nombreTrimestre(2026, '3T')).toBe('3.er trimestre 2026')
    expect(lineaDelTrimestre(T)).toBe('3.er trimestre 2026 · domiciliados hasta el 15/10 · el resto hasta el 20/10 · hoy 13/10')
  })
  it('?hoy= solo fuera de producción', () => {
    const ahora = new Date('2026-10-19T10:00:00Z')
    expect(hoyDeLaPantalla('?hoy=2026-10-13', false, ahora)).toEqual({ hoy: '2026-10-13', forzado: true })
    expect(hoyDeLaPantalla('?hoy=2026-10-13', true, ahora)).toEqual({ hoy: '2026-10-19', forzado: false })
    expect(hoyDeLaPantalla('?hoy=mañana', false, ahora)).toEqual({ hoy: '2026-10-19', forzado: false })
    expect(hoyDeLaPantalla('', false, ahora)).toEqual({ hoy: '2026-10-19', forzado: false })
  })
})

describe('P01 · los chips, con los datos de staging', () => {
  it('rojo lo que vence, ámbar con avisos, azul por revisar, verde listo o presentado', () => {
    const ana = de('Ana Prueba Gómez').modelos
    expect(chipDeModelo(ana[0])).toMatchObject({ tono: 'falta', texto: '303 vence en 2 días' })
    expect(chipDeModelo(ana[1])).toMatchObject({ tono: 'neutro', texto: '130 · hasta 20/10' })
    expect(chipDeModelo(de('Clínica Dental de Prueba Sol').modelos[0])).toMatchObject({ tono: 'duda', texto: '303 · 2 avisos' })
    expect(chipDeModelo(de('Hostal de Prueba Mayor').modelos[0])).toMatchObject({ tono: 'accion', texto: '303 · −3.723,44' })
    expect(chipDeModelo(de('Talleres de Prueba Ruiz').modelos[1])).toMatchObject({ tono: 'seguro', texto: '111 listo' })
    expect(chipDeModelo(de('Bar de Prueba Esquina').modelos[1])).toMatchObject({ tono: 'seguro', texto: '111 ✓' })
    expect(chipDeModelo(de('Importaciones de Prueba Levante').modelos[2])).toMatchObject({ tono: 'seguro', texto: '303 sep ✓' })
    expect(chipDeModelo(de('Hostal de Prueba Mayor').modelos[3])).toMatchObject({ tono: 'neutro', texto: '202 2.º pago · hasta 20/10' })
  })
  it('el periodo corto de los mensuales y del 202', () => {
    expect(periodoCorto({ cadencia: 'monthly', periodo: '07' })).toBe('jul')
    expect(periodoCorto({ cadencia: 'quarterly', periodo: '3T' })).toBe('')
  })
  it('el certificado: rojo si caduca; si no vale, solo cuando hay algo por presentar', () => {
    const imp = de('Importaciones de Prueba Levante')
    expect(chipDeCertificado(imp.certificado, imp.pendiente)).toMatchObject({ tono: 'falta', texto: 'Certificado caduca en 12 días' })
    const luis = de('Luis Prueba Martín')
    expect(chipDeCertificado(luis.certificado, luis.pendiente)).toMatchObject({ tono: 'falta', texto: 'Certificado caducado' })
    expect(chipDeCertificado(luis.certificado, false)).toBeNull()
    expect(chipDeCertificado(de('Bar de Prueba Esquina').certificado, true)).toBeNull()
  })
  it('el tipo de cada cliente, en palabras', () => {
    expect(tipoDeCliente(de('Hostal de Prueba Mayor'))).toBe('Hostelería · trimestral')
    expect(tipoDeCliente(de('Ana Prueba Gómez'))).toBe('Autónomo · trimestral · domicilia')
    expect(tipoDeCliente(de('Clínica Dental de Prueba Sol'))).toBe('Sociedad · trimestral · prorrata 38 %')
    expect(tipoDeCliente(de('Importaciones de Prueba Levante'))).toBe('Sociedad · mensual · SII')
  })
})

describe('P01 · los filtros (regla 7: apagados, todos)', () => {
  it('apagados se ven los 8, en el orden de la base', () => {
    expect(hayFiltros(SIN_FILTROS)).toBe(false)
    expect(filtrar(T.clientes, SIN_FILTROS)).toHaveLength(8)
    expect(T.clientes[0].nombre).toBe('Ana Prueba Gómez')
  })
  it('cada filtro cuenta lo mismo que la base (misma vara)', () => {
    const f = T.resumen.filtros
    expect(filtrar(T.clientes, { ...SIN_FILTROS, conAvisos: true })).toHaveLength(f.con_avisos)
    expect(filtrar(T.clientes, { ...SIN_FILTROS, listos: true })).toHaveLength(f.listos)
    expect(filtrar(T.clientes, { ...SIN_FILTROS, sinCertificado: true })).toHaveLength(f.sin_certificado)
    expect(filtrar(T.clientes, { ...SIN_FILTROS, domiciliados: true })).toHaveLength(f.domiciliados)
  })
  it('responsable, sin responsable y modelo', () => {
    expect(filtrar(T.clientes, { ...SIN_FILTROS, responsable: 'd5ac0000-0000-4000-8000-0000000000a2' }).map((c) => c.nombre).sort())
      .toEqual(['Bar de Prueba Esquina', 'Importaciones de Prueba Levante', 'Talleres de Prueba Ruiz'])
    expect(filtrar(T.clientes, { ...SIN_FILTROS, responsable: '—' }).map((c) => c.nombre)).toEqual(['Panadería de Prueba Norte'])
    expect(modelosDelTrimestre(T.clientes)).toEqual(['111', '115', '130', '202', '303', '349'])
    expect(filtrar(T.clientes, { ...SIN_FILTROS, modelo: '130' }).map((c) => c.nombre)).toEqual(['Ana Prueba Gómez', 'Luis Prueba Martín'])
  })
})

describe('P01 · el lote: solo lo revisado, y por ahora solo el 303', () => {
  it('Talleres: 3 listos, se presenta el 303; el 111 y el 115, fuera', () => {
    const l = loteDe([de('Talleres de Prueba Ruiz')])
    expect(l.aPresentar.map((x) => x.modelo.modelo)).toEqual(['303'])
    expect(l.fuera.map((x) => x.modelo.modelo)).toEqual(['111', '115'])
    expect(resumenLote(l)).toBe('1 cliente elegido · 3 modelos listos · 4.902,10 € a ingresar')
    expect(textoPresentar(l)).toBe('Presentar el 1 a Hacienda')
  })
  it('dos clientes: Talleres y el Bar', () => {
    const l = loteDe([de('Talleres de Prueba Ruiz'), de('Bar de Prueba Esquina')])
    expect(l.aPresentar).toHaveLength(2)
    expect(resumenLote(l)).toBe('2 clientes elegidos · 4 modelos listos · 6.106,60 € a ingresar')
    expect(textoPresentar(l)).toBe('Presentar los 2 a Hacienda')
  })
  it('lo que no está revisado no entra, y un certificado caducado tampoco deja', () => {
    const l = loteDe([de('Hostal de Prueba Mayor'), de('Luis Prueba Martín')])
    expect(l.aPresentar).toHaveLength(0)
    expect(l.sinRevisar).toBe(2)                       // el 303 y el 202 del Hostal
    expect(l.sinCertificado.map((c) => c.nombre)).toEqual(['Luis Prueba Martín'])
    expect(l.fuera.map((x) => x.modelo.modelo)).toEqual(['130'])
  })
  it('por qué no presenta: nunca en silencio (regla 8)', () => {
    const l = loteDe([de('Talleres de Prueba Ruiz')])
    expect(porQueNoPresenta(l, { abierta: false, mensaje: 'La conexión con Hacienda está cerrada.' }, true)).toBe('La conexión con Hacienda está cerrada.')
    expect(porQueNoPresenta(l, null, true)).toMatch(/Mirando/)
    expect(porQueNoPresenta(l, { abierta: true, mensaje: '' }, true)).toBeNull()
    expect(porQueNoPresenta(l, { abierta: true, mensaje: '' }, false)).toMatch(/Solo la administración/)
    expect(porQueNoPresenta(loteDe([de('Hostal de Prueba Mayor')]), { abierta: true, mensaje: '' }, true)).toMatch(/solo se presenta lo revisado/)
  })
  it('ddmm', () => {
    expect(ddmm('2026-10-15')).toBe('15/10')
    expect(ddmm(null)).toBe('—')
  })
})
