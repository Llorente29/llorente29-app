// scripts/conta/lib/libro.mjs
//
// Agente «Libro diario» (C04 §8). Pura: recibe el volcado de
// scripts/conta/agente-libro.sql y devuelve hallazgos con el mismo formato que
// coherencia.mjs. SOLO LEE: si algo no cuadra, lo dice; no lo arregla.
//
// Rojo: lo que la base no debería haber dejado pasar nunca (descuadre, hueco,
// cadena rota, IVA mal, venta cedida en el 70, compra del socio como gasto,
// 6/7 sin local, asiento validado en un mes ya cerrado, resumen del día que no
// es sus tickets). Ámbar: lo que espera a una persona (propuestas de más de
// 7 días, lo común sin su reparto al 100 %).
//
// Sin conceptos ni nombres (el informe va a un repositorio público): serie por
// su palabra, número, fecha e ids cortos.

const SERIE = { 1: 'Ventas', 2: 'Compras', 3: 'Banco', 4: 'General', 9: 'Nóminas' }
const corto = (id) => (id ? String(id).slice(0, 8) : '—')
const asiento = (x) => `${SERIE[x.serie] ?? `serie ${x.serie}`} nº ${x.numero ?? '—'}`
const donde = (x) => `cuenta ${corto(x.account_id)} · empresa ${corto(x.company_id)}`

export const NORMAS = {
  cuadre: 'CCom art. 28.2 y PGC (partida doble): todo asiento cuadra',
  huecos: 'CCom art. 29.1: el diario se lleva por orden, sin espacios en blanco',
  cadena: 'LGT art. 29.2.j y RD 1007/2023: integridad e inalterabilidad de los registros',
  iva: 'RIVA arts. 63 y 64: cada apunte de IVA con su base, su tipo y su libro registro',
  ventas_dia: 'RIVA art. 63.4: el asiento resumen es la suma de sus facturas',
  cedidas_70: 'PGC NRV 16.ª: lo cobrado por cuenta de un tercero no es ingreso propio',
  socio_gasto: 'Encargo C04, regla 6: las compras a nombre del socio no son gasto tuyo',
  resultado: 'Encargo C04, regla 9: cada apunte de 6/7 con su local o «común», y lo común con su reparto',
  mes_cerrado: 'Encargo C04, regla 4: un mes cerrado no admite asientos',
  propuestas: 'Encargo C04, agente: una propuesta no espera más de 7 días sin que nadie la mire',
}

/** @returns {{ nivel: 'rojo'|'ambar', tipo: string, donde: string, detalle: string, norma: string }[]} */
export function revisarLibro(bd) {
  const out = []
  const h = (nivel, tipo, x, detalle) => out.push({ nivel, tipo, donde: donde(x), detalle, norma: NORMAS[tipo] })
  for (const x of bd.cuadre ?? []) h('rojo', 'cuadre', x, `${asiento(x)}: Debe ${x.debe ?? 0} y Haber ${x.haber ?? 0} (${x.apuntes ?? 0} apuntes)`)
  for (const x of bd.huecos ?? []) h('rojo', 'huecos', x, `falta ${SERIE[x.serie] ?? x.serie} nº ${x.falta} en el ejercicio ${corto(x.ejercicio)}`)
  for (const x of bd.cadena ?? []) h('rojo', 'cadena', x, `${asiento(x)} (orden ${x.orden}): ${x.motivo}`)
  for (const x of bd.iva ?? []) h('rojo', 'iva', x, `${asiento(x)}, cuenta ${x.cuenta}: ${x.motivo}`)
  for (const x of bd.ventas_dia ?? []) h('rojo', 'ventas_dia', x, `${x.dia} local ${corto(x.local)}: ${x.motivo} (resumen ${x.resumen}, ${x.tickets} tickets, ${x.pedidos} pedidos que suman ${x.suma_pedidos ?? 0})`)
  for (const x of bd.cedidas_70 ?? []) h('rojo', 'cedidas_70', x, `${asiento(x)}: ${x.importe} € de la marca cedida ${corto(x.marca)} en la ${x.cuenta}`)
  for (const x of bd.socio_gasto ?? []) h('rojo', 'socio_gasto', x, `${asiento(x)}: ${x.importe} € del socio de marca como gasto en la ${x.cuenta}`)
  for (const x of bd.resultado ?? []) h(x.numero == null ? 'ambar' : 'rojo', 'resultado', x, x.numero == null ? x.motivo : `${asiento(x)}, cuenta ${x.cuenta}: ${x.motivo}`)
  for (const x of bd.mes_cerrado ?? []) h('rojo', 'mes_cerrado', x, `${asiento(x)} del ${x.fecha}, validado después de cerrar su mes`)
  for (const x of bd.propuestas ?? []) h('ambar', 'propuestas', x, `${SERIE[x.serie] ?? x.serie} del ${x.fecha} (${x.origen}) lleva ${x.dias} días sin validar ni descartar`)
  return out
}

/** El informe en Markdown, para el resumen de la ejecución y el aviso. */
export function informeLibro(hallazgos, { donde: dondeCorre, hoy, contado }) {
  const rojos = hallazgos.filter((x) => x.nivel === 'rojo')
  const ambar = hallazgos.filter((x) => x.nivel === 'ambar')
  const c = contado ?? {}
  const l = [
    `## Agente «Libro diario» · ${dondeCorre} · ${hoy}`,
    '',
    `Mirados: ${c.asientos ?? 0} asientos (${c.validados ?? 0} validados, ${c.anulados ?? 0} anulados) con ${c.apuntes ?? 0} apuntes en ${c.empresas ?? 0} empresas; ${c.propuestos ?? 0} propuestas o borradores esperando.`,
    '',
    rojos.length === 0 ? '**En verde**: cuadre, numeración, cadena, IVA, ventas del día, marcas cedidas, compras del socio, resultado por local y meses cerrados.' : `**${rojos.length} en rojo.**`,
  ]
  const grupo = (titulo, xs) => {
    if (!xs.length) return
    l.push('', `### ${titulo}`, '', '| Qué | Dónde | Detalle | Norma |', '|---|---|---|---|')
    for (const x of xs) l.push(`| ${x.tipo} | ${x.donde} | ${x.detalle} | ${x.norma} |`)
  }
  grupo('Rojo', rojos)
  grupo('Ámbar (espera a una persona)', ambar)
  return l.join('\n') + '\n'
}
