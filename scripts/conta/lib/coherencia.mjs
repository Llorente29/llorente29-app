// scripts/conta/lib/coherencia.mjs
//
// Agente «Datos maestros e impuestos», segunda mitad (respuesta 3 del C00,
// punto 4): COHERENCIA, no recuento. Comprueba que lo que hay en la base
// cumple las normas fiscales, contables y tributarias, empresa por empresa, y
// cada hallazgo dice el caso concreto y su norma.
//
//   rojo   falla: abre aviso (el agente sale con código 1)
//   ámbar  falta algo que hará falta (sale en el informe, no interrumpe; regla 7)
//
// Pura: recibe el volcado de la base (agente-datos-maestros.sql) y, para la
// comprobación de pantallas, el texto de los ficheros. Sin red ni base.
//
// Las reglas son LAS MISMAS que usa la app (src/modules/conta/lib/modelos.ts,
// ivaVentas.ts, pgc.ts): tests/conta/cumplimiento/coherencia.test.ts comprueba
// que las dos dicen lo mismo sobre la población real.

/** Ley 3/2004, art. 4.3: el plazo de pago entre empresas no pasa de 60 días. */
export const PLAZO_MAXIMO = 60
const NORMA_PLAZO = 'Ley 3/2004, art. 4.3'
const NORMA_IVA_VENTAS = 'Ley 37/1992, art. 91.Uno.2.2.º (criterio de Foodint, respuesta 2; pendiente de confirmación del asesor fiscal)'
const NORMA_CUENTAS = 'RD 1514/2007: el plan define las cuentas hasta 4 dígitos; se apunta en subcuentas con la longitud de la empresa'

const vacio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const lista = (v) => (Array.isArray(v) ? v.map(String) : [])

/** La misma regla que src/modules/conta/lib/ivaVentas.ts (esHosteleria). */
export function esHosteleria(iaeCode, cnaeCode) {
  const iae = String(iaeCode ?? '')
  const [seccion, numero] = iae.includes('_') ? iae.split('_') : ['1', iae]
  return (seccion === '1' && /^6[78]/.test(numero)) || /^5[56]/.test(String(cnaeCode ?? '').replace(/[^0-9]/g, ''))
}

/** Hostelería en el IAE (agrupaciones 67 y 68) y en la CNAE (divisiones 55 y 56), cada una por su lado. */
const iaeHosteleria = (c) => { const s = String(c ?? ''); const [sec, n] = s.includes('_') ? s.split('_') : ['1', s]; return sec === '1' && /^6[78]/.test(n) }
const cnaeHosteleria = (c) => /^5[56]/.test(String(c ?? '').replace(/[^0-9]/g, ''))

/** La misma regla que src/modules/conta/lib/modelos.ts (coherenciaModelos), con las filas de tax_form de la base. */
export function coherenciaModelos(modelos, reglas, perfil) {
  const tiene = new Set(modelos)
  const out = []
  for (const r of reglas) {
    if (r.annual_form_code && tiene.has(r.code) && !tiene.has(r.annual_form_code)) {
      out.push({ clave: 'periodico_sin_anual', modelo: r.code, norma: r.annual_legal_ref, texto: `Presenta el ${r.code} y no su resumen anual, el ${r.annual_form_code}.` })
    }
    if (r.annual_form_code && tiene.has(r.annual_form_code) && !tiene.has(r.code)) {
      out.push({ clave: 'anual_sin_periodico', modelo: r.annual_form_code, norma: r.annual_legal_ref, texto: `Presenta el ${r.annual_form_code} (resumen anual) sin el ${r.code} del que resume.` })
    }
    if (r.default_for === 'company_not_sii' && perfil.tipo === 'company') {
      if (!perfil.sii && !tiene.has(r.code)) out.push({ clave: 'falta_por_defecto', modelo: r.code, norma: r.default_legal_ref, texto: `Es una sociedad fuera del SII y no tiene el ${r.code}.` })
      if (perfil.sii && tiene.has(r.code)) out.push({ clave: 'sobra_por_defecto', modelo: r.code, norma: r.default_legal_ref, texto: `Lleva el SII y tiene el ${r.code}, que con el SII no se presenta.` })
    }
  }
  return out
}

