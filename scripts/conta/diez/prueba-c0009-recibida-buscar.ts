// scripts/conta/diez/prueba-c0009-recibida-buscar.ts
//
// D01 · LA BÚSQUEDA ANTES DE ESCRIBIR, CONTRA LAS RECIBIDAS DE VERDAD (C0009).
//
// Antes de mandar una recibida, conta-diez-enviar la busca en Diez por si Julio
// ya la metió a mano: desde el mes de la factura hasta hoy (el listado filtra
// por la fecha del ASIENTO), con el número normalizado y el proveedor por su
// cuenta o por su NIF; si sale más de una, no toca nada. Aquí se hace esa misma
// búsqueda (esLaMismaRecibida y mesesEntre, el código de la función) para cada
// recibida que YA está en C0009, como si fuera a mandarse otra vez, y se cuenta:
//   · cuántas se encuentran a sí mismas y solo a sí mismas (se enlazarían);
//   · cuántas darían «más de una» (se pararían sin escribir);
//   · cuántas no se encontrarían (se duplicarían: tiene que ser 0 en la ventana);
//   · lo mismo con la búsqueda de antes (mes de la factura, número y cuenta exactos);
//   · y las tres variantes de las pruebas, sobre la población real: el número
//     escrito de otra forma, y otra cuenta con el mismo NIF.
//
// Frenos: C0009 y escribir: false (el cliente no puede escribir); la salida es
// solo «@@ clave número» y el workflow la pasa por salida-segura.mjs.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida-buscar.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { esLaMismaRecibida, mesesEntre, MESES_BUSQUEDA_RECIBIDA } from '../../../supabase/functions/_shared/diezEnviar.ts'

const BD = 'C0009'
const di = (k: string, v: number | boolean) => console.log(`@@ ${k} ${typeof v === 'boolean' ? Number(v) : Math.trunc(v)}`)
const seccion = (k: string) => console.log(`@@ # ${k}`)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date()).replace('-', '')
const clave = (f: Factura) => `${f.Ejercicio ?? ''}|${f.Serie}|${f.Documento}`
/** Sin repetir filas: el listado trae una por ejercicio, serie y documento. */
const unicas = (fs: Factura[]) => [...new Map(fs.map((f) => [clave(f), f])).values()]

try {
  await c.asegurarToken()
  // Los meses de la ventana más uno (para ver también las que se quedan fuera).
  const meses = mesesEntre(mesesEntre('200001', hoy).slice(-(MESES_BUSQUEDA_RECIBIDA + 1))[0], hoy)
  const porMes = new Map<string, Factura[]>()
  for (const m of meses) porMes.set(m, (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2'))
  const todas = unicas([...porMes.values()].flat())

  seccion('poblacion')
  di('meses_leidos', meses.length)
  di('meses_con_recibidas', [...porMes.values()].filter((x) => x.length).length)
  di('recibidas', todas.length)
  di('filas_del_listado', [...porMes.values()].flat().length)
  if (!todas.length) throw new Error('sin recibidas')

  // Buscar `f` como si fuera a mandarse, con un número, una cuenta y un NIF dados.
  const buscar = (f: Factura, q: { numero: unknown; cuenta: unknown; nif: unknown }) => {
    const igual = esLaMismaRecibida(q)
    if (!igual) return { estado: 'sin_clave' as const }
    const ms = mesesEntre(String(f.FechaFactura ?? '').slice(0, 6), hoy)
    if (ms.length > MESES_BUSQUEDA_RECIBIDA) return { estado: 'fuera_de_ventana' as const }
    const ya = unicas(ms.flatMap((m) => porMes.get(m) ?? []).filter(igual))
    if (ya.length > 1) return { estado: 'mas_de_una' as const, ya }
    if (ya.length === 1) return { estado: ya[0] === f || clave(ya[0]) === clave(f) ? 'ella_misma' as const : 'otra' as const }
    return { estado: 'ninguna' as const }
  }
  const contar = (nombre: string, q: (f: Factura) => { numero: unknown; cuenta: unknown; nif: unknown }) => {
    seccion(nombre)
    const r = todas.map((f) => ({ f, b: buscar(f, q(f)) }))
    for (const e of ['ella_misma', 'mas_de_una', 'ninguna', 'otra', 'sin_clave', 'fuera_de_ventana']) di(e, r.filter((x) => x.b.estado === e).length)
    return r
  }

  // 1 · Tal cual está en Diez.
  const tal = contar('tal_cual', (f) => ({ numero: f.NumeroFactura, cuenta: f.CuentaCliente, nif: f.CifCliente }))
  // Por qué no se encuentra alguna: el asiento es de un mes ANTERIOR al de la factura.
  di('ninguna.asiento_antes_que_la_factura', tal.filter((x) => x.b.estado === 'ninguna' && String(x.f.Fecha ?? '').slice(0, 6) < String(x.f.FechaFactura ?? '').slice(0, 6)).length)
  // De dónde sale «más de una»: el mismo proveedor (cuenta) con el número repetido, o solo por NIF.
  const varias = tal.filter((x) => x.b.estado === 'mas_de_una') as { f: Factura; b: { ya: Factura[] } }[]
  di('mas_de_una.misma_cuenta', varias.filter((x) => x.b.ya.filter((g) => String(g.CuentaCliente) === String(x.f.CuentaCliente)).length > 1).length)
  di('mas_de_una.solo_por_nif', varias.filter((x) => x.b.ya.filter((g) => String(g.CuentaCliente) === String(x.f.CuentaCliente)).length <= 1).length)
  di('sin_nif', todas.filter((f) => !String(f.CifCliente ?? '').trim()).length)

  // 2 · La búsqueda de antes: solo el mes de la factura, número y cuenta exactos.
  seccion('antes')
  const antes = todas.map((f) => unicas((porMes.get(String(f.FechaFactura ?? '').slice(0, 6)) ?? [])
    .filter((g) => String(g.NumeroFactura) === String(f.NumeroFactura) && String(g.CuentaCliente) === String(f.CuentaCliente))).length)
  di('una', antes.filter((n) => n === 1).length)
  di('mas_de_una', antes.filter((n) => n > 1).length)
  di('ninguna', antes.filter((n) => n === 0).length)

  // 3 · El número escrito de otra forma (minúsculas, separadores cambiados).
  contar('numero_de_otra_forma', (f) => ({ numero: String(f.NumeroFactura ?? '').toLowerCase().replace(/[-/.]/g, ' ').replace(/\s+/g, '-'), cuenta: f.CuentaCliente, nif: f.CifCliente }))
  // 4 · Otra cuenta (una que no existe), el mismo NIF con «ES» y guiones.
  contar('otra_cuenta_mismo_nif', (f) => ({ numero: f.NumeroFactura, cuenta: '40099999', nif: `ES-${String(f.CifCliente ?? '')}` }))
  // 5 · Otra cuenta y otro NIF: no tiene que encontrar ninguna (tendría que darse de alta).
  contar('otra_cuenta_otro_nif', (f) => ({ numero: f.NumeroFactura, cuenta: '40099999', nif: 'B00000000' }))
} catch {
  di('parado', true)
  process.exit(1)
}
di('peticiones', c.metrica.peticiones)
di('reintentos_429', c.metrica.reintentos429)
