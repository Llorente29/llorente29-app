// tests/conta/erp10/simulado.ts — X10 · Un ERP10 simulado (un fetch), con lo medido el 19/11:
//   · POST /token solo en formulario; en JSON, 400 invalid_clientId;
//   · claves que no son: 400 invalid_grant;
//   · sin cod_empresa el token sale, y cada lectura da 500 «Error al comprobar … empresa …»;
//   · GET /api/parametros: la Empresa abierta, con su CIF;
//   · GET /api/apuntes paginado ($top, $skip por página) con ResultadosTotales.
// X12 (con lo medido en QBO Integrity el 20/11, X11):
//   · GET /api/subcuentas paginado (las fichas, si las tiene; si no, solo el código);
//   · /api/clientes y /api/proveedores: 400 «endpoint de Estimaciones/Autónomos» (en una sociedad);
//   · pasarse del final devuelve la primera página otra vez, sin avisar (como Diez).
// Todo inventado (T11): NIF de ceros, códigos 101…, importes redondos.

/** X10b · Los nombres de tipo que da ERP10 en su resumen (los del 19/11). */
export const NOMBRES_DE_TIPO: Record<number, string> = { 1: 'Por factura', 2: 'DiezBank', 3: 'Traspasos de nóminas' }

export type EmpresaSimulada = {
  cif: string
  apuntes: { Serie: string; Documento: number; TipoAsiento: number; Fecha: number; Descripcion?: string; Detalles: { Cuenta: string; Debe: number; Haber: number; Descripcion?: string }[] }[]
  /** X12 · Las fichas de las subcuentas (Codigo, Descripcion, NIF…), para el listado. */
  fichas?: Record<string, unknown>[]
  /** X10b · Lo que se escribe: las subcuentas que tiene, las facturas y los PDF subidos. */
  subcuentas?: string[]
  facturas?: Record<string, unknown>[]
  pdfs?: { Ejercicio: string; Serie: string; Documento: number; NombreArchivo: string; bytes: number }[]
  /** Para probar que no se sube: el upload contesta 500 «container does not exist», como Diez. */
  sinAlmacen?: boolean
  /** X10d · El alta de un asiento cuya descripción lleve esto falla con un 500. */
  fallaAsiento?: string
}

