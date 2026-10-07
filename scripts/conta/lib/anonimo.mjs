// scripts/conta/lib/anonimo.mjs
//
// El informe de los agentes de cumplimiento SIN conceptos ni nombres, para
// producción (respuesta 2 del C04): el resumen de Actions y los avisos de un
// repositorio público no pueden llevar razones sociales, proveedores, NIF,
// IBAN ni descripciones. De cada hallazgo queda lo que permite actuar sin
// enseñar a nadie: el agente, el nivel, el tipo, la cuenta abreviada (8
// caracteres de su id) y la norma. El detalle se mira en la app, con la sesión
// de quien puede verlo.
//
// Lo usan agente-datos-maestros.mjs (datos maestros, coherencia y terceros)
// y agente-plan-contable.mjs cuando CONTA_ANONIMO=1, que solo pone el
// workflow de producción. El del libro diario ya sale sin nombres.

/** La cuenta abreviada que el hallazgo diga («cuenta c01a0000»), o null. */
export function cuentaCorta(texto) {
  const m = /cuenta ([0-9a-f]{8})/.exec(String(texto ?? ''))
  return m ? m[1] : null
}

/**
 * Hallazgos de cualquier agente → filas sin nombres. Acepta las tres formas
 * que hay: {nivel, tipo, donde, detalle, norma} (coherencia, terceros),
 * {tabla, fila, tipo, detalle} (datos maestros: siempre rojo) y
 * {nivel, texto} (plan contable).
 */
export function anonimizar(agente, hallazgos) {
  return (hallazgos ?? []).map((h) => ({
    agente,
    nivel: h.nivel ?? 'rojo',
    tipo: h.tipo ?? (h.tabla ? `serie:${h.tabla}` : String(h.texto ?? '').split(' · ')[0] || 'sin tipo'),
    cuenta: cuentaCorta(h.donde ?? h.texto),
    norma: h.norma ?? null,
  }))
}

/** El informe en Markdown: cuántos de cada, y una línea por hallazgo sin detalle. */
export function informeAnonimo(titulo, filas, { donde, hoy, mirado }) {
  const rojos = filas.filter((f) => f.nivel === 'rojo')
  const ambar = filas.filter((f) => f.nivel !== 'rojo')
  const l = [`## ${titulo} · ${donde} · ${hoy}`, '', mirado, '',
    '_Resumen sin nombres ni conceptos (repositorio público): el detalle de cada hallazgo se ve en la app._', '']
  l.push(rojos.length ? `**${rojos.length} en rojo**${ambar.length ? `, ${ambar.length} en ámbar` : ''}.` : ambar.length ? `En verde; ${ambar.length} en ámbar (esperan a una persona).` : '**En verde.**')
  if (filas.length) {
    l.push('', '| Agente | Nivel | Tipo | Cuenta | Norma |', '|---|---|---|---|---|')
    for (const f of [...rojos, ...ambar]) l.push(`| ${f.agente} | ${f.nivel} | ${f.tipo} | ${f.cuenta ?? '—'} | ${f.norma ?? '—'} |`)
  }
  return l.join('\n') + '\n'
}
