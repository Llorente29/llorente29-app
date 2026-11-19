// tests/conta/erp10/simulado.ts — X10 · Un ERP10 simulado (un fetch), con lo medido el 19/11:
//   · POST /token solo en formulario; en JSON, 400 invalid_clientId;
//   · claves que no son: 400 invalid_grant;
//   · sin cod_empresa el token sale, y cada lectura da 500 «Error al comprobar … empresa …»;
//   · GET /api/parametros: la Empresa abierta, con su CIF;
//   · GET /api/apuntes paginado ($top, $skip por página) con ResultadosTotales.
// Todo inventado (T11): NIF de ceros, códigos 101…, importes redondos.

/** X10b · Los nombres de tipo que da ERP10 en su resumen (los del 19/11). */
export const NOMBRES_DE_TIPO: Record<number, string> = { 1: 'Por factura', 2: 'DiezBank', 3: 'Traspasos de nóminas' }

export type EmpresaSimulada = { cif: string; apuntes: { Serie: string; Documento: number; TipoAsiento: number; Fecha: number; Detalles: { Cuenta: string; Debe: number; Haber: number }[] }[] }

export function erp10Simulado(o: { empresas: Record<string, EmpresaSimulada>; claves?: { client_id: string; password: string } }) {
  const claves = o.claves ?? { client_id: 'cliente-inventado', password: 'codigo-inventado' }
  const tokens = new Map<string, string | null>() // token → cod_empresa (null: sin empresa)
  const vistas: { metodo: string; ruta: string; cuerpo: string | null; tipo: string | null }[] = []
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
      return r(200, { Datos: filas.slice(pag * top, pag * top + top), ResultadosTotales: filas.length })
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
