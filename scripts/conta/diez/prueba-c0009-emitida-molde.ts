// scripts/conta/diez/prueba-c0009-emitida-molde.ts
//
// C04b · R13 · LA FACTURA EMITIDA DE MOLDE, SOLO LEYENDO (C0009).
//
// Antes de enviar a Diez la primera venta de Folvy (Uber · Alcalá del 01/10,
// Julio, R13), se mira cómo guarda Diez una venta de plataforma igual: una
// factura emitida de la serie 1 con la 430 de Uber (43000002). De ella sale la
// forma de lo que Folvy mandará: los campos, los tipos, las claves de IVA, el
// número de factura, la descripción y las líneas.
//
// Frenos:
//   · la base es C0009, escrita aquí; el cliente se crea con escribir: false,
//     así que no puede escribir nada aunque se quisiera;
//   · la salida pasa por limpiar() y además: de los números y descripciones
//     solo sale el PATRÓN (cada cifra como 9), del NIF y del nombre del
//     cliente solo si están, y de los importes solo el signo.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-emitida-molde.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const UBER = '43000002'
const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
/** El patrón de un texto: las letras se quedan, cada cifra es un 9. */
const patron = (x: unknown) => (x == null || x === '' ? '—' : `\`${String(x).replace(/\d/g, '9')}\``)
const tipo = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? `lista(${v.length})` : typeof v)
/** Valores que se pueden publicar tal cual: claves, tipos y códigos de cuenta. */
const SEGUROS = new Set(['Ejercicio', 'Serie', 'TipoAsiento', 'TipoFactura', 'ClaveTipoFactura', 'ClaveRegimenIva1', 'ClaveRegimenIva2', 'PorcentajeIVA1', 'PorcentajeIVA2',
  'PorcentajeRecargo1', 'CuentaCliente', 'Simplificada', 'Rectificativa', 'TipoRectificativa', 'Criterio', 'CriterioCaja', 'Exenta', 'Pais', 'TipoOperacion', 'Moneda'])

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

