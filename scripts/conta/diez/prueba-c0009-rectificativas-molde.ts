// scripts/conta/diez/prueba-c0009-rectificativas-molde.ts
//
// C06b · Respuesta 8, pregunta 2 · CÓMO ANULA DIEZ UNA FACTURA EMITIDA, SOLO
// LEYENDO (C0009).
//
// Julio (R8): «al anular un asiento ya enviado, Folvy manda el contraasiento a
// Diez solo». En Diez la venta es una FACTURA emitida (serie 1, la 430 de la
// plataforma), así que su contraasiento es otra factura emitida que la anula.
// El Swagger de apiCON dice qué campos tiene (FacturaRectificativa,
// TipoRectificativa 1|2, NumeroFacturaRectificativa, FechaFacturaRectificativa,
// TotalBasesRectificativa, TotalCuotasRectificativa, ClaveTipoFactura,
// TipoFactura 1–13) pero no qué valor lleva cada uno. Lo que no se ha medido
// no se inventa: aquí se mira cómo están las que la gestoría ya ha hecho.
//
// Se recorren las emitidas de 2026-10 hacia atrás (hasta 2023-01, si da tiempo) y se cuentan:
//   · las que llevan algo de rectificativa (FacturaRectificativa, TipoRectificativa,
//     NumeroFacturaRectificativa) y las de total negativo;
//   · de ellas, la FORMA: TipoFactura, ClaveTipoFactura, TipoRectificativa,
//     Simplificada, el patrón del número (cada cifra, 9) y del número que
//     rectifican, si ese número existe en Diez y es de la misma cuenta, el
//     signo de base, cuota y total, y si los Totales*Rectificativa son los de
//     la original.
//
// Frenos: la base es C0009; el cliente se crea con escribir: false; la salida
// pasa por limpiar() y además solo saca patrones, signos y recuentos: ni
// importes, ni nombres, ni NIF.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/prueba-c0009-rectificativas-molde.ts

import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
const patron = (x: unknown) => (x == null || x === '' ? '—' : `\`${String(x).replace(/\d/g, '9')}\``)
const signo = (x: unknown) => { const n = Number(x); return n > 0 ? '+' : n < 0 ? '−' : '0' }
const n2 = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const v = (f: Factura, k: string) => (f as Record<string, unknown>)[k]
const lleno = (x: unknown) => x != null && x !== '' && x !== 0 && x !== false

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: false, pausaMs: 150,
})