/** Huecos en la vigencia: entre el final de una fila y el principio de la siguiente del mismo concepto queda algún día sin tipo. */
export function huecosDeVigencia(filas) {
  const out = []
  const porConcepto = new Map()
  for (const f of filas) porConcepto.set(f.code, [...(porConcepto.get(f.code) ?? []), f])
  for (const [code, fs] of porConcepto) {
    const orden = [...fs].sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)))
    for (let i = 1; i < orden.length; i++) {
      const ant = orden[i - 1], act = orden[i]
      if (vacio(ant.valid_to)) continue // eso es un solape, no un hueco: lo cuenta la primera mitad
      const siguiente = new Date(`${String(ant.valid_to).slice(0, 10)}T00:00:00Z`)
      siguiente.setUTCDate(siguiente.getUTCDate() + 1)
      const debia = siguiente.toISOString().slice(0, 10)
      if (String(act.valid_from).slice(0, 10) > debia) {
        out.push({ code, desde: debia, hasta: String(act.valid_from).slice(0, 10), norma: act.legal_ref ?? ant.legal_ref ?? null })
      }
    }
  }
  return out
}

/**
 * Las pantallas que enseñan una cuenta con el código corto del plan donde va
 * la cuenta de apunte. cuentaPgc es el título de grupo; solo se permite donde
 * no hay empresa (y por tanto no hay longitud) o donde está definido.
 */
