// scripts/conta/diez/muestra-resumen-ventas.ts
//
// C04b · R14 · La MAQUETA del «Resumen de ventas»: el PDF con datos
// INVENTADOS (empresa, pedidos e importes), para que Julio lo vea antes de
// dejarlo fijo. No lee ninguna base.
//
//   npx tsx scripts/conta/diez/muestra-resumen-ventas.ts salida.pdf
import { writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import { resumenVentasPdf, type MarcaResumen, type PedidoResumen } from '../../../supabase/functions/_shared/resumenVentasPdf.ts'

// Pedidos inventados: cuatro marcas, a lo largo del día, al 10 %.
const marcas = [['Marca Uno', '70000001'], ['Marca Dos', '70000002'], ['Marca Tres', '70000005'], ['Marca Cuatro', '70000006']] as const
const totales = [18.9, 24.5, 12.0, 31.4, 15.8, 22.6, 9.9, 27.3, 19.5, 14.2, 35.0, 21.7, 16.4, 28.9, 11.5, 23.8, 17.6, 26.4, 13.9, 30.2, 20.1, 15.3]
const horas = ['12:41', '13:05', '13:22', '13:47', '14:03', '14:18', '14:36', '15:02', '19:58', '20:14', '20:31', '20:49', '21:03', '21:17', '21:26', '21:40', '21:52', '22:05', '22:19', '22:34', '22:51', '23:12']
const base = (t: number) => Math.round((t * 100) / 1.1) / 100
const pedidos: PedidoResumen[] = totales.map((t, i) => {
  const b = base(t)
  return { hora: horas[i], codigo: `A${(83412 + i * 37).toString(36).toUpperCase()}`, marca: marcas[i % 4][0], base: b, cuota: Math.round((t - b) * 100) / 100, total: t }
})
const reembolsos: PedidoResumen[] = [{ hora: '21:58', codigo: 'A1Y7K2', marca: 'Marca Dos', base: base(12.1), cuota: Math.round((12.1 - base(12.1)) * 100) / 100, total: 12.1 }]
const c = (x: number) => Math.round(x * 100)
const lineas: MarcaResumen[] = marcas.map(([m, cuenta]) => ({ marca: m, cuenta, importe: pedidos.filter((p) => p.marca === m).reduce((t, p) => t + c(p.base), 0) / 100 }))
lineas.push({ marca: 'Marca Dos', cuenta: '70800002', importe: -c(reembolsos[0].base) / 100 })
const suma = (k: 'base' | 'cuota' | 'total') => (pedidos.reduce((t, p) => t + c(p[k]), 0) - reembolsos.reduce((t, p) => t + c(p[k]), 0)) / 100
const pdf = resumenVentasPdf(jsPDF, {
  empresa: { nombre: 'Cocinas de Ejemplo, S.L.', nif: 'B00000000' }, local: 'Local Centro', plataforma: 'Uber Eats', fecha: '2026-10-01',
  numeroFactura: 'UBR-CEN-20261001', generado: new Date('2026-10-13T09:42:00Z'), tipoIva: 10,
  pedidos, reembolsos, lineasFactura: lineas, factura: { base: suma('base'), cuota: suma('cuota'), total: suma('total') }, cobro: suma('total'),
})
writeFileSync(process.argv[2] ?? 'resumen-de-ventas-muestra.pdf', pdf)
console.log(`PDF de muestra: ${pdf.length} bytes`)
