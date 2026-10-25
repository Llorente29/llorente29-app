// V02 · Entrega 1 · La puerta (Inicio › Documentos): «Lo que falta», lo último
// y lo que se sube. Las llegadas son las de VERDAD de Foodint, medidas el 25/10
// en solo lectura y con su account_id (regla 31):
//   · Xfera: el 22 de cada mes (22/06, 22/07, 22/08, 22/09);
//   · Iberdrola: varias al mes (28/05 … 29/09, diez facturas);
//   · Uber: el resumen de cada domingo (11/10 y 18/10; antes, dos mensuales importados);
//   · Glovo y Just Eat: quincenales, y nada desde el 30/06 (falta importarlas: entrega 3);
//   · Catcher: la quincena del 1 al 15/10;
//   · BBVA: extractos subidos el 15/10 y el 23/10.
// Los alquileres van sin nombres de personas: la fila es el local. Los locales,
// los de Foodint (locations, con su dirección): Florencio Llorente, 29 · Camichi, 4 · Cañaveral, 75.
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import {
  cifrasPuerta, clasificarSubida, correoPedirla, nombreDelLocal, cuandoLlego, deLaPestana, delAl, faltaDe, loQueFalta, ocurrencias, porLlegarEsteMes, queSeEspera, sumarDias,
  type DatosFuentes, type DatosPuerta, type Fuente, type Ultimo,
} from '@/modules/conta/lib/puerta'

const HOY = '2026-10-25' // domingo
const base = (o: Partial<Fuente> & Pick<Fuente, 'id' | 'tipo' | 'nombre' | 'cadencia'>): Fuente => ({
  grupo: null, proveedor_id: null, dia: null, dia_semana: null, cada: null, margen: null, activa: true, origen: 'propuesta', cubierta: false, llegadas: [], pedida: null, ...o,
})
const XFERA = base({ id: 'xfera', tipo: 'proveedor', nombre: 'Xfera', cadencia: 'mensual', dia: 22, llegadas: ['2026-06-22', '2026-07-22', '2026-08-22', '2026-09-22'] })
const IBERDROLA = base({ id: 'iber', tipo: 'proveedor', nombre: 'Iberdrola', cadencia: 'varias', cada: 10,
  llegadas: ['2026-05-28', '2026-06-15', '2026-06-29', '2026-07-15', '2026-07-30', '2026-08-18', '2026-08-28', '2026-09-15', '2026-09-23', '2026-09-29'] })
const UBER = base({ id: 'uber', tipo: 'intermediario', nombre: 'Uber Eats', cadencia: 'semanal', dia_semana: 7, margen: 1, llegadas: ['2026-05-31', '2026-06-30', '2026-10-11', '2026-10-18'] })
const GLOVO = base({ id: 'glovo', tipo: 'intermediario', nombre: 'Glovo', cadencia: 'quincenal', dia: 0, llegadas: ['2026-05-31', '2026-06-15', '2026-06-30'] })
const RIDERS = base({ id: 'riders', tipo: 'riders', nombre: 'Riders de Catcher', cadencia: 'quincenal', dia: 0, margen: 5, llegadas: ['2026-10-15'] })
const BBVA = base({ id: 'bbva', tipo: 'banco', nombre: 'Extracto · BBVA', cadencia: 'semanal', dia_semana: 5, llegadas: ['2026-10-15', '2026-10-23'] })
const LOCAL = {
  alcala: { id: 'l-alcala', nombre: 'Foodint Alcalá', direccion: 'Florencio Llorente, 29' },
  carabanchel: { id: 'l-carabanchel', nombre: 'Foodint Carabanchel', direccion: 'Camichi, 4' },
  plaza: { id: 'l-plaza', nombre: 'Foodint Plaza Castilla', direccion: 'Cañaveral, 75' },
}
// Cañaveral 75: tres propietarias, una fila. Sin nombres: la fila es el local.
const CANAVERAL = [1, 2, 3].map((i) => base({ id: `alq${i}`, tipo: 'alquiler', nombre: `Arrendadora ${i}`, local: LOCAL.plaza, cadencia: 'mensual', dia: 1,
  llegadas: i === 3 ? ['2026-08-01', '2026-09-01'] : ['2026-08-01', '2026-09-01', '2026-10-01'] }))