md(`## Diez · cómo se anula una factura emitida en ${BD} (solo lectura)`, '')
try {
  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí. El cliente no puede escribir (escribir: false).`, '')

  // Del mes más reciente hacia atrás, y para sola a los 11 minutos (el job tiene 15:
  // el 1.er intento, de 2023-01 en adelante, se quedó sin tiempo). Dice qué meses ha mirado.
  const todosMeses: string[] = []
  for (let y = 2026; y >= 2023; y--) for (let m = 12; m >= 1; m--) if (y < 2026 || m <= 10) todosMeses.push(`${y}${String(m).padStart(2, '0')}`)
  const hasta = Date.now() + 11 * 60_000
  const todas: Factura[] = []
  const sinContestar: string[] = []
  const meses: string[] = []
  for (const m of todosMeses) {
    if (Date.now() > hasta) break
    meses.push(m)
    try { todas.push(...(await c.facturasDelMes(m))) } catch { sinContestar.push(m) }
  }
  meses.reverse()
  // El listado de Diez repite filas: una por Ejercicio/Serie/Documento.
  const unicas = [...new Map(todas.map((f) => [`${f.Ejercicio}/${f.Serie}/${f.Documento}`, f])).values()]
  const porNumero = new Map<string, Factura[]>()
  for (const f of unicas) porNumero.set(String(v(f, 'NumeroFactura') ?? ''), [...(porNumero.get(String(v(f, 'NumeroFactura') ?? '')) ?? []), f])
  md('### Dónde', '', `- Meses ${meses[0]}–${meses.at(-1)} (${meses.length} de ${todosMeses.length}; del más reciente hacia atrás, con 11 minutos): ${unicas.length} facturas emitidas distintas (sin contestar: ${sinContestar.join(', ') || 'ninguno'}).`, '')

  const rect = unicas.filter((f) => lleno(v(f, 'FacturaRectificativa')) || lleno(v(f, 'TipoRectificativa')) || lleno(v(f, 'NumeroFacturaRectificativa')) || /^R/i.test(String(v(f, 'ClaveTipoFactura') ?? '')))
  const negativas = unicas.filter((f) => n2(v(f, 'TotalFactura')) < 0)
  md('### Cuántas', '',
    `- Con algo de rectificativa (FacturaRectificativa, TipoRectificativa, NumeroFacturaRectificativa o ClaveTipoFactura R…): **${rect.length}**`,
    `- Con el total en negativo: **${negativas.length}** (de ellas, con algo de rectificativa: ${negativas.filter((f) => rect.includes(f)).length})`, '')

  const grupo = [...new Set([...rect, ...negativas])]
  const cuenta = (xs: Factura[], k: string) => [...new Set(xs.map((f) => JSON.stringify(v(f, k) ?? null)))].map((x) => `${x} ${xs.filter((f) => JSON.stringify(v(f, k) ?? null) === x).length}`).join(' · ')
  if (grupo.length) {
    md('### Su forma (recuentos por valor)', '', '| Campo | Valores |', '|---|---|',
      ...['Serie', 'TipoAsiento', 'TipoFactura', 'ClaveTipoFactura', 'FacturaRectificativa', 'TipoRectificativa', 'EsFacturaSimplificada', 'Simplificada', 'ClaveRegimenIva1', 'PorcentajeIVA1']
        .map((k) => `| ${k} | ${cuenta(grupo, k)} |`), '')
    md('### Una a una (hasta 15): patrón, signos y a qué factura apunta', '')
    for (const f of grupo.slice(0, 15)) {
      const ref = String(v(f, 'NumeroFacturaRectificativa') ?? '')
      const orig = ref ? (porNumero.get(ref) ?? []) : []
      const o = orig[0]
      md(`- Serie ${f.Serie} · cuenta ${String(f.CuentaCliente ?? '—').slice(0, 3)}… · nº ${patron(v(f, 'NumeroFactura'))} · rectifica ${patron(ref)} (en Diez: ${orig.length}${o ? `, misma cuenta: ${String(o.CuentaCliente) === String(f.CuentaCliente) ? 'sí' : 'no'}, fecha ${patron(v(o, 'FechaFactura'))}` : ''})`
        + ` · base ${signo(v(f, 'BaseImponible1'))} cuota ${signo(v(f, 'CuotaIVA1'))} total ${signo(v(f, 'TotalFactura'))}`
        + ` · TotalBasesRectificativa ${signo(v(f, 'TotalBasesRectificativa'))}${o ? ` (= base de la original: ${n2(v(f, 'TotalBasesRectificativa')) === n2(v(o, 'BaseImponible1')) ? 'sí' : 'no'}; = −base propia: ${n2(v(f, 'TotalBasesRectificativa')) === -n2(v(f, 'BaseImponible1')) ? 'sí' : 'no'})` : ''}`
        + ` · FechaFacturaRectificativa ${patron(v(f, 'FechaFacturaRectificativa'))}${o ? ` (= la original: ${v(f, 'FechaFacturaRectificativa') === v(o, 'FechaFactura') ? 'sí' : 'no'})` : ''}`
        + ` · apuntes ${((v(f, 'Apuntes') as { Importe?: number; Cuenta?: string }[] | undefined) ?? []).map((a) => `${String(a.Cuenta ?? '').slice(0, 3)}(${signo(a.Importe)})`).join(' ') || '—'}`
        + ` · descripción ${patron(v(f, 'Descripcion'))}`)
    }
    md('')
    md('### Los campos que salen en ellas', '', `- ${[...new Set(grupo.flatMap((f) => Object.keys(f).filter((k) => lleno(v(f, k)))))].sort().join(', ')}`, '')
  } else md('- Ninguna: en esta base no hay ninguna factura emitida anulada. La forma no se puede medir aquí.', '')
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
