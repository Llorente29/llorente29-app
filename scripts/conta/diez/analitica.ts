// scripts/conta/diez/analitica.ts
//
// C04b · Respuesta 4 · ¿Tiene Diez analítica (local, marca, plataforma) en el
// histórico, y de qué forma? T1 contó 0 de 14.937 asientos con analítica, pero
// en el LISTADO de apuntes, y en la C0009 se vio (T2 §6) que la analítica
// guardada solo sale por `analitica/asiento/{ej}/{serie}/{doc}`. Julio dice
// que en Diez se lleva por local. Antes de diseñar nada se mide, asiento a
// asiento, sobre una muestra de meses:
//   · cuántos asientos la tienen, por ejercicio y serie, y en qué subcuentas
//     (por grupo del PGC: 6, 7, el resto);
//   · qué campos vienen (Grupo, Subgrupo, Nivel3, TablaReparto, TipoImporte) y
//     qué códigos (los de los catálogos: CAM, FLO, 1–12, GLV…; no son datos de
//     nadie);
//   · si el reparto de cada subcuenta CUBRE su importe en el asiento (100 %),
//     se queda corto o se pasa, y si una subcuenta se reparte entre varios
//     grupos o marcas;
//   · cuánto tarda una petición (para saber lo que costaría traerla entera).
// En claro, SOLO recuentos y códigos de catálogo: ni importes, ni nombres, ni
// conceptos (el registro es público). Solo GET.
//
//   DIEZ_LECTURA='{…}' ANALITICA_MESES=202311,202406,202506,202609 npx tsx scripts/conta/diez/analitica.ts

import { ClienteDiez, type AlmacenToken, type Apunte, type AnaliticaDiez } from '../../../supabase/functions/_shared/diezCliente.ts'
import { cent } from '../../../supabase/functions/_shared/diezMapeo.ts'
// @ts-expect-error módulo .mjs sin tipos
import { limpiar } from './publicable.mjs'

const MESES = (process.env.ANALITICA_MESES || '202311,202406,202506,202609').split(',').filter(Boolean)

const l: string[] = []
const md = (...x: string[]) => l.push(...x)
const soltar = () => process.stdout.write(limpiar(l.join('\n')) + '\n')

const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
if (!cred || typeof cred !== 'object') { console.log('Falta el secreto DIEZ_LECTURA. No se lee nada.'); process.exit(1) }
let guardado: { token: string; expiresAt: string } | null = null
const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
const c = new ClienteDiez({
  base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: 'C0008',
  credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
  almacen, pausaMs: 120,
})

