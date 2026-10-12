// scripts/conta/diez/falso.mjs
//
// C04b · T3 · Un Diez de mentira, para las unitarias, el e2e y la CI.
//
// Imita lo que se MIDIÓ en el Diez de verdad (runs 7 a 10), no lo que dice el
// Swagger:
//   · POST /token en formulario con nombre_bd; devuelve DataBaseName,
//     expires_in 1209599 y, para la C0001, «No tiene acceso a la empresa
//     indicada» (400);
//   · OData: $filter por Fecha (ge/le) y por Ejercicio (eq), $top con techo de
//     200, $skip que cuenta PÁGINAS, y pasado el final, la primera página otra
//     vez sin avisar;
//   · respuesta paginada con Datos, ResultadosTotales, PaginaActual,
//     ElementosPorPagina y ElementosEnPagina;
//   · apuntes/add y facturas/add guardan y devuelven lo guardado con su
//     Documento (el pedido, o el siguiente libre si no se pide).
// Y deja meter fallos a propósito: 429, una base distinta al entrar, un total
// que no casa con lo que hay.
//
// Todos los datos que lleve los pone quien lo arranca, y son inventados.
//
//   const d = await arrancarDiezFalso({ bases: { C0009: { apuntes: [...] } } })
//   d.url · d.estado · await d.cerrar()

import { createServer } from 'node:http'

const TECHO = 200

