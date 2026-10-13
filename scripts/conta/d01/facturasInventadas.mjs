// scripts/conta/d01/facturasInventadas.mjs
//
// D01 · R2 punto 2 · Las facturas INVENTADAS para la prueba de lectura con el
// modelo: los ocho formatos del núcleo, una foto torcida, una borrosa y un PDF
// escaneado (sin texto). Ningún nombre, NIF ni cuenta es de nadie: el
// repositorio es público. Los NIF son los de forma válida de las pruebas del
// núcleo (A00000001…), que no son de ninguna empresa.
//
// De cada una sale todo de AQUÍ, para que el papel y lo esperado no puedan
// separarse (regla 31: la misma vara a los dos lados):
//   · el papel: html(f) lo dibuja; generar-facturas.mjs lo imprime a PDF o lo
//     fotografía (torcida, borrosa, escaneada);
//   · lo que leería un lector perfecto: ideal(f), con la forma del modelo;
//   · lo esperado: leerFactura(ideal(f)) —en la prueba—, con su confianza.

export const HOY = '2026-10-13'
export const DESTINATARIO = { nombre: 'Taberna de Prueba Norte, S.L.', nif: 'B00000099', direccion: 'Calle Inventada 1, 28000 Madrid' }

const r2 = (x) => Math.round(x * 100) / 100
const tipos = (lineas, recargos = {}) => {
  const m = new Map()
  for (const l of lineas) m.set(l.iva, r2((m.get(l.iva) ?? 0) + l.importe))
  return [...m].sort((a, b) => b[0] - a[0]).map(([iva, base]) => {
    const cuota = r2(base * iva / 100)
    const rp = recargos[iva] ?? null
    return { iva, base, cuota, recargoPct: rp, recargo: rp == null ? null : r2(base * rp / 100) }
  })
}
const linea = (texto, cantidad, precio, iva) => ({ texto, cantidad, precio, importe: r2(cantidad * precio), iva })