const cuenta = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n }
const tabla = (cab: string[], filas: (string | number)[][]) => md(`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...filas.map((f) => `| ${f.join(' | ')} |`), '')
const lleno = (v: unknown) => v != null && String(v).trim() !== ''
const grupoPgc = (s: string) => (s.startsWith('6') ? '6' : s.startsWith('7') ? '7' : 'otras')

md('## Diez · la analítica del histórico, asiento a asiento (muestra)', '', `Meses ${MESES.join(', ')} · base C0008 · solo GET · solo recuentos y códigos de catálogo`, '')

// 1 · Los catálogos (códigos y cuántos; nada más) ----------------------------------------
const catalogo = async (ruta: string, campo: string) => {
  try {
    const filas = await c.todas<Record<string, unknown>>(ruta)
    return { n: filas.length, codigos: filas.map((f) => String(f[campo] ?? f.Codigo ?? '?')).sort().join(' · ') }
  } catch (e) { return { n: -1, codigos: `error: ${(e as Error).message}` } }
}
const cat = {
  grupos: await catalogo('/api/analitica/operationGroups', 'Codigo'),
  subgrupos: await catalogo('/api/analitica/operationSubGroups', 'Codigo'),
  nivel3: await catalogo('/api/analitica/nivel3s', 'Codigo'),
  tablas: await catalogo('/api/analitica/distributionTables', 'Codigo'),
}
md('### Catálogos', '')
tabla(['Catálogo', 'Cuántos', 'Códigos'], Object.entries(cat).map(([k, v]) => [k, v.n, v.codigos || '—']))

// 2 · Asiento a asiento --------------------------------------------------------------------
type Fila = { asientos: number; con: number; filas: number; errores: number }
const porSerie: Record<string, Fila> = {}
const campos: Record<string, number> = {}
const tipoImporte: Record<string, number> = {}
const grupos: Record<string, number> = {}, subgrupos: Record<string, number> = {}, nivel3: Record<string, number> = {}
const pgcCon: Record<string, number> = {}, pgcSin: Record<string, number> = {}
const cobertura: Record<string, number> = {}
let repartidas = 0, subcuentasConAnalitica = 0, sinSubcuenta = 0
const errores: Record<string, number> = {}
const tiempos: number[] = []

for (const mes of MESES) {
  const apuntes: Apunte[] = await c.apuntesDelMes(mes)
  for (const a of apuntes) {
    const k = `${a.Ejercicio} · serie ${a.Serie}`
    const f = (porSerie[k] ??= { asientos: 0, con: 0, filas: 0, errores: 0 })
    f.asientos++
    let an: AnaliticaDiez[]
    const t0 = Date.now()
    try {
      an = await c.analiticaDe(String(a.Ejercicio), String(a.Serie), Number(a.Documento))
    } catch (e) {
      f.errores++; cuenta(errores, (e as Error).message.replace(/\/\d{4}\/\w+\/\d+/, '/{ej}/{serie}/{doc}'))
      continue
    } finally { tiempos.push(Date.now() - t0) }
    // Lo que importa de cada subcuenta en el asiento (céntimos, con signo).
    const importe = new Map<string, number>()
    for (const d of a.Detalles ?? []) importe.set(String(d.Cuenta), (importe.get(String(d.Cuenta)) ?? 0) + cent(d.Debe) - cent(d.Haber))
    const filas = an.filter((x) => lleno(x.Grupo) || lleno(x.Subgrupo) || lleno(x.Nivel3) || lleno(x.TablaReparto))
    for (const [s] of importe) if (!filas.some((x) => String(x.Subcuenta ?? '') === s)) cuenta(pgcSin, grupoPgc(s))
    if (!filas.length) continue
    f.con++; f.filas += filas.length
    const porSub = new Map<string, { suma: number; claves: Set<string> }>()
    for (const x of filas) {
      for (const cpo of ['Subcuenta', 'Grupo', 'Subgrupo', 'Nivel3', 'TablaReparto', 'CuentaCliente', 'Descripcion', 'Fecha']) if (lleno((x as Record<string, unknown>)[cpo])) cuenta(campos, cpo)
      cuenta(tipoImporte, String(x.TipoImporte ?? '—'))
      if (lleno(x.Grupo)) cuenta(grupos, String(x.Grupo))
      if (lleno(x.Subgrupo)) cuenta(subgrupos, String(x.Subgrupo))
      if (lleno(x.Nivel3)) cuenta(nivel3, String(x.Nivel3))
      const s = String(x.Subcuenta ?? '')
      if (!s) { sinSubcuenta++; continue }
      const p = porSub.get(s) ?? { suma: 0, claves: new Set<string>() }
      p.suma += cent(x.ImporteDebe) - cent(x.ImporteHaber)
      p.claves.add(`${x.Grupo ?? ''}|${x.Subgrupo ?? ''}|${x.Nivel3 ?? ''}`)
      porSub.set(s, p)
    }
    for (const [s, p] of porSub) {
      subcuentasConAnalitica++
      cuenta(pgcCon, grupoPgc(s))
      if (p.claves.size > 1) repartidas++
      const total = importe.get(s)
      cuenta(cobertura, total == null ? 'subcuenta que no está en el asiento'
        : p.suma === total ? 'cubre el 100 % (al céntimo)'
        : Math.abs(p.suma) < Math.abs(total) ? 'se queda corta' : 'se pasa')
    }
  }
}

md('### Por ejercicio y serie', '')
tabla(['Ejercicio · serie', 'Asientos', 'Con analítica', 'Filas de analítica', 'Errores al pedirla'],
  Object.entries(porSerie).sort().map(([k, v]) => [k, v.asientos, v.con, v.filas, v.errores]))
const todos = Object.values(porSerie).reduce((s, v) => ({ a: s.a + v.asientos, c: s.c + v.con }), { a: 0, c: 0 })
md(`**${todos.c} de ${todos.a}** asientos de la muestra tienen analítica.`, '')
const orden = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'
md('### La forma', '',
  `- Campos rellenos (filas): ${orden(campos)}`,
  `- TipoImporte: ${orden(tipoImporte)}`,
  `- Grupo (local): ${orden(grupos)}`,
  `- Subgrupo (marca): ${orden(subgrupos)}`,
  `- Nivel3 (plataforma): ${orden(nivel3)}`,
  `- Subcuentas con analítica, por grupo del PGC: ${orden(pgcCon)} · sin analítica: ${orden(pgcSin)}`,
  `- Cobertura del importe de cada subcuenta: ${orden(cobertura)}`,
  `- Subcuentas repartidas entre varios grupo/marca/plataforma en el mismo asiento: ${repartidas} de ${subcuentasConAnalitica}`,
  `- Filas de analítica sin subcuenta: ${sinSubcuenta}`,
  `- Errores: ${orden(errores)}`,
  '')
tiempos.sort((a, b) => a - b)
const p = (q: number) => tiempos.length ? tiempos[Math.min(tiempos.length - 1, Math.floor(q * tiempos.length))] : 0
md('### Lo que costaría traerla entera', '',
  `- Peticiones de analítica: ${tiempos.length} · mediana ${p(0.5)} ms · p95 ${p(0.95)} ms (más la pausa de 120 ms entre peticiones).`,
  `- Peticiones totales de la sesión: ${c.metrica.peticiones} · reintentos por 429: ${c.metrica.reintentos429}.`,
  '')
soltar()
