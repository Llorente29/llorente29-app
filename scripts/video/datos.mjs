// scripts/video/datos.mjs — V01 · los datos inventados del vídeo (T11).
//
// Parecen de verdad, pero se ven inventados donde importa: los NIF son de
// ceros con su letra de control, y los IBAN son del banco 9999, que no existe.
// Los nombres son de proveedor de hostelería genérico, sin ninguna persona.

/** IBAN español del banco 9999 con su control bien calculado. */
export function iban9999(cuenta10) {
  const P = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
  const dc = (d10) => { const r = 11 - (d10.split('').reduce((s, c, i) => s + Number(c) * P[i], 0) % 11); return r === 11 ? 0 : r === 10 ? 1 : r }
  const cuenta = cuenta10.padStart(10, '0')
  const bban = `9999${'0001'}${dc('0099990001')}${dc(cuenta)}${cuenta}`
  const num = `${bban}142800` // E=14, S=28, 00
  let r = 0
  for (const c of num) r = (r * 10 + Number(c)) % 97
  return `ES${String(98 - r).padStart(2, '0')}${bban}`
}

export const EMPRESA = { nombre: 'Taberna del Mercado SL' }

/** Las tres de pagar. La primera es además la que se lee en el paso 2. */
export const FACTURAS = [
  {
    proveedor: 'Frutas y Verduras La Huerta SL', nif: 'B00000018', numero: 'FV-2026/1187', iban: iban9999('4410000187'),
    lineas: [
      { texto: 'Tomate pera, caja 10 kg', cantidad: 6, precio: 14.9, iva: 4 },
      { texto: 'Lechuga romana, caja 12 ud', cantidad: 4, precio: 11.4, iva: 4 },
      { texto: 'Patata agria, saco 25 kg', cantidad: 3, precio: 18.75, iva: 4 },
      { texto: 'Limón, caja 5 kg', cantidad: 2, precio: 9.6, iva: 4 },
      { texto: 'Aceite de oliva virgen extra, garrafa 5 l', cantidad: 2, precio: 34.5, iva: 10 },
    ],
    titular: 'coincide', ibanNuevo: false,
  },
  {
    proveedor: 'Cárnicas del Centro SL', nif: 'B00000026', numero: 'CC-26-0942', iban: iban9999('7720004421'),
    lineas: [
      { texto: 'Lomo de cerdo ibérico, kg', cantidad: 18, precio: 12.4, iva: 10 },
      { texto: 'Pollo de corral entero, kg', cantidad: 25, precio: 4.85, iva: 10 },
      { texto: 'Chuletón de vaca madurado, kg', cantidad: 12, precio: 29.9, iva: 10 },
    ],
    titular: 'coincide', ibanNuevo: true,
  },
  {
    proveedor: 'Bebidas Sierra Norte SA', nif: 'A00000034', numero: 'SN/2026/3310', iban: iban9999('1330009870'),
    lineas: [
      { texto: 'Cerveza barril 30 l', cantidad: 4, precio: 82.0, iva: 21 },
      { texto: 'Agua mineral 1,5 l, pack 6', cantidad: 20, precio: 3.1, iva: 10 },
      { texto: 'Refresco de cola, caja 24 latas', cantidad: 6, precio: 13.8, iva: 21 },
    ],
    titular: 'coincide', ibanNuevo: false,
  },
]

const r2 = (x) => Math.round(x * 100) / 100
export function totales(f) {
  const porIva = new Map()
  for (const l of f.lineas) porIva.set(l.iva, r2((porIva.get(l.iva) ?? 0) + r2(l.cantidad * l.precio)))
  const tramos = [...porIva].map(([iva, base]) => ({ iva, base, cuota: r2(base * iva / 100) }))
  const base = r2(tramos.reduce((s, t) => s + t.base, 0))
  const iva = r2(tramos.reduce((s, t) => s + t.cuota, 0))
  return { tramos, base, iva, total: r2(base + iva) }
}

const eur = (x) => x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/** El HTML de la factura (para sacar su PDF con Chromium). */
export function facturaHtml(f, fecha, cliente) {
  const t = totales(f)
  const filas = f.lineas.map((l) => `<tr><td>${l.texto}</td><td class="n">${l.cantidad}</td><td class="n">${eur(l.precio)}</td><td class="n">${l.iva} %</td><td class="n">${eur(r2(l.cantidad * l.precio))}</td></tr>`).join('')
  const tramos = t.tramos.map((x) => `<tr><td>Base ${x.iva} %</td><td class="n">${eur(x.base)}</td></tr><tr><td>IVA ${x.iva} %</td><td class="n">${eur(x.cuota)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:'DejaVu Sans',Arial,sans-serif;font-size:12px;color:#222;margin:40px}
  .cab{display:flex;justify-content:space-between;border-bottom:3px solid #2f6b3a;padding-bottom:14px}
  .marca{font-size:22px;font-weight:700;color:#2f6b3a}.pe{color:#555;line-height:1.5}
  h1{font-size:20px;margin:24px 0 6px}table{width:100%;border-collapse:collapse;margin-top:14px}
  th{background:#eef4ef;text-align:left;padding:7px;border-bottom:1px solid #9bb8a0}td{padding:7px;border-bottom:1px solid #e3e3e3}
  .n{text-align:right}.tot{width:300px;margin-left:auto}.tot td{border:none;padding:4px 7px}.g td{font-size:15px;font-weight:700;border-top:2px solid #2f6b3a}
  .dos{display:flex;gap:40px;margin-top:10px}.caja{border:1px solid #ccc;padding:10px 14px;flex:1;line-height:1.5}
  .pie{margin-top:30px;color:#555}
  </style></head><body>
  <div class="cab"><div><div class="marca">${f.proveedor}</div><div class="pe">NIF ${f.nif}<br>Polígono Industrial Norte, nave 7<br>28000 Madrid</div></div>
  <div class="pe" style="text-align:right"><b>FACTURA</b><br>Nº ${f.numero}<br>Fecha ${fecha.split('-').reverse().join('/')}</div></div>
  <div class="dos"><div class="caja"><b>Cliente</b><br>${cliente}<br>Calle Mayor 1<br>28000 Madrid</div>
  <div class="caja"><b>Forma de pago</b><br>Transferencia a 15 días<br>IBAN ${f.iban.replace(/(.{4})/g, '$1 ').trim()}</div></div>
  <table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">IVA</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody></table>
  <table class="tot">${tramos}<tr class="g"><td>TOTAL</td><td class="n">${eur(t.total)}</td></tr></table>
  <div class="pie">Gracias por su confianza.</div></body></html>`
}