/** Las once. `papel`: 'pdf' (con texto), 'torcida', 'borrosa' o 'escaneada'. */
export const FACTURAS = [
  {
    id: 'f01-mercancia', formato: 'Mercancía a un tipo', papel: 'pdf',
    emisor: { nombre: 'Mayorista Alfa, S.A.', nif: 'A00000001', direccion: 'Polígono Inventado 4, 28000 Madrid' },
    numero: 'F-2026/1022', fecha: '2026-10-11', vencimiento: '2026-11-10', clase: 'completa',
    lineas: [linea('Aceite de oliva virgen extra 5 L', 6, 38.5, 10), linea('Harina de trigo 25 kg', 4, 21.9, 10), linea('Tomate triturado 3 kg', 12, 4.35, 10)],
  },
  {
    id: 'f02-recargo', formato: 'Varios tipos con recargo de equivalencia', papel: 'pdf',
    emisor: { nombre: 'Distribuciones Beta, S.L.', nif: 'B00000005', direccion: 'Avenida Ficticia 12, 28000 Madrid' },
    numero: 'DB-0451', fecha: '2026-10-08', vencimiento: '2026-11-07', clase: 'completa', recargos: { 21: 5.2, 10: 1.4 },
    lineas: [linea('Detergente industrial 10 L', 5, 20, 21), linea('Pan de molde', 25, 2, 10)],
  },
  {
    id: 'f03-retencion', formato: 'Profesional con retención del 15 %', papel: 'pdf',
    emisor: { nombre: 'Asesora Ejemplo', nif: '00000000T', direccion: 'Plaza Supuesta 3, 28000 Madrid' },
    numero: '2026-031', fecha: '2026-10-01', clase: 'completa', retencionPct: 15,
    lineas: [linea('Asesoría laboral, septiembre de 2026', 1, 400, 21)],
  },
  {
    id: 'f04-alquiler', formato: 'Alquiler con retención del 19 %', papel: 'pdf',
    emisor: { nombre: 'Inmuebles Ejemplo, S.L.', nif: 'B00000002', direccion: 'Calle Imaginaria 8, 28000 Madrid' },
    numero: 'ALQ-10', fecha: '2026-10-01', vencimiento: '2026-10-05', clase: 'completa', retencionPct: 19,
    lineas: [linea('Renta del local, octubre de 2026', 1, 1000, 21)],
  },
  {
    id: 'f05-rectificativa', formato: 'Rectificativa', papel: 'pdf',
    emisor: { nombre: 'Mayorista Alfa, S.A.', nif: 'A00000001', direccion: 'Polígono Inventado 4, 28000 Madrid' },
    numero: 'R-7', fecha: '2026-10-12', clase: 'rectificativa', rectifica: 'F-2026/1022',
    lineas: [linea('Devolución: aceite de oliva 5 L (defectuoso)', -1, 38.5, 10)],
  },
  {
    id: 'f06-ticket', formato: 'Ticket simplificado', papel: 'pdf', ticket: true,
    emisor: { nombre: 'Ferretería Ejemplo', nif: 'B00000003', direccion: 'Calle Fingida 22, 28000 Madrid' },
    numero: 'T-551', fecha: '2026-10-07', clase: 'simplificada',
    lineas: [linea('Bombillas LED', 6, 3.9, 21), linea('Cinta americana', 3, 5.17, 21)],
  },
  {
    id: 'f07-sin-desglose', formato: 'Sin desglose de IVA en el papel', papel: 'pdf', sinDesglose: true,
    emisor: { nombre: 'Bebidas Gamma, S.L.', nif: 'B00000004', direccion: 'Ronda Ficticia 5, 28000 Madrid' },
    numero: '889', fecha: '2026-10-09', clase: 'completa',
    lineas: [linea('Agua mineral 1,5 L (caja de 6)', 10, 3.2, 10), linea('Servilletas de papel', 20, 1.5, 21)],
  },
  {
    id: 'f08-intracomunitaria', formato: 'Intracomunitaria al 0 % con NIF de la UE', papel: 'pdf', idioma: 'de',
    emisor: { nombre: 'Lieferant Beispiel GmbH', nif: 'DE000000000', direccion: 'Musterstraße 1, 10115 Berlin' },
    numero: 'RE-2026-1', fecha: '2026-10-02', clase: 'completa', nota: 'Steuerfreie innergemeinschaftliche Lieferung',
    lineas: [linea('Kaffeemaschine Ersatzteile', 1, 500, 0)],
  },
  {
    id: 'f09-torcida', formato: 'Foto torcida (mercancía, dos tipos)', papel: 'torcida',
    emisor: { nombre: 'Frutas Delta, S.L.', nif: 'B00000006', direccion: 'Mercado Inventado, puesto 9, 28000 Madrid' },
    numero: 'FD-2026-778', fecha: '2026-10-10', vencimiento: '2026-10-25', clase: 'completa',
    lineas: [linea('Limones (kg)', 8, 1.85, 4), linea('Patatas (saco 10 kg)', 3, 9.4, 4), linea('Bolsas compostables', 2, 6.5, 21)],
  },
  {
    id: 'f10-borrosa', formato: 'Foto borrosa (servicios)', papel: 'borrosa',
    emisor: { nombre: 'Limpiezas Épsilon, S.L.', nif: 'B00000007', direccion: 'Calle Supuesta 40, 28000 Madrid' },
    numero: 'LE/2026/0193', fecha: '2026-09-30', vencimiento: '2026-10-30', clase: 'completa',
    lineas: [linea('Limpieza de cocina, septiembre de 2026', 1, 320, 21)],
  },
  {
    id: 'f11-escaneada', formato: 'PDF escaneado, sin texto', papel: 'escaneada',
    emisor: { nombre: 'Carnes Zeta, S.A.', nif: 'A00000008', direccion: 'Matadero Ficticio 2, 28000 Madrid' },
    numero: 'CZ-50211', fecha: '2026-10-06', vencimiento: '2026-11-05', clase: 'completa',
    lineas: [linea('Ternera para guisar (kg)', 12, 11.9, 10), linea('Pollo entero (ud)', 10, 6.25, 10)],
  },
]