export const CUENTA_CORTA_PERMITIDA = new Set([
  'src/modules/conta/lib/pgc.ts', // la define
  'src/modules/conta/lib/opcionesFicha.ts', // sin empresa no hay longitud
  'src/modules/conta/tablas/registro.ts', // ídem, cuando la tabla se pinta sin contexto de empresa
])
export function pantallasConCuentaCorta(ficheros) {
  return ficheros
    .filter((f) => !CUENTA_CORTA_PERMITIDA.has(f.ruta) && /\bcuentaPgc\(/.test(f.texto))
    .map((f) => f.ruta)
}

// ── La ficha basta para presentar (respuesta 3, punto 5) ────────────────────
// La misma lista que src/modules/conta/lib/presentar.ts (requisitosParaPresentar),
// sobre el volcado de la base. La prueba compara las dos.

const ROLES_DE_REPRESENTANTE = ['administrator', 'representative', 'president']
const NOMBRE_DOC = { '200': 'el modelo 200', deposito: 'el depósito de cuentas', notificaciones: 'las notificaciones' }

/** El ejercicio que se presentaría: el último cerrado; si no hay, el de hoy. */
function ejercicioParaPresentar(ejercicios, hoy) {
  const cerrados = ejercicios.filter((x) => x.status === 'closed').sort((a, b) => String(b.ends_on).localeCompare(String(a.ends_on)))
  return cerrados[0] ?? ejercicios.find((x) => String(x.starts_on) <= hoy && String(x.ends_on) >= hoy) ?? null
}

export function tocaPresentar(e) {
  return e.entity_kind === 'company' && ((e.ejercicios ?? []).some((x) => x.status === 'closed') || lista(e.tax_forms).includes('200'))
}

/** Lo que falta (clave, texto, para), como en la app. Solo sociedades. */
export function faltaParaPresentar(e, hoy) {
  if (e.entity_kind !== 'company') return []
  const ll = (v) => !vacio(v)
  // El volcado no saca el NIF de las personas: solo si lo tienen (tax_id_puesto).
  const conNif = (p) => p.tax_id_puesto === true || ll(p.tax_id)
  const vivas = (e.actividades ?? []).filter((a) => vacio(a.ended_on))
  const principal = vivas.find((a) => a.is_main) ?? vivas[0]
  const socios = (e.personas ?? []).filter((p) => vacio(p.ended_on))
  const ej = ejercicioParaPresentar(e.ejercicios ?? [], hoy)
  const r = [
    ['razon_social', 'Razón social', ['200', 'deposito'], ll(e.legal_name)],
    ['nif', 'NIF', ['200', 'deposito'], ll(e.tax_id)],
    ['forma', 'Forma jurídica', ['200', 'deposito'], ll(e.legal_form_code)],
    ['domicilio', 'Domicilio fiscal completo', ['200', 'deposito'], ll(e.fiscal_street) && ll(e.fiscal_postal_code) && ll(e.fiscal_city)],
    ['constitucion', 'Fecha de constitución', ['200', 'deposito'], ll(e.incorporated_on)],
    ['registro', 'Datos del Registro Mercantil: registro, tomo, folio, hoja e inscripción', ['deposito'],
      [e.registry_name, e.registry_volume, e.registry_folio, e.registry_sheet, e.registry_entry].every(ll)],
    ['contacto', 'Teléfono o correo de la empresa', ['deposito'], ll(e.phone) || ll(e.email)],
    ['dehu', 'Correo para los avisos de notificaciones (DEHú)', ['notificaciones'], ll(e.dehu_email)],
    ['cnae', 'CNAE de la actividad principal', ['200', 'deposito'], ll(principal?.cnae_code)],
    ['representante', 'Un representante legal (administrador o apoderado) con su NIF', ['200'],
      socios.some((p) => lista(p.roles).some((x) => ROLES_DE_REPRESENTANTE.includes(x)) && conNif(p))],
    ['socios', 'Los socios con un 5 % o más, con su NIF y su porcentaje', ['200'],
      socios.some((p) => p.ownership_pct !== null && p.ownership_pct !== undefined) && socios.filter((p) => Number(p.ownership_pct ?? 0) >= 5).every(conNif)],
    ['firmantes', 'Quién firma las cuentas anuales', ['deposito'], socios.some((p) => p.signs_accounts === true)],
    ['plantilla', `Plantilla media${ej ? ` de ${ej.code}` : ''}, fija y no fija`, ['200', 'deposito'],
      !!ej && ej.average_staff_fixed !== null && ej.average_staff_fixed !== undefined && ej.average_staff_temporary !== null && ej.average_staff_temporary !== undefined],
    ['auditoria', `Si las cuentas${ej ? ` de ${ej.code}` : ''} están auditadas y, si lo están, el auditor y su opinión`, ['200', 'deposito'],
      !!ej && (ej.is_audited === false || (ej.is_audited === true && ll(ej.auditor_name) && ll(ej.audit_opinion)))],
  ]
  return r.filter((x) => !x[3]).map(([clave, texto, para]) => ({ clave, texto, para }))
}

/**
 * @param {object} bd  el volcado (agente-datos-maestros.sql): tablas.tax_form, tablas.tax_rate,
 *   tablas.withholding_rate, empresas, plazos, proveedores_plazo, cuentas_apunte
 * @param {{ ficheros?: { ruta: string, texto: string }[], hoy?: string }} extra
 * @returns {{ nivel: 'rojo'|'ambar', tipo: string, donde: string, detalle: string, norma: string|null }[]}
 */
export function revisarCoherencia(bd, extra = {}) {
  const out = []
  const h = (nivel, tipo, donde, detalle, norma) => out.push({ nivel, tipo, donde, detalle, norma: norma ?? null })
  const reglas = bd.tablas?.tax_form ?? []
  const empresas = (bd.empresas ?? []).filter((e) => e.completa)

  for (const e of empresas) {
    const donde = `${e.legal_name ?? 'Empresa sin nombre'} (cuenta ${String(e.account_id).slice(0, 8)})`
    const tipo = e.entity_kind === 'self_employed' ? 'self_employed' : 'company'
    // 1 y 2. Modelos: periódico sin anual, anual sin periódico, 347 fuera del SII.
    for (const c of coherenciaModelos(lista(e.tax_forms), reglas, { tipo, sii: e.sii === true })) {
      h('rojo', c.clave === 'falta_por_defecto' || c.clave === 'sobra_por_defecto' ? 'modelo_347' : 'modelos', donde, c.texto, c.norma)
    }
    const vivas = (e.actividades ?? []).filter((a) => vacio(a.ended_on))
    for (const a of vivas) {
      // 5a. Epígrafe del IAE sin CNAE compatible (lo que se puede comprobar: la hostelería).
      if (!vacio(a.iae_code) && vacio(a.cnae_code)) h('rojo', 'iae_cnae', donde, `La actividad «${a.description}» tiene epígrafe del IAE (${a.iae_code ?? 'ninguno'}) y no tiene CNAE.`, 'RD 10/2025 (CNAE-2025)')
      else if (!vacio(a.iae_code) && iaeHosteleria(a.iae_code) !== cnaeHosteleria(a.cnae_code)) {
        h('rojo', 'iae_cnae', donde, `La actividad «${a.description}» tiene el epígrafe ${a.iae_code} y la CNAE ${a.cnae_code}: uno es de hostelería y el otro no.`, 'RD 10/2025 (CNAE-2025) y RDL 1175/1990 (tarifas del IAE)')
      }
    }
    // 5b. Hostelería (también la que solo reparte) sin el IVA de sus ventas al 10 %.
    if (e.tax_territory === 'peninsula_baleares' && vivas.some((a) => esHosteleria(a.iae_code, a.cnae_code)) && e.sales_tax_rate_code !== 'iva_reducido') {
      h('rojo', 'iva_ventas', donde, `Es hostelería y el IVA de sus ventas está en ${e.sales_tax_rate_code ?? 'nada'}, no en el 10 %.`, NORMA_IVA_VENTAS)
    }
  }

  // Punto 5. Sociedad a la que ya le toca presentar (ejercicio cerrado o el 200
  // previsto) y le falta algo que piden el 200 o el depósito: ámbar, con el campo.
  for (const e of empresas) {
    if (!tocaPresentar(e)) continue
    const donde = `${e.legal_name ?? 'Empresa sin nombre'} (cuenta ${String(e.account_id).slice(0, 8)})`
    for (const f of faltaParaPresentar(e, extra.hoy ?? new Date().toISOString().slice(0, 10))) {
      const docs = f.para.filter((p) => p !== 'notificaciones')
      const para = docs.length ? `que pide${docs.length > 1 ? 'n' : ''} ${docs.map((p) => NOMBRE_DOC[p]).join(' y ')}` : 'que hace falta para las notificaciones'
      h('ambar', 'presentar', donde, `Falta «${f.texto}», ${para}.`,
        'Orden del modelo 200 del ejercicio y Orden JUS de los modelos de depósito de cuentas (hoja de identificación)')
    }
  }

  // 3. Impuestos y retenciones de serie: huecos en la vigencia (los solapes los cuenta la primera mitad).
  for (const [t, nombre] of [['tax_rate', 'Impuestos'], ['withholding_rate', 'Retenciones']]) {
    for (const x of huecosDeVigencia(bd.tablas?.[t] ?? [])) {
      h('rojo', 'hueco', `${nombre} · ${x.code}`, `Del ${x.desde} al día antes del ${x.hasta} no hay ningún tipo vigente.`, x.norma)
    }
  }

  // 4. Plazos de pago de más de 60 días, en Tablas o en un proveedor.
  for (const p of bd.plazos ?? []) {
    const dias = lista(p.days).map(Number).filter(Number.isFinite)
    if (dias.some((d) => d > PLAZO_MAXIMO)) h('rojo', 'plazo', `Plazos de pago · ${p.name} (${p.is_system ? 'de serie' : `cuenta ${String(p.account_id).slice(0, 8)}`})`, `Pasa de ${PLAZO_MAXIMO} días: ${dias.join(', ')}.`, NORMA_PLAZO)
  }
  for (const s of bd.proveedores_plazo ?? []) {
    if (Number(s.payment_terms_days) > PLAZO_MAXIMO) h('rojo', 'plazo', `Proveedor ${s.name} (cuenta ${String(s.account_id).slice(0, 8)})`, `Paga a ${s.payment_terms_days} días, más de ${PLAZO_MAXIMO}.`, NORMA_PLAZO)
  }

  // 6. Cuentas de apunte más cortas que la longitud de la empresa: en los datos…
  for (const c of bd.cuentas_apunte ?? []) {
    const largo = String(c.ledger_account_code ?? '').length
    if (largo > 0 && largo < Number(c.account_digits)) {
      h('rojo', 'cuenta_corta', `Proveedor ${c.name} (cuenta ${String(c.account_id).slice(0, 8)})`, `Su cuenta ${c.ledger_account_code} tiene ${largo} dígitos y la empresa usa ${c.account_digits}.`, NORMA_CUENTAS)
    }
  }
  // …y en las pantallas.
  for (const ruta of pantallasConCuentaCorta(extra.ficheros ?? [])) {
    h('rojo', 'cuenta_corta', ruta, 'Enseña una cuenta con el código corto del plan (cuentaPgc) donde va la cuenta de apunte completa.', NORMA_CUENTAS)
  }
  return out
}

const TITULO = {
  modelos: 'Modelos sin su resumen anual (o al revés)', modelo_347: 'El 347', hueco: 'Huecos en la vigencia', plazo: 'Plazos de pago de más de 60 días',
  iae_cnae: 'Epígrafe y CNAE que no casan', presentar: 'Lo que falta para presentar el 200 y depositar las cuentas', iva_ventas: 'El IVA de las ventas de la hostelería', cuenta_corta: 'Cuentas más cortas que las de la empresa',
}

/** La parte del informe que dice la coherencia, en lenguaje normal. */
export function informeCoherencia(hallazgos, { empresasMiradas }) {
  const l = ['## Coherencia fiscal, contable y tributaria', '']
  const rojos = hallazgos.filter((x) => x.nivel === 'rojo')
  const ambar = hallazgos.filter((x) => x.nivel === 'ambar')
  l.push(`Revisadas ${empresasMiradas} empresas con el alta terminada, los impuestos y retenciones de serie, los plazos de pago y las pantallas que enseñan cuentas.`, '')
  if (hallazgos.length === 0) {
    l.push('**Todo es coherente.** Cada periódico lleva su anual, el 347 está donde toca, no hay huecos en la vigencia, ningún plazo pasa de 60 días, cada epígrafe casa con su CNAE, la hostelería vende al 10 % y las cuentas salen con la longitud de su empresa.', '')
    return l.join('\n')
  }
  if (rojos.length) l.push(`🔴 **${rojos.length === 1 ? 'Un fallo' : `${rojos.length} fallos`}.** No se ha cambiado nada: cada uno con su caso y su norma.`, '')
  const porTipo = new Map()
  for (const x of rojos) porTipo.set(x.tipo, [...(porTipo.get(x.tipo) ?? []), x])
  for (const [tipo, xs] of porTipo) {
    l.push(`### ${TITULO[tipo] ?? tipo} · ${xs.length}`, '')
    for (const x of xs) l.push(`- **${x.donde}**: ${x.detalle}${x.norma ? ` _(${x.norma})_` : ''}`)
    l.push('')
  }
  if (ambar.length) {
    l.push(`🟠 **${ambar.length === 1 ? 'Un aviso' : `${ambar.length} avisos`}** (falta algo que hará falta; no abre incidencia).`, '')
    for (const x of ambar) l.push(`- **${x.donde}**: ${x.detalle}${x.norma ? ` _(${x.norma})_` : ''}`)
    l.push('')
  }
  return l.join('\n')
}
