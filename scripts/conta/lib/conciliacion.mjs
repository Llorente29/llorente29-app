// scripts/conta/lib/conciliacion.mjs
//
// Agente «Conciliación» (B01), la parte de cada noche. Pura: recibe el volcado
// de scripts/conta/agente-conciliacion.sql y devuelve hallazgos con el mismo
// formato que libro.mjs. SOLO LEE: si algo no cuadra, lo dice; no lo arregla.
//
// Rojo: lo que la base no debería haber dejado pasar nunca (un movimiento
// casado dos veces, un asiento de Bancos sin movimiento, un mes cerrado que ya
// no cuadra, una regla sin su registro, un extracto que no cuadra, un permiso
// del agregador caducado y activo). Ámbar: lo que espera a una persona (un mes
// cerrado a sabiendas, un hueco entre extractos, un permiso que caduca en 7
// días, movimientos sin mirar y sin pasada del agente en 48 h).
//
// Sin conceptos ni nombres (el informe va a un repositorio público): ids
// cortos, fechas e importes.

const corto = (id) => (id ? String(id).slice(0, 8) : '—')
const donde = (x) => `cuenta ${corto(x.account_id)} · empresa ${corto(x.company_id)}`

export const NORMAS = {
  casado_dos_veces: 'Encargo B01: cada movimiento se casa una sola vez',
  asiento_sin_movimiento: 'Encargo B01: ningún asiento de banco sin movimiento detrás; CCom art. 29.1 (orden y corrección)',
  mes_cerrado: 'Encargo B01: saldo del banco = saldo contable al cierre de cada mes, o la diferencia explicada',
  regla_sin_registro: 'Encargo B01: ninguna regla automática sin su registro',
  extracto: 'Cuaderno 43 de la AEB: el saldo inicial más los movimientos es el saldo final, y el inicial es el final del anterior',
  consentimiento: 'RDL 19/2018 art. 39.1.a: el agregador solo lee con el consentimiento vivo del titular',
  sin_pasada: 'Respuesta 4 (B01): el agente pasa después de cada extracto y una vez al día',
}

const euros = (n) => `${Number(n ?? 0).toFixed(2).replace('.', ',')} €`

/** @returns {{ nivel: 'rojo'|'ambar', tipo: string, donde: string, detalle: string, norma: string }[]} */
export function revisarConciliacion(bd) {
  const out = []
  const h = (nivel, tipo, x, detalle) => out.push({ nivel, tipo, donde: donde(x), detalle, norma: NORMAS[tipo] })
  for (const x of bd.casado_dos_veces ?? []) h('rojo', 'casado_dos_veces', x, `el ${x.que} ${corto(x.id)} tiene ${x.n} casados vivos`)
  for (const x of bd.asiento_sin_movimiento ?? []) h('rojo', 'asiento_sin_movimiento', x, `asiento ${corto(x.id)} del ${x.fecha} (${x.estado}) hecho por Bancos, sin movimiento casado`)
  for (const x of bd.mes_cerrado ?? []) {
    if (Number(x.libro_hoy) !== Number(x.libro_al_cerrar)) {
      h('rojo', 'mes_cerrado', x, `${x.mes} del banco ${corto(x.banco)}: al cerrar, contabilidad decía ${euros(x.libro_al_cerrar)}; hoy, a esa fecha, ${euros(x.libro_hoy)}`)
    } else {
      h('ambar', 'mes_cerrado', x, `${x.mes} del banco ${corto(x.banco)} se cerró a sabiendas: diferencia ${x.diferencia === null ? 'sin saldo del banco' : euros(x.diferencia)}, ${x.sueltos} sin casar`)
    }
  }
  for (const x of bd.regla_sin_registro ?? []) h('rojo', 'regla_sin_registro', x, `regla ${corto(x.id)} ${x.estado}: su último apunte es «${x.ultimo}»`)
  for (const x of bd.extracto ?? []) {
    if (x.motivo === 'hueco') h('ambar', 'extracto', x, `extracto ${corto(x.id)} del ${x.desde} al ${x.hasta}: falta un trozo con el anterior (${euros(x.hueco)})`)
    else h('rojo', 'extracto', x, `extracto ${corto(x.id)} del ${x.desde} al ${x.hasta}: ${x.motivo}`)
  }
  for (const x of bd.consentimiento ?? []) {
    h(Number(x.dias) < 0 ? 'rojo' : 'ambar', 'consentimiento', x,
      Number(x.dias) < 0 ? `el permiso ${corto(x.id)} (${x.proveedor}) caducó el ${x.caduca} y sigue activo` : `el permiso ${corto(x.id)} (${x.proveedor}) caduca el ${x.caduca}, en ${x.dias} días`)
  }
  for (const x of bd.sin_pasada ?? []) h('ambar', 'sin_pasada', x, `${x.sin_mirar} movimientos sin mirar y ninguna pasada del agente en 48 h${x.ultima ? ` (la última, ${String(x.ultima).slice(0, 10)})` : ' (nunca ha pasado)'}`)
  return out
}

/** El informe en Markdown, para el resumen de la ejecución y el aviso. */
export function informeConciliacion(hallazgos, { donde: dondeCorre, hoy, contado }) {
  const rojos = hallazgos.filter((x) => x.nivel === 'rojo')
  const ambar = hallazgos.filter((x) => x.nivel === 'ambar')
  const c = contado ?? {}
  const l = [
    `## Agente «Conciliación» · ${dondeCorre} · ${hoy}`,
    '',
    `Mirados: ${c.movimientos ?? 0} movimientos de ${c.empresas ?? 0} empresas (${c.casados ?? 0} casados, ${c.sin_mirar ?? 0} sin casar), ${c.extractos ?? 0} extractos, ${c.reglas ?? 0} reglas, ${c.meses_cerrados ?? 0} meses cerrados; ${c.pasadas_48h ?? 0} pasadas del agente en 48 h.`,
    '',
    rojos.length === 0 ? '**En verde**: nada casado dos veces, ningún asiento de banco sin movimiento, meses cerrados que siguen cuadrando, reglas con su registro, extractos que cuadran y permisos vivos.' : `**${rojos.length} en rojo.**`,
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
