// scripts/conta/diez/prueba-c0009-adjunto.ts
//
// C04b · R14 · ¿DEJA DIEZ ADJUNTAR EL PDF A UNA FACTURA? Prueba en la C0009,
// con la UBR-FLO-20261001 que ya está allí (documento 1801, R13).
//
// El PDF es el «Resumen de ventas» REAL de ese día (resumenVentasPdf.ts), con
// los pedidos leídos en producción por conta_lectura (solo lectura) en el paso
// anterior del workflow. Se genera aquí y va solo a Diez: no se guarda ni se
// publica.
//
// Lo que se mide, por este orden (Julio, 13/10: si no se puede, se para):
//   1. getfile ANTES: ¿tiene ya documento? Si lo tiene, NO se sube otro.
//   2. facturas/upload (DatosDocumento: Ejercicio, Serie, Documento,
//      NombreArchivo, Archivo en base64): qué contesta.
//   3. getfile DESPUÉS: ¿devuelve el mismo PDF (misma huella)?
// Frenos: C0009 escrita aquí; una sola factura (si hay más de una con ese
// número, para); salida por limpiar() y sin importes.
//
//   DIEZ_LECTURA='{…}' ASIENTO_JSON=/tmp/asiento.json npx tsx scripts/conta/diez/prueba-c0009-adjunto.ts

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { jsPDF } from 'jspdf'
import { ClienteDiez, type AlmacenToken } from '../../../supabase/functions/_shared/diezCliente.ts'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../supabase/functions/_shared/diezAnalitica.ts'
import { facturaDeVentas, type AsientoVentas } from '../../../supabase/functions/_shared/diezFactura.ts'
import { resumenVentasPdf, type PedidoResumen } from '../../../supabase/functions/_shared/resumenVentasPdf.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const BD = 'C0009'
const ASIENTO = 'ae586513-1792-4563-ae73-8ef4870363c2'
const LOCAL: Record<string, string> = { '38158159-cd71-4056-950b-53425afac1ce': 'Foodint Alcalá' }
const CANAL: Record<string, string> = { '16ed2c7e-294b-4652-9a80-e5d3a241d2be': 'uber' }
const PLATAFORMA: Record<string, string> = { uber: 'Uber Eats' }
const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')
const huella = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16)
const corto = (x: unknown) => (x == null ? '—' : (typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').slice(0, 300))

type Volcado = Omit<AsientoVentas, 'local' | 'canal'> & {
  id: string; estado: string; location_id: string; channel_id: string
  empresa: { nombre: string; nif: string }
  pedidos: { hora: string; codigo: string; marca: string; total: number; base: number | null; cuota: number | null }[]
}
const v = JSON.parse(readFileSync(process.env.ASIENTO_JSON ?? '/tmp/asiento.json', 'utf8')) as Volcado
const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred) { console.log('Falta el secreto DIEZ_LECTURA.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, escribir: true, pausaMs: 150,
})

md(`## Diez · ¿se puede adjuntar el PDF a una factura? (${BD}, UBR-FLO-20261001)`, '')
try {
  if (v.id !== ASIENTO) throw new Error(`el volcado no es el asiento ${ASIENTO}`)
  const asiento: AsientoVentas = { ...v, local: LOCAL[v.location_id] ?? '?', canal: CANAL[v.channel_id] ?? '?' }
  const { factura: fd } = facturaDeVentas(asiento, { correspondencia: CORRESPONDENCIA_LLORENTE29, nombreCliente: '—', hoy: new Date().toISOString().slice(0, 10), conAnalitica: false })

  // La base de cada pedido, como la propuesta (conta_propuesta_ventas_unidad):
  // la que trae si cuadra con su total; si no, del total al 10 %.
  const pedidos: PedidoResumen[] = v.pedidos.map((p) => {
    const t = Math.round(p.total * 100)
    const trae = p.base != null && p.cuota != null && Math.round(p.base * 100) + Math.round(p.cuota * 100) === t
    const b = trae ? Math.round(p.base! * 100) : Math.sign(t) * Math.round((Math.abs(t) * 100) / 110)
    return { hora: p.hora, codigo: p.codigo, marca: p.marca, base: b / 100, cuota: (t - b) / 100, total: t / 100 }
  })
  const marcaDe = new Map(v.lineas.filter((x) => x.marca).map((x) => [x.cuenta, x.marca!]))
  const lineasFactura = (fd.Apuntes as { Cuenta: string; Importe: number }[]).map((a) => ({ marca: marcaDe.get(a.Cuenta) ?? a.Cuenta, cuenta: a.Cuenta, importe: a.Importe }))
  const pdf = resumenVentasPdf(jsPDF, {
    empresa: v.empresa, local: asiento.local, plataforma: PLATAFORMA[asiento.canal] ?? asiento.canal, fecha: v.fecha,
    numeroFactura: String(fd.NumeroFactura), generado: new Date(), tipoIva: 10, pedidos, reembolsos: [], lineasFactura,
    factura: { base: Number(fd.BaseImponible1), cuota: Number(fd.CuotaIVA1), total: Number(fd.TotalFactura) }, cobro: Number(fd.TotalFactura),
  })
  md(`- El PDF: «Resumen de ventas» de ${fd.NumeroFactura}, ${pedidos.length} pedidos, ${pdf.length} bytes, huella \`${huella(pdf)}\`. Cuadra con la factura (si no, no habría PDF).`)

  await c.asegurarToken()
  md(`- Entrar en ${BD}: sí.`)
  const oct = await c.facturasDelMes('202610')
  const docs = [...new Set(oct.filter((f) => String(f.Serie) === '1' && String(f.NumeroFactura) === fd.NumeroFactura && String(f.CuentaCliente) === fd.CuentaCliente).map((f) => Number(f.Documento)))]
  if (docs.length !== 1) throw new Error(`hay ${docs.length} facturas ${fd.NumeroFactura} en ${BD}; tiene que haber una`)
  const doc = docs[0]
  md(`- La factura: serie 1, documento ${doc}.`, '')

  // 1. ¿Tiene ya documento?
  const antes = await c.documentoDeFactura('2026', '1', doc)
  md('### 1 · getfile antes de subir', '', `- ${antes.status}: ${corto(antes.json)}`, '')
  if (antes.status === 200 && typeof antes.json === 'string' && antes.json.length > 100) {
    md('- **Ya tiene documento: no se sube otro.**')
  } else {
    // 2. Subir.
    const sub = await c.adjuntarDocumentoFactura({ Ejercicio: '2026', Serie: '1', Documento: doc, NombreArchivo: `${fd.NumeroFactura}.pdf`, Archivo: Buffer.from(pdf).toString('base64') })
    md('### 2 · facturas/upload', '', `- **${sub.status}**: ${sub.status === 200 ? `devuelve la factura ${corto((sub.json as Record<string, unknown> | null)?.NumeroFactura)} (documento ${corto((sub.json as Record<string, unknown> | null)?.Documento)})` : corto(sub.json)}`, '')
  }

  // 3. ¿Lo devuelve igual?
  const despues = await c.documentoDeFactura('2026', '1', doc)
  let veredicto: string
  if (despues.status === 200 && typeof despues.json === 'string' && despues.json.length > 100) {
    const bytes = new Uint8Array(Buffer.from(despues.json, 'base64'))
    const igual = huella(bytes) === huella(pdf)
    md('### 3 · getfile después de subir', '', `- 200: ${bytes.length} bytes, huella \`${huella(bytes)}\`, empieza por «${new TextDecoder().decode(bytes.slice(0, 5))}» · **igual que el subido: ${igual ? 'sí' : 'no'}**`, '')
    veredicto = igual ? '**Se puede adjuntar por la API: Diez guarda el PDF y lo devuelve igual.**' : '**Diez guarda un documento, pero no es el subido (otra huella).**'
  } else {
    md('### 3 · getfile después de subir', '', `- ${despues.status}: ${corto(despues.json)}`, '')
    veredicto = '**No se ha podido comprobar que Diez guarde el PDF: getfile no lo devuelve.**'
  }
  md('### Veredicto', '', veredicto)
} catch (e) {
  md('', `**Parado:** ${(e as Error).message}`)
  soltar()
  process.exit(1)
}
md('', `Peticiones: ${c.metrica.peticiones} · 429: ${c.metrica.reintentos429}`)
soltar()
