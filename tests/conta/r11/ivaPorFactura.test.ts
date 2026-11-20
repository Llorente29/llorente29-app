// R11 · El IVA de Revo con 3 decimales, redondeado FACTURA A FACTURA (como Revo) y no al final del día.
// Con los ficheros de verdad, redondear al final rechazaba días por 2–7 céntimos («El IVA desglosado
// suma 131,93 € y el de las facturas 131,91 €»). Días INVENTADOS (T11): Impuestos con 3 decimales y
// Documentos con 2, como los da Revo (cada factura ya redondeada).

import { describe, expect, it } from 'vitest'
import { leerRevo, milesimasRevo, type FicheroRevo } from '../../../src/modules/conta/lib/lectorRevo'
import { porQueNoCuadra, prepararDias, textoAjuste } from '../../../src/modules/conta/lib/subirTpv'

const t = (...l: string[]) => l.join('\r\n') + '\r\n'
interface Fac { orden: string; numero: number; total: string; base: string; iva: string; lineas: [tipo: number, base: string, iva: string][] }
const hora = (k: number) => `2026-10-07 1${k}:00:00`
function ficheros(fs: Fac[]): FicheroRevo[] {
  return [
    { nombre: 'Ordenes_2026-10-07.csv', contenido: t('ID;Mesa;Sala;Empleado;Comensales;Abierto;Cerrado;Valor medio;Suma;Descuento;Subtotal;Impuesto total;Total;Entrega',
      ...fs.map((f, k) => `    ${f.orden};Mesa ${k};Sala;Empleado de ejemplo 1;1;${hora(k)};${hora(k)};${f.total};${f.total};0;${f.base};${f.iva};${f.total};--`)) },
    { nombre: 'Documentos_2026-10-07.csv', contenido: t('Orden;Documento;Contador;Cliente;NIF;Grupos de clientes;Fecha;Suma;Descuento;Subtotal;Impuesto total;Total',
      ...fs.map((f, k) => `    ${f.orden};${f.numero};Facturas;;;;${hora(k)};${f.total};0;${f.base};${f.iva};${f.total}`)) },
    { nombre: 'Impuestos_2026-10-07.csv', contenido: t('Orden;Impuesto;Total;Subtotal;Impuesto total;Fecha',
      ...fs.flatMap((f, k) => f.lineas.map(([tipo, b, q]) => `    ${f.orden};IVA ${tipo}%;${f.total};${b};${q};${hora(k)}`))) },
    { nombre: 'Pagos_2026-10-07.csv', contenido: t(';Orden;Total de la orden;Cliente;Factura;Caja;Fecha;Forma de pago;Turno;Empleado;Motivo de cancelación;Información adicional;Propina;Importe;Total',
      ...fs.map((f, k) => `    ${f.orden};${f.orden};${f.total};;${f.numero};Caja Principal;${hora(k)};Efectivo;8001;Empleado de ejemplo 1;;;0;${f.total};${f.total}`)) },
  ]
}
function dia(fs: Fac[]) {
  const r = leerRevo(ficheros(fs))
  if (!r.ok) throw new Error(r.problemas.join(' | '))
  return r.lectura.dias[0]
}
const cent = (xs: number[]) => xs.reduce((a, b) => a + Math.round(b * 100), 0)

// Cuatro facturas de 2,20 €: 2,004 + 0,196 en Impuestos; 2,00 + 0,20 en Documentos.
const IGUALES: Fac[] = [0, 1, 2, 3].map((k) => ({ orden: `91000${k}`, numero: 7001 + k, total: '2,20', base: '2,00', iva: '0,20', lineas: [[10, '2,004', '0,196']] }))
// Una factura de 10,00 € con dos tipos: al 10 %, 4,545 + 0,455; al 21 %, 4,132 + 0,868. Documentos: 8,68 + 1,32.
// Renglón a renglón, el IVA da 0,46 + 0,87 = 1,33: un céntimo más que la factura.
const DOS_TIPOS: Fac = { orden: '910009', numero: 7005, total: '10,00', base: '8,68', iva: '1,32', lineas: [[10, '4,545', '0,455'], [21, '4,132', '0,868']] }

describe('R11 · El IVA de Revo, redondeado factura a factura', () => {
  it('los 3 decimales se siguen leyendo', () => {
    expect(milesimasRevo('28,909')).toBe(28909)
    expect(milesimasRevo('2,1234')).toBeNull()
  })
  it('redondeado renglón a renglón, el IVA del día da lo mismo que Documentos y que Pagos (al final del día daba 0,78 contra 0,80)', () => {
    const d = dia(IGUALES)
    const l = d.lectura
    const imp = { base: cent(l.impuestos.map((i) => i.base)), iva: cent(l.impuestos.map((i) => i.cuota)) }
    const doc = { base: cent(l.documentos.map((x) => x.base)), iva: cent(l.documentos.map((x) => x.cuota)), total: cent(l.documentos.map((x) => x.total)) }
    // Las dos cifras del día (regla 31): Impuestos 8,00 + 0,80 = 8,80; Documentos 8,00 + 0,80 = 8,80; Pagos 8,80.
    expect(imp).toEqual({ base: 800, iva: 80 })
    expect(doc).toEqual({ base: 800, iva: 80, total: 880 })
    expect(cent(l.cobros.map((x) => x.importe))).toBe(880)
    expect(porQueNoCuadra(l)).toEqual([])
    expect(d.ajuste).toBeNull()
  })
  it('si aun así un céntimo no da, manda la factura: va al renglón del tipo mayor, el día cuadra y lo dice', () => {
    const d = dia([...IGUALES, DOS_TIPOS])
    const l = d.lectura
    const suyos = l.impuestos.filter((i) => i.orden === DOS_TIPOS.orden).map((i) => [i.tipo, i.base, i.cuota])
    expect(suyos).toEqual([[10, 4.55, 0.46], [21, 4.13, 0.86]])
    expect(cent(l.impuestos.map((i) => i.cuota))).toBe(cent(l.documentos.map((x) => x.cuota)))
    expect(porQueNoCuadra(l)).toEqual([])
    expect(d.ajuste).toEqual({ iva: -1, base: 0, facturas: 1 })
    expect(textoAjuste(d.ajuste!)).toBe('Ajuste de redondeo: 0,01 € de IVA, en 1 factura (manda la factura).')
    const [p] = prepararDias([d], [], [])
    expect(p.como).toBe('cuadra')
    expect(p.comprobaciones.map((x) => x.texto)).toContain('Ajuste de redondeo: 0,01 € de IVA, en 1 factura (manda la factura).')
  })
  it('con más de 1 céntimo en una factura no se ajusta: el día no se guarda, y ya no dice «Vuelve a sacar de Revo»', () => {
    const mal: Fac = { ...DOS_TIPOS, iva: '1,30', base: '8,70' }
    const d = dia([mal])
    expect(d.ajuste).toBeNull()
    const [p] = prepararDias([d], [], [])
    expect(p.como).toBe('no_cuadra')
    expect(p.aviso?.frases[0]).toMatch(/^El IVA desglosado suma 1,33 € y el de las facturas 1,30 €\./)
    expect(p.aviso?.queHacer).toBe('Los demás días se guardan igual.')
  })
})
