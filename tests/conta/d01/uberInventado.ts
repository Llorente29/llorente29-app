// tests/conta/d01/uberInventado.ts
//
// Correos «Resumen de pagos» de Uber Eats INVENTADOS, con la forma exacta de
// los de verdad (medida el 15/10 en los 33 recibidos desde julio): la cabecera
// en tres tarjetas (etiqueta gris y valor debajo, vacíos los que no vienen),
// el resumen diario en una tabla th/td con su fila Total, el desglose en cuatro
// tablas y «Pago neto» dos veces al final (la primera, vacía). El primero del
// mes repite las etiquetas en «Resumen unificado del mes pasado».
// Ni una tienda, ni una dirección, ni una cifra de verdad.

export const TIENDA_INVENTADA = 'Marca Inventada (Calle Inventada 1, Madrid, ES, 28001)'

// Importes inventados, siempre números (nunca del servidor).
// eslint-disable-next-line no-restricted-syntax
const eur = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const largo = (iso: string) => `${MES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}, ${iso.slice(0, 4)}`
const mdy = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`

const tarjeta = (etiqueta: string, valor: string) =>
  `<td style="vertical-align:top"><div style="border:1px solid #e2e2e2;border-radius:8px;padding:15px"><div style="font-size:11px;color:#777;margin-bottom:5px">${etiqueta}</div><div style="font-size:14px;font-weight:500">${valor}</div></div></td>`
const fila = (etiqueta: string, valor: string) =>
  `<tr><td style="padding:10px 15px;border-bottom:1px solid #f0f0f0">${etiqueta}</td><td style="padding:10px 15px;border-bottom:1px solid #f0f0f0;text-align:right">${valor}</td></tr>`
const bloque = (titulo: string, filas: [string, number | null][], total?: [string, number]) =>
  `<table style="width:100%;border-collapse:collapse"><tr><th colspan="2" style="background-color:#555;color:#fff">${titulo}</th></tr>` +
  filas.filter(([, v]) => v !== null).map(([e, v]) => fila(e, eur(v as number))).join('') +
  (total ? fila(total[0], eur(total[1])) : '') + '</table>'

export interface Desglose {
  ventas: number; pedidosVentas: number; otras?: number | null
  tasas: number; otros?: number | null
  promociones?: number | null; otrosPromo?: number | null; anuncios?: number | null
  contracargo?: number; pedidosContracargo?: number; ajustes?: number
}
export interface OpcionesCorreo {
  tienda?: string
  marca?: string
  desde: string
  hasta: string
  referencia?: string
  deposito?: string
  dias: { fecha: string; pedidos: number; ventas: number; impuesto: number }[]
  desglose: Desglose
  /** Neto escrito a mano (para un correo que no cuadra); si no, la suma. */
  neto?: number
  contracargos?: { pedido: string; momento: string; venta: number; contracargo: number; tipo: string }[]
  /** El resumen del mes pasado (como el primero de cada mes), con otro desglose que NO hay que leer. */
  mesPasado?: { titulo: string; desglose: Desglose }
}

const r2 = (n: number) => Math.round(n * 100) / 100
export function sumas(d: Desglose) {
  const g = r2(d.ventas + (d.otras ?? 0))
  const u = r2(d.tasas + (d.otros ?? 0))
  const m = r2((d.promociones ?? 0) + (d.otrosPromo ?? 0) + (d.anuncios ?? 0))
  const md = r2((d.contracargo ?? 0) + (d.ajustes ?? 0))
  return { g, u, m, md, neto: r2(g + u + m + md) }
}

function desgloseHtml(d: Desglose, cierre: 'Pago neto' | 'Total neto', neto?: number) {
  const s = sumas(d)
  return bloque('Ganancias', [[`Ventas\r\n(${d.pedidosVentas} Pedidos)`, d.ventas], ['Otras ganancias', d.otras ?? null]], ['Ganancias totales', s.g]) +
    bloque('Precios de Uber', [['Tasas de mercado', d.tasas], ['Otros cargos', d.otros ?? null]], ['Precios totales de Uber', s.u]) +
    bloque('Gastos de marketing', [['Promociones en artículos', d.promociones ?? null], ['Otros cargos de la promoción', d.otrosPromo ?? null], ['Gastos en anuncios', d.anuncios ?? null]], ['Gastos totales de marketing', s.m]) +
    `<table style="width:100%"><tr><th colspan="2">Modificaciones</th></tr>${fila(`Importe neto del contracargo\r\n(${d.pedidosContracargo ?? 0} Pedidos)`, eur(d.contracargo ?? 0))}${fila('Ajustes', eur(d.ajustes ?? 0))}${fila('Modificaciones totales', eur(s.md))}` +
    `<tr><td style="font-weight:700">${cierre}</td><td style="font-weight:700"></td></tr>` +
    (cierre === 'Pago neto' ? fila('Pago neto', eur(neto ?? s.neto)) : '') + '</table>'
}

/** Un correo «Resumen de pagos» inventado: { subject, html }. */
export function correoUber(o: OpcionesCorreo): { subject: string; html: string; from: string } {
  const tienda = o.tienda ?? TIENDA_INVENTADA
  const marca = o.marca ?? tienda.replace(/\s*\(.*$/, '')
  const periodo = `${largo(o.desde)} - ${largo(o.hasta)}`
  const neto = o.neto ?? sumas(o.desglose).neto
  const tot = o.dias.reduce((a, x) => ({ p: a.p + x.pedidos, v: r2(a.v + x.ventas), i: r2(a.i + x.impuesto) }), { p: 0, v: 0, i: 0 })
  const celda = (x: string, izq = false) => `<td style="text-align:${izq ? 'left' : 'right'};padding:12px 10px">${x}</td>`
  const diario = `<div style="background-color:#555;color:#fff">Resumen diario</div><table style="width:100%">` +
    `<tr><th>Fecha</th><th>Pedidos</th><th>Ventas</th><th>Impuesto sobre las ventas</th><th>Ventas\r\n(impuestos incluidos)</th></tr>` +
    o.dias.map((x) => `<tr>${celda(mdy(x.fecha), true)}${celda(String(x.pedidos))}${celda(eur(x.ventas))}${celda(eur(x.impuesto))}${celda(eur(r2(x.ventas + x.impuesto)))}</tr>`).join('') +
    `<tr style="background-color:#e0e0e0">${celda('Total', true)}${celda(String(tot.p))}${celda(eur(tot.v))}${celda(eur(tot.i))}${celda(eur(r2(tot.v + tot.i)))}</tr></table>`
  const cc = o.contracargos?.length
    ? `<div style="background-color:#555;color:#fff">Contracargos</div><div>Detalles del error del pedido</div><table><tr><th>ID del pedido</th><th>Fecha y hora de recogida</th><th>Venta</th><th>Contracargo neto</th><th>Tipo de error</th></tr>` +
      o.contracargos.map((x) => `<tr>${celda(x.pedido, true)}${celda(x.momento)}${celda(eur(x.venta))}${celda(eur(x.contracargo))}${celda(x.tipo)}</tr>`).join('') + '</table>'
    : ''
  const mes = o.mesPasado
    ? `<table><tr><th>Resumen unificado del mes pasado – ${o.mesPasado.titulo} También te hemos adjuntado tu resumen mensual de pagos de ${o.mesPasado.titulo.replace(' ', '')} para que lo tengas archivado.</th></tr></table>${desgloseHtml(o.mesPasado.desglose, 'Total neto')}`
    : ''
  const html = `<!doctype html><html><head><title>Your Monthly Statement is Ready</title><style>body{font-family:uber move text}</style></head><body>` +
    `<header><div style="padding:30px"><p style="margin:0 0 15px">Hola ${tienda},</p><p>Tu resumen de pagos consolidado del periodo de ${periodo} ya está disponible.</p><p>Gracias por colaborar con nuestro equipo,<br>El equipo de Uber Eats</p></div></header>` +
    `<main><div style="background-color:#000;color:#fff">Resumen de pagos del periodo de pago: ${periodo}</div>` +
    `<table><tr>${tarjeta('Periodo de pago', periodo)}${tarjeta('ID de referencia del pago', o.referencia ?? '')}${tarjeta('Depósito iniciado', o.deposito ? largo(o.deposito) : '')}</tr></table>` +
    `<div style="background-color:#555;color:#fff">Ventas totales</div><table><tr>${tarjeta('Pedidos', String(tot.p))}${tarjeta('Pago neto', eur(neto))}</tr></table>` +
    diario + cc +
    `<div style="background-color:#000;color:#fff">Desglose de pagos</div>${desgloseHtml(o.desglose, 'Pago neto', neto)}` + mes +
    `<h3>Una forma sencilla de ver tu información financiera</h3><p>Accede al informe desde la pestaña <a href="https://ejemplo.test/informes">Informes</a>.</p></main>` +
    `<footer><p>¿Tienes alguna pregunta?</p></footer></body></html>`
  return { subject: `Resumen de pagos de Uber Eats correspondiente a ${marca} del ${periodo}`, html, from: 'noreply@uber.com' }
}

/** El mismo correo como lo deja un reenvío en texto plano (tablas «| a | b |»). */
export function comoTexto(html: string): string {
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<tr[^>]*>/gi, '\n|').replace(/<\/t[dh]>/gi, ' |')
    .replace(/<\/(div|p|h3|table)>/gi, '\n').replace(/<br>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/\r\n/g, ' ')
}
