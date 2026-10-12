// scripts/conta/diez/lectura.mjs
//
// C04b · T1 · Qué hay en el Diez de la empresa, CONTADO. Solo lectura.
//
// Lo corre el workflow diez-lectura.yml con el secreto DIEZ_LECTURA (un JSON con
// los parámetros de POST /token tal cual los pide apiCON, y opcionalmente
// base_url). El secreto no se escribe en ningún sitio: el workflow enmascara
// cada valor antes de llamar a este script.
//
// Lo que sale (Markdown, a la salida estándar) son RECUENTOS Y FORMAS: cuántos
// asientos por ejercicio y serie, si llevan analítica, cuántas facturas y
// adjuntos, cómo pagina, qué límites tiene. NUNCA importes, nombres, NIF,
// conceptos ni códigos de terceros: el repositorio es público y el resumen
// del run también.
//
// Freno: la única escritura posible es entrar (POST /token). Cualquier otra
// cosa que no sea GET lanza antes de salir del proceso.
//
//   DIEZ_LECTURA='{"username":…}' node scripts/conta/diez/lectura.mjs [desde AAAAMM] [hasta AAAAMM]

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred || typeof cred !== 'object') {
  console.log('**Falta el secreto DIEZ_LECTURA** (o no es un JSON). No se lee nada.')
  process.exit(1)
}
const BASE0 = String(cred.base_url || 'https://apicon.diezsoftware.com').replace(/\/$/, '')
// Siempre https, aunque la colección diga http. La única excepción es el Diez
// falso de las pruebas, en esta misma máquina.
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE0)
const BASE = LOCAL ? BASE0 : BASE0.replace(/^http:\/\//i, 'https://')
// /token (12/10, Julio): en Diez cada empresa es una base de datos, y se
// nombra con nombre_bd. Llorente29 es C0008. Un solo intento, en formulario:
// grant_type, client_id, client_secret, username, password y nombre_bd.
// cod_empresa no se manda. Si falla, para.
const CAMPOS = ['grant_type', 'client_id', 'client_secret', 'username', 'password', 'nombre_bd']
const cuerpoToken = Object.fromEntries(CAMPOS.filter((k) => cred[k] !== undefined && cred[k] !== null).map((k) => [k, String(cred[k])]))
const sobran = Object.keys(cred).filter((k) => k !== 'base_url' && !CAMPOS.includes(k))
// La base que se espera leer, y la que nunca se toca (la personal de Julio).
const BD_ESPERADA = 'C0008'
const BD_PROHIBIDAS = ['C0001']
// Lo que ya se sabe de Foodint en Diez (C02c, 06/10: el plan leído del PDF de
// Diez, en producción, company_chart_import): para comprobar que se lee lo suyo.
const REFERENCIA = { cuentas: 743, terceros: 45, ejercicios: ['2023', '2024', '2025', '2026'] }
const DESDE = process.argv[2] || '202301'
const HASTA = process.argv[3] || '202609'
const MUESTRA = Number(process.env.MUESTRA_POR_EJERCICIO || 25)
const PAUSA_MS = 120

const l = []
const md = (...x) => l.push(...x)
const metrica = { peticiones: 0, bytes: 0, ms: 0, porRuta: {}, limites: new Set(), esperas429: 0 }
let token = null
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Lo único que habla con Diez ──────────────────────────────────────────────
async function llamar(metodo, ruta, { cuerpo, tipoCuerpo, crudo } = {}) {
  const esEntrar = metodo === 'POST' && ruta === '/token'
  if (metodo !== 'GET' && !esEntrar) throw new Error(`Freno: ${metodo} ${ruta} no es lectura`)
  if (!BASE.startsWith('https://') && !LOCAL) throw new Error('Freno: sin https no sale nada')
  const cab = { accept: 'application/json' }
  if (token && !esEntrar) cab.authorization = `Bearer ${token}`
  let body
  if (cuerpo) {
    cab['content-type'] = tipoCuerpo
    body = tipoCuerpo === 'application/json' ? JSON.stringify(cuerpo) : new URLSearchParams(cuerpo).toString()
  }
  for (let intento = 1; intento <= 4; intento++) {
    await espera(PAUSA_MS)
    const t0 = Date.now()
    const r = await fetch(BASE + ruta, { method: metodo, headers: cab, body, redirect: 'manual' })
    // Una redirección podría llevar a http: no se sigue ninguna.
    if (r.status >= 300 && r.status < 400) throw new Error(`Freno: ${metodo} ${ruta.split('?')[0]} redirige (${r.status}); no se sigue`)
    const buf = Buffer.from(await r.arrayBuffer())
    const ms = Date.now() - t0
    metrica.peticiones++; metrica.bytes += buf.length; metrica.ms += ms
    const clave = ruta.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/{n}')
    const pr = (metrica.porRuta[clave] ??= { n: 0, bytes: 0, ms: 0, maxMs: 0 })
    pr.n++; pr.bytes += buf.length; pr.ms += ms; pr.maxMs = Math.max(pr.maxMs, ms)
    for (const [k, v] of r.headers) if (/rate|retry|limit|quota|throttl/i.test(k)) metrica.limites.add(`${k}: ${v}`)
    if (r.status === 429 && intento < 4) {
      metrica.esperas429++
      const s = Math.min(Number(r.headers.get('retry-after')) || 10 * intento, 60)
      await espera(s * 1000)
      continue
    }
    if (crudo) return { status: r.status, bytes: buf.length, tipo: r.headers.get('content-type') }
    let json = null
    try { json = JSON.parse(buf.toString('utf8')) } catch { /* no es JSON */ }
    return { status: r.status, json, bytes: buf.length, ms }
  }
}
const get = (ruta, o) => llamar('GET', ruta, o)

// Un mensaje de error sin datos: solo letras y la forma.
const sinDatos = (x) => (x == null ? '—' : JSON.stringify(x).replace(/\d/g, '9').replace(/\s+/g, ' ').slice(0, 160))
const claves = (o) => (o && typeof o === 'object' ? Object.keys(o).join(', ') : typeof o)
const paginada = (j) => j && typeof j === 'object' && Array.isArray(j.Datos)
const lleno = (v) => v !== null && v !== undefined && String(v).trim() !== ''
const cent = (n) => Math.round(Number(n || 0) * 100)
const cuenta = (obj, k, n = 1) => { obj[k] = (obj[k] ?? 0) + n }
const tabla = (cabeza, filas) => { md(`| ${cabeza.join(' | ')} |`, `|${cabeza.map(() => '---').join('|')}|`, ...filas.map((f) => `| ${f.join(' | ')} |`), '') }
const meses = () => {
  const out = []
  let y = Number(DESDE.slice(0, 4)), m = Number(DESDE.slice(4))
  while (y * 100 + m <= Number(HASTA)) {
    const fin = new Date(Date.UTC(y, m, 0)).getUTCDate()
    out.push({ y, m, ini: `${y}${String(m).padStart(2, '0')}01`, fin: `${y}${String(m).padStart(2, '0')}${fin}` })
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
const fechaComo = (formato, yyyymmdd) => {
  const [y, m, d] = [yyyymmdd.slice(0, 4), yyyymmdd.slice(4, 6), yyyymmdd.slice(6)]
  return { compacta: yyyymmdd, iso: `${y}-${m}-${d}`, es: `${d}/${m}/${y}` }[formato]
}

// ── 1. Entrar ────────────────────────────────────────────────────────────────
md('## Diez · lectura (solo recuentos)', '', `Base: \`${BASE}\` · meses: ${DESDE}–${HASTA}`, '')
md('### Entrar', '')
// Antes de mandar ninguna credencial: ¿contesta Diez por https? (sin datos)
try {
  if (!BASE.startsWith('https://') && !LOCAL) throw new Error(`la base no es https: ${BASE.split('/')[0]}`)
  const r = await fetch(BASE + '/swagger/docs/v1', { redirect: 'manual' })
  md(`- https: \`GET /swagger/docs/v1\` → ${r.status} (sin credenciales)`)
  if (r.status !== 200) throw new Error(`contesta ${r.status}`)
} catch (e) {
  md(`**Diez no responde por https (${e.message}). Paro aquí: no se manda nada sin cifrar.**`)
  process.stdout.write(l.join('\n') + '\n')
  process.exit(1)
}
if (sobran.length) md(`- Del secreto no se manda nunca: ${sobran.join(', ')}`)
let comoEntra = null, dataBase = null
if (BD_PROHIBIDAS.includes(String(cred.nombre_bd ?? '').trim().toUpperCase())) {
  md(`**El secreto apunta a ${String(cred.nombre_bd).trim()}, que nunca se toca. No se entra.**`)
  process.stdout.write(l.join('\n') + '\n')
  process.exit(1)
}
{
  const r = await llamar('POST', '/token', { cuerpo: cuerpoToken, tipoCuerpo: 'application/x-www-form-urlencoded' })
  md(`- Un intento (formulario; campos: ${Object.keys(cuerpoToken).join(', ')}) → ${r.status}; la respuesta trae: ${claves(r.json)}`)
  // El código OAuth y su texto dicen por qué no entra, sin datos (cifras como 9;
  // los valores del secreto los enmascara el workflow).
  if (r.status !== 200 && r.json) md(`  - error: \`${sinDatos(r.json.error)}\` · ${sinDatos(r.json.error_description)}`)
  const t = r.json && Object.entries(r.json).find(([k, v]) => /access_?token|^token$/i.test(k) && typeof v === 'string')
  if (r.status === 200 && t) {
    // DataBaseName es un nombre, no una clave (Julio, 12/10): se apunta, y si
    // no es la base esperada no se lee nada.
    dataBase = r.json.DataBaseName ?? null
    md(`- DataBaseName: \`${dataBase ?? '—'}\` (se espera \`${BD_ESPERADA}\`) · caduca a los ${r.json.expires_in ?? '—'} s · tipo: ${r.json.token_type ?? '—'}`)
    if (String(dataBase ?? '').toUpperCase() !== BD_ESPERADA) {
      md(`**Entra, pero en otra base (${dataBase ?? 'sin nombre'}): no se lee nada.**`)
      process.stdout.write(l.join('\n') + '\n')
      process.exit(1)
    }
    token = t[1]
    comoEntra = 'formulario con nombre_bd'
  }
}
md('')
if (!token) {
  md('**No se ha podido entrar.** Nada más que contar.')
  process.stdout.write(l.join('\n') + '\n')
  process.exit(1)
}
const yo = await get('/token')
md(`- \`GET /token\` → ${yo.status}; trae: ${claves(yo.json)}`)
const par = await get('/api/parametros')
md(`- \`GET /api/parametros\` → ${par.status}; TipoContabilidad ${par.json?.TipoContabilidad ?? '—'} · DigitosPlanContable ${par.json?.DigitosPlanContable ?? '—'}`, '')

// ── 2. Paginación ────────────────────────────────────────────────────────────
// La colección de Cegid trae OData ($filter, $top, $skip, $orderby, $select).
// Se mide si de verdad se aplica antes de fiarse; si no, se prueba a ciegas.
md('### Paginación', '')
const items = (j) => (Array.isArray(j) ? j : paginada(j) ? j.Datos : null)
const forma = (j) => (paginada(j) ? `total ${j.ResultadosTotales} · página ${j.PaginaActual} · por página ${j.ElementosPorPagina} · en página ${j.ElementosEnPagina ?? j.Datos.length}`
  : Array.isArray(j) ? `lista de ${j.length}` : `ni lista ni paginada (${claves(j)})`)
const huella = (x) => JSON.stringify(x ?? null)
const base = await get('/api/subcuentas')
md(`- Sin parámetros, \`/api/subcuentas\` → ${base.status}; ${forma(base.json)}`)
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
const t3 = await get(`/api/subcuentas?${q({ $top: 3 })}`)
const t3s = await get(`/api/subcuentas?${q({ $top: 3, $skip: 3 })}`)
const t3o = await get(`/api/subcuentas?${q({ $top: 3, $orderby: 'Codigo desc' })}`)
const t3sel = await get(`/api/subcuentas?${q({ $top: 3, $select: 'Codigo' })}`)
const n3 = items(t3.json)?.length
const saltaBien = items(t3s.json)?.length > 0 && huella(items(t3s.json)?.[0]) !== huella(items(t3.json)?.[0])
const ordenaBien = items(t3o.json)?.length > 0 && huella(items(t3o.json)?.[0]) !== huella(items(t3.json)?.[0])
md(`- \`$top=3\` → ${t3.status}; ${forma(t3.json)}${n3 === 3 ? ' ← **se aplica**' : ''}`,
  `- \`$top=3&$skip=3\` → ${t3s.status}; ${forma(t3s.json)}; primer elemento distinto del de \`$top=3\`: ${saltaBien ? '**sí**' : 'no'}`,
  `- \`$orderby=Codigo desc\` → ${t3o.status}; primer elemento distinto: ${ordenaBien ? '**sí**' : 'no'}`,
  `- \`$select=Codigo\` → ${t3sel.status}; campos del primer elemento: ${claves(items(t3sel.json)?.[0])}`)
const odata = n3 === 3 && saltaBien
let TOP = null
if (odata) {
  for (const n of [500, 1000, 5000]) {
    const r = await get(`/api/subcuentas?${q({ $top: n })}`)
    const k = items(r.json)?.length
    md(`- \`$top=${n}\` → ${r.status}; devuelve ${k ?? '—'}`)
    if (r.status === 200 && k != null) TOP = n
  }
  TOP = Math.min(TOP || 500, 1000)
}
let paramPagina = null, paramTam = null, tamMax = null
if (!odata) {
  for (const p of ['pagina', 'page', 'numeroPagina', 'paginaActual', 'numPagina', 'pageNumber']) {
    const r = await get(`/api/subcuentas?${p}=2`)
    const cambia = paginada(r.json) && r.json.PaginaActual === 2
    md(`- \`?${p}=2\` → ${r.status}; ${forma(r.json)}${cambia ? ' ← **sirve**' : ''}`)
    if (cambia && !paramPagina) paramPagina = p
  }
  for (const p of ['elementosPorPagina', 'pageSize', 'tamanoPagina', 'registrosPorPagina', 'porPagina', 'limit']) {
    const r = await get(`/api/subcuentas?${p}=500`)
    const cambia = paginada(r.json) && paginada(base.json) && r.json.ElementosPorPagina !== base.json.ElementosPorPagina
    md(`- \`?${p}=500\` → ${r.status}; ${forma(r.json)}${cambia ? ' ← **sirve**' : ''}`)
    if (cambia && !paramTam) paramTam = p
  }
  if (paramTam) {
    for (const n of [1000, 5000]) {
      const r = await get(`/api/subcuentas?${paramTam}=${n}`)
      md(`- \`?${paramTam}=${n}\` → ${r.status}; ${forma(r.json)}`)
      if (paginada(r.json)) tamMax = r.json.ElementosPorPagina
    }
  }
}
md('', odata ? `Paginación: **OData**, \`$top=${TOP}\` y \`$skip\`.` : `Paginación: OData **no** se aplica · página: **${paramPagina ?? 'no encontrada'}** · tamaño: **${paramTam ?? 'no encontrado'}**`, '')

const TAM = paramTam ? Math.min(tamMax || 500, 1000) : null
async function todas(ruta) {
  const sep = ruta.includes('?') ? '&' : '?'
  const filas = []
  let pag = 1, total = null, estado = null, paginas = 0
  for (;;) {
    const qq = odata ? q({ $top: TOP, $skip: (pag - 1) * TOP }) : [paramPagina && `${paramPagina}=${pag}`, TAM && `${paramTam}=${TAM}`].filter(Boolean).join('&')
    const r = await get(ruta + (qq ? sep + qq : ''))
    estado = r.status
    const d = items(r.json)
    if (r.status !== 200 || !d) return { filas, total, estado, paginas, error: r.status !== 200 ? sinDatos(r.json) : `forma inesperada (${claves(r.json)})` }
    paginas++
    if (paginada(r.json)) total = r.json.ResultadosTotales
    filas.push(...d)
    if (d.length === 0 || paginas > 2000) break
    if (odata ? d.length < TOP : (!paramPagina || (total != null && filas.length >= total))) break
    pag++
  }
  return { filas, total: total ?? filas.length, estado, paginas }
}

// ── 3. Catálogos ─────────────────────────────────────────────────────────────
md('### Catálogos (cuántos)', '')
const catalogos = [
  ['/api/series', 'Series'], ['/api/subcuentas', 'Subcuentas'], ['/api/clientes', 'Clientes'], ['/api/proveedores', 'Proveedores'],
  ['/api/vencimientos', 'Vencimientos'], ['/api/actividades', 'Actividades'], ['/api/analitica/operationGroups', 'Analítica: grupos'],
  ['/api/analitica/operationSubGroups', 'Analítica: subgrupos'], ['/api/analitica/nivel3s', 'Analítica: nivel 3'],
  ['/api/analitica/distributionTables', 'Analítica: tablas de reparto'], ['/api/grupogastos', 'Grupos de gastos'], ['/api/grupoingresos', 'Grupos de ingresos'],
]
const cat = {}
const filasCat = []
for (const [ruta, nombre] of catalogos) {
  const r = await todas(ruta)
  cat[ruta] = r
  filasCat.push([nombre, `\`${ruta}\``, r.estado, r.total ?? '—', r.filas.length, r.paginas, r.error ?? ''])
}
tabla(['Qué', 'Ruta', 'HTTP', 'Total que dice', 'Leídos', 'Páginas', 'Error'], filasCat)

const series = cat['/api/series'].filas
md(`Series: ${series.length} — códigos: ${series.map((s) => `\`${s.Codigo}\``).join(', ') || '—'}`, '')
const sc = cat['/api/subcuentas'].filas
if (sc.length) {
  const largo = {}, grupo = {}, tipo = {}
  for (const s of sc) { cuenta(largo, String(s.Codigo ?? '').length); cuenta(grupo, String(s.Codigo ?? '?')[0]); cuenta(tipo, s.TipoSubcuenta ?? '—') }
  md(`Subcuentas: ${sc.length} · longitud del código: ${JSON.stringify(largo)} · por grupo (primer dígito): ${JSON.stringify(grupo)} · por TipoSubcuenta: ${JSON.stringify(tipo)} · con NIF: ${sc.filter((s) => lleno(s.NIF)).length}`, '')
}

// ── ¿Es Foodint? Contraste con lo que ya se sabe (C02c) ─────────────────────
md('### ¿Es la contabilidad de Foodint?', '')
const ejercicios = [], porAno = []
for (let y = 2019; y <= 2027; y++) {
  const r = await get(`/api/apuntes?$filter=${encodeURIComponent(`Ejercicio eq '${y}'`)}&${q({ $top: 1 })}`)
  const n = paginada(r.json) ? r.json.ResultadosTotales : items(r.json)?.length
  if (r.status === 200 && n > 0) ejercicios.push(String(y))
  porAno.push(n)
  md(`- Ejercicio ${y}: ${r.status}; ${n == null ? sinDatos(r.json) : `${n} asientos`}`)
}
// Si todos los años dan lo mismo, el $filter no se está aplicando y la lista
// de ejercicios no vale.
if (ejercicios.length > 1 && new Set(porAno.filter((n) => n > 0)).size === 1) {
  md('', '**Todos los años dan el mismo número: el `$filter` por ejercicio no se aplica.** La lista de ejercicios de abajo no vale.')
}
const nSub = cat['/api/subcuentas'].filas.length
const sub8 = cat['/api/subcuentas'].filas.filter((x) => String(x.Codigo ?? '').length === 8).length
md('', `| Qué | En Diez (ahora) | Conocido (C02c, 06/10) |`, '|---|---|---|',
  `| Subcuentas | ${nSub} (de 8 cifras: ${sub8}) | ${REFERENCIA.cuentas} del plan + ${REFERENCIA.terceros} terceros |`,
  `| Clientes + proveedores | ${cat['/api/clientes'].filas.length} + ${cat['/api/proveedores'].filas.length} | ${REFERENCIA.terceros} |`,
  `| Ejercicios con asientos | ${ejercicios.join(', ') || '—'} | ${REFERENCIA.ejercicios.join(', ')} (el encargo) |`, '',
  `DataBaseName: \`${dataBase ?? '—'}\`. Si las cifras no se parecen, **no es la empresa**: no se sigue con lo que se lea.`, '')

// ── 4. Resumen de apuntes que da Diez ────────────────────────────────────────
md('### Lo que dice Diez de sí mismo (`/api/apuntes/resumen`)', '')
const res = await get(`/api/apuntes/resumen?fechaInicio=${DESDE}01&fechaFinal=${meses().at(-1).fin}`)
if (res.status === 200 && Array.isArray(res.json)) {
  const porEj = {}
  for (const x of res.json) {
    const k = `${x.Ejercicio} · ${x.DescripcionTipoIntroduccion ?? x.TipoIntroduccion}${x.Automatico ? ' (automático)' : ''}`
    cuenta(porEj, k, Number(x.Numero || 0))
  }
  md(`${res.json.length} filas (por periodo y tipo). Sumado por ejercicio y tipo:`, '')
  tabla(['Ejercicio · tipo', 'Número'], Object.entries(porEj).sort().map(([k, n]) => [k, n]))
} else md(`→ ${res.status}; ${sinDatos(res.json)}`, '')

// ── 5. Asientos, mes a mes ──────────────────────────────────────────────────
md('### Asientos, mes a mes', '')
// Cómo pedir un mes: $filter por Fecha (OData) o /all con fechas (el Swagger
// dice «string» y no dice el formato). Se elige lo que devuelve asientos y
// todos dentro del mes.
const m0 = meses().find((x) => x.y === 2025 && x.m === 1) ?? meses()[0]
const dentro = (d, mm) => d.length > 0 && d.every((x) => String(x.Fecha ?? '').slice(0, 6) === mm.ini.slice(0, 6))
let formatoFecha = null
const filtro = (mm) => `$filter=${encodeURIComponent(`Fecha ge ${mm.ini} and Fecha le ${mm.fin}`)}`
const conFiltro = await get(`/api/apuntes?${filtro(m0)}&${q({ $top: 50 })}`)
const porFiltro = conFiltro.status === 200 && dentro(items(conFiltro.json) ?? [], m0)
md(`- \`/api/apuntes?$filter=Fecha ge ${m0.ini} and Fecha le ${m0.fin}\` → ${conFiltro.status}; ${forma(conFiltro.json)}; todos dentro del mes: ${porFiltro ? '**sí**' : 'no'}`)
const conEj = await get(`/api/apuntes?$filter=${encodeURIComponent("Ejercicio eq '2025'")}&${q({ $top: 50 })}`)
md(`- \`$filter=Ejercicio eq '2025'\` → ${conEj.status}; ${forma(conEj.json)}; todos de 2025: ${(items(conEj.json) ?? []).length && (items(conEj.json) ?? []).every((x) => String(x.Ejercicio) === '2025') ? 'sí' : 'no'}`)
for (const f of ['compacta', 'iso', 'es']) {
  const r = await get(`/api/apuntes/all?fechaDesde=${encodeURIComponent(fechaComo(f, m0.ini))}&fechaHasta=${encodeURIComponent(fechaComo(f, m0.fin))}`)
  const ok = r.status === 200 && dentro(items(r.json) ?? [], m0)
  md(`- \`/api/apuntes/all\`, fechas ${f} (${fechaComo(f, m0.fin)}) → ${r.status}; ${forma(r.json)}; todos dentro del mes: ${ok ? 'sí' : 'no'}`)
  if (!formatoFecha && ok) formatoFecha = f
}
const sinFechas = await get('/api/apuntes')
md(`- \`/api/apuntes\` sin nada → ${sinFechas.status}; ${forma(sinFechas.json)}`, '')
const pedirMes = porFiltro || formatoFecha
const rutaMes = (recurso, mm) => (porFiltro ? `/api/${recurso}?${filtro(mm)}`
  : `/api/${recurso}/all?fechaDesde=${encodeURIComponent(fechaComo(formatoFecha, mm.ini))}&fechaHasta=${encodeURIComponent(fechaComo(formatoFecha, mm.fin))}`)
md(`Cada mes se pide con: **${porFiltro ? '$filter por Fecha' : formatoFecha ? `/all con fechas ${formatoFecha}` : 'nada que funcione'}**.`, '')

const ej = {}
const detalle = { lineas: 0, conAnalitica: 0, lineasConTercero: 0, lineasConJustificante: 0, lineasConContrapartida: 0, maxDescAsiento: 0, maxDescLinea: 0, descuadrados: 0, fueraDeMes: 0, sinDetalles: 0, repetidos: 0, tipoAsiento: {}, formatoFecha: {}, camposAnalitica: {} }
const vistos = new Set()
const porMes = []
const muestraAsientos = {}
if (pedirMes) {
  for (const mm of meses()) {
    const r = await todas(rutaMes('apuntes', mm))
    porMes.push([`${mm.y}-${String(mm.m).padStart(2, '0')}`, r.estado, r.total ?? '—', r.filas.length, r.paginas, r.error ?? ''])
    for (const a of r.filas) {
      const k = `${a.Ejercicio}|${a.Serie}|${a.Documento}`
      if (vistos.has(k)) { detalle.repetidos++; continue }
      vistos.add(k)
      const e = (ej[a.Ejercicio] ??= { asientos: 0, lineas: 0, series: {}, conAnalitica: 0 })
      e.asientos++; cuenta(e.series, a.Serie)
      cuenta(detalle.tipoAsiento, a.TipoAsiento ?? '—')
      cuenta(detalle.formatoFecha, `${String(a.Fecha ?? '').length} cifras`)
      if (String(a.Fecha ?? '').slice(0, 6) !== `${mm.y}${String(mm.m).padStart(2, '0')}`) detalle.fueraDeMes++
      detalle.maxDescAsiento = Math.max(detalle.maxDescAsiento, String(a.Descripcion ?? '').length)
      const d = a.Detalles ?? []
      if (!d.length) detalle.sinDetalles++
      e.lineas += d.length; detalle.lineas += d.length
      let debe = 0, haber = 0
      for (const x of d) {
        debe += cent(x.Debe); haber += cent(x.Haber)
        if (lleno(x.Tercero)) detalle.lineasConTercero++
        if (lleno(x.Justificante)) detalle.lineasConJustificante++
        if (lleno(x.Contrapartida)) detalle.lineasConContrapartida++
        detalle.maxDescLinea = Math.max(detalle.maxDescLinea, String(x.Descripcion ?? '').length)
      }
      if (d.length && debe !== haber) detalle.descuadrados++
      const an = a.DetallesAnalitica ?? []
      if (an.length) {
        detalle.conAnalitica++; e.conAnalitica++
        for (const x of an) for (const c of ['Grupo', 'Subgrupo', 'Nivel3', 'TablaReparto', 'CuentaCliente']) if (lleno(x[c])) cuenta(detalle.camposAnalitica, c)
      }
      const ms = (muestraAsientos[a.Ejercicio] ??= [])
      if (ms.length < MUESTRA && (e.asientos % 37 === 1)) ms.push(a)
    }
  }
  tabla(['Mes', 'HTTP', 'Total que dice', 'Leídos', 'Páginas', 'Error'], porMes)
  md('Por ejercicio:', '')
  tabla(['Ejercicio', 'Asientos', 'Líneas', 'Por serie', 'Con analítica en el listado'], Object.entries(ej).sort().map(([k, e]) => [k, e.asientos, e.lineas, Object.entries(e.series).map(([s, n]) => `${s}: ${n}`).join(' · '), e.conAnalitica]))
  md(`- TipoAsiento: ${JSON.stringify(detalle.tipoAsiento)} · Fecha: ${JSON.stringify(detalle.formatoFecha)}`,
    `- Asientos sin líneas en el listado: ${detalle.sinDetalles} · descuadrados (debe ≠ haber al céntimo): ${detalle.descuadrados} · con fecha fuera del mes pedido: ${detalle.fueraDeMes} · repetidos entre meses: ${detalle.repetidos}`,
    `- Líneas con Tercero: ${detalle.lineasConTercero} · con Justificante: ${detalle.lineasConJustificante} · con Contrapartida: ${detalle.lineasConContrapartida} (de ${detalle.lineas})`,
    `- Largo máximo de la descripción: asiento ${detalle.maxDescAsiento} · línea ${detalle.maxDescLinea}`,
    `- Analítica en el listado: ${detalle.conAnalitica} asientos; campos rellenos: ${JSON.stringify(detalle.camposAnalitica)}`, '')
} else md('**No se ha encontrado cómo pedir un mes de asientos.** Sin recuento mes a mes.', '')

// Analítica por asiento, en una muestra (el listado puede no traerla).
md('### Analítica por asiento (muestra)', '')
const filasAn = []
for (const [e, lista] of Object.entries(muestraAsientos).sort()) {
  let con = 0, ok = 0, estados = {}
  const campos = {}
  for (const a of lista) {
    const r = await get(`/api/analitica/asiento/${encodeURIComponent(a.Ejercicio)}/${encodeURIComponent(a.Serie)}/${a.Documento}`)
    cuenta(estados, r.status)
    if (r.status === 200) ok++
    const arr = Array.isArray(r.json) ? r.json : r.json ? [r.json] : []
    if (arr.some((x) => ['Grupo', 'Subgrupo', 'Nivel3', 'TablaReparto'].some((c) => lleno(x?.[c])))) con++
    for (const x of arr) for (const c of ['Grupo', 'Subgrupo', 'Nivel3', 'TablaReparto']) if (lleno(x?.[c])) cuenta(campos, c)
  }
  filasAn.push([e, lista.length, JSON.stringify(estados), con, JSON.stringify(campos)])
}
if (filasAn.length) tabla(['Ejercicio', 'Muestra', 'HTTP', 'Con analítica', 'Campos'], filasAn)
else md('Sin muestra (no hubo asientos).', '')

// ── 6. Facturas y adjuntos ──────────────────────────────────────────────────
md('### Facturas, mes a mes, y adjuntos (muestra)', '')
const fe = {}
const ff = { tipoFactura: {}, tipoAsiento: {}, simplificadas: 0, conVencimientos: 0, conAnalitica: 0, conApuntes: 0 }
const muestraFact = {}
if (pedirMes) {
  const filas = []
  for (const mm of meses()) {
    const r = await todas(rutaMes('facturas', mm))
    filas.push([`${mm.y}-${String(mm.m).padStart(2, '0')}`, r.estado, r.total ?? '—', r.filas.length, r.error ?? ''])
    for (const f of r.filas) {
      const e = (fe[f.Ejercicio] ??= { facturas: 0, series: {} })
      e.facturas++; cuenta(e.series, f.Serie)
      cuenta(ff.tipoFactura, f.TipoFactura ?? '—'); cuenta(ff.tipoAsiento, f.TipoAsiento ?? '—')
      if (f.EsFacturaSimplificada) ff.simplificadas++
      if ((f.Vencimientos ?? []).length) ff.conVencimientos++
      if ((f.Analitica ?? []).length) ff.conAnalitica++
      if ((f.Apuntes ?? []).length || (f.Detalles ?? []).length) ff.conApuntes++
      const ms = (muestraFact[f.Ejercicio] ??= [])
      if (ms.length < MUESTRA && e.facturas % 23 === 1) ms.push(f)
    }
  }
  tabla(['Mes', 'HTTP', 'Total que dice', 'Leídas', 'Error'], filas)
  tabla(['Ejercicio', 'Facturas', 'Por serie'], Object.entries(fe).sort().map(([k, e]) => [k, e.facturas, Object.entries(e.series).map(([s, n]) => `${s}: ${n}`).join(' · ')]))
  md(`- TipoFactura: ${JSON.stringify(ff.tipoFactura)} · TipoAsiento: ${JSON.stringify(ff.tipoAsiento)}`,
    `- Simplificadas: ${ff.simplificadas} · con vencimientos: ${ff.conVencimientos} · con analítica: ${ff.conAnalitica} · con apuntes/detalle: ${ff.conApuntes}`, '')
}
const filasAdj = []
for (const [e, lista] of Object.entries(muestraFact).sort()) {
  let con = 0, bytes = 0
  const estados = {}, tipos = {}
  for (const f of lista) {
    const r = await llamar('GET', `/api/facturas/getfile/${encodeURIComponent(f.Ejercicio)}/${encodeURIComponent(f.Serie)}/${f.Documento}`, { crudo: true })
    cuenta(estados, r.status)
    if (r.status === 200 && r.bytes > 200) { con++; bytes += r.bytes; cuenta(tipos, (r.tipo || '—').split(';')[0]) }
  }
  filasAdj.push([e, lista.length, JSON.stringify(estados), con, con ? `${Math.round(bytes / con / 1024)} KB` : '—', JSON.stringify(tipos)])
}
if (filasAdj.length) tabla(['Ejercicio', 'Muestra', 'HTTP', 'Con fichero', 'Tamaño medio', 'Tipo'], filasAdj)

// ── 7. Sumas y saldos ───────────────────────────────────────────────────────
md('### Sumas y saldos (`/api/subcuentas/getSumasYsaldos/{periodo}/{fechaIni}/{fechaFinal}`)', '', 'El Swagger no dice qué es `periodo`. Se prueba con 2025 entero:', '')
const filasSys = []
for (const periodo of [0, 1, 2, 3, 12, 13, 2025]) {
  const r = await get(`/api/subcuentas/getSumasYsaldos/${periodo}/20250101/20251231`)
  let extra = ''
  if (paginada(r.json)) {
    const d = r.json.Datos
    const debe = d.reduce((s, x) => s + cent(x.Debe), 0), haber = d.reduce((s, x) => s + cent(x.Haber), 0)
    const conDoc = d.filter((x) => lleno(x.Documento) && Number(x.Documento) !== 0).length
    extra = `${new Set(d.map((x) => x.Subcuenta)).size} subcuentas distintas en la página · filas con Documento: ${conDoc} · debe = haber en la página: ${debe === haber ? 'sí' : 'no'}`
  }
  filasSys.push([periodo, r.status, forma(r.json), extra || sinDatos(r.json)])
}
tabla(['periodo', 'HTTP', 'Forma', 'Qué trae'], filasSys)

// ── 8. Límites y volumen ────────────────────────────────────────────────────
md('### Límites y volumen de esta lectura', '',
  `- Peticiones: ${metrica.peticiones} · ${Math.round(metrica.bytes / 1024)} KB · ${Math.round(metrica.ms / 1000)} s de espera de red`,
  `- Respuestas 429 (demasiadas peticiones): ${metrica.esperas429}`,
  `- Cabeceras de límite vistas: ${[...metrica.limites].join(' · ') || 'ninguna'}`, '')
tabla(['Ruta', 'Peticiones', 'KB', 'ms medio', 'ms máximo'], Object.entries(metrica.porRuta).sort((a, b) => b[1].bytes - a[1].bytes)
  .map(([k, v]) => [`\`${k}\``, v.n, Math.round(v.bytes / 1024), Math.round(v.ms / v.n), v.maxMs]))
md(`Entró con: ${comoEntra}.`)
process.stdout.write(l.join('\n') + '\n')
