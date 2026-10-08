// scripts/conta/lib/cuentasAnuales.mjs
//
// C05 · La serie de los modelos de cuentas anuales: LÍNEAS (balance, PyG y
// estado de ingresos y gastos reconocidos de cada modelo) y MAPEO línea ↔
// cuentas. Núcleo puro: recibe lo que saca modelos-pgc.mjs del BOE y el cuadro
// de cuentas del C02 (supabase/conta/pgc/serie.json) y devuelve filas. Lo usan
// scripts/conta/cuentas-anuales.mjs (genera la migración) y las pruebas.
//
// De dónde sale cada fila de mapeo (columna `origin`):
//   · 'boe'       la columna «N.º cuentas» del modelo, tal cual.
//   · 'a_crear'   una partida que las normas de elaboración mandan CREAR si hay
//                 saldo (respuestas 1 y 2 del C05): «Otros resultados» (678,
//                 778), «Diferencia negativa de combinaciones de negocio» (774),
//                 «Deuda con características especiales», «Investigación»,
//                 «Diferencia de conversión». La línea lleva to_create = true:
//                 solo sale con saldo.
//   · 'resultado' los grupos 6 y 7 en «Resultado del ejercicio» del balance:
//                 a una fecha sin regularizar, el resultado aún no está en la
//                 129 (lo hace Diez igual: «129, 6, 7»). Sin esto el balance no
//                 cuadra en ninguna fecha intermedia (regla 1).
//   · 'defecto'   colocada por defecto (respuesta 1): la 473 con la Hacienda
//                 deudora, y las cuentas que el modelo no nombra pero cuyas
//                 hermanas sí. La pantalla la marca «colocada por defecto» con
//                 «Completar», y el agente las cuenta.
//
// Signo por saldo (by_balance): una cuenta que el modelo pone en el activo Y en
// el pasivo (551, 5523, 5524, 5525 —el asterisco de Diez—) va al activo si su
// saldo es deudor y al pasivo si es acreedor. El signo de cada cuenta en la
// línea (sign) es informativo («(2801)» resta); el importe de una línea es
// siempre el saldo natural de su lado: Debe − Haber en el activo, Haber − Debe
// en patrimonio neto y pasivo y en la PyG.

export const MODELOS = ['normal', 'abreviado', 'pymes']
export const PLAN_DE = { normal: 'general', abreviado: 'general', pymes: 'pymes' }
const NORMA = { general: 'RD 1514/2007', pymes: 'RD 1515/2007' }

/** El estado al que va el saldo de una cuenta según su grupo. */
export const estadoDe = (code) => (/^[12345]/.test(code) ? 'balance' : /^[67]/.test(code) ? 'pyg' : 'igrpn')

