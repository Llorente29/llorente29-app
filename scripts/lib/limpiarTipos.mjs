// scripts/lib/limpiarTipos.mjs
//
// La limpieza de los tipos generados de Supabase (src/types/database.ts), pura
// y probada (tests/unit/scripts/limpiarTipos.test.ts). La usa gen-types.mjs.
//
//   1. Quita el BOM.
//   2. QUITA DEL TIPO (no de la base) las vistas y tablas que envenenan la
//      inferencia de `from(string)` de supabase-js: con ellas en el tipo, todo
//      servicio que llama a `from()` con un nombre que el compilador no puede
//      fijar ve la unión de todas las filas, y una sin `id` lo rompe todo
//      («column 'id' does not exist on …»). Las de PostGIS ya se quitaban;
//      goods_receipt_posting_status y vat_category_rate se añadieron el 05/10:
//      con ellas, la regeneración entera daba 505 errores; sin ellas, 24. El
//      código que las lee lo hace sin tipar (tabla() de conta).
//   3. `account_id` OPCIONAL al insertar en las tablas donde lo rellena el
//      disparador trg_fill_acc (a partir del empleado, el local, el perfil, la
//      asignación o quien pide el cambio). El generador no ve disparadores y lo
//      marca obligatorio. Medido en producción el 05/10: esas 15 tablas, cada
//      una con su función _fill_acc_from_*.

export const SIN_TIPO = ['spatial_ref_sys', 'geography_columns', 'geometry_columns', 'goods_receipt_posting_status', 'vat_category_rate']

export const CON_FILL_ACC = [
  'clock_entries', 'course_attempt', 'employee_availability', 'employee_formations', 'employee_notifications', 'employees',
  'manager_permissions', 'monthly_balance_closures', 'open_shift_requests', 'open_shifts', 'schedules', 'shift_swap_requests',
  'shift_templates', 'training_path_progress', 'vacations',
]

/** Fin del bloque `{ … }` que abre la línea `desde` (por emparejamiento de llaves). */
function finDeBloque(lineas, desde) {
  let prof = 0, empezado = false
  for (let j = desde; j < lineas.length; j++) {
    for (const ch of lineas[j]) {
      if (ch === '{') { prof++; empezado = true } else if (ch === '}') prof--
    }
    if (empezado && prof === 0) return j
  }
  return lineas.length - 1
}

export function limpiarTipos(raw) {
  const lineas = raw.replace(/^\uFEFF/, '').split('\n')
  const quitadas = []
  let opcionales = 0
  const fuera = new RegExp(`^\\s+(${SIN_TIPO.join('|')}): \\{\\s*$`)
  const conFill = new RegExp(`^(\\s+)(${CON_FILL_ACC.join('|')}): \\{\\s*$`)
  const out = []
  for (let i = 0; i < lineas.length;) {
    const m = lineas[i].match(fuera)
    if (m) { quitadas.push(m[1]); i = finDeBloque(lineas, i) + 1; continue }
    const f = lineas[i].match(conFill)
    if (f) {
      // Dentro de la tabla, en su bloque Insert: «account_id: string» → «account_id?: string».
      const fin = finDeBloque(lineas, i)
      let enInsert = false
      for (let j = i; j <= fin; j++) {
        if (/^\s+Insert: \{\s*$/.test(lineas[j])) enInsert = true
        else if (/^\s+(Update|Relationships): /.test(lineas[j])) enInsert = false
        if (enInsert && /^\s+account_id: string\s*$/.test(lineas[j])) { lineas[j] = lineas[j].replace('account_id:', 'account_id?:'); opcionales++ }
        out.push(lineas[j])
      }
      i = fin + 1
      continue
    }
    out.push(lineas[i]); i++
  }
  return { texto: out.join('\n'), quitadas, opcionales }
}
