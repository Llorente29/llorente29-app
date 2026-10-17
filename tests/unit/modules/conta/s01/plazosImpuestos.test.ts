import { describe, expect, it } from 'vitest'
import { avisosDeImpuestos, frasePlazo, plazosDelAnio, sinFinDeSemana, type PerfilFiscal } from '@/modules/conta/lib/plazosImpuestos'

// Los modelos de la única fila de company_tax_profile en producción (Foodint, 17/10, tabla entera).
const FOODINT: PerfilFiscal = { modelos: ['111', '115', '180', '190', '200', '202', '303', '347', '390'], periodoIva: 'quarterly', sii: false }

describe('S01 · Los plazos de impuestos del Inicio (dos plazos: domiciliado el 15; si no, el 20)', () => {
  it('el 17/10/2026, Foodint: 303, 111 y 115 del 3.er trimestre y el 2.º pago del 202, hasta el 20; domiciliar ya pasó', () => {
    const a = avisosDeImpuestos(FOODINT, '2026-10-17')
    expect(a.map((x) => x.modelo)).toEqual(['111', '115', '202', '303'])
    for (const x of a) expect([x.hasta, x.domiciliado]).toEqual(['2026-10-20', '2026-10-15'])
    expect(a.find((x) => x.modelo === '303')!.que).toBe('IVA del 3.er trimestre de 2026')
    expect(frasePlazo(a[0], '2026-10-17')).toBe('Domiciliar ya no se puede (era hasta el 15/10); presentarlo y pagarlo, hasta el 20/10.')
    expect(frasePlazo(a[0], '2026-10-10')).toBe('Si lo domicilias, hasta el 15/10; si no, hasta el 20/10.')
  })

  it('en enero: 303 hasta el 30 (domiciliado el 25), 111 y 115 hasta el 20 (el 15), y los resúmenes sin pago', () => {
    const enero = plazosDelAnio(FOODINT, 2027).filter((x) => x.desde.startsWith('2027-01'))
    const de = (m: string) => enero.find((x) => x.modelo === m)!
    expect([de('303').hasta, de('303').domiciliado]).toEqual(['2027-02-01', '2027-01-25']) // el 30/01/2027 es sábado
    expect([de('111').hasta, de('111').domiciliado]).toEqual(['2027-01-20', '2027-01-15'])
    expect(de('303').que).toBe('IVA del 4.º trimestre de 2026')
    expect(de('390').domiciliado).toBeNull()
    expect(frasePlazo(de('390'), '2027-01-10')).toBe('Hasta el 01/02. No se paga: es informativo.')
  })

  it('el último día en fin de semana pasa al lunes; el domiciliado no se mueve', () => {
    expect(sinFinDeSemana('2027-01-30')).toBe('2027-02-01')
    expect(sinFinDeSemana('2027-01-31')).toBe('2027-02-01')
    expect(sinFinDeSemana('2026-10-20')).toBe('2026-10-20')
    const julio = plazosDelAnio(FOODINT, 2027).find((x) => x.modelo === '303' && x.desde === '2027-07-01')!
    expect([julio.hasta, julio.domiciliado]).toEqual(['2027-07-20', '2027-07-15'])
  })

  it('el 200 en julio (25; domiciliado el 20) y el 347 todo febrero', () => {
    const a = plazosDelAnio(FOODINT, 2028)
    expect(a.find((x) => x.modelo === '200')).toMatchObject({ desde: '2028-07-01', hasta: '2028-07-25', domiciliado: '2028-07-20' })
    expect(a.find((x) => x.modelo === '347')).toMatchObject({ desde: '2028-02-01', hasta: '2028-02-29', domiciliado: null })
  })

  it('IVA mensual: del 1 al 20 del mes siguiente; en el SII, hasta el 30 (domiciliado el 25)', () => {
    const fuera = avisosDeImpuestos({ modelos: ['303'], periodoIva: 'monthly', sii: false }, '2026-11-03')
    expect(fuera[0]).toMatchObject({ que: 'IVA de octubre de 2026', hasta: '2026-11-20', domiciliado: '2026-11-15' })
    const sii = avisosDeImpuestos({ modelos: ['303'], periodoIva: 'monthly', sii: true }, '2026-11-03')
    expect(sii[0]).toMatchObject({ hasta: '2026-11-30', domiciliado: '2026-11-25' })
  })

  it('lo que se abre en los próximos 15 días sale antes de abrirse; lo vencido no sale; sin modelos, nada', () => {
    const a = avisosDeImpuestos(FOODINT, '2026-12-20')
    // El 20/12/2026 es domingo: el 202 pasa al 21. El 30 y el 31/01/2027 son fin de semana: al 01/02.
    expect(a.map((x) => `${x.modelo}:${x.hasta}`)).toEqual(['202:2026-12-21', '111:2027-01-20', '115:2027-01-20', '180:2027-02-01', '190:2027-02-01', '303:2027-02-01', '390:2027-02-01'])
    expect(frasePlazo(a.find((x) => x.modelo === '111')!, '2026-12-20')).toBe('Del 01/01 al 20/01; domiciliando el pago, hasta el 15/01.')
    expect(avisosDeImpuestos(FOODINT, '2026-10-21').map((x) => x.modelo)).toEqual([])
    expect(avisosDeImpuestos({ modelos: [], periodoIva: null, sii: false }, '2026-10-17')).toEqual([])
  })
})
