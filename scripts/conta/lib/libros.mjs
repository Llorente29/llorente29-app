// scripts/conta/lib/libros.mjs
//
// Agente «Libro diario», parte del C05 (libros y balances). Pura: recibe el
// volcado de scripts/conta/agente-libros.sql y devuelve hallazgos con el mismo
// formato que lib/libro.mjs. SOLO LEE.
//
// Rojo: lo que impide presentar unas cuentas o rompe una regla del C05
// (balance que no cuadra a un fin de mes, cuenta con saldo sin sitio en el
// modelo, 6/7 con saldo tras regularizar, libro registro distinto del diario,
// asiento validado en un ejercicio ya cerrado). Ámbar: lo que espera a una
// persona (cuentas dejadas fuera con saldo, colocadas por defecto, «Otros
// resultados» que la memoria tiene que explicar).

const corto = (id) => (id ? String(id).slice(0, 8) : '—')
const donde = (x) => `cuenta ${corto(x.account_id)} · empresa ${corto(x.company_id)}`
const eur = (n) => `${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const SERIE = { 1: 'Ventas', 2: 'Compras', 3: 'Banco', 4: 'General', 9: 'Nóminas' }

export const NORMAS_LIBROS = {
  cuadre_mes: 'PGC, tercera parte (modelos de balance): Activo = Patrimonio neto + Pasivo',
  sin_sitio: 'Encargo C05, regla 2: ninguna cuenta con saldo sin línea en el modelo',
  fuera_con_saldo: 'Encargo C05, regla 9: una cuenta que el mapeo propio deja fuera no sale en los estados',
  por_defecto: 'Respuesta 1 del C05: las cuentas que el modelo no nombra van «colocadas por defecto» y se completan',
  otros_resultados: 'PGC de pymes, tercera parte, norma 6.ª.6 (abreviado y normal, 7.ª.9): «Otros resultados» se explica en la memoria',
  pyg_129: 'PGC, quinta parte, cuenta 129: tras regularizar, gastos e ingresos quedan a cero y el resultado en la 129',
  libro_diario: 'RIVA art. 62 y encargo C05, regla 6: las cuotas del libro registro son las de la 477 y la 472',
  cerrado_con_asientos: 'Encargo C05, regla 7: un ejercicio cerrado no admite asientos',
}

/** @returns {{ nivel: 'rojo'|'ambar', tipo: string, donde: string, detalle: string, norma: string }[]} */
export function revisarLibros(bd) {
  const out = []
  if (!bd) return out
  const h = (nivel, tipo, x, detalle) => out.push({ nivel, tipo, donde: donde(x), detalle, norma: NORMAS_LIBROS[tipo] })
  for (const x of bd.cuadre_mes ?? []) h('rojo', 'cuadre_mes', x, `a ${x.fin_mes} (modelo ${x.modelo}) el balance no cuadra: ${eur(x.diferencia)} de diferencia entre el activo y el patrimonio neto más el pasivo`)
  for (const x of bd.sin_sitio ?? []) h('rojo', 'sin_sitio', x, `la ${x.cuenta} tiene ${eur(x.saldo)} y no tiene línea en el modelo ${x.modelo}: ${x.porque}`)
  for (const x of bd.pyg_129 ?? []) h('rojo', 'pyg_129', x, `ejercicio ${x.ejercicio}: tras la regularización quedan ${x.cuentas} cuentas de gastos o ingresos con saldo (${eur(x.saldo)} en total)`)
  for (const x of bd.libro_diario ?? []) {
    const cuenta = x.libro === 'issued' ? '477' : '472'
    h('rojo', 'libro_diario', x, `${x.trimestre}, ${x.libro === 'issued' ? 'expedidas' : 'recibidas'}: el libro registro suma ${eur(x.en_libro)} y la ${cuenta} ${eur(x.en_diario)}`)
  }
  for (const x of bd.cerrado_con_asientos ?? []) h('rojo', 'cerrado_con_asientos', x, `${SERIE[x.serie] ?? `serie ${x.serie}`} nº ${x.numero ?? '—'} del ${x.fecha}, validado después de cerrar el ejercicio ${x.ejercicio}`)
  for (const x of bd.fuera_con_saldo ?? []) h('ambar', 'fuera_con_saldo', x, `la ${x.cuenta} está fuera del modelo por decisión de la empresa y tiene ${eur(x.saldo)}: el balance no la refleja`)
  for (const x of bd.por_defecto ?? []) h('ambar', 'por_defecto', x, `${x.n} ${x.n === 1 ? 'cuenta con saldo colocada' : 'cuentas con saldo colocadas'} por defecto (modelo ${x.modelo}): ${(x.cuentas ?? []).slice(0, 8).join(', ')}${(x.cuentas ?? []).length > 8 ? '…' : ''}. Completar`)
  for (const x of bd.otros_resultados ?? []) h('ambar', 'otros_resultados', x, `hay «Otros resultados» (la ${x.cuenta}, ${eur(x.saldo)}): la memoria tiene que explicarlos; queda apuntado para el C05b`)
  return out
}

/** Las líneas del informe de la parte C05 (se añaden al del libro diario). */
export function informeLibros(hallazgos, contado) {
  const c = contado ?? {}
  const rojos = hallazgos.filter((x) => x.nivel === 'rojo')
  const ambar = hallazgos.filter((x) => x.nivel === 'ambar')
  const l = [
    '',
    '### Libros y balances (C05)',
    '',
    `Mirados: ${c.empresas ?? 0} empresas, ${c.cuentas_con_saldo ?? 0} cuentas con saldo, ${c.anotaciones ?? 0} anotaciones del libro registro, ${c.ejercicios_cerrados ?? 0} ejercicios cerrados.`,
    '',
    rojos.length === 0
      ? '**En verde**: el balance cuadra a cada fin de mes, toda cuenta con saldo tiene su línea, el libro registro es el diario, la regularización deja 6 y 7 a cero y ningún ejercicio cerrado tiene asientos nuevos.'
      : `**${rojos.length} en rojo.**`,
  ]
  const grupo = (titulo, xs) => {
    if (!xs.length) return
    l.push('', `#### ${titulo}`, '', '| Qué | Dónde | Detalle | Norma |', '|---|---|---|---|')
    for (const x of xs) l.push(`| ${x.tipo} | ${x.donde} | ${x.detalle} | ${x.norma} |`)
  }
  grupo('Rojo', rojos)
  grupo('Ámbar (espera a una persona)', ambar)
  return l.join('\n') + '\n'
}
