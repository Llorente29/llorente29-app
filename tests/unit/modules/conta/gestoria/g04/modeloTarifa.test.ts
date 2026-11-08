// G04 · Tarea 4 · El modelo de «Tarifa y paquetes»
// (src/modules/conta/gestoria/g04/modeloTarifa.ts), con los niveles, la
// laboral y el Pack Pyme del tablero Tarifa de la maqueta. Clientes e importes
// inventados (T11).
import { describe, expect, it } from 'vitest'
import { modeloTarifa, pruebalo, formaEnPalabras } from '@/modules/conta/gestoria/g04/modeloTarifa'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const Q = 'emp-qbo'
const precio = (id: string, x: Record<string, unknown>) => ({ id, empresa_id: Q, servicio_id: null, nivel_id: null, paquete_id: null, cliente_id: null, forma: 'fijo', periodo: 'mes',
  importe: null, tramos: [], desde: '2024-01-01', hasta: null, ...x })
const cuota = (id: string, cliente: string, x: Record<string, unknown>) => ({ id, tipo: 'cuota', cliente_id: cliente, empresa_id: Q, servicio_id: null, nivel_id: null, paquete_id: null,
  empleado_nombre: null, importe_propio: null, periodo: 'mes', desde: '2024-01-01', hasta: null, ...x })
const laboral = [{ desde: 1, hasta: 5, importe: 100, porUnidad: false }, { desde: 6, hasta: null, importe: 18, porUnidad: true }]

const datos = (): DatosClientes => ({
  clientes: [{ cliente_id: '1', cliente: 'Construcciones Ficticias, S.A.' }, { cliente_id: '2', cliente: 'Talleres Ejemplo, S.L.' }, { cliente_id: '3', cliente: 'Estudio de Prueba, S.L.' }],
  cuotasGc: [], proximos: [], cargos: [], queHacer: [], ajustes: [], crm: [],
  servicios: [
    { id: 'ges', company_id: Q, nombre: 'Gestoría mensual', forma: 'fijo_mes' },
    { id: 'lab', company_id: Q, nombre: 'Gestión laboral', forma: 'por_empleado' },
    { id: 'soft', company_id: Q, nombre: 'Gestión software', forma: 'fijo_mes' },
  ],
  niveles: [
    { id: 'b', servicio_id: 'ges', nombre: 'Básica', orden: 1, incluye: ['Impuestos trimestrales'], mas_elegido: false },
    { id: 'e', servicio_id: 'ges', nombre: 'Estándar', orden: 2, incluye: ['Cuentas anuales'], mas_elegido: true },
    { id: 'p', servicio_id: 'ges', nombre: 'Premium', orden: 3, incluye: ['Gestor asignado'], mas_elegido: false },
  ],
  paquetes: [{ id: 'pyme', company_id: Q, nombre: 'Pack Pyme', descripcion: 'La cuota Estándar y la laboral de hasta 5 trabajadores.', exceso_por_trabajador: 18 }],
  lineasDePaquete: [{ paquete_id: 'pyme', servicio_id: 'ges', nivel_id: 'e', limite_trabajadores: null }, { paquete_id: 'pyme', servicio_id: 'lab', nivel_id: null, limite_trabajadores: 5 }],
  precios: [
    precio('pb', { servicio_id: 'ges', nivel_id: 'b', importe: 45 }),
    precio('pe', { servicio_id: 'ges', nivel_id: 'e', importe: 60.5 }),
    precio('pp', { servicio_id: 'ges', nivel_id: 'p', importe: 95 }),
    precio('pl', { servicio_id: 'lab', forma: 'tramo_y_por_trabajador', periodo: null, tramos: laboral }),
    precio('pq', { paquete_id: 'pyme', importe: 150 }),
    precio('c1e', { servicio_id: 'ges', nivel_id: 'e', cliente_id: '1', importe: 55, desde: '2026-03-01' }),
    precio('c1l', { servicio_id: 'lab', cliente_id: '1', forma: 'por_trabajador', periodo: null, importe: 20, desde: '2026-03-01' }),
    precio('c2q', { paquete_id: 'pyme', cliente_id: '2', importe: 140, desde: '2026-01-01' }),
    precio('c3s', { servicio_id: 'soft', cliente_id: '3', importe: 30, desde: '2025-06-01' }),
  ],
  asignaciones: [
    cuota('a1', '1', { servicio_id: 'ges', nivel_id: 'e' }),
    cuota('a2', '3', { servicio_id: 'ges', nivel_id: 'e' }),
    cuota('a3', '1', { servicio_id: 'lab', empleado_nombre: 'Persona Prueba 1' }),
    cuota('a4', '2', { paquete_id: 'pyme' }),
    cuota('a5', '3', { servicio_id: 'soft' }),
  ],
})

