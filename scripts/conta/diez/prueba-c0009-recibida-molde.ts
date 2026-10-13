// scripts/conta/diez/prueba-c0009-recibida-molde.ts
//
// D01 · Tarea 5 · LA FACTURA RECIBIDA DE MOLDE, SOLO LEYENDO (C0009).
//
// Antes de enviar a Diez la primera factura recibida que propone Folvy, se mira
// cómo guarda Diez las de la serie 2 (las recibidas de la gestoría): los
// campos, los tipos, las claves de IVA, cuántos tipos lleva una factura, el
// recargo, la retención, las cuentas del asiento (6…, 472…, 400/410, 4751) y
// cómo se numeran. De ahí sale la forma de lo que Folvy manda.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente se crea con escribir: false,
//     así que no puede escribir nada aunque se quisiera;
//   · la salida pasa por limpiar() y además: de números y descripciones solo
//     sale el PATRÓN (cada cifra un 9), del NIF y del nombre solo si están, y
//     de los importes solo el signo y si cuadran.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-recibida-molde.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
const patron = (x: unknown) => (x == null || x === '' ? '—' : `\`${String(x).replace(/\d/g, '9')}\``)
const tipo = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? `lista(${v.length})` : typeof v)
const SEGUROS = new Set(['Ejercicio', 'Serie', 'TipoAsiento', 'TipoFactura', 'ClaveTipoFactura', 'ClaveRegimenIva1', 'ClaveRegimenIva2', 'ClaveRegimenIva3',
  'PorcentajeIVA1', 'PorcentajeIVA2', 'PorcentajeIVA3', 'PorcentajeRecargo1', 'PorcentajeRecargo2', 'PorcentajeRecargo3', 'PorcentajeRetencion',
  'CuentaRetencion', 'ClaveRetencion', 'Simplificada', 'Rectificativa', 'TipoRectificativa', 'Criterio', 'CriterioCaja', 'Exenta', 'Pais', 'TipoOperacion', 'Moneda'])
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const conValor = (v: unknown) => v != null && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && !v.length)
const grupo = (cuenta: unknown) => String(cuenta ?? '').slice(0, 3)

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