const datos = (fuentes: Fuente[], ajustes = { lo_que_falta: true, margen: 5 }): DatosFuentes => ({ ajustes, fuentes })

describe('el calendario de cada fuente', () => {
  it('mensual el día 22; semanal en domingo, con su semana; quincenal, el 15 y fin de mes', () => {
    expect(ocurrencias(XFERA, '2026-09-01', '2026-11-30').map((o) => o.dia)).toEqual(['2026-09-22', '2026-10-22', '2026-11-22'])
    expect(ocurrencias(UBER, '2026-10-12', '2026-10-26')).toEqual([{ dia: '2026-10-18', desde: '2026-10-12', hasta: '2026-10-18' }, { dia: '2026-10-25', desde: '2026-10-19', hasta: '2026-10-25' }])
    expect(ocurrencias(GLOVO, '2026-09-20', '2026-10-31').map((o) => [o.desde, o.hasta])).toEqual([['2026-09-16', '2026-09-30'], ['2026-10-01', '2026-10-15'], ['2026-10-16', '2026-10-31']])
  })
  it('el día 31 en un mes de 30 es el último del mes', () => {
    expect(ocurrencias(base({ id: 'x', tipo: 'proveedor', nombre: 'x', cadencia: 'mensual', dia: 31, llegadas: [] }), '2026-09-01', '2026-10-31').map((o) => o.dia)).toEqual(['2026-09-30', '2026-10-31'])
  })
  it('las palabras de lo que se espera', () => {
    expect(queSeEspera(GLOVO, { dia: '2026-09-30', desde: '2026-09-16', hasta: '2026-09-30' })).toBe('Liquidación del 16 al 30 de septiembre')
    expect(queSeEspera(RIDERS, { dia: '2026-10-31', desde: '2026-10-16', hasta: '2026-10-31' })).toBe('Facturas de los riders del 16 al 31 de octubre')
    expect(queSeEspera(base({ id: 'n', tipo: 'nominas', nombre: 'Nóminas', cadencia: 'mensual', dia: 5 }), { dia: '2026-11-05', desde: null, hasta: null })).toBe('Nóminas de octubre')
    expect(queSeEspera(XFERA, { dia: '2026-10-22', desde: null, hasta: null })).toBe('Factura de octubre')
    expect(delAl('2026-10-26', '2026-11-01')).toBe('del 26 de octubre al 1 de noviembre')
  })
})

