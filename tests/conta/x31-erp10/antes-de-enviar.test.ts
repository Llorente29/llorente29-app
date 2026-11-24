// tests/conta/x31-erp10/antes-de-enviar.test.ts
//
// X31 · 2 · Antes de enviar a ERP10, mirar (supabase/functions/_shared/erp10Escribir.ts), contra un puerto de mentira con las
// reglas de conta_erp10_envio_tomar y un ERP10 simulado (respuesta de Julio, 24/11):
//   · una factura que ya está en ERP10 (mismo número y mismo tercero, por su cuenta o por su NIF) no se manda ni se enlaza
//     sola: queda en duda, con su número y los dos totales; si el total no es el mismo, se ve la diferencia;
//   · a la que ya estaba nunca se le sube el PDF de Sumied;
//   · un asiento del mismo día con la misma cuenta y el mismo importe en su línea principal: en duda; si la persona dijo «Es
//     otro», se manda sin mirar;
//   · lo nuevo sale; lo que escribió el mismo envío antes de cortarse se enlaza solo (es lo suyo).
// Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { lineaPrincipal, sacarAsiento, sacarRecibida, textoDuda, type AsientoParaApi, type Envio, type PuertoEscribir, type RecibidaParaApi } from '../../../supabase/functions/_shared/erp10Escribir'

const HOY = '2026-11-24'
const recibida = (o: Partial<RecibidaParaApi> = {}): RecibidaParaApi => ({
  entryId: 'r-1', numero: 'F-0007', fechaFactura: '2026-11-03', fechaAsiento: '2026-11-05', nif: 'B00000000', nombre: 'Proveedor Inventado, S.L.',
  proveedor: '40000009', tipoOperacion: 'OI', gastos: [{ cuenta: '62300000', importe: 10000 }], iva: [{ pct: 21, base: 10000, cuota: 2100 }], retencion: null, total: 12100, ...o,
})
const ap = (cuenta: string, debe: number, haber: number) => ({ cuenta, debe, haber, concepto: 'Pago inventado' })
const pago: AsientoParaApi = { entryId: 'a-1', numero: '3/1', fecha: '2026-11-05', apuntes: [ap('41000012', 10000, 0), ap('57200001', 0, 10000)] }

type Fila = Envio & { cambiado: number }
function mundo(erp: { facturas?: Record<string, unknown>[]; apuntes?: Record<string, unknown>[] } = {}) {
  const reloj = Date.parse('2026-11-24T10:00:00Z')
  const filas = new Map<string, Fila>()
  const e = { facturas: [...(erp.facturas ?? [])], apuntes: [...(erp.apuntes ?? [])], altasF: 0, altasA: 0, subidas: 0 }
  const p: PuertoEscribir = {
    hoy: HOY,
    tomar: async (entryId) => {
      const f = filas.get(entryId)
      if (!f) {
        const n: Fila = { id: `envio-${entryId}`, entry_id: entryId, estado: 'enviando', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null, cambiado: reloj }
        filas.set(entryId, n)
        return { tomado: true, envio: { ...n } }
      }
      if (f.estado === 'no_pudo' || (f.estado === 'enviando' && reloj - f.cambiado > 3 * 60_000)) {
        Object.assign(f, { estado: 'enviando', intentos: f.intentos + 1, motivo: null })
        return { tomado: true, envio: { ...f } }
      }
      return { tomado: false, envio: { ...f } }
    },
    poner: async (id, cambios) => { Object.assign([...filas.values()].find((x) => x.id === id)!, cambios) },
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    erp10: {
      tieneSubcuenta: async () => true,
      crearSubcuenta: async () => undefined,
      facturasDelMes: async (m) => e.facturas.filter((f) => String(f.Fecha).startsWith(m.replace('-', ''))),
      altaFactura: async (fd) => { const f = { ...fd, Documento: 900 + e.facturas.length }; e.facturas.push(f); e.altasF++; return f },
      subirDocumento: async () => { e.subidas++; return { status: 200, motivo: null } },
      apuntesDelMes: async (m) => e.apuntes.filter((a) => String(a.Fecha).startsWith(m.replace('-', ''))),
      altaApunte: async (a) => { const x = { ...a, Documento: 700 + e.apuntes.length }; e.apuntes.push(x); e.altasA++; return x },
    },
  }
  return { p, filas, e }
}
const PDF = { ruta: 'x/f.pdf', nombre: 'f.pdf' }