md(`## Diez · la factura recibida de molde en ${BD} (solo lectura)`, '')
try {
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí. El cliente no puede escribir (escribir: false).`, '')

  // Tres meses de la serie 2, para tener variedad (la copia puede no llegar a septiembre).
  const meses: string[] = []
  let rec: Factura[] = []
  for (const m of ['202609', '202608', '202607', '202606', '202605', '202604']) {
    const del = (await c.facturasDelMes(m)).filter((f) => String(f.Serie) === '2')
    if (del.length) { meses.push(m); rec = rec.concat(del) }
    if (meses.length === 3) break
  }
  if (!rec.length) throw new Error(`no hay facturas de la serie 2 en ${BD} (mirados 202609 a 202604)`)
  const porCuenta = new Map<string, number>()
  for (const f of rec) porCuenta.set(grupo(f.CuentaCliente), (porCuenta.get(grupo(f.CuentaCliente)) ?? 0) + 1)
  md('### Dónde', '', `- Meses ${meses.join(', ')}: **${rec.length}** facturas de la serie 2.`,
    `- Por grupo de la cuenta del tercero: ${[...porCuenta].map(([k, n]) => `${k} ${n}`).join(' · ')}`,
    `- La prueba del C04b (FOLVY-PRUEBA-0001) está entre ellas: ${rec.some((f) => String(f.NumeroFactura) === 'FOLVY-PRUEBA-0001') ? 'sí' : 'no (es de octubre)'}`, '')

  // Los campos.
  const claves = [...new Set(rec.flatMap((f) => Object.keys(f)))].sort()
  md('### Los campos de sus facturas', '', '| Campo | Tipo | Con valor | Valores (si se pueden publicar) |', '|---|---|---:|---|',
    ...claves.map((k) => {
      const vs = rec.map((f) => (f as Record<string, unknown>)[k])
      const valores = SEGUROS.has(k) ? [...new Set(vs.map((v) => JSON.stringify(v ?? null)))].slice(0, 8).join(' · ') : ''
      return `| ${k} | ${[...new Set(vs.map(tipo))].join('/')} | ${vs.filter(conValor).length} de ${rec.length} | ${valores} |`
    }), '')

  // Las cifras: varios tipos, recargo, retención, cuadre.
  const ntipos = (f: Factura) => [1, 2, 3].filter((i) => n2(f[`BaseImponible${i}`]) !== 0).length
  const cuadra = (f: Factura) => {
    const s = [1, 2, 3].reduce((t, i) => t + n2(f[`BaseImponible${i}`]) + n2(f[`CuotaIVA${i}`]) + n2(f[`CuotaRecargo${i}`]), 0) - Math.abs(n2(f.ImporteRetencion ?? f.CuotaRetencion))
    return Math.abs(s - n2(f.TotalFactura)) <= 1
  }
  md('### Las cifras (solo recuentos)', '',
    `- Con 1 / 2 / 3 tipos de IVA: ${[1, 2, 3].map((k) => rec.filter((f) => ntipos(f) === k).length).join(' / ')} · sin base: ${rec.filter((f) => ntipos(f) === 0).length}`,
    `- Con recargo (algún CuotaRecargo): ${rec.filter((f) => [1, 2, 3].some((i) => n2(f[`CuotaRecargo${i}`]) !== 0)).length}`,
    `- Con retención (ImporteRetencion o CuotaRetencion): ${rec.filter((f) => n2(f.ImporteRetencion ?? f.CuotaRetencion) !== 0).length}`,
    `- Total negativo (abonos): ${rec.filter((f) => n2(f.TotalFactura) < 0).length}`,
    `- **Bases + cuotas + recargos − retención = TotalFactura**: ${rec.filter(cuadra).length} de ${rec.length}`,
    `- Pares tipo de IVA: ${[...new Set(rec.map((f) => [1, 2, 3].filter((i) => n2(f[`BaseImponible${i}`]) !== 0).map((i) => f[`PorcentajeIVA${i}`]).join('+')))].join(' · ')}`, '')

  // Las cuentas del asiento.
  const ap = (f: Factura) => (f.Apuntes as Record<string, unknown>[] | undefined) ?? []
  const de = (f: Factura) => (f.Detalles as Record<string, unknown>[] | undefined) ?? []
  const lado = (d: Record<string, unknown>) => `${grupo(d.Cuenta)}${Number(d.Debe) ? 'D' : ''}${Number(d.Haber) ? 'H' : ''}`
  const formas = new Map<string, number>()
  for (const f of rec) { const k = de(f).map(lado).sort().join(' '); formas.set(k, (formas.get(k) ?? 0) + 1) }
  const cuentas472 = [...new Set(rec.flatMap((f) => de(f).map((d) => String(d.Cuenta ?? '')).filter((x) => x.startsWith('472'))))]
  const cuentasRet = [...new Set(rec.flatMap((f) => de(f).map((d) => String(d.Cuenta ?? '')).filter((x) => x.startsWith('475'))))]
  const gastos = [...new Set(rec.flatMap((f) => ap(f).map((a) => grupo(a.Cuenta))))]
  md('### Las cuentas', '',
    `- Apuntes (lo que se manda): por factura ${[...new Set(rec.map((f) => ap(f).length))].join('/')}; grupos de cuenta ${gastos.join(', ')}; suma de Apuntes = suma de bases: ${rec.filter((f) => ap(f).reduce((t, a) => t + n2(a.Importe), 0) === [1, 2, 3].reduce((t, i) => t + n2(f[`BaseImponible${i}`]), 0)).length} de ${rec.length}`,
    `- Campos de un Apunte: ${[...new Set(rec.flatMap((f) => ap(f).flatMap((a) => Object.keys(a))))].join(', ') || '—'}`,
    `- Cuentas de IVA soportado (472…) en el asiento: ${cuentas472.join(', ') || 'ninguna'}`,
    `- Cuentas de retención (475…): ${cuentasRet.join(', ') || 'ninguna'}`,
    `- Formas del asiento de Diez (Detalles, grupo y lado): ${[...formas].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `\`${k}\` ${n}`).join(' · ')}`, '')

  // Números, fechas, NIF.
  const nums = rec.map((f) => String(f.NumeroFactura ?? ''))
  const dias = rec.map((f) => {
    const a = String(f.FechaFactura ?? ''), b = String(f.Fecha ?? '')
    if (a.length !== 8 || b.length !== 8) return null
    return (Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8)) - Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8))) / 864e5
  }).filter((x): x is number => x != null)
  md('### Números, fechas y tercero', '',
    `- Patrones del número (los 8 más frecuentes): ${[...nums.reduce((m, n) => m.set(n.replace(/\d/g, '9'), (m.get(n.replace(/\d/g, '9')) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${patron(p)} ${n}`).join(' · ')}`,
    `- Mismo NumeroFactura y misma cuenta dos veces: ${rec.length - new Set(rec.map((f) => `${f.CuentaCliente}|${f.NumeroFactura}`)).size}`,
    `- Fecha (del asiento) − FechaFactura, en días: igual ${dias.filter((d) => d === 0).length}; después ${dias.filter((d) => d > 0).length} (máx ${Math.max(0, ...dias)}); antes ${dias.filter((d) => d < 0).length}`,
    `- FechaIntroduccionFactura con valor: ${rec.filter((f) => conValor(f.FechaIntroduccionFactura)).length}`,
    `- CifCliente con valor: ${rec.filter((f) => conValor(f.CifCliente)).length} · NombreCliente: ${rec.filter((f) => conValor(f.NombreCliente)).length}`,
    `- Descripción, patrones (5): ${[...new Set(rec.map((f) => String(f.Descripcion ?? '').replace(/\d/g, '9').slice(0, 40)))].slice(0, 5).map(patron).join(' · ')}`,
    `- Con analítica: ${rec.filter((f) => Array.isArray(f.Analitica) && (f.Analitica as unknown[]).length).length} de ${rec.length}`, '')

  // Una de molde: la primera con dos tipos, si la hay; si no, la primera.
  const molde = rec.find((f) => ntipos(f) >= 2 && de(f).length) ?? rec.find((f) => de(f).length) ?? rec[0]
  md('### Una de molde', '',
    `- Serie ${molde.Serie} · TipoAsiento ${molde.TipoAsiento} · TipoFactura ${molde.TipoFactura ?? '—'} · ClaveTipoFactura ${molde.ClaveTipoFactura ?? '—'} · ClaveRegimenIva1 ${molde.ClaveRegimenIva1 ?? '—'} · tipos ${ntipos(molde)}`,
    `- NumeroFactura ${patron(molde.NumeroFactura)} · Descripcion ${patron(molde.Descripcion)} · cuenta del tercero ${grupo(molde.CuentaCliente)}…`,
    `- Apuntes: ${ap(molde).map((a) => `${String(a.Cuenta ?? '—')} (${Math.sign(Number(a.Importe))})`).join(' · ') || 'ninguno'}`,
    `- Detalles (grupo y lado): ${de(molde).map(lado).join(' · ') || 'ninguno'}`,
    `- Campos con valor: ${Object.entries(molde).filter(([, v]) => conValor(v)).map(([k]) => k).join(', ')}`, '')
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