describe('«Lo que falta» con las fuentes de Foodint, el 25/10', () => {
  it('Xfera (llega el 22, hoy 25, margen 5): aún a tiempo, hacia el 22/10', () => {
    expect(faltaDe(XFERA, HOY)).toEqual({ o: { dia: '2026-10-22', desde: null, hasta: null }, estado: { que: 'a_tiempo', texto: 'Aún a tiempo' } })
  })
  it('Xfera el 30/10 (margen pasado): se retrasa 8 días, en ámbar (rojo solo pasado un mes)', () => {
    expect(faltaDe(XFERA, '2026-10-30')?.estado).toEqual({ que: 'tarde', dias: 8, texto: 'Se retrasa 8 días', grave: false })
  })
  it('Uber: los resúmenes semanales entran desde el 11/10; el de la semana del 28/09 al 04/10 no está en Sumied, y se dice', () => {
    expect(faltaDe(UBER, HOY)).toMatchObject({ o: { dia: '2026-10-04', desde: '2026-09-28' }, estado: { que: 'tarde', dias: 21 } })
    // …el de hoy domingo está aún a tiempo (margen 1); el martes, 2 días tarde.
    // Con todos los domingos desde agosto (como cuando se importe el histórico, entrega 3):
    const domingos = Array.from({ length: 10 }, (_, i) => sumarDias('2026-08-16', 7 * i))
    const conEsa = { ...UBER, llegadas: domingos }
    expect(faltaDe(conEsa, HOY)).toMatchObject({ o: { dia: '2026-10-25' }, estado: { que: 'a_tiempo' } })
    expect(faltaDe(conEsa, '2026-10-27')?.estado).toMatchObject({ que: 'tarde', dias: 2, texto: 'Se retrasa 2 días' })
  })
  it('Glovo, sin nada desde el 30/06: la última quincena que falta (1 al 15/10), 10 días tarde', () => {
    const x = faltaDe(GLOVO, HOY)!
    expect([x.o.desde, x.o.hasta, x.estado]).toEqual(['2026-10-01', '2026-10-15', { que: 'tarde', dias: 10, texto: 'Se retrasa 10 días', grave: false }])
  })
  it('los riders de Catcher: la del 1 al 15/10 llegó; la del 16 al 31, aún a tiempo', () => {
    expect(faltaDe(RIDERS, HOY)).toMatchObject({ o: { dia: '2026-10-31', desde: '2026-10-16' }, estado: { que: 'a_tiempo' } })
  })
  it('Iberdrola (varias al mes, cada 10 días): la última el 29/09, la siguiente hacia el 09/10, ya tarde', () => {
    expect(faltaDe(IBERDROLA, HOY)?.estado).toMatchObject({ que: 'tarde' })
  })
  it('BBVA (extractos el 15/10 y el 23/10, semanal en viernes): el del 30/10, aún a tiempo', () => {
    expect(faltaDe(BBVA, HOY)).toMatchObject({ o: { dia: '2026-10-30' }, estado: { que: 'a_tiempo' } })
  })
  it('una fuente apagada o cubierta por una recurrente no avisa', () => {
    expect(faltaDe({ ...GLOVO, activa: false }, HOY)).toBeNull()
    expect(faltaDe({ ...GLOVO, cubierta: true }, HOY)).toBeNull()
  })
  it('lo de antes de la primera llegada no cuenta (la fuente aún no existía): ni agosto ni septiembre, solo la del 03/11', () => {
    expect(faltaDe(base({ id: 'n', tipo: 'proveedor', nombre: 'Nuevo', cadencia: 'mensual', dia: 3, llegadas: ['2026-10-03'] }), HOY))
      .toEqual({ o: { dia: '2026-11-03', desde: null, hasta: null }, estado: { que: 'a_tiempo', texto: 'Aún a tiempo' } })
  })
  it('Cañaveral 75 en una fila, sin nombres: la de una propietaria no llegó el 01/10 → «falta 1 de 3», tarde', () => {
    const filas = loQueFalta(datos(CANAVERAL), HOY)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ de: 'Alquiler · Cañaveral 75', que: 'Alquiler de octubre: falta 1 de 3', n: 3, estado: { que: 'tarde', dias: 24 } })
    expect(JSON.stringify(filas)).not.toMatch(/Arrendadora/)
  })
  it('los alquileres de Foodint, con el local que dijo Julio (25/10): tres filas, una por local, sin nombres', () => {
    const alq = (id: string, local: (typeof LOCAL)[keyof typeof LOCAL], llego: boolean) => base({ id, tipo: 'alquiler', nombre: `Arrendador ${id}`, local, cadencia: 'mensual', dia: 1,
      llegadas: llego ? ['2026-08-01', '2026-09-01', '2026-10-01'] : ['2026-08-01', '2026-09-01'] })
    const filas = loQueFalta(datos([alq('a', LOCAL.alcala, false), alq('b', LOCAL.carabanchel, false), alq('c1', LOCAL.plaza, false), alq('c2', LOCAL.plaza, true), alq('c3', LOCAL.plaza, true)]), HOY)
    // Las tres van 24 días tarde (lo del 01/10): mismo peso, en el orden en que llegan.
    expect(filas.map((x) => [x.de, x.que, x.estado.texto])).toEqual([
      ['Alquiler · Florencio Llorente 29', 'Alquiler de octubre', 'Se retrasa 24 días'],
      ['Alquiler · Camichi 4', 'Alquiler de octubre', 'Se retrasa 24 días'],
      ['Alquiler · Cañaveral 75', 'Alquiler de octubre: falta 1 de 3', 'Se retrasa 24 días'],
    ])
    expect(JSON.stringify(filas)).not.toMatch(/Arrendador/)
  })
  it('sin local, los alquileres van juntos por tipo: «Alquileres», falta 1 de 5', () => {
    const alq = (id: string, llego: boolean) => base({ id, tipo: 'alquiler', nombre: `Arrendador ${id}`, cadencia: 'mensual', dia: 1,
      llegadas: llego ? ['2026-08-01', '2026-09-01', '2026-10-01'] : ['2026-08-01', '2026-09-01'] })
    expect(loQueFalta(datos([alq('1', true), alq('2', false), alq('3', true), alq('4', true), alq('5', true)]), HOY).map((x) => [x.de, x.que]))
      .toEqual([['Alquileres', 'Alquiler de octubre: falta 1 de 5']])
  })
  it('una fuente que no es alquiler, con su local: el aviso dice de qué local es', () => {
    const luz = base({ id: 'luz', tipo: 'proveedor', nombre: 'Endesa', local: LOCAL.carabanchel, cadencia: 'mensual', dia: 22, llegadas: ['2026-08-22', '2026-09-22'] })
    expect(loQueFalta(datos([luz]), HOY).map((x) => [x.de, x.que])).toEqual([['Endesa', 'Factura de octubre · Camichi 4']])
  })
  it('el nombre de un local en los avisos: su dirección, como se dice; sin dirección, su nombre', () => {
    expect(nombreDelLocal(LOCAL.plaza)).toBe('Cañaveral 75')
    expect(nombreDelLocal({ nombre: 'Taller', direccion: null })).toBe('Taller')
  })
  it('el orden: lo más tarde arriba, luego lo más cercano; apagado en la empresa, nada', () => {
    const d = datos([XFERA, UBER, GLOVO, RIDERS, ...CANAVERAL])
    expect(loQueFalta(d, HOY).map((x) => [x.de, x.estado.texto])).toEqual([
      ['Alquiler · Cañaveral 75', 'Se retrasa 24 días'], ['Uber Eats', 'Se retrasa 21 días'], ['Glovo', 'Se retrasa 10 días'], ['Xfera', 'Aún a tiempo'], ['Riders de Catcher', 'Aún a tiempo'],
    ])
    expect(loQueFalta({ ...d, ajustes: { lo_que_falta: false, margen: 5 } }, HOY)).toEqual([])
  })
  it('«Por llegar este mes»: lo pendiente hasta el 31/10 que no va tarde (también la quincena de Glovo del 16 al 31, aunque falte la anterior)', () => {
    expect(porLlegarEsteMes(datos([XFERA, UBER, RIDERS, GLOVO]), HOY)).toEqual({ n: 4, de: ['Xfera', 'Uber Eats', 'Riders de Catcher', 'Glovo'] })
  })
})

