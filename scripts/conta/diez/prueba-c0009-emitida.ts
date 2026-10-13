// scripts/conta/diez/prueba-c0009-emitida.ts
//
// C04b · R13 · LA PRIMERA VENTA DE FOLVY EN DIEZ, EN LA C0009 (visto bueno de
// Julio, 13/10): el asiento propuesto de Uber · Alcalá del 01/10, como factura
// emitida de la serie 1, con analítica (local, marca y plataforma), y leída de
// vuelta: la factura, la analítica y el asiento que hace Diez (con su 477).
//
// De dónde sale: ASIENTO_JSON, el volcado de ese asiento leído en producción
// con conta_lectura (solo lectura) por el workflow. En Folvy no se marca nada:
// es una prueba en la copia de Diez.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente no escribe en C0008 sin
//     escribirEnReal, que aquí no se pasa, y C0001 está vetada;
//   · NUNCA DOS VECES: antes de enviar se busca en Diez por serie, número de
//     factura y cliente (la 430: las emitidas de Uber de Diez no llevan NIF).
//     Si ya está, no se envía otra: se lee la que hay;
//   · la salida pasa por limpiar() y no lleva importes: solo «igual» o
//     «distinto», códigos de cuenta y la analítica. Los importes, en el chat.
//
//   DIEZ_LECTURA='{…}' ASIENTO_JSON=/tmp/asiento.json npx tsx scripts/conta/diez/prueba-c0009-emitida.ts

import { readFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica.ts'
import { facturaDeVentas, type AsientoVentas } from '../../../supabase/functions/_shared/diezFactura.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const ASIENTO = 'ae586513-1792-4563-ae73-8ef4870363c2' // Ventas Uber · Foodint Alcalá · 01/10
const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
const cts = (x: unknown) => Math.round(Number(x) * 100)
const igual = (a: unknown, b: unknown) => (cts(a) === cts(b) ? 'igual' : '**DISTINTO**')
const si = (b: boolean) => (b ? 'sí' : '**NO**')

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
// conta_lectura no lee locations ni sales_channel: el local y el canal se
// anclan por su id (regla 9), comprobados en producción el 13/10.
const LOCAL: Record<string, string> = { '38158159-cd71-4056-950b-53425afac1ce': 'Foodint Alcalá' }
const CANAL: Record<string, string> = { '16ed2c7e-294b-4652-9a80-e5d3a241d2be': 'uber' }
const crudo = JSON.parse(readFileSync(process.env.ASIENTO_JSON ?? '/tmp/asiento.json', 'utf8')) as Omit<AsientoVentas, 'local' | 'canal'> & { id: string; estado: string; location_id: string; channel_id: string }
const volcado: AsientoVentas & { id: string; estado: string } = { ...crudo, local: LOCAL[crudo.location_id] ?? `(local ${crudo.location_id})`, canal: CANAL[crudo.channel_id] ?? `(canal ${crudo.channel_id})` }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

md(`## Diez · la primera venta de Folvy en ${BD}: Uber · Alcalá del 01/10`, '')
try {
  if (volcado.id !== ASIENTO) throw new Error(`el volcado no es el asiento ${ASIENTO}`)
  md(`- El asiento de Folvy: \`${volcado.id}\` (${volcado.estado}), ${volcado.local}, ${volcado.canal}, ${volcado.fecha}, ${volcado.lineas.length} líneas. En Folvy no se marca nada.`)
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí (la base que abre Diez es la pedida).`)

  // El nombre del cliente, el de las emitidas de Uber de Diez.
  const sep = (await c.facturasDelMes('202609')).filter((f) => String(f.Serie) === '1' && String(f.CuentaCliente) === '43000002')
  const nombres = [...new Set(sep.map((f) => String(f.NombreCliente ?? '')))]
  if (nombres.length !== 1 || !nombres[0]) throw new Error(`el nombre del cliente de Uber no es uno solo en Diez (${nombres.length})`)
  const hoy = new Date().toISOString().slice(0, 10)
  const { factura: fd, sinPoner } = facturaDeVentas(volcado, { correspondencia: CORRESPONDENCIA_LLORENTE29, nombreCliente: nombres[0], hoy, conAnalitica: true })
  md(`- La factura: serie ${fd.Serie} · ${fd.NumeroFactura} · ${fd.Descripcion} · ${(fd.Apuntes as unknown[]).length} líneas · analítica ${(fd.Analitica as unknown[]).length} filas${sinPoner.length ? ` · sin poner: ${sinPoner.join('; ')}` : ''}`, '')

  // Nunca dos veces: ¿ya está? (por documento: el listado de Diez repite filas).
  const delMes = await c.facturasDelMes(String(fd.FechaFactura).slice(0, 6))
  const ya = [...new Map(delMes.filter((f) => String(f.Serie) === fd.Serie && String(f.NumeroFactura) === fd.NumeroFactura && String(f.CuentaCliente) === fd.CuentaCliente)
    .map((f) => [String(f.Documento), f])).values()]
  let doc: number
  if (ya.length > 1) throw new Error(`hay ${ya.length} facturas ${fd.NumeroFactura} en Diez: no se toca nada`)
  if (ya.length === 1) {
    doc = Number(ya[0].Documento)
    md(`### Envío`, '', `- Ya estaba en ${BD} (documento ${doc}): **no se envía otra**; se lee la que hay.`, '')
  } else {
    const creada = await c.enviarFactura(fd)
    doc = Number(creada.Documento)
    md(`### Envío`, '', `- \`facturas/add\` → **200**: serie 1, documento **${doc}** (ejercicio 2026).`, '')
  }

  // Leída de vuelta: la factura.
  const f = await c.get<Factura>(`/api/facturas/factura/2026/1/${doc}`)
  const ap = ((f.Apuntes as { Cuenta: string; Importe: number }[] | undefined) ?? []).map((a) => `${a.Cuenta}:${cts(a.Importe)}`).sort()
  const apMandado = (fd.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => `${a.Cuenta}:${cts(a.Importe)}`).sort()
  md('### La factura, leída de vuelta', '', '| Campo | ¿Como se mandó? |', '|---|---|',
    ...(['Serie', 'TipoAsiento', 'TipoFactura', 'NumeroFactura', 'Descripcion', 'Fecha', 'FechaFactura', 'FechaIntroduccionFactura', 'CuentaCliente', 'NombreCliente', 'PorcentajeIVA1'] as const)
      .map((k) => `| ${k} | ${String(f[k]) === String(fd[k]) ? `igual (\`${k === 'NombreCliente' ? '…' : String(f[k])}\`)` : `**DISTINTO**: \`${String(f[k])}\``} |`),
    `| BaseImponible1 | ${igual(f.BaseImponible1, fd.BaseImponible1)} |`, `| CuotaIVA1 | ${igual(f.CuotaIVA1, fd.CuotaIVA1)} |`,
    `| TotalFactura | ${igual(f.TotalFactura, fd.TotalFactura)} |`, `| TotalGastosIngresos | ${igual(f.TotalGastosIngresos, fd.TotalGastosIngresos)} |`,
    `| Apuntes (cuenta e importe) | ${ap.join() === apMandado.join() ? `iguales (${ap.length}: ${ap.map((x) => x.split(':')[0]).join(', ')})` : `**DISTINTOS**: ${ap.map((x) => x.split(':')[0]).join(', ')}`} |`, '')

  // El asiento que hace Diez (Detalles), con su 477.
  const det = (f.Detalles as { Cuenta?: string; Debe?: number; Haber?: number }[] | undefined) ?? []
  const lado = (pref: string, k: 'Debe' | 'Haber') => det.filter((d) => String(d.Cuenta).startsWith(pref)).reduce((t, d) => t + cts(d[k]), 0)
  const c477 = [...new Set(det.filter((d) => String(d.Cuenta).startsWith('477')).map((d) => String(d.Cuenta)))]
  const c700 = det.filter((d) => String(d.Cuenta).startsWith('70')).map((d) => `${d.Cuenta}:${cts(d.Haber) - cts(d.Debe)}`).sort()
  md('### El asiento que hace Diez', '',
    `- Líneas: ${det.length} · cuentas: ${det.map((d) => String(d.Cuenta)).join(', ')}`,
    `- **La 477 que pone Diez: ${c477.map((x) => `\`${x}\``).join(', ') || 'ninguna'}** ${c477.length === 1 && c477[0] === '47700010' ? '(la 47700010 que decidió Julio)' : '(no es la 47700010)'}`,
    `- 430 al debe = el total: ${igual(lado('430', 'Debe') / 100, fd.TotalFactura)} · 477 al haber = la cuota: ${igual(lado('477', 'Haber') / 100, fd.CuotaIVA1)} · cada 700 al haber = su línea: ${c700.join() === apMandado.join() ? 'igual' : '**DISTINTO**'}`,
    `- Cuadra (debe = haber): ${si(det.reduce((t, d) => t + cts(d.Debe), 0) === det.reduce((t, d) => t + cts(d.Haber), 0))}`, '')

  // La analítica: solo se lee por analitica/asiento.
  const an = await c.get<unknown>(`/api/analitica/asiento/2026/1/${doc}`)
  const filas = (Array.isArray(an) ? an : an && typeof an === 'object' ? [an] : []) as Record<string, unknown>[]
  const clave = (x: Record<string, unknown>) => `${x.Subcuenta}|${x.Grupo}|${x.Subgrupo}|${x.Nivel3}|${cts(x.ImporteDebe)}|${cts(x.ImporteHaber)}`
  const mandada = (fd.Analitica as Record<string, unknown>[]).map(clave).sort()
  const vuelta = filas.map(clave).sort()
  md('### La analítica, leída de vuelta (`analitica/asiento`)', '',
    `- Filas: ${filas.length} (se mandaron ${mandada.length})`,
    ...filas.map((x) => `  - ${x.Subcuenta} · Local \`${x.Grupo ?? '—'}\` · Marca \`${x.Subgrupo ?? '—'}\` · Plataforma \`${x.Nivel3 ?? '—'}\``),
    `- **Igual que la mandada (subcuenta, local, marca, plataforma e importe): ${si(vuelta.join() === mandada.join())}**`, '')

  const oct = await c.facturasDelMes('202610')
  md('### En el libro', '', `- En el listado de facturas de octubre: ${si(oct.some((x) => Number(x.Documento) === doc && String(x.Serie) === '1'))}`,
    `- Facturas ${fd.NumeroFactura} de Uber en Diez ahora: ${new Set(oct.filter((x) => String(x.NumeroFactura) === fd.NumeroFactura && String(x.CuentaCliente) === fd.CuentaCliente).map((x) => String(x.Documento))).size} (tiene que ser 1)`)
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
