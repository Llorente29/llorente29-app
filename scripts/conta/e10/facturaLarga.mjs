// scripts/conta/e10/facturaLarga.mjs
//
// E10 · LA FACTURA LARGA INVENTADA: la mensual de un proveedor de aves, con un albarán por
// entrega y cada línea con su lote y su caducidad. Todo inventado (T11): el proveedor, el
// cliente, los NIF (todo ceros), el IBAN (banco 9999), los lotes. Lo usan:
//   · generar-facturas-largas.mjs, que hace sus PDF (5 páginas y 10 páginas);
//   · las unitarias del E10 (tests/conta/e10), para juntar las líneas;
//   · leer-facturas-largas.ts, que las lee con el modelo de verdad y compara.
//
//   facturaLarga({ albaranes: 20, numero: 'AV-2026-0000011' })
// Devuelve la cabecera, los albaranes con sus líneas, las bases por tipo y el total.

const PRODUCTOS = [
  { codigo: 'P0101', texto: 'Pollo entero limpio', iva: 10, precio: 3.45 },
  { codigo: 'P0102', texto: 'Muslo de pollo', iva: 10, precio: 2.95 },
  { codigo: 'P0103', texto: 'Pechuga de pollo fileteada', iva: 10, precio: 7.80 },
  { codigo: 'P0104', texto: 'Alitas de pollo partidas', iva: 10, precio: 3.10 },
  { codigo: 'P0105', texto: 'Contramuslo deshuesado', iva: 10, precio: 6.25 },
  { codigo: 'H0201', texto: 'Huevos camperos M (docena)', iva: 4, precio: 2.40 },
]

const cent = (n) => Math.round(n * 100)
const dos = (n) => Math.round(n * 100) / 100
const dia = (d) => `2026-10-${String(d).padStart(2, '0')}`
const mas = (iso, dias) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + dias); return t.toISOString().slice(0, 10) }

/**
 * Los albaranes: los primeros 14 de cada 20 llevan dos líneas y los demás una
 * (20 albaranes → 34 líneas; 40 → 68). Cantidades y precios fijos por posición:
 * la misma llamada da siempre la misma factura.
 */
export function facturaLarga({ albaranes = 20, numero = 'AV-2026-0000011' } = {}) {
  const lista = []
  let n = 0
  for (let a = 0; a < albaranes; a++) {
    const fecha = dia(1 + (a % 30))
    const cuantas = a % 20 < 14 ? 2 : 1
    const lineas = []
    for (let k = 0; k < cuantas; k++) {
      const p = PRODUCTOS[(a * 2 + k) % PRODUCTOS.length]
      const cantidad = p.codigo.startsWith('H') ? 5 + ((a + k) % 6) : dos(4 + ((a * 7 + k * 3) % 17) * 0.5 + ((a + k) % 4) * 0.05)
      const importe = dos(cantidad * p.precio)
      n++
      lineas.push({
        supplier_code: p.codigo, raw_text: p.texto, quantity: cantidad, unit: p.codigo.startsWith('H') ? 'docena' : 'kg',
        unit_price_net: p.precio, line_amount: importe, vat_pct: p.iva,
        lot_code: `L-${String(a + 1).padStart(3, '0')}-${String(k + 1).padStart(2, '0')}`, expiry_date: mas(fecha, p.codigo.startsWith('H') ? 28 : 6),
      })
    }
    lista.push({ numero: `ALB-${String(a + 1).padStart(5, '0')}`, fecha, lineas })
  }
  const todas = lista.flatMap((a) => a.lineas)
  const porTipo = new Map()
  for (const l of todas) porTipo.set(l.vat_pct, (porTipo.get(l.vat_pct) ?? 0) + cent(l.line_amount))
  const tipos = [...porTipo.entries()].sort((a, b) => b[0] - a[0]).map(([tipo, c]) => ({ vat_pct: tipo, base: c / 100, vat_amount: Math.round(c * tipo / 100) / 100 }))
  const base = tipos.reduce((s, t) => s + cent(t.base), 0) / 100
  const cuota = tipos.reduce((s, t) => s + cent(t.vat_amount), 0) / 100
  return {
    proveedor: { nombre: 'Avícola de Prueba, S.L.', nif: 'B00000000', direccion: 'Calle Inventada 1, 00000 Pueblo de Prueba' },
    cliente: { nombre: 'Restaurante de Prueba, S.L.', nif: 'A00000000', direccion: 'Calle de Ejemplo 2, 00000 Ciudad de Prueba' },
    numero, fecha: '2026-10-31', vence: '2026-11-30', formaPago: 'Transferencia a 30 días', iban: 'ES0099990000000000000000',
    albaranes: lista, lineas: todas, tipos, base, cuota, total: dos(base + cuota),
  }
}