describe('lo último', () => {
  const u = (o: Partial<Ultimo> & Pick<Ultimo, 'id'>): Ultimo => ({ fuente: 'bandeja', cuando: '2026-10-25T07:12:00Z', por: 'correo', que: null, de: null, importe: null, estado: 'recibido', donde: null, ...o })
  const p: DatosPuerta = {
    direcciones: [{ tipo: 'documentos', direccion: 'foodint@entrada.folvy.app', activa: true }],
    conectados: { bancos: [], uber_por_correo: true },
    ultimos: [
      u({ id: '1', fuente: 'liquidacion', que: 'liquidacion', donde: 'liquidaciones', estado: 'colocado' }),
      u({ id: '2', que: 'factura', donde: 'factura', estado: 'factura' }),
      u({ id: '3', que: null, estado: 'no_es_factura', cuando: '2026-10-24T08:02:00Z', por: 'subido' }),
      u({ id: '4', que: null, estado: 'repetida', cuando: '2026-10-10T08:02:00Z' }),
    ],
  }
  it('las pestañas: «Necesita que lo mires» es lo que nadie sabe qué es (una repetida no)', () => {
    expect(deLaPestana(p.ultimos, 'mirar').map((x) => x.id)).toEqual(['3'])
    expect(deLaPestana(p.ultimos, 'colocado').map((x) => x.id)).toEqual(['1', '2'])
    expect(deLaPestana(p.ultimos, 'ultimo')).toHaveLength(4)
  })
  it('cuándo llegó, en hora de Madrid', () => {
    expect(cuandoLlego('2026-10-25T07:12:00Z', HOY)).toBe('hoy 08:12')
    expect(cuandoLlego('2026-10-24T17:05:00Z', HOY)).toBe('ayer 19:05')
    expect(cuandoLlego('2026-10-20T08:00:00Z', HOY)).toBe('20/10 10:00')
  })
  it('las cifras de arriba: lo de la semana, lo que hay que mirar, lo que falta y lo que está por llegar', () => {
    const c = cifrasPuerta(p, datos([XFERA, GLOVO]), HOY)
    expect(c.llegado).toEqual({ n: 3, apoyo: '2 en su sitio' })
    expect(c.mirar).toEqual({ n: 1, apoyo: 'un documento que no reconozco' })
    expect(c.falta).toEqual({ n: 1, apoyo: 'Glovo' })
    expect(c.porLlegar).toEqual({ n: 2, apoyo: 'Xfera y Glovo' })
  })
})