md(`## Diez · la factura emitida de molde en ${BD} (solo lectura)`, '')
try {
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí (la base que abre Diez es la pedida). El cliente no puede escribir (escribir: false).`, '')

  // La copia puede no llegar a septiembre: se busca hacia atrás.
  let mes = '', del: Factura[] = [], uber: Factura[] = []
  for (const m of ['202609', '202608', '202607', '202606', '202605']) {
    del = await c.facturasDelMes(m)
    uber = del.filter((f) => String(f.Serie) === '1' && String(f.CuentaCliente ?? '') === UBER)
    mes = m
    if (uber.length) break
  }
  const serie1 = del.filter((f) => String(f.Serie) === '1')
  md('### Dónde', '', `- Mes ${mes}: ${del.length} facturas; de la serie 1, ${serie1.length}; de la serie 1 con la 430 de Uber (${UBER}), **${uber.length}**.`,
    `- La serie 1, por cuenta de cliente: ${[...new Map(serie1.map((f) => [String(f.CuentaCliente), 0])).keys()].map((k) => `${k} ${serie1.filter((f) => String(f.CuentaCliente) === k).length}`).join(' · ')}`, '')
  if (!uber.length) throw new Error(`no hay ninguna factura emitida de Uber en la serie 1 de ${BD} (mirados 202609 a 202605)`)

  // Los campos: cuáles salen, de qué tipo, y los valores seguros.
  const claves = [...new Set(uber.flatMap((f) => Object.keys(f)))].sort()
  const conValor = (k: string) => uber.filter((f) => { const v = (f as Record<string, unknown>)[k]; return v != null && v !== '' && v !== 0 && v !== false && !(Array.isArray(v) && !v.length) }).length
  md('### Los campos de sus facturas emitidas de Uber', '', '| Campo | Tipo | Con valor | Valores (si se pueden publicar) |', '|---|---|---:|---|',
    ...claves.map((k) => {
      const valores = SEGUROS.has(k) ? [...new Set(uber.map((f) => JSON.stringify((f as Record<string, unknown>)[k] ?? null)))].slice(0, 6).join(' · ') : ''
      return `| ${k} | ${[...new Set(uber.map((f) => tipo((f as Record<string, unknown>)[k])))].join('/')} | ${conValor(k)} de ${uber.length} | ${valores} |`
    }), '')

  // El número, la descripción y las fechas: el patrón.
  const molde = uber.find((f) => /FLO/i.test(String(f.Descripcion ?? ''))) ?? uber[0]
  const ap = (molde.Apuntes as Record<string, unknown>[] | undefined) ?? []
  const de = (molde.Detalles as Record<string, unknown>[] | undefined) ?? []
  md('### Una, de molde (la primera de Alcalá, FLO, si la hay)', '',
    `- Serie ${molde.Serie} · Documento ${patron(molde.Documento)} · TipoAsiento ${molde.TipoAsiento} · TipoFactura ${molde.TipoFactura ?? '—'} · ClaveTipoFactura ${molde.ClaveTipoFactura ?? '—'} · ClaveRegimenIva1 ${molde.ClaveRegimenIva1 ?? '—'} · IVA ${molde.PorcentajeIVA1 ?? '—'} %`,
    `- NumeroFactura ${patron(molde.NumeroFactura)} · Descripcion ${patron(molde.Descripcion)}`,
    `- Fecha ${patron(molde.Fecha)} · FechaFactura ${patron(molde.FechaFactura)} · iguales: ${molde.Fecha === molde.FechaFactura ? 'sí' : 'no'} · FechaIntroduccionFactura ${patron(molde.FechaIntroduccionFactura)}`,
    `- CifCliente: ${molde.CifCliente ? 'sí, lleva' : 'no lleva'} · NombreCliente: ${molde.NombreCliente ? 'sí, lleva' : 'no lleva'}`,
    `- Base ${Math.sign(Number(molde.BaseImponible1))} · cuota ${Math.sign(Number(molde.CuotaIVA1))} · total ${Math.sign(Number(molde.TotalFactura))} (solo el signo) · cuota = base × IVA: ${Math.abs(Math.round(Number(molde.BaseImponible1) * Number(molde.PorcentajeIVA1)) / 100 - Number(molde.CuotaIVA1)) < 0.011 ? 'sí' : 'no'} · base + cuota = total: ${Math.abs(Number(molde.BaseImponible1) + Number(molde.CuotaIVA1) - Number(molde.TotalFactura)) < 0.011 ? 'sí' : 'no'}`,
    `- Apuntes (${ap.length}): ${ap.map((a) => `${String(a.Cuenta ?? '—')} (${Math.sign(Number(a.Importe))}) ${patron(a.Concepto)}`).join(' · ') || 'ninguno'}`,
    `- Campos de un Apunte: ${[...new Set(ap.flatMap((a) => Object.keys(a)))].join(', ') || '—'}`,
    `- Detalles (${de.length}, las líneas del asiento que hace Diez): ${de.map((d) => `${String(d.Cuenta ?? '—')} ${Number(d.Debe) ? 'D' : ''}${Number(d.Haber) ? 'H' : ''}`).join(' · ') || 'ninguno'}`, '')

  // Cuántas por día y cómo se numeran: ¿una por local y día?
  const porDesc = new Map<string, number>()
  for (const f of uber) { const k = String(f.Descripcion ?? '').replace(/\d/g, '9'); porDesc.set(k, (porDesc.get(k) ?? 0) + 1) }
  const numeros = uber.map((f) => String(f.NumeroFactura ?? ''))
  md('### Cómo se numeran y describen', '',
    `- Patrones de la descripción: ${[...porDesc].map(([k, n]) => `\`${k}\` ${n}`).join(' · ')}`,
    `- Patrones del número de factura: ${[...new Set(numeros.map((n) => n.replace(/\d/g, '9')))].map((p) => `\`${p}\` ${numeros.filter((n) => n.replace(/\d/g, '9') === p).length}`).join(' · ')}`,
    `- Números repetidos dentro del mes: ${numeros.length - new Set(numeros).size}`,
    `- ¿El número de factura es el Documento? ${uber.every((f) => String(f.NumeroFactura) === String(f.Documento)) ? 'sí, en todas' : uber.some((f) => String(f.NumeroFactura) === String(f.Documento)) ? 'en algunas' : 'no'}`,
    `- Con analítica: ${uber.filter((f) => Array.isArray(f.Analitica) && (f.Analitica as unknown[]).length).length} de ${uber.length}`, '')
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