export function erp10Simulado(o: { empresas: Record<string, EmpresaSimulada>; claves?: { client_id: string; password: string } }) {
  const claves = o.claves ?? { client_id: 'cliente-inventado', password: 'codigo-inventado' }
  const tokens = new Map<string, string | null>() // token → cod_empresa (null: sin empresa)
  const vistas: { metodo: string; ruta: string; cuerpo: string | null; tipo: string | null }[] = []
  /** Una página como ERP10: 200 como mucho; $skip cuenta páginas; pasado el final, la primera otra vez. */
  const pagina = (filas: unknown[], u: URL) => {
    const top = Math.min(200, Number(u.searchParams.get('$top') ?? 200)), pag = Number(u.searchParams.get('$skip') ?? 0)
    const d = filas.slice(pag * top, pag * top + top)
    return { Datos: d.length ? d : filas.slice(0, top), ResultadosTotales: filas.length, ElementosPorPagina: top, PaginaActual: pag + 1 }
  }
  const r = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    const metodo = init?.method ?? 'GET'
    const cab = (init?.headers ?? {}) as Record<string, string>
    vistas.push({ metodo, ruta: u.pathname + u.search, cuerpo: (init?.body as string) ?? null, tipo: cab['content-type'] ?? null })
    if (u.pathname === '/token') {
      if (cab['content-type'] !== 'application/x-www-form-urlencoded') return r(400, { error: 'invalid_clientId' })
      const p = new URLSearchParams(String(init?.body ?? ''))
      if (p.get('client_id') !== claves.client_id) return r(400, { error: 'invalid_clientId' })
      if (p.get('password') !== claves.password) return r(400, { error: 'invalid_grant', error_description: 'El usuario o la contraseña no son correctos.' })
      const t = `tok-${tokens.size + 1}`
      tokens.set(t, p.get('cod_empresa') || null)
      return r(200, { access_token: t, token_type: 'bearer', expires_in: 1209599, UserName: 'usuario-inventado' })
    }
    const tok = String(cab.authorization ?? '').replace(/^Bearer /, '')
    if (!tokens.has(tok)) return r(401, { Message: 'Authorization has been denied for this request.' })
    const cod = tokens.get(tok)
    if (!cod) return r(500, { Message: 'Error al comprobar si la empresa tiene Contabilidad Estandard/Sociedades' })
    const e = o.empresas[cod]
    if (!e) return r(500, { Message: 'Error al comprobar si la empresa tiene Contabilidad Estandard/Sociedades' })
    if (u.pathname === '/api/parametros') return r(200, { NombreFiscal: 'EMPRESA INVENTADA', CIF: e.cif, TipoContabilidad: 1, DigitosPlanContable: 8 })
    if (u.pathname === '/api/apuntes') {
      const m = /Fecha ge (\d+) and Fecha le (\d+)/.exec(u.searchParams.get('$filter') ?? '')
      const filas = e.apuntes.filter((a) => !m || (a.Fecha >= Number(m[1]) && a.Fecha <= Number(m[2])))
      const top = Number(u.searchParams.get('$top') ?? 200), pag = Number(u.searchParams.get('$skip') ?? 0)
      if (filas.length && pag * top >= filas.length) return r(200, pagina(filas, u))
      return r(200, { Datos: filas.slice(pag * top, pag * top + top), ResultadosTotales: filas.length })
    }
    // X12 · El listado de subcuentas (en una sociedad, también los terceros) y los 400 de clientes y proveedores.
    if (u.pathname === '/api/subcuentas' && metodo === 'GET') {
      const filas = e.fichas ?? (e.subcuentas ?? []).map((Codigo) => ({ Codigo, Descripcion: 'inventada' }))
      return r(200, filas.length ? pagina(filas, u) : { Datos: [], ResultadosTotales: 0 })
    }
    if (u.pathname === '/api/clientes' || u.pathname === '/api/proveedores') {
      return r(400, { Message: 'Ha intentado acceder a un endpoint de Estimaciones/Autónomos para una empresa Estándar/Sociedades' })
    }
    // X10b · Escribir.
    const cuerpo = () => JSON.parse(String(init?.body ?? 'null')) as Record<string, unknown>
    if (u.pathname.startsWith('/api/subcuentas/') && metodo === 'GET') {
      const k = decodeURIComponent(u.pathname.split('/').pop() ?? '')
      return (e.subcuentas ?? []).includes(k) ? r(200, { Codigo: k, Descripcion: 'inventada' }) : r(404, { Message: 'No existe la subcuenta' })
    }
    if (u.pathname === '/api/subcuentas/add' && metodo === 'POST') {
      const b = cuerpo()
      if (!b?.Codigo || !b?.Descripcion) return r(400, { Message: 'Faltan Codigo o Descripcion' })
      ;(e.subcuentas ??= []).push(String(b.Codigo))
      return r(200, [b])
    }
    if (u.pathname === '/api/facturas' && metodo === 'GET') {
      const m = /Fecha ge (\d+) and Fecha le (\d+)/.exec(u.searchParams.get('$filter') ?? '')
      const filas = (e.facturas ?? []).filter((f) => !m || (Number(f.Fecha) >= Number(m[1]) && Number(f.Fecha) <= Number(m[2])))
      const top = Number(u.searchParams.get('$top') ?? 200), pag = Number(u.searchParams.get('$skip') ?? 0)
      if (filas.length && pag * top >= filas.length) return r(200, pagina(filas, u))
      return r(200, { Datos: filas.slice(pag * top, pag * top + top), ResultadosTotales: filas.length })
    }
    if (u.pathname === '/api/facturas/add' && metodo === 'POST') {
      const b = cuerpo()
      for (const k of ['Ejercicio', 'Serie', 'TipoAsiento', 'CuentaCliente', 'FechaFactura']) if (b?.[k] == null) return r(400, { Message: `Falta ${k}` })
      if (String(b.Descripcion ?? '').length > 40) return r(400, { Message: 'Descripcion pasa de 40' })
      const usa = [String(b.CuentaCliente), ...((b.Apuntes ?? []) as { Cuenta: string }[]).map((a) => a.Cuenta)]
      const falta = usa.find((k) => !(e.subcuentas ?? usa).includes(k))
      if (falta) return r(400, { Message: `No existe la subcuenta ${falta}` })
      const documento = 1000 + (e.facturas?.length ?? 0) + e.apuntes.length
      const f = { ...b, Documento: documento }
      ;(e.facturas ??= []).push(f)
      // Como ERP10: el asiento de la factura, con el gasto al debe, el IVA (una sola 472) y el proveedor al haber.
      const cuotas = [1, 2, 3].reduce((t, i) => t + Number(b[`CuotaIVA${i}`] ?? 0), 0)
      e.apuntes.push({ Serie: String(b.Serie), Documento: documento, TipoAsiento: 1, Fecha: Number(b.Fecha ?? b.FechaFactura), Detalles: [
        ...((b.Apuntes ?? []) as { Cuenta: string; Importe: number }[]).map((a) => ({ Cuenta: a.Cuenta, Debe: a.Importe, Haber: 0 })),
        ...(cuotas ? [{ Cuenta: '47200000', Debe: Math.round(cuotas * 100) / 100, Haber: 0 }] : []),
        { Cuenta: String(b.CuentaCliente), Debe: 0, Haber: Number(b.TotalFactura) },
      ] })
      return r(200, f)
    }
    if (u.pathname === '/api/apuntes/add' && metodo === 'POST') {
      // X10d · Como ERP10: un asiento general (TipoAsiento 0), con su número de documento. Si se pide, falla (para probar que los demás siguen).
      const b = cuerpo() as { Ejercicio?: string; Serie?: string; Fecha?: number; Descripcion?: string; Detalles?: { Cuenta: string; Debe?: number; Haber?: number }[] }
      for (const k of ['Ejercicio', 'Serie', 'Fecha'] as const) if (b?.[k] == null) return r(400, { Message: `Falta ${k}` })
      if (e.fallaAsiento && (b.Descripcion ?? '').includes(e.fallaAsiento)) return r(500, { Message: 'Error al guardar el asiento (inventado)' })
      const falta = (b.Detalles ?? []).map((l) => l.Cuenta).find((k) => !(e.subcuentas ?? [k]).includes(k))
      if (falta) return r(400, { Message: `No existe la subcuenta ${falta}` })
      const d = (b.Detalles ?? []).reduce((t, l) => t + Math.round(Number(l.Debe ?? 0) * 100), 0), h = (b.Detalles ?? []).reduce((t, l) => t + Math.round(Number(l.Haber ?? 0) * 100), 0)
      if (d !== h) return r(400, { Message: 'El asiento no cuadra' })
      const documento = 5000 + e.apuntes.length
      const ap = { Serie: String(b.Serie), Documento: documento, TipoAsiento: 0, Fecha: Number(b.Fecha), Detalles: (b.Detalles ?? []).map((l) => ({ Cuenta: l.Cuenta, Debe: Number(l.Debe ?? 0), Haber: Number(l.Haber ?? 0) })) }
      e.apuntes.push(ap)
      return r(200, { ...ap, Ejercicio: b.Ejercicio, Descripcion: b.Descripcion })
    }
    if (u.pathname === '/api/facturas/upload' && metodo === 'POST') {
      if (e.sinAlmacen) return r(500, { Message: 'The specified container does not exist.' })
      const b = cuerpo()
      ;(e.pdfs ??= []).push({ Ejercicio: String(b.Ejercicio), Serie: String(b.Serie), Documento: Number(b.Documento), NombreArchivo: String(b.NombreArchivo), bytes: String(b.Archivo ?? '').length })
      return r(200, b)
    }
    if (u.pathname === '/api/apuntes/resumen') {
      // X10b · Por tipo: el nombre que da ERP10 (DescripcionTipoIntroduccion) y «Numero», que cuenta LÍNEAS.
      // Sin fechas, el resumen entero, por año, mes y tipo (como el de Llorente29 del 19/11).
      const a = Number(u.searchParams.get('fechaInicio') ?? 0), b = Number(u.searchParams.get('fechaFinal') ?? 99999999)
      const por = new Map<string, { Ejercicio: number; Mes: number; t: number; n: number }>()
      for (const x of e.apuntes) {
        if (x.Fecha < a || x.Fecha > b) continue
        const k = `${Math.floor(x.Fecha / 100)}:${x.TipoAsiento}`
        const y = por.get(k) ?? { Ejercicio: Math.floor(x.Fecha / 10000), Mes: Math.floor(x.Fecha / 100) % 100, t: x.TipoAsiento, n: 0 }
        y.n += x.Detalles.length
        por.set(k, y)
      }
      return r(200, [...por.values()].map((y) => ({ Ejercicio: y.Ejercicio, Mes: y.Mes, TipoIntroduccion: y.t, DescripcionTipoIntroduccion: NOMBRES_DE_TIPO[y.t] ?? `Tipo ${y.t}`, Numero: y.n })))
    }
    return r(404, { Message: 'No encontrado' })
  }) as typeof fetch
  return { fetch: f, vistas }
}
