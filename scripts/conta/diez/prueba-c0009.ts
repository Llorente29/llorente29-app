// scripts/conta/diez/prueba-c0009.ts
//
// C04b · T3 · UNA factura recibida de prueba en la C0009 (la copia de pruebas),
// con la analítica de Diez (Local, Marca y Plataforma en la pantalla de la
// factura; en la API, Analitica[] con Grupo, Subgrupo y Nivel3).
//
// Pregunta que contesta (Julio, 12/10): ¿admite facturas/add la analítica, y
// la devuelve Diez igual al leerla? Si sí, Folvy la rellena con su local y su
// marca al enviar, y la comparación puede ser también por local.
//
// Frenos:
//   · la base es C0009 escrita aquí, no la del secreto; el cliente no deja
//     escribir en C0008 sin escribirEnReal, que aquí no se pasa;
//   · una sola factura: antes de enviar se busca por serie + número + NIF, y si
//     ya está, no se envía otra (se lee la que hay);
//   · si Diez la rechaza CON analítica, se prueba una vez SIN ella, para saber
//     si el problema es la analítica. Como mucho queda una factura creada;
//   · la salida pasa por limpiar(): ni NIF, ni nombres de terceros, ni IBAN.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009.ts

import { ClienteDiez, ErrorDiez, type AlmacenToken, type Factura, type FacturaData } from '../../../supabase/functions/_shared/diezCliente.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const NUMERO = 'FOLVY-PRUEBA-0001'
const FECHA = 20261012
const BASE_EUR = 1

const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
// Dos decimales sin reventar con null (lo que no es número sale «—»). Con
// punto: son los importes INVENTADOS de la prueba (1,00 €), y con coma el
// filtro los taparía como importes.
const E2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
const eur = (x: unknown) => { const n = Number(x); return x == null || !Number.isFinite(n) ? '—' : E2.format(n) }
const sinDatos = (x: unknown) => (x == null ? '—' : JSON.stringify(x).replace(/\d/g, '9').replace(/\s+/g, ' ').slice(0, 200))

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