/** Las cifras de una factura, calculadas una vez. */
export function cifras(f) {
  const t = tipos(f.lineas, f.recargos ?? {})
  const base = r2(t.reduce((s, x) => s + x.base, 0))
  const cuota = r2(t.reduce((s, x) => s + x.cuota, 0))
  const recargo = r2(t.reduce((s, x) => s + (x.recargo ?? 0), 0))
  const retencion = f.retencionPct ? r2(base * f.retencionPct / 100) : 0
  return { tipos: t, base, cuota, recargo, retencion, total: r2(base + cuota + recargo - retencion) }
}

/** Lo que devolvería un lector perfecto, con la forma del modelo (buildPrompt + PROMPT_FACTURA). */
export function ideal(f) {
  const c = cifras(f)
  return {
    document: {
      supplier_name: f.emisor.nombre, supplier_tax_id: f.emisor.nif, doc_number: f.numero, doc_date: f.fecha, doc_type: 'factura', handwritten: false,
      bill_to_name: DESTINATARIO.nombre, bill_to_tax_id: DESTINATARIO.nif,
      ...(f.sinDesglose ? { tax_total: c.cuota } : { tax_base_total: c.base, tax_total: c.cuota }), grand_total: c.total,
    },
    lines: f.lineas.map((l) => ({ raw_text: l.texto, qty: l.cantidad, unit_price: l.precio, line_amount: l.importe, vat_pct: l.iva })),
    factura: {
      invoice_kind: f.clase, corrects_number: f.rectifica ?? null, due_date: f.vencimiento ?? null,
      tax_breakdown: f.sinDesglose ? [] : c.tipos.map((x) => ({ vat_pct: x.iva, base: x.base, vat_amount: x.cuota, surcharge_pct: x.recargoPct, surcharge_amount: x.recargo })),
      withholding_pct: f.retencionPct ?? null, withholding_amount: f.retencionPct ? c.retencion : null,
    },
    confidence: 0.95,
  }
}