/** Las partidas «a crear» de cada modelo, con su cita literal (tercera parte, I). */
export function partidasACrear(modelo) {
  const plan = PLAN_DE[modelo]
  const n = NORMA[plan]
  const pyg = []
  const bal = []
  if (plan === 'pymes') {
    pyg.push({ code: 'OR', text: 'Otros resultados.', despues: '11', cuentas: [['678', 'resta'], ['778', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 6.ª Cuenta de pérdidas y ganancias, apartado 6 (partida que se crea si hay ingresos o gastos excepcionales; la memoria los explica)` })
    bal.push({ code: 'PNP.B.DCE', text: 'Deuda con características especiales a largo plazo.', despues: 'PNP.B.V', lado: 'pn_pasivo', nivel: 2, cuentas: [['15', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 5.ª Balance, apartado 12` })
    bal.push({ code: 'PNP.C.DCE', text: 'Deuda con características especiales a corto plazo.', despues: 'PNP.C.V', lado: 'pn_pasivo', nivel: 2, cuentas: [['502', 'suma'], ['507', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 5.ª Balance, apartado 12` })
  } else {
    pyg.push({ code: 'DN', text: 'Diferencia negativa de combinaciones de negocio.', despues: '11', cuentas: [['774', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 7.ª Cuenta de pérdidas y ganancias, apartado 6` })
    pyg.push({ code: 'OR', text: 'Otros resultados.', despues: 'DN', cuentas: [['678', 'resta'], ['778', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 7.ª Cuenta de pérdidas y ganancias, apartado 9 (partida que se crea si hay ingresos o gastos excepcionales; la memoria los explica)` })
    bal.push({ code: 'PNP.B.DCE', text: 'Deuda con características especiales a largo plazo.', despues: 'PNP.B.V', lado: 'pn_pasivo', nivel: 2, cuentas: [['15', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 6.ª Balance, apartado 17` })
    bal.push({ code: 'PNP.C.DCE', text: 'Deuda con características especiales a corto plazo.', despues: 'PNP.C.VI', lado: 'pn_pasivo', nivel: 2, cuentas: [['502', 'suma'], ['507', 'suma']],
      legal_ref: `${n}, tercera parte, I, norma 6.ª Balance, apartado 17` })
    if (modelo === 'normal') {
      bal.push({ code: 'ACT.A.I.INV', text: 'Investigación.', despues: 'ACT.A.I', lado: 'activo', nivel: 3, cuentas: [['200', 'suma'], ['2800', 'resta'], ['2900', 'resta']],
        legal_ref: `${n}, tercera parte, I, norma 6.ª Balance, apartado 4` })
      bal.push({ code: 'PNP.A.A2.DC', text: 'Diferencia de conversión.', despues: 'PNP.A.A2.II', lado: 'pn_pasivo', nivel: 3, cuentas: [['135', 'suma']],
        legal_ref: `${n}, tercera parte, I, norma 6.ª Balance, apartado 14` })
    }
  }
  return { balance: bal, pyg }
}

/** Colocaciones por defecto explícitas (respuesta 1): [cuenta, línea del activo o única, línea del pasivo si va por signo]. */
function porDefecto(modelo) {
  const m = {
    pymes: {
      otrosDeudores: 'ACT.B.II.3', otrasDeudasCP: 'PNP.C.II.3', accionistas: 'ACT.B.II.2', financierasCP: 'ACT.B.IV', subvenciones: 'PNP.A.A2',
    },
    abreviado: {
      otrosDeudores: 'ACT.B.III.3', otrasDeudasCP: 'PNP.C.III.3', accionistas: 'ACT.B.III.2', financierasCP: 'ACT.B.V', ajustesValor: 'PNP.A.A2',
    },
    normal: {
      impuestoCorriente: 'ACT.B.III.5', otrasDeudasCP: 'PNP.C.III.5', accionistas: 'ACT.B.III.7', financierasCP: 'ACT.B.V.5', cobertura: 'PNP.A.A2.II', otrosLP: 'ACT.A.V.5',
    },
  }[modelo]
  const r = []
  // 473 (retenciones y pagos a cuenta): con la Hacienda deudora. Se cancela
  // contra la 4752 al registrar el impuesto; si queda saldo, el agente avisa.
  r.push({ cuenta: '473', linea: m.otrosDeudores ?? m.impuestoCorriente, motivo: 'Retenciones y pagos a cuenta: con la Hacienda deudora (Diez la pone en «Otros deudores»); se cancela contra la 4752 al cierre.' })
  for (const c of ['195', '197', '199']) r.push({ cuenta: c, linea: m.otrasDeudasCP, motivo: 'Situación transitoria de financiación: con las otras deudas a corto plazo.' })
  r.push({ cuenta: '5585', linea: m.accionistas, motivo: 'Desembolsos exigidos: con la 5580 (accionistas por desembolsos exigidos).' })
  // Cuentas corrientes que pueden ser deudoras o acreedoras: como la 551, por signo.
  for (const c of ['550', '554', '5530', '5531', '5532', '5533']) r.push({ cuenta: c, linea: m.financierasCP, pasivo: m.otrasDeudasCP, motivo: 'Cuenta corriente: como la 551, al activo si es deudora y al pasivo si es acreedora.' })
  if (modelo === 'pymes') {
    for (const c of ['1370', '1371']) r.push({ cuenta: c, linea: m.subvenciones, motivo: 'Ingresos fiscales a distribuir: el modelo de pymes no tiene «Ajustes por cambios de valor»; con las subvenciones.' })
  } else {
    r.push({ cuenta: '1341', linea: m.ajustesValor ?? m.cobertura, motivo: 'Cobertura de una inversión neta en un negocio en el extranjero: con las operaciones de cobertura (Diez la pone en «Ajustes por cambios de valor»).' })
    r.push({ cuenta: '136', linea: m.ajustesValor ?? 'PNP.A.A2.III', motivo: 'Ajustes por valoración de activos mantenidos para la venta: con los demás ajustes por cambios de valor.' })
    if (modelo === 'abreviado') r.push({ cuenta: '135', linea: m.ajustesValor, motivo: 'Diferencias de conversión: el abreviado no tiene la partida; con los ajustes por cambios de valor.' })
    if (modelo === 'normal') r.push({ cuenta: '257', linea: m.otrosLP, motivo: 'Derechos de reembolso de seguros: con los otros activos financieros a largo plazo (el abreviado la nombra en V).' })
  }
  return r
}

/** El código de línea al que va el resultado del ejercicio en cada modelo. */
const LINEA_RESULTADO = { normal: 'PNP.A.A1.VII', abreviado: 'PNP.A.A1.VII', pymes: 'PNP.A.A1.VII' }

/**
 * Construye la serie de un modelo.
 * @param {string} modelo normal | abreviado | pymes
 * @param {{balance:{lineas:any[]}, pyg:{lineas:any[]}, igrpn?:{lineas:any[]}}} estados lo de modelos-pgc.mjs
 * @param {string[]} hojas códigos hoja del cuadro de su plan (serie.json, is_leaf)
 * @param {{vigentes: Record<string,string>, citaModelo: (estado:string)=>string}} meta
 */
export function construirModelo(modelo, estados, hojas, meta) {
  const lineas = []
  const mapeo = []
  const aCrear = partidasACrear(modelo)
  for (const estado of ['balance', 'pyg', 'igrpn']) {
    const e = estados[estado]
    if (!e || !e.lineas?.length) continue
    const extra = aCrear[estado] ?? []
    const base = e.lineas.map((l) => ({ ...l }))
    // Las partidas a crear van detrás de la línea que dice la norma (o de su último descendiente).
    const orden = []
    for (const l of base) orden.push(l)
    for (const x of extra) {
      let i = orden.findIndex((l) => l.codigo === x.despues)
      if (i < 0) throw new Error(`${modelo} · ${estado}: no está la línea ${x.despues} para poner detrás «${x.text}»`)
      const pref = x.despues + '.'
      while (i + 1 < orden.length && orden[i + 1].codigo.startsWith(pref)) i++
      const padre = orden.find((l) => l.codigo === x.despues)
      orden.splice(i + 1, 0, { codigo: x.code, texto: x.text, nivel: x.nivel ?? padre.nivel, total: false, lado: x.lado ?? padre.lado ?? null, cuentas: [], aCrear: x })
    }
    orden.forEach((l, i) => {
      const padre = [...orden.slice(0, i)].reverse().find((p) => !p.total && p.nivel < l.nivel)
      lineas.push({
        model: modelo, statement: estado, code: l.codigo, parent_code: l.total ? null : padre?.codigo ?? null, text: l.texto,
        level: l.nivel, sort_order: (i + 1) * 10, side: l.lado ?? null, is_total: !!l.total, to_create: !!l.aCrear,
        legal_ref: l.aCrear ? l.aCrear.legal_ref : meta.citaModelo(estado),
      })
      const filas = l.aCrear ? l.aCrear.cuentas.map(([cuenta, sign]) => ({ cuenta, signo: sign, dosSignos: false })) : l.cuentas
      for (const c of filas) {
        mapeo.push({ model: modelo, statement: estado, line_code: l.codigo, account_prefix: c.cuenta, sign: c.signo, by_balance: null,
          origin: l.aCrear ? 'a_crear' : 'boe', any_sign: !!c.dosSignos, note: null, legal_ref: l.aCrear ? l.aCrear.legal_ref : meta.citaModelo(estado) })
      }
    })
  }

  // Signo por saldo: una cuenta del balance en el activo y en el pasivo.
  const enBalance = mapeo.filter((m) => m.statement === 'balance')
  const lado = (code) => lineas.find((l) => l.model === modelo && l.statement === 'balance' && l.code === code)?.side
  const porCuenta = new Map()
  for (const m of enBalance) porCuenta.set(m.account_prefix, [...(porCuenta.get(m.account_prefix) ?? []), m])
  for (const [, ms] of porCuenta) {
    const lados = new Set(ms.map((m) => lado(m.line_code)))
    if (ms.length > 1 && lados.has('activo') && lados.has('pn_pasivo')) for (const m of ms) m.by_balance = lado(m.line_code) === 'activo' ? 'deudor' : 'acreedor'
  }

  // El resultado del ejercicio: 6 y 7 sin regularizar.
  const lr = LINEA_RESULTADO[modelo]
  if (!lineas.some((l) => l.statement === 'balance' && l.code === lr)) throw new Error(`${modelo}: no está la línea del resultado ${lr}`)
  for (const g of ['6', '7']) mapeo.push({ model: modelo, statement: 'balance', line_code: lr, account_prefix: g, sign: 'suma', by_balance: null, origin: 'resultado', any_sign: true,
    note: 'Saldo de los grupos 6 y 7 aún sin regularizar: es resultado del ejercicio (al regularizar pasa a la 129).', legal_ref: meta.citaModelo('balance') })

  const yaColocada = (code, estado) => mapeo.some((m) => m.statement === estado && m.origin !== 'resultado' && code.startsWith(m.account_prefix))
  const existeLinea = (code) => lineas.some((l) => l.statement === 'balance' && l.code === code)
  const hojasPlan = new Set(hojas)

  // Colocaciones por defecto explícitas.
  for (const d of porDefecto(modelo)) {
    if (!hojasPlan.has(d.cuenta) && !hojas.some((h) => h.startsWith(d.cuenta))) continue
    if (yaColocada(d.cuenta, 'balance')) continue
    if (!existeLinea(d.linea)) throw new Error(`${modelo}: la línea ${d.linea} de la colocación por defecto de ${d.cuenta} no existe`)
    mapeo.push({ model: modelo, statement: 'balance', line_code: d.linea, account_prefix: d.cuenta, sign: 'suma', by_balance: d.pasivo ? 'deudor' : null, origin: 'defecto', any_sign: false, note: d.motivo, legal_ref: meta.citaModelo('balance') })
    if (d.pasivo) {
      if (!existeLinea(d.pasivo)) throw new Error(`${modelo}: la línea ${d.pasivo} no existe`)
      mapeo.push({ model: modelo, statement: 'balance', line_code: d.pasivo, account_prefix: d.cuenta, sign: 'suma', by_balance: 'acreedor', origin: 'defecto', any_sign: false, note: d.motivo, legal_ref: meta.citaModelo('balance') })
    }
  }

  // Cuentas que el modelo reparte a un nivel más fino (160 → 1603/1604/1605):
  // van a la línea de su hija «otras» (la que acaba en 5), o a la primera.
  // Se aplica a las hojas del cuadro Y a sus padres de 3 cifras, porque una
  // empresa puede tener la cuenta de 3 cifras como cuenta de apunte (el C02 la
  // crea así: Foodint tiene 160, 240, 510, 530…).
  const candidatas = new Set([...hojas, ...hojas.filter((h) => h.length > 3).map((h) => h.slice(0, 3))])
  for (const code of [...candidatas].sort()) {
    const estado = estadoDe(code)
    if (estado === 'igrpn') continue
    if (yaColocada(code, estado)) continue
    const hijas = mapeo.filter((m) => m.statement === estado && m.account_prefix.startsWith(code) && m.account_prefix.length > code.length && m.origin !== 'resultado')
    if (!hijas.length) continue
    const otras = hijas.filter((m) => m.account_prefix.endsWith('5'))
    const elegidas = otras.length ? otras : [hijas.sort((a, b) => a.account_prefix.localeCompare(b.account_prefix))[0]]
    const hija = elegidas[0].account_prefix
    for (const h of mapeo.filter((m) => m.statement === estado && m.account_prefix === hija && m.origin !== 'resultado')) {
      mapeo.push({ ...h, account_prefix: code, origin: 'defecto', note: `El modelo no nombra la ${code}; va con su hija ${hija}. Completar si es de grupo o asociadas.` })
    }
  }
  return { lineas, mapeo }
}

/**
 * Dónde cae cada hoja del cuadro (regla 2). Devuelve, por estado, las cuentas
 * sin sitio y las que caen en más de una línea sin ir por signo.
 */
export function cobertura(modelo, mapeo, codigos) {
  const sinSitio = []
  const varias = []
  for (const code of codigos) {
    for (const estado of estadoDe(code) === 'igrpn' ? [] : estadoDe(code) === 'pyg' ? ['pyg', 'balance'] : ['balance']) {
      const ms = mapeo.filter((m) => m.model === modelo && m.statement === estado && code.startsWith(m.account_prefix))
      // La más específica manda (prefijo más largo), como en el cálculo.
      const max = Math.max(0, ...ms.map((m) => m.account_prefix.length))
      const top = ms.filter((m) => m.account_prefix.length === max)
      if (!top.length) sinSitio.push({ code, estado })
      else {
        const lineasSinSigno = new Set(top.filter((m) => !m.by_balance).map((m) => m.line_code))
        const porSigno = top.filter((m) => m.by_balance)
        if (lineasSinSigno.size > 1 || (lineasSinSigno.size && porSigno.length)) varias.push({ code, estado, lineas: [...new Set(top.map((m) => m.line_code))] })
      }
    }
  }
  return { sinSitio, varias }
}