describe('G04 · el modelo de «Tarifa y paquetes»', () => {
  const m = modeloTarifa(datos(), Q, '2026-11-08')
  it('la lista: servicios y paquetes con su resumen y sus clientes', () => {
    expect(m.entradas.map((e) => [e.id, e.resumen, e.clientes])).toEqual([
      ['servicio:ges', '3 niveles · de 45 a 95 € al mes', 2],
      ['servicio:lab', 'Tramo 1–5 por 100 €, después 18 €', 1],
      ['servicio:soft', 'Sin precio de tarifa · cada cliente con el suyo', 1],
      ['paquete:pyme', '150 € al mes · ahorra 10,50 €', 1],
    ])
  })
  it('un servicio con niveles: tarjetas con su precio y «precio especial» solo si difiere de la tarifa', () => {
    const d = m.detalle('servicio:ges')!
    expect([d.tipoTexto, d.niveles.map((n) => [n.nombre, n.precio, n.masElegido, n.clientes])]).toEqual(['Servicio con niveles', [['Básica', '45,00', false, 0], ['Estándar', '60,50', true, 2], ['Premium', '95,00', false, 0]]])
    expect(d.especiales).toEqual([{ clienteId: '1', cliente: 'Construcciones Ficticias, S.A.', precio: 'Estándar a 55,00 € al mes', desde: 'Desde marzo de 2026', palabra: 'Precio especial' }])
  })
  it('la laboral: sus reglas y «Pruébalo»', () => {
    const d = m.detalle('servicio:lab')!
    expect([d.formaTipo, d.porTrabajador, d.reglas]).toEqual(['tramo_y_por_trabajador', true, [
      { tramo: 'De 1 a 5 trabajadores', importe: '100,00', unidad: '€ al mes, cerrado' }, { tramo: 'Desde el 6.º trabajador', importe: '18,00', unidad: '€ por cada uno' }]])
    expect(pruebalo(d.general!.forma, 12).total).toBe('226,00 €')
    expect(pruebalo(d.general!.forma, 3).total).toBe('100,00 €')
    expect(d.especiales.map((e) => [e.precio, e.palabra])).toEqual([['20,00 € por trabajador', 'Precio especial']])
  })
  it('sin precio general, «Precio de este cliente»', () => {
    const d = m.detalle('servicio:soft')!
    expect([d.sinPrecioGeneral, d.especiales.map((e) => e.palabra)]).toEqual([true, ['Precio de este cliente']])
  })
  it('el paquete: lo que incluye, por separado, el ahorro y el exceso', () => {
    const d = m.detalle('paquete:pyme')!
    expect({ ...d.paquete, lineas: d.paquete!.lineas.map(({ texto, detalle, suelto }) => ({ texto, detalle, suelto })) }).toEqual({
      lineas: [{ texto: 'Gestoría mensual · Estándar', detalle: 'Cada mes', suelto: '60,50 €' }, { texto: 'Gestión laboral', detalle: 'Hasta 5 trabajadores', suelto: '100,00 €' }],
      precio: '150,00', porSeparado: '160,50 € al mes', ahorro: '10,50 € al mes (126 € al año)',
      exceso: 'Desde el 6.º trabajador se cobra cada uno a 18,00 € al mes.',
    })
    expect(d.especiales.map((e) => [e.cliente, e.precio])).toEqual([['Talleres Ejemplo, S.L.', '140,00 € al mes']])
  })
  it('las formas en palabras', () => {
    expect([formaEnPalabras({ tipo: 'fijo', periodo: 'anio', importeCent: 60500 }), formaEnPalabras({ tipo: 'fijo', periodo: 'vez', importeCent: 6000 })]).toEqual(['605,00 € al año', '60,00 € cada vez'])
  })
})

describe('G04 · «Cambiar precios» desde Tarifa', () => {
  const m = modeloTarifa(datos(), 'emp-qbo', '2026-11-08')
  it('«Qué cambia»: cada nivel, cada servicio sin niveles con precio y cada paquete', () => {
    expect(m.opciones.map((o) => o.nombre)).toEqual(['Gestoría mensual · Básica', 'Gestoría mensual · Estándar', 'Gestoría mensual · Premium', 'Gestión laboral', 'Pack Pyme'])
  })
  it('subir un 10 % el Estándar a todos, con los precios del cliente quietos: solo le llega a quien paga la tarifa', () => {
    const e = m.ensayar({ sentido: 'subir', cantidad: { tipo: 'porcentaje', valor: 10 }, desde: '2027-01', que: [m.opciones[1].objetivo], aQuien: { tipo: 'todos' }, preciosDelCliente: 'se_quedan' })
    expect(e.lineas.map((l) => [l.clienteId, l.antesCent, l.despuesCent, l.como])).toEqual([['3', 6050, 6655, 'tarifa']])
    expect(e.guardar.nuevos.map((p) => [p.clienteId, p.forma])).toEqual([[null, { tipo: 'fijo', periodo: 'mes', importeCent: 6655 }]])
  })
})
