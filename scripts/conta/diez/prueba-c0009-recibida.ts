// scripts/conta/diez/prueba-c0009-recibida.ts
//
// D01 · Tarea 5 · UNA factura recibida de Folvy en la C0009 (la copia de
// pruebas) y leída de vuelta, para medir la serie 2 (Julio, respuesta D01_1).
//
// Es la cadena entera de Folvy, no un molde copiado: la propuesta sale de
// facturaProveedor (lo que propone el libro) y la factura de Diez de
// facturaRecibida (_shared/diezRecibida.ts). Importes inventados: 1,00 € al
// 10 % a la 600 y 1,00 € al 21 % a la 629, total 2,31 €.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente no deja escribir en C0008 sin
//     escribirEnReal, que aquí no se pasa, y la C0001 ni se abre;
//   · una sola: antes de enviar se busca por serie + número + NIF + fecha; si
//     ya está, no se envía otra (se lee la que hay);
//   · el proveedor es uno que ya está en la serie 2 de la C0009 (su 400 existe
//     en Diez), con su NIF y su nombre, que NO salen: la salida pasa por
//     limpiar() y no se imprime ni el nombre, ni la descripción, ni el NIF;
//   · el PDF no se adjunta: aquí solo se mide la factura. El freno «sin
//     documento no se envía» es del envío al validar, no de esta prueba.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { facturaRecibida } from '../../../supabase/functions/_shared/diezRecibida.ts'
import { facturaProveedor } from '../../../src/modules/conta/lib/asientosPropuestos.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const NUMERO = 'FOLVY-D01-0001'
const FECHA = '2026-10-13'

const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
const E2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
const eur = (x: unknown) => { const n = Number(x); return x == null || !Number.isFinite(n) ? '—' : E2.format(n) }
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const grupo = (x: unknown) => String(x ?? '').slice(0, 3)
const sinDatos = (x: unknown) => (x == null ? '—' : JSON.stringify(x).replace(/\d/g, '9').replace(/\p{L}{3,}/gu, 'A').slice(0, 200))

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