describe('lo que se sube por la puerta', () => {
  const zipRiders = zipSync({ 'invoice_34974_ES_I_34974_26_00110.pdf': new Uint8Array([37, 80]), 'invoice_890_ES_I_PIT_26_03471.pdf': new Uint8Array([37, 80]) })
  it('la quincena de Catcher (el zip y sus dos hojas, con nombres que no dicen nada), un PDF, el extracto de BBVA y lo demás', () => {
    const g = clasificarSubida([
      { nombre: 'descarga.zip', tipo: 'application/zip', bytes: zipRiders },
      { nombre: 'export (1).xlsx', tipo: '' }, { nombre: 'export (2).xlsx', tipo: '' },
      { nombre: 'Factura F-77.pdf', tipo: 'application/pdf' }, { nombre: 'foto.jpg', tipo: 'image/jpeg' },
      { nombre: 'BBVA Histórico movimientos (6).xlsx', tipo: '' },
      { nombre: 'contrato.docx', tipo: '' },
    ])
    expect(g.map((x) => [x.camino, x.ficheros.map((f) => f.i)])).toEqual([['catcher', [0, 1, 2]], ['facturas', [3, 4]], ['extracto', [5]], ['sin_saber', [6]]])
    expect(g[1].texto).toBe('2 facturas o tickets: se leen y van a Compras › Facturas recibidas.')
  })
  it('una hoja suelta sin el zip de los riders no se toma por Catcher', () => {
    expect(clasificarSubida([{ nombre: 'export.xlsx', tipo: '' }]).map((x) => x.camino)).toEqual(['sin_saber'])
  })
})

describe('«Pedírsela»', () => {
  it('el correo propuesto: qué falta, hacia cuándo y a qué dirección mandarla', () => {
    expect(correoPedirla({ empresa: 'Llorente29 Food SL', que: 'Factura de octubre', hacia: '2026-10-22', direccion: 'foodint@entrada.folvy.app' })).toEqual({
      asunto: 'Factura de octubre · Llorente29 Food SL',
      cuerpo: 'Hola:\n\nNo nos ha llegado todavía: factura de octubre (solía llegar hacia el 22/10).\n¿Nos la podéis mandar a foodint@entrada.folvy.app? Así entra sola en la contabilidad.\n\nGracias.\nLlorente29 Food SL',
    })
  })
})