describe('una factura que ya está en ERP10', () => {
  it('mismo número y mismo tercero, el mismo total: no se manda ni se enlaza; en duda, «Ya está en ERP10 (asiento N)», con los dos totales', async () => {
    const m = mundo({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 51, NumeroFactura: 'F-0007', CuentaCliente: '40000009', TotalFactura: 121, Fecha: 20261105 }] })
    const r = await sacarRecibida(recibida(), [], PDF, m.p)
    expect(r).toMatchObject({ estado: 'duda', porque: 'Ya está en ERP10 (asiento 51).', duda: { que: 'factura', documento: 51, totalErp10Cent: 12100, totalSumiedCent: 12100 } })
    expect(m.filas.get('r-1')).toMatchObject({ estado: 'duda', erp10_documento: null })
    expect([m.e.altasF, m.e.subidas], 'ni se escribe ni se le sube el PDF').toEqual([0, 0])
  })
  it('el mismo número y otro total: en duda, con los dos totales (la pantalla enseña la diferencia en rojo)', async () => {
    const m = mundo({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 52, NumeroFactura: 'F-0007', CuentaCliente: '40000009', TotalFactura: 120, Fecha: 20261105 }] })
    expect((await sacarRecibida(recibida(), [], PDF, m.p)).duda).toMatchObject({ totalErp10Cent: 12000, totalSumiedCent: 12100 })
  })
  it('el mismo tercero por su NIF, aunque en ERP10 tenga otra cuenta: en duda', async () => {
    const m = mundo({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 53, NumeroFactura: 'F-0007', CuentaCliente: '40000077', CifCliente: 'ES-B00000000', TotalFactura: 121, Fecha: 20261105 }] })
    expect(await sacarRecibida(recibida(), [], PDF, m.p)).toMatchObject({ estado: 'duda', duda: { documento: 53 } })
  })
  it('el mismo número de otro proveedor: no es la misma; sale, con su PDF', async () => {
    const m = mundo({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 54, NumeroFactura: 'F-0007', CuentaCliente: '40000077', CifCliente: 'B11111111', TotalFactura: 121, Fecha: 20261105 }] })
    expect(await sacarRecibida(recibida(), [], PDF, m.p)).toMatchObject({ estado: 'en_erp10', enlazada: false, pdf: 'subido' })
    expect(m.e.altasF).toBe(1)
  })
  it('la que escribió el mismo envío antes de cortarse (ya pidió el alta): es la suya, se enlaza sola', async () => {
    const m = mundo({ facturas: [{ Ejercicio: '2026', Serie: '2', Documento: 55, NumeroFactura: 'F-0007', CuentaCliente: '40000009', TotalFactura: 121, Fecha: 20261105 }] })
    m.filas.set('r-1', { id: 'envio-r-1', entry_id: 'r-1', estado: 'no_pudo', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: 'cortado',
      intentos: 1, lote_id: null, cambiado: 0, alta_pedida_en: '2026-11-24T09:59:00Z' })
    expect(await sacarRecibida(recibida(), [], PDF, m.p)).toMatchObject({ estado: 'en_erp10', documento: 55, enlazada: true })
  })
  it('«Ya está en ERP10 (asiento N)», y si encajan varios, cuántos más', () => {
    expect(textoDuda({ documento: 51, cuantos: 1 })).toBe('Ya está en ERP10 (asiento 51).')
    expect(textoDuda({ documento: 51, cuantos: 3 })).toBe('Ya está en ERP10 (asiento 51) y 2 más que encajan.')
  })
})

describe('un asiento que ya está en ERP10', () => {
  it('la línea principal: la que más mueve, con su cuenta y su lado', () => {
    expect(lineaPrincipal([{ Cuenta: '41000012', Debe: 100, Haber: 0 }, { Cuenta: '57200001', Debe: 0, Haber: 100 }, { Cuenta: '62600000', Debe: 2, Haber: 0 }]))
      .toEqual({ cuenta: '41000012', debe: 10000, haber: 0 })
  })
  it('el mismo día, la misma cuenta y el mismo importe: en duda (aunque el resto del asiento sea distinto); no se escribe', async () => {
    const m = mundo({ apuntes: [{ Ejercicio: '2026', Serie: '1', Documento: 61, TipoAsiento: 0, Fecha: 20261105, Detalles: [{ Cuenta: '41000012', Debe: 100, Haber: 0 }, { Cuenta: '57200009', Debe: 0, Haber: 100 }] }] })
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'duda', porque: 'Ya está en ERP10 (asiento 61).', duda: { que: 'asiento', documento: 61, fecha: '2026-11-05' } })
    expect(m.e.altasA).toBe(0)
  })
  it('«Es otro, mándalo»: con la decisión de la persona, sale sin mirar', async () => {
    const m = mundo({ apuntes: [{ Ejercicio: '2026', Serie: '1', Documento: 62, TipoAsiento: 0, Fecha: 20261105, Detalles: [{ Cuenta: '41000012', Debe: 100, Haber: 0 }] }] })
    await sacarAsiento(pago, [], m.p)
    Object.assign(m.filas.get('a-1')!, { estado: 'no_pudo', decision: 'otro' })
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'en_erp10', enlazada: false })
    expect(m.e.altasA).toBe(1)
  })
  it('otro día u otro importe: no encaja; sale', async () => {
    const m = mundo({ apuntes: [
      { Ejercicio: '2026', Serie: '1', Documento: 63, TipoAsiento: 0, Fecha: 20261106, Detalles: [{ Cuenta: '41000012', Debe: 100, Haber: 0 }] },
      { Ejercicio: '2026', Serie: '1', Documento: 64, TipoAsiento: 0, Fecha: 20261105, Detalles: [{ Cuenta: '41000012', Debe: 99.99, Haber: 0 }] },
    ] })
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'en_erp10', enlazada: false })
  })
  it('en duda, otra salida no lo vuelve a coger: espera a una persona', async () => {
    const m = mundo({ apuntes: [{ Ejercicio: '2026', Serie: '1', Documento: 65, TipoAsiento: 0, Fecha: 20261105, Detalles: [{ Cuenta: '41000012', Debe: 100, Haber: 0 }] }] })
    await sacarAsiento(pago, [], m.p)
    expect(await sacarAsiento(pago, [], m.p)).toMatchObject({ estado: 'duda', duda: { documento: 65 } })
    expect(m.e.altasA).toBe(0)
  })
})