md(`## Diez · factura de prueba con analítica en ${BD}`, '')
try {
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí (la base que abre Diez es la pedida)`, '')

  // 1. El catálogo de la analítica: tres niveles.
  type Grupo = { Codigo: string; Nombre?: string; NoActivo?: boolean }
  type Sub = { Grupo: string; Subgrupo: number; Descripcion?: string; NoActivo?: string }
  const grupos = await c.todas<Grupo>('/api/analitica/operationGroups')
  const subs = await c.todas<Sub>('/api/analitica/operationSubGroups')
  const n3 = await c.todas<Grupo>('/api/analitica/nivel3s')
  md('### La analítica de la C0009 (copia de la C0008)', '',
    `Grupos ${grupos.length} · subgrupos ${subs.length} · nivel 3 ${n3.length}`, '',
    '| Nivel | Código | Nombre | Activo |', '|---|---|---|---|',
    ...grupos.map((g) => `| Grupo | \`${g.Codigo}\` | ${g.Nombre ?? '—'} | ${g.NoActivo ? 'no' : 'sí'} |`),
    ...subs.map((s) => `| Subgrupo de \`${s.Grupo}\` | \`${s.Subgrupo}\` | ${s.Descripcion ?? '—'} | ${s.NoActivo && s.NoActivo !== 'N' && s.NoActivo !== 'false' ? 'no' : 'sí'} |`),
    ...n3.map((x) => `| Nivel 3 | \`${x.Codigo}\` | ${x.Nombre ?? '—'} | ${x.NoActivo ? 'no' : 'sí'} |`), '')

  // 2. Una factura recibida real de la C0009 como molde (julio de 2026, o el mes más cercano).
  // La copia puede no llegar a julio: se busca hacia atrás.
  let mes = '', julio: Factura[] = [], recibidas: Factura[] = []
  for (const m of ['202607', '202609', '202608', '202606', '202605', '202604', '202603']) {
    julio = await c.facturasDelMes(m)
    recibidas = julio.filter((f) => String(f.CuentaCliente ?? '').startsWith('40') && Number(f.BaseImponible1) > 0)
    mes = m
    if (recibidas.length) break
  }
  const conAnalitica = julio.filter((f) => Array.isArray(f.Analitica) && (f.Analitica as unknown[]).length > 0).length
  md('### El molde', '', `- Facturas de ${mes} en ${BD}: ${julio.length}; recibidas (40…) con base: ${recibidas.length}; con analítica: ${conAnalitica}`)
  const molde = recibidas.find((f) => Array.isArray(f.Apuntes) && (f.Apuntes as unknown[]).length > 0) ?? recibidas[0]
  if (!molde) throw new Error('no hay ninguna factura recibida de 2026 que sirva de molde')
  const apuntesMolde = (molde.Apuntes as { Cuenta: string; Importe: number; Concepto?: string }[] | undefined) ?? []
  md(`- Molde: serie \`${molde.Serie}\` · TipoAsiento ${molde.TipoAsiento} · TipoFactura ${molde.TipoFactura ?? '—'} · IVA ${molde.PorcentajeIVA1 ?? '—'} % · ClaveTipoFactura ${molde.ClaveTipoFactura ?? '—'}`,
    `- Sus Apuntes: ${apuntesMolde.length}; grupo de cuenta y signo del importe: ${apuntesMolde.map((a) => `${String(a.Cuenta).slice(0, 3)}(${Math.sign(Number(a.Importe))})`).join(', ') || 'ninguno'}`,
    `- Campos con valor en el molde: ${Object.entries(molde).filter(([, v]) => v != null && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && !v.length)).map(([k]) => k).join(', ')}`, '')

  // 3. La factura de prueba: el molde con 1,00 € de base.
  const pct = Number(molde.PorcentajeIVA1) || 21
  const base = BASE_EUR, cuota = Math.round(base * pct) / 100, total = Math.round((base + cuota) * 100) / 100
  const baseMolde = Number(molde.BaseImponible1)
  const gasto = apuntesMolde.find((a) => /^6/.test(String(a.Cuenta)))?.Cuenta ?? '62900000'
  const apuntes = apuntesMolde.length
    ? apuntesMolde.map((a, i) => ({ Linea: i + 1, Cuenta: a.Cuenta, Concepto: 'PRUEBA FOLVY', Fecha: FECHA, Importe: Math.round((Number(a.Importe) / baseMolde) * base * 100) / 100 }))
    : [{ Linea: 1, Cuenta: gasto, Concepto: 'PRUEBA FOLVY', Fecha: FECHA, Importe: base }]
  // Run 1 usó BAR (el primero del catálogo). Julio, 12/10: Carabanchel va
  // siempre con CAM y JDH no se envía nunca (el cliente lo frena).
  const g = grupos.find((x) => x.Codigo === 'CAM') ?? grupos.find((x) => !x.NoActivo && x.Codigo !== 'JDH' && x.Codigo !== 'BAR')
  const s = subs.find((x) => x.Grupo === g?.Codigo) ?? subs[0]
  const n = n3.find((x) => !x.NoActivo) ?? n3[0]
  const analitica = g ? [{ Subcuenta: gasto, Grupo: g.Codigo, Subgrupo: s ? String(s.Subgrupo) : undefined, Nivel3: n?.Codigo, Descripcion: 'PRUEBA FOLVY', Fecha: FECHA, ImporteDebe: base, ImporteHaber: 0 }] : []
  const copia = (k: string) => (molde[k] == null ? {} : { [k]: molde[k] })
  const fd: FacturaData = {
    Ejercicio: '2026', Serie: String(molde.Serie), TipoAsiento: Number(molde.TipoAsiento), Fecha: FECHA, FechaFactura: FECHA, FechaIntroduccionFactura: FECHA,
    CuentaCliente: String(molde.CuentaCliente), NumeroFactura: NUMERO, Descripcion: 'PRUEBA FOLVY (C04b)',
    ...copia('CifCliente'), ...copia('NombreCliente'), ...copia('TipoFactura'), ...copia('ClaveTipoFactura'), ...copia('ClaveRegimenIva1'),
    BaseImponible1: base, PorcentajeIVA1: pct, CuotaIVA1: cuota, TotalFactura: total,
    Apuntes: apuntes, Analitica: analitica,
  }
  md('### Lo que se envía', '', `- Base ${eur(base)} · IVA ${pct} % · cuota ${eur(cuota)} · total ${eur(total)} · Apuntes ${apuntes.length} · Analitica ${analitica.length} (Grupo \`${g?.Codigo ?? '—'}\`, Subgrupo \`${s?.Subgrupo ?? '—'}\`, Nivel3 \`${n?.Codigo ?? '—'}\`)`, '')

  // 4. ¿Ya está? Entonces no se envía otra.
  const ya = await c.buscarFactura(fd.Serie, NUMERO, String(molde.CifCliente ?? ''), FECHA)
  let creada: Factura | null = ya[0] ?? null
  if (ya.length) md(`- Ya estaba en ${BD} (${ya.length}): **no se envía otra**; se lee la que hay (documento ${ya[0].Documento}).`)
  else {
    try {
      creada = await c.enviarFactura(fd)
      md(`- \`facturas/add\` CON analítica → **200**; documento ${creada.Documento}`)
    } catch (e) {
      const cuerpo = e instanceof ErrorDiez ? sinDatos(e.cuerpo) : (e as Error).message
      md(`- \`facturas/add\` CON analítica → **rechazada**: ${(e as Error).message} · ${cuerpo}`)
      try {
        creada = await c.enviarFactura({ ...fd, Analitica: [] })
        md(`- \`facturas/add\` SIN analítica → **200**; documento ${creada.Documento}. **El problema es la analítica.**`)
      } catch (e2) {
        md(`- \`facturas/add\` SIN analítica → **rechazada** también: ${(e2 as Error).message} · ${e2 instanceof ErrorDiez ? sinDatos(e2.cuerpo) : ''}. El problema no es (solo) la analítica.`)
      }
    }
  }

  // 5. Leerla de vuelta.
  if (creada?.Documento) {
    md('', '### Leída de vuelta', '')
    const doc = Number(creada.Documento)
    const f = await c.get<Factura>(`/api/facturas/factura/2026/${encodeURIComponent(fd.Serie)}/${doc}`)
    const an = (f.Analitica as { Grupo?: string; Subgrupo?: string; Nivel3?: string; Subcuenta?: string; ImporteDebe?: number }[] | undefined) ?? []
    md(`- \`facturas/factura\`: base ${eur(f.BaseImponible1)} · cuota ${eur(f.CuotaIVA1)} · total ${eur(f.TotalFactura)} · NumeroFactura igual: ${f.NumeroFactura === NUMERO ? 'sí' : 'no'} · Apuntes ${(f.Apuntes as unknown[] | undefined)?.length ?? 0} · Detalles ${(f.Detalles as unknown[] | undefined)?.length ?? 0}`,
      `- Analitica devuelta: ${an.length} · ${an.map((a) => `Grupo \`${a.Grupo ?? '—'}\` Subgrupo \`${a.Subgrupo ?? '—'}\` Nivel3 \`${a.Nivel3 ?? '—'}\` subcuenta ${String(a.Subcuenta ?? '').slice(0, 3)}… importe ${eur(a.ImporteDebe ?? 0)}`).join(' · ') || 'ninguna'}`)
    const igual = an.length === analitica.length && analitica.every((x, i) => String(an[i]?.Grupo ?? '') === String(x.Grupo ?? '') && String(an[i]?.Subgrupo ?? '') === String(x.Subgrupo ?? '') && String(an[i]?.Nivel3 ?? '') === String(x.Nivel3 ?? ''))
    md(`- **Por \`facturas/factura\`, la analítica vuelve igual que se mandó: ${analitica.length ? (igual ? 'sí' : 'no') : 'no se mandó'}**`)
    // Run 1 (12/10): facturas/factura no devuelve la analítica, pero
    // analitica/asiento contesta una lista. Lo que dice cuenta más.
    try {
      const a2 = await c.get<unknown>(`/api/analitica/asiento/2026/${encodeURIComponent(fd.Serie)}/${doc}`)
      const filas = (Array.isArray(a2) ? a2 : a2 && typeof a2 === 'object' ? [a2] : []) as Record<string, unknown>[]
      md(`- \`analitica/asiento\`: ${filas.length} fila(s)`,
        ...filas.map((a, i) => `  - ${i + 1}: Grupo \`${a.Grupo ?? '—'}\` · Subgrupo \`${a.Subgrupo ?? '—'}\` · Nivel3 \`${a.Nivel3 ?? '—'}\` · TablaReparto \`${a.TablaReparto ?? '—'}\` · TipoImporte ${a.TipoImporte ?? '—'} · subcuenta ${String(a.Subcuenta ?? '').slice(0, 3)}… · debe ${eur(a.ImporteDebe)} · haber ${eur(a.ImporteHaber)} · campos: ${Object.keys(a).join(', ')}`))
      const igual2 = filas.length === analitica.length && analitica.every((x, i) => String(filas[i]?.Grupo ?? '') === String(x.Grupo ?? '') && String(filas[i]?.Subgrupo ?? '') === String(x.Subgrupo ?? '') && String(filas[i]?.Nivel3 ?? '') === String(x.Nivel3 ?? ''))
      md(`- **Por \`analitica/asiento\`, la analítica es la que se mandó: ${igual2 ? 'sí' : 'no'}**`)
    } catch (e) { md(`- \`analitica/asiento\`: ${(e as Error).message}`) }
    const oct = await c.facturasDelMes('202610')
    md(`- En el listado de facturas de octubre (libro de IVA): ${oct.some((x) => Number(x.Documento) === doc && String(x.Serie) === fd.Serie) ? 'sí' : 'no'}`,
      `- **Falta mirarlo en la pantalla de Diez (Julio):** que salga en el libro de recibidas y en el 303 del 4T de la C0009, y con Local/Marca/Plataforma rellenos.`)
  }
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
