// tests/unit/modules/conta/r21/pantalla.test.tsx
//
// R21 · La pantalla «Facturar el mes» (FacturarMes.tsx), pintada con datos inventados (T11): noviembre como hoy abre
// en el paso 4 con los pasos 1 a 3 en verde y la cifra que Cegid tiene que dar; el paso 5 en gris; «Pendientes: N»
// arriba; y con un caso por resolver, el paso 2 con sus botones y «Dejar los N para después y seguir». Sin palabras
// de la base («incidencia», «decisión», nombres de tablas).

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { casosDelMes, cuadreDelMes, pasoCuatro, pasosDelMes, type MandadoCegid } from '../../../../../supabase/functions/_shared/factura/facturarMes'
import { FacturarMes, type CasoVista, type PropsFacturarMes } from '@/modules/conta/gestoria/r21/FacturarMes'

const NOV = '2026-11'
const nada = () => undefined
const mandado: MandadoCegid[] = [{ cliente: 1001, nombre: 'Cliente uno de prueba', serie: '1', totalCent: 12100, estado: 'mandada' }, { cliente: 1002, nombre: 'Cliente dos de prueba', serie: '1', totalCent: 6050, estado: 'mandada' }]
const paso4 = pasoCuatro(mandado)
const cuadre = cuadreDelMes(NOV, { cobradoCent: 18150, noEsCobroCent: 0, mandadoCent: 18150, pagaFacturasCent: 0 }, [])
const props = (x: Partial<PropsFacturarMes> = {}): PropsFacturarMes => ({
  empresa: 'Gestoría de Prueba, S.L.', mes: NOV, meses: [{ valor: NOV, texto: 'Noviembre 2026' }, { valor: '2026-12', texto: 'Diciembre 2026' }], alCambiarMes: nada,
  pasos: pasosDelMes({ preparado: { cobradoCent: 18150, listos: 2, casos: 0 }, casos: [], cuadre, porMandar: 0, mandados: 2, paso4, vistoBueno: null, paso5: null }),
  preparar: { frase: null, alPulsar: nada }, casos: [], ocupado: null, frases: {}, conceptos: [], alAccion: nada, alDeshacer: nada, alDejarTodos: nada,
  cuadre, mandar: { cobros: 0, frase: null, alPulsar: nada }, serie1: paso4.serie1, vistoBueno: null, alCoincide: nada, serie3: paso4.serie3,
  contasimple: { cuotas: 0, cent: 0, frase: null, alPulsar: nada }, comprobar: { frase: null, faltan: null, alPulsar: nada }, pendientes: [], alResolverPendiente: nada, ...x,
})

describe('R21 · la pantalla', () => {
  it('noviembre como hoy: pasos 1 a 3 en verde, abre en el 4 con la cifra grande y el 5 en gris', () => {
    const h = renderToStaticMarkup(<FacturarMes {...props()} />)
    expect(h).toContain('Facturar noviembre de 2026')
    expect(h).toContain('Paso 4 de 5')
    expect((h.match(/data-hecho="si"/g) ?? []).length).toBe(3)
    expect(h).toContain('181,50 € · 2 facturas')
    expect(h).toContain('Nunca «Generar».')
    expect(h).toContain('Coincide: mandar el listado a QBO')
    expect(h).toMatch(/data-prueba="paso-5"[^>]*data-falta="si"/)
    expect(h).toContain('Pendientes: 0')
    // R21d · Se puede volver a recorrer desde el paso 1, sin deshacer nada.
    expect(h).toContain('Empezar desde el paso 1')
    // Un solo botón principal en el paso activo (más «No coincide», que no es principal).
    expect((h.match(/class="r21-boton"(?![^>]*data-tipo)/g) ?? []).length).toBe(1)
  })
  it('con un caso por resolver: su tarjeta con la propuesta, sus botones y «Dejar el 1 para después y seguir»', () => {
    const entrada = { clave: 'mov:1', tipo: 'paga_sin_recibo' as const, cliente: 'El cliente 1002', importeCent: 6050, fecha: '2026-11-23', frase: 'El cliente 1002 pagó 60,50 € por transferencia el 23/11.',
      propuesta: 'facturarle con el concepto 00001 Gestoría mensual, 60,50 € IVA incluido.', falta: null, decidido: false }
    const casos = casosDelMes(NOV, [entrada], [])
    const vista: CasoVista[] = casos.map((c) => ({ ...c, resuelto: false, hecho: null, deshacer: false, aMano: null,
      acciones: [{ id: 'si', texto: 'Sí, facturar', principal: true, efecto: { que: 'facturar', clave: 'mov:1', cliente: 1002, concepto: '00001' } },
        { id: 'dejar', texto: 'Dejar para después', principal: false, efecto: { que: 'dejar', motivo: 'x' } }] }))
    const pasos = pasosDelMes({ preparado: { cobradoCent: 18150, listos: 2, casos: 1 }, casos, cuadre, porMandar: 2, mandados: 0, paso4: null, vistoBueno: null, paso5: null })
    const h = renderToStaticMarkup(<FacturarMes {...props({ pasos, casos: vista })} />)
    expect(h).toContain('Paso 2 de 5')
    expect(h).toContain('Cliente que paga sin recibo')
    expect(h).toContain('Sumied propone:')
    expect(h).toContain('Sí, facturar')
    expect(h).toContain('Dejar el 1 para después y seguir')
    for (const jerga of ['incidencia', 'decisión', 'conta_', 'Julio']) expect(h).not.toContain(jerga)
  })
  it('R21e · un mes aún sin cobros: dice lo que GoCardless tiene previsto y abre en el paso 1, sin pasos hechos', () => {
    const vacio = cuadreDelMes('2026-12', { cobradoCent: 0, noEsCobroCent: 0, mandadoCent: 0, pagaFacturasCent: 0 }, [])
    const pasos = pasosDelMes({ preparado: { cobradoCent: 0, listos: 0, casos: 0 }, casos: [], cuadre: vacio, porMandar: 0, mandados: 0, paso4: null, vistoBueno: null, paso5: null })
    const h = renderToStaticMarkup(<FacturarMes {...props({ mes: '2026-12', pasos, cuadre: vacio, serie1: null, serie3: null,
      sinCobros: 'Diciembre aún no tiene cobros. GoCardless tiene previsto cobrar 250,00 € en 3 cargos, el primero el 01/12. Cuando cobre, empieza por el paso 1.' })} />)
    expect(h).toContain('GoCardless tiene previsto cobrar 250,00 € en 3 cargos')
    expect(h).toContain('Paso 1 de 5')
    expect(h).not.toContain('data-hecho="si"')
    expect(h).not.toContain('Empezar desde el paso 1')
  })
})