export async function arrancarDiezFalso(opciones = {}) {
  const cred = opciones.credenciales ?? { client_id: 'cli', client_secret: 'sec', username: 'usu', password: 'pas' }
  const bases = {}
  for (const [bd, b] of Object.entries(opciones.bases ?? {})) {
    bases[bd] = { apuntes: [...(b.apuntes ?? [])], facturas: [...(b.facturas ?? [])], subcuentas: [...(b.subcuentas ?? [])], series: [...(b.series ?? [])], grupos: [...(b.grupos ?? [])], subgrupos: [...(b.subgrupos ?? [])], nivel3: [...(b.nivel3 ?? [])] }
  }
  // Lo que se puede tocar desde la prueba.
  const estado = {
    bases,
    peticiones: [], // { metodo, ruta, bd }
    fallos: { entrar: null, abreOtraBase: null, veces429: 0, totalMiente: 0 },
    tokens: new Map(), // token → bd
  }
  let n = 0

  const responder = (res, status, json) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(json === undefined ? '' : JSON.stringify(json))
  }
  const leerCuerpo = (req) => new Promise((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => ok(t)) })

  const filtrar = (filas, filtro) => {
    if (!filtro) return filas
    let r = filas
    const ge = /Fecha ge (\d{8})/.exec(filtro), le = /Fecha le (\d{8})/.exec(filtro), ej = /Ejercicio eq '(\d{4})'/.exec(filtro)
    if (ge) r = r.filter((x) => Number(x.Fecha) >= Number(ge[1]))
    if (le) r = r.filter((x) => Number(x.Fecha) <= Number(le[1]))
    if (ej) r = r.filter((x) => String(x.Ejercicio) === ej[1])
    return r
  }
  const paginar = (filas, url) => {
    const top = Math.min(Number(url.searchParams.get('$top')) || TECHO, TECHO)
    const skip = Number(url.searchParams.get('$skip')) || 0 // en PÁGINAS
    let pagina = skip
    if (pagina * top >= filas.length) pagina = 0 // pasado el final: la primera, sin avisar
    const datos = filas.slice(pagina * top, pagina * top + top)
    const total = filas.length + (estado.fallos.totalMiente || 0)
    return { Datos: datos, ResultadosTotales: total, PaginaActual: pagina + 1, ElementosPorPagina: top, ElementosEnPagina: datos.length }
  }

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const ruta = url.pathname
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
    const bd = estado.tokens.get(auth) ?? null
    estado.peticiones.push({ metodo: req.method, ruta, bd })

    if (req.method === 'POST' && ruta === '/token') {
      const f = new URLSearchParams(await leerCuerpo(req))
      if (estado.fallos.entrar) return responder(res, 400, { error: 'invalid_grant', error_description: estado.fallos.entrar })
      for (const k of ['client_id', 'client_secret', 'username', 'password']) if (f.get(k) !== cred[k]) return responder(res, 400, { error: 'invalid_grant', error_description: 'Usuario o contraseña incorrectos' })
      const nb = f.get('nombre_bd')
      if (!nb) return responder(res, 400, { error: 'invalid_grant', error_description: 'Debe indicar un nombre o identificador de base de datos' })
      if (!estado.bases[nb]) return responder(res, 400, { error: 'invalid_grant', error_description: 'No tiene acceso a la empresa indicada' })
      const tok = `tok-${++n}`
      estado.tokens.set(tok, nb)
      return responder(res, 200, { access_token: tok, token_type: 'bearer', expires_in: 1209599, DataBaseName: estado.fallos.abreOtraBase ?? nb })
    }
    if (!bd) return responder(res, 401, { Message: 'Authorization has been denied for this request.' })
    if (estado.fallos.veces429 > 0) { estado.fallos.veces429--; res.setHeader('retry-after', '0'); return responder(res, 429, { Message: 'Too many requests' }) }
    const b = estado.bases[bd]

    if (req.method === 'GET') {
      const listados = { '/api/apuntes': 'apuntes', '/api/facturas': 'facturas', '/api/subcuentas': 'subcuentas', '/api/series': 'series', '/api/analitica/operationGroups': 'grupos', '/api/analitica/operationSubGroups': 'subgrupos', '/api/analitica/nivel3s': 'nivel3' }
      if (listados[ruta]) return responder(res, 200, paginar(filtrar(b[listados[ruta]], url.searchParams.get('$filter')), url))
      const m = /^\/api\/(apuntes\/asiento|facturas\/factura)\/([^/]+)\/([^/]+)\/(\d+)$/.exec(ruta)
      if (m) {
        const [, , ej, se, doc] = m.map(decodeURIComponent)
        const x = [...b.facturas, ...b.apuntes].find((a) => String(a.Ejercicio) === ej && String(a.Serie) === se && Number(a.Documento) === Number(doc))
        return x ? responder(res, 200, x) : responder(res, 404, { Message: 'No se ha encontrado el asiento' })
      }
      return responder(res, 404, { Message: 'No HTTP resource was found' })
    }
    if (req.method === 'POST' && (ruta === '/api/apuntes/add' || ruta === '/api/facturas/add')) {
      let c
      try { c = JSON.parse(await leerCuerpo(req)) } catch { return responder(res, 400, { Message: 'Cuerpo no válido' }) }
      const lista = ruta === '/api/apuntes/add' ? b.apuntes : b.facturas
      const todos = [...b.apuntes, ...b.facturas].filter((a) => String(a.Ejercicio) === String(c.Ejercicio) && String(a.Serie) === String(c.Serie))
      if (c.Documento && todos.some((a) => Number(a.Documento) === Number(c.Documento))) return responder(res, 400, { Message: 'Ya existe un asiento con ese número' })
      const doc = c.Documento || Math.max(0, ...todos.map((a) => Number(a.Documento) || 0)) + 1
      if (ruta === '/api/apuntes/add') {
        const d = Math.round((c.Detalles ?? []).reduce((s, l) => s + (l.Debe || 0), 0) * 100)
        const h = Math.round((c.Detalles ?? []).reduce((s, l) => s + (l.Haber || 0), 0) * 100)
        if (d !== h) return responder(res, 400, { Message: 'El asiento está descuadrado' })
        const guardado = { ...c, Documento: doc, TipoAsiento: 0, Debe: d / 100, Haber: h / 100, Detalles: (c.Detalles ?? []).map((l, i) => ({ ...l, Ejercicio: c.Ejercicio, Serie: c.Serie, Documento: doc, Linea: l.Linea ?? i + 1, Fecha: c.Fecha })) }
        lista.push(guardado)
        return responder(res, 200, guardado)
      }
      const guardada = { ...c, Documento: doc, Fecha: c.Fecha ?? c.FechaFactura }
      lista.push(guardada)
      return responder(res, 200, guardada)
    }
    return responder(res, 405, { Message: 'The requested resource does not support this method.' })
  })

  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok))
  const { port } = servidor.address()
  return {
    url: `http://127.0.0.1:${port}`,
    credenciales: cred,
    estado,
    cerrar: () => new Promise((ok) => servidor.close(() => ok())),
  }
}