const eur = (x) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + ' €'
const fecha = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** El papel, en HTML. Una factura de verdad tiene este aspecto: no es un formulario. */
export function html(f) {
  const c = cifras(f)
  const de = f.idioma === 'de'
  const T = de
    ? { factura: 'RECHNUNG', num: 'Rechnungsnr.', fecha: 'Datum', cliente: 'Kunde', desc: 'Beschreibung', cant: 'Menge', precio: 'Preis', imp: 'Betrag', iva: 'MwSt.', base: 'Nettobetrag', total: 'Gesamtbetrag', vence: 'Fällig' }
    : { factura: f.clase === 'rectificativa' ? 'FACTURA RECTIFICATIVA' : f.clase === 'simplificada' ? 'FACTURA SIMPLIFICADA' : 'FACTURA', num: 'Nº', fecha: 'Fecha', cliente: 'Cliente', desc: 'Concepto', cant: 'Cant.', precio: 'Precio', imp: 'Importe', iva: 'IVA', base: 'Base imponible', total: 'TOTAL', vence: 'Vencimiento' }
  const filas = f.lineas.map((l) => `<tr><td>${esc(l.texto)}</td><td class="n">${l.cantidad}</td><td class="n">${eur(l.precio)}</td>${f.sinDesglose ? `<td class="n">${l.iva} %</td>` : ''}<td class="n">${eur(l.importe)}</td></tr>`).join('')
  const desglose = f.sinDesglose
    ? `<tr><td>${T.iva} incluido en el total</td><td class="n">${eur(c.cuota)}</td></tr>`
    : c.tipos.map((x) => `<tr><td>${T.base} al ${x.iva} %</td><td class="n">${eur(x.base)}</td></tr><tr><td>${T.iva} ${x.iva} %</td><td class="n">${eur(x.cuota)}</td></tr>${x.recargo != null ? `<tr><td>Recargo de equivalencia ${String(x.recargoPct).replace('.', ',')} %</td><td class="n">${eur(x.recargo)}</td></tr>` : ''}`).join('')
  const ret = f.retencionPct ? `<tr><td>Retención IRPF ${f.retencionPct} %</td><td class="n">−${eur(c.retencion)}</td></tr>` : ''
  const ticket = f.ticket
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:${f.papel === 'pdf' || f.papel === 'escaneada' ? '#fff' : '#6b5d4f'};font-family:${ticket ? '"DejaVu Sans Mono",monospace' : 'Helvetica,Arial,sans-serif'};color:#1d1d1f}
    .hoja{background:#fff;width:${ticket ? '320px' : '760px'};margin:${f.papel === 'pdf' || f.papel === 'escaneada' ? '0' : '60px auto'};padding:${ticket ? '18px' : '44px 48px'};box-sizing:border-box;font-size:${ticket ? '12px' : '13px'}}
    .cab{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
    h1{font-size:${ticket ? '14px' : '22px'};letter-spacing:.06em;margin:0 0 6px}
    .emisor b{font-size:${ticket ? '13px' : '16px'}} .gris{color:#555}
    table{width:100%;border-collapse:collapse;margin-top:18px} th{text-align:left;border-bottom:1.5px solid #222;padding:6px 4px;font-size:12px}
    td{padding:5px 4px;border-bottom:1px solid #ddd} .n{text-align:right;white-space:nowrap}
    .tot{width:${ticket ? '100%' : '320px'};margin-left:auto} .tot td{border:none} .gran td{font-weight:700;font-size:15px;border-top:1.5px solid #222}
    .pie{margin-top:26px;font-size:11px;color:#555}
    ${f.papel === 'torcida' ? '.hoja{transform:perspective(1400px) rotateX(6deg) rotate(-4.5deg);box-shadow:0 18px 40px rgba(0,0,0,.45)}' : ''}
    ${f.papel === 'borrosa' ? '.hoja{filter:blur(1.3px) contrast(.9) brightness(1.04);transform:rotate(1.2deg);box-shadow:0 10px 30px rgba(0,0,0,.4)}' : ''}
    ${f.papel === 'escaneada' ? '.hoja{filter:grayscale(1) contrast(1.15);transform:rotate(-.6deg)}' : ''}
  </style></head><body><div class="hoja">
    <div class="cab">
      <div class="emisor"><b>${esc(f.emisor.nombre)}</b><br><span class="gris">${de ? 'USt-IdNr.' : 'NIF'}: ${esc(f.emisor.nif)}<br>${esc(f.emisor.direccion)}</span></div>
      <div style="text-align:right"><h1>${T.factura}</h1>${T.num} <b>${esc(f.numero)}</b><br>${T.fecha}: ${fecha(f.fecha)}${f.vencimiento ? `<br>${T.vence}: ${fecha(f.vencimiento)}` : ''}</div>
    </div>
    ${ticket ? '' : `<div style="margin-top:22px"><span class="gris">${T.cliente}</span><br><b>${esc(DESTINATARIO.nombre)}</b><br>NIF: ${DESTINATARIO.nif}<br>${esc(DESTINATARIO.direccion)}</div>`}
    ${f.rectifica ? `<p><b>Rectifica la factura ${esc(f.rectifica)}</b> por devolución de mercancía.</p>` : ''}
    <table><thead><tr><th>${T.desc}</th><th class="n">${T.cant}</th><th class="n">${T.precio}</th>${f.sinDesglose ? `<th class="n">${T.iva}</th>` : ''}<th class="n">${T.imp}</th></tr></thead><tbody>${filas}</tbody></table>
    <table class="tot"><tbody>${desglose}${ret}<tr class="gran"><td>${T.total}</td><td class="n">${eur(c.total)}</td></tr></tbody></table>
    <div class="pie">${f.nota ? esc(f.nota) + '. ' : ''}${f.ticket ? 'IVA incluido. Gracias por su compra.' : 'Pago por transferencia a la cuenta indicada en el contrato. Documento inventado para pruebas.'}</div>
  </div></body></html>`
}