md(`## Diez · una factura recibida de Folvy en ${BD}, y leída de vuelta`, '')
try {
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí.`, '')

  // 1. Un proveedor que ya está en la serie 2 (su 400 existe en Diez), con NIF.
  let antes: Factura[] = []
  for (const m of ['202609', '202608', '202607']) {
    antes = (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2' && String(f.CuentaCliente ?? '').startsWith('400') && f.CifCliente && f.NombreCliente)
    if (antes.length) break
  }
  const molde = antes[0]
  if (!molde) throw new Error('no hay ningún proveedor 400 con NIF en la serie 2 (julio a septiembre)')
  const prov = String(molde.CuentaCliente)
  md(`- Proveedor: uno de la serie 2 con su 400 (grupo ${grupo(prov)}…), con NIF y nombre (no se publican).`, '')

  // 2. La propuesta de Folvy y su factura de Diez.
  const p = facturaProveedor({
    id: 'prueba-d01', numero: NUMERO, fecha: FECHA, proveedor: 'Proveedor de prueba', terceroId: null, esSocio: false, tieneNif: true, localId: 'prueba',
    lineas: [{ base: 1, tipo: { id: 't10', porcentaje: 10 }, cuentaGasto: '60000000' }, { base: 1, tipo: { id: 't21', porcentaje: 21 }, cuentaGasto: '62900000' }],
    total: 2.31, retencion: null,
  }, { proveedor: prov, ivaSoportado: (pct) => ({ cuenta: `472000${String(pct).padStart(2, '0')}`, tipoId: `t${pct}` }), retencion: '47510019' })
  if (!p.propuesta) throw new Error(`Folvy no propone: ${p.sinPropuesta}`)
  const { factura: fd, esperado } = facturaRecibida({
    fecha: FECHA, fechaFactura: FECHA, numero: NUMERO, proveedor: { nombre: String(molde.NombreCliente), nif: String(molde.CifCliente) },
    lineas: p.propuesta.lineas.map((x) => ({ cuenta: x.cuenta, debe: x.debe, haber: x.haber, tipoIva: x.iva?.tipo ?? null, baseIva: x.iva?.base ?? null })),
  }, { hoy: FECHA })
  md('### La propuesta de Folvy', '',
    `- Líneas: ${p.propuesta.lineas.map((x) => `${grupo(x.cuenta)}${x.debe ? 'D' : 'H'} ${eur(x.debe || x.haber)}`).join(' · ')} · confianza ${p.propuesta.confianza}`,
    `- A Diez: serie ${fd.Serie} · TipoAsiento ${fd.TipoAsiento} · TipoFactura ${fd.TipoFactura} · tipos ${esperado.tipos.join('+')} · bases ${eur(esperado.bases)} · cuotas ${eur(esperado.cuotas)} · total ${eur(esperado.total)} · Apuntes ${(fd.Apuntes as unknown[]).length}`, '')

  // 3. ¿Ya está? Entonces no se envía otra.
  const recientes = [...await c.facturasDelMes('202609'), ...await c.facturasDelMes('202610')].filter((f) => String(f.Serie) === '2')
  const maxAntes = Math.max(0, ...recientes.map((f) => Number(f.Documento) || 0))
  const ya = await c.buscarFactura('2', NUMERO, String(molde.CifCliente), Number(FECHA.replaceAll('-', '')))
  let creada: Factura | null = ya[0] ?? null
  if (ya.length) md(`- Ya estaba en ${BD} (${ya.length}): **no se envía otra**; se lee la que hay.`)
  else {
    try {
      creada = await c.enviarFactura(fd)
      md(`- \`facturas/add\` → **200**; Documento ${creada.Documento} (el mayor de la serie 2 en septiembre y octubre, antes: ${maxAntes})`)
    } catch (e) {
      md(`- \`facturas/add\` → **rechazada**: ${(e as Error).message} · ${e instanceof ErrorDiez ? sinDatos(e.cuerpo) : ''}`)
    }
  }

  // 4. Leída de vuelta: lo que guardó Diez contra lo que se mandó.
  if (creada?.Documento) {
    const doc = Number(creada.Documento)
    const f = await c.get<Factura>(`/api/facturas/factura/2026/2/${doc}`)
    const iguales = (k: string) => (typeof fd[k] === 'number' ? n2(f[k]) === n2(fd[k]) : String(f[k] ?? '') === String(fd[k] ?? ''))
    const campos = ['Serie', 'TipoAsiento', 'TipoFactura', 'Fecha', 'FechaFactura', 'CuentaCliente', 'NumeroFactura', 'CifCliente', 'NombreCliente', 'Descripcion',
      'BaseImponible1', 'PorcentajeIVA1', 'CuotaIVA1', 'BaseImponible2', 'PorcentajeIVA2', 'CuotaIVA2', 'TotalFactura', 'TotalGastosIngresos']
    const ap = (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
    const de = (f.Detalles as Record<string, unknown>[] | undefined) ?? []
    const debe = de.reduce((t, d) => t + n2(d.Debe), 0), haber = de.reduce((t, d) => t + n2(d.Haber), 0)
    const c472 = [...new Set(de.filter((d) => String(d.Cuenta ?? '').startsWith('472')).map((d) => String(d.Cuenta)))]
    md('', '### Leída de vuelta (`facturas/factura`)', '',
      `- Campos que vuelven igual que se mandaron: ${campos.filter(iguales).length} de ${campos.length}${campos.some((k) => !iguales(k)) ? ` · distintos: ${campos.filter((k) => !iguales(k)).join(', ')}` : ''}`,
      `- Apuntes: ${ap.length} · cuentas iguales y en el mismo orden: ${ap.map((x) => String(x.Cuenta)).join() === (fd.Apuntes as { Cuenta: string }[]).map((x) => x.Cuenta).join() ? 'sí' : 'no'} · importes iguales: ${ap.every((x, i) => n2(x.Importe) === n2((fd.Apuntes as { Importe: number }[])[i]?.Importe)) ? 'sí' : 'no'}`,
      `- El asiento que hace Diez (Detalles, grupo y lado): ${de.map((d) => `${grupo(d.Cuenta)}${n2(d.Debe) ? 'D' : ''}${n2(d.Haber) ? 'H' : ''}`).join(' · ') || 'ninguno'} · cuadra: ${debe === haber ? 'sí' : 'no'} · Haber = TotalFactura: ${haber === n2(fd.TotalFactura) ? 'sí' : 'no'}`,
      `- **Su 472**: ${c472.length} cuenta(s), ${c472.map((x) => (x === '47200000' ? 'la genérica (47200000)' : `por tipo (${x.slice(-2)})`)).join(', ') || '—'} · Folvy propone una por tipo (47200010 y 47200021): ${c472.length === 1 && c472[0] === '47200000' ? 'Diez las junta en la genérica, como en las 1.432 medidas' : 'Diez no las junta'}`,
      `- **Su proveedor**: la cuenta del Haber es la mandada: ${de.some((d) => String(d.Cuenta) === prov && n2(d.Haber) === n2(fd.TotalFactura)) ? 'sí' : 'no'}`,
      `- **Numeración de la serie 2**: Documento ${doc} · el siguiente al mayor de septiembre y octubre (${maxAntes}): ${doc === maxAntes + 1 ? 'sí' : `no (${doc - maxAntes - 1} de hueco)`}`)
    const oct = await c.facturasDelMes('202610')
    md(`- En el listado de facturas de octubre (libro de IVA): ${oct.some((x) => Number(x.Documento) === doc && String(x.Serie) === '2') ? 'sí' : 'no'}`,
      `- **Falta mirarlo en la pantalla de Diez (Julio):** que salga en el libro de recibidas de la C0009 con sus dos tipos, y en el 303 del 4T.`)
  }
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
