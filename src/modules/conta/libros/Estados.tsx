// src/modules/conta/libros/Estados.tsx
//
// C05 · Balance de situación, pérdidas y ganancias y cambios en el patrimonio
// neto con los modelos oficiales (maqueta N14Balance). Arriba, la barra de la
// IA con lo que ve (saldos anómalos, cuentas sin sitio, patrimonio neto por
// debajo de la mitad del capital con la cita de la LSC, el modelo con su
// porqué, «Otros resultados» que la memoria tiene que explicar). Dos
// columnas: el ejercicio y el anterior en gris (regla 8: si no hay anterior,
// lo dice). Cada línea con «+» despliega sus cuentas, y cada cuenta lleva a su
// Mayor. Pie: «Cuadra · Activo = PN + Pasivo · ✓ 0,00 €» o, en rojo, por qué
// no (regla 1). La PyG, además, «Por local» (y «Por marca» si las hay):
// columnas que suman el total al céntimo (regla 10).

import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros, rutaMayor } from '@/config/navegacion'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  calcularEstado, columnaAnterior, cuadreBalance, mapeoEfectivo, modeloPropuesto, resultadoTresCifras, vistasDeResultado,
  type LineaCalculada, type Modelo, type ResultadoEstado, type SaldoCuenta,
} from '@/modules/conta/lib/cuentasAnuales'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { aSaldoCuenta, leerLineas, leerMapeo, planDeEmpresa, resultadoRepartido, saldosCuentas, type SaldoConLocal } from '@/modules/conta/services/librosService'

type Vista = 'oficial' | 'detallado' | 'local' | 'marca'
const NOMBRE = { balance: 'Balance de situación', pyg: 'Pérdidas y ganancias', ecpn: 'Cambios en el patrimonio neto' } as const

/** Los fines de mes de un ejercicio, hasta hoy o su final. */
function finesDeMes(inicio: string, fin: string, hoy: string): string[] {
  const r: string[] = []
  let y = Number(inicio.slice(0, 4)); let m = Number(inicio.slice(5, 7))
  for (;;) {
    const ultimo = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    const tope = hoy < fin ? hoy : fin
    if (ultimo >= tope) { r.push(tope); break }
    r.push(ultimo)
    m++; if (m > 12) { m = 1; y++ }
  }
  return r.reverse()
}
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export function Estados({ estado, salida }: { estado: 'balance' | 'pyg' | 'ecpn'; salida?: 'pdf' | 'excel' }) {
  const L = useLibros()
  const hoy = new Date().toISOString().slice(0, 10)
  const fechas = finesDeMes(L.ejercicio.inicio, L.ejercicio.fin, hoy)
  const [fecha, setFecha] = useState(fechas[0])
  const [vista, setVista] = useState<Vista>('oficial')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [hecho, setHecho] = useState<string | null>(null)

  const d = useLeer(async () => {
    const plan = await planDeEmpresa(L.accountId, L.companyId)
    const modelo: Modelo = L.ejercicio.modelo?.elegido ?? (plan === 'pymes' ? 'pymes' : 'abreviado')
    const est = estado === 'ecpn' ? 'balance' : estado
    const [lineas, mapeo, lineasPyg, mapeoPyg, saldos, saldosAnt, porLocal] = await Promise.all([
      leerLineas(modelo, est), leerMapeo(L.companyId, modelo, est),
      leerLineas(modelo, 'pyg'), leerMapeo(L.companyId, modelo, 'pyg'),
      saldosCuentas(L.companyId, L.ejercicio.inicio, fecha),
      L.anterior ? saldosCuentas(L.companyId, L.anterior.inicio, L.anterior.fin) : Promise.resolve(null),
      estado === 'pyg' ? saldosCuentas(L.companyId, L.ejercicio.inicio, fecha, true) : Promise.resolve(null),
    ])
    const repartido = estado === 'pyg' && L.locales.length > 1 ? await resultadoRepartido(L.companyId, L.ejercicio.inicio, fecha).catch(() => null) : null
    return { modelo, plan, lineas, mapeo, lineasPyg, mapeoPyg, saldos, saldosAnt, porLocal, repartido }
  }, `${L.companyId}:${L.ejercicio.id}:${estado}:${fecha}:${L.vuelta}`)

  const calc = useMemo(() => {
    if (!d.datos) return null
    const x = d.datos
    const est = estado === 'pyg' ? 'pyg' : 'balance'
    const mapeo = mapeoEfectivo(x.mapeo.serie, x.mapeo.propio)
    const conv = (s: SaldoConLocal[]) => s.map((y) => aSaldoCuenta(y, est))
    const actual = calcularEstado(est, x.lineas, mapeo, conv(x.saldos))
    const anterior = x.saldosAnt ? calcularEstado(est, x.lineas, mapeo, conv(x.saldosAnt)) : null
    // Para la IA y el modelo: balance y PyG del mismo corte.
    const mapeoPyg = mapeoEfectivo(x.mapeoPyg.serie, x.mapeoPyg.propio)
    const pyg = calcularEstado('pyg', x.lineasPyg, mapeoPyg, x.saldos.map((y) => aSaldoCuenta(y, 'pyg')))
    const bal = est === 'balance' ? actual : null
    return { actual, anterior, pyg, bal }
  }, [d.datos, estado])

  const col = columnaAnterior(L.anterior ? { estado: L.anterior.origen === 'migrated' ? 'traido' : L.anterior.estado === 'closed' ? 'cerrado' : 'abierto' } : null)
  const vistas = vistasDeResultado(L.locales.length, L.marcas.length)
  const titulo = NOMBRE[estado]

  const filasExport = (r: ResultadoEstado, ant: ResultadoEstado | null): FilaTabla[] => r.lineas.filter((l) => !l.oculta).map((l) => {
    const a = ant?.lineas.find((x) => x.code === l.code)
    return [`${'  '.repeat(Math.max(0, l.level - 1))}${l.text}`, l.importe, ...(col.sale ? [a?.importe ?? null] : [])]
  })
  const exportar = (como: 'pdf' | 'excel') => {
    if (!calc) return
    const cab = ['Línea', ddmm(fecha), ...(col.sale ? [`${L.anterior!.code}`] : [])]
    const filas = filasExport(calc.actual, calc.anterior)
    const nombre = `${titulo} ${L.ejercicio.code} a ${fecha}`
    const ok = como === 'pdf'
      ? pdfTabla(`${nombre}.pdf`, titulo, `Modelo ${d.datos!.modelo} · a ${ddmm(fecha)} · ejercicio ${L.ejercicio.code}`, cab, filas, undefined, 'Modelos oficiales del PGC (texto consolidado del BOE). Las partidas «a crear» solo salen con saldo.')
      : excelTabla(`${nombre}.xlsx`, titulo, cab, filas)
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${filas.length} líneas.` : 'No había nada que bajar: el estado no tiene ninguna línea con saldo.')
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label={titulo}>
      <div className="cxl-seccion">
        <div>
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Balances' }]} />
          <h2>{titulo}</h2>
        </div>
        <div className="cxl-herramientas">
          {estado !== 'ecpn' && (
            <div className="cxl-segmento" role="group" aria-label="Cómo verlo">
              <button type="button" aria-pressed={vista === 'oficial'} onClick={() => setVista('oficial')}>Oficial</button>
              <button type="button" aria-pressed={vista === 'detallado'} onClick={() => setVista('detallado')}>{estado === 'pyg' ? 'Detallada' : 'Detallado'}</button>
              {estado === 'pyg' && vistas.porLocal && <button type="button" aria-pressed={vista === 'local'} onClick={() => setVista('local')}>Por local</button>}
            </div>
          )}
          <label><span className="cx-oculto">A qué fecha</span>
            <select className="cx-input" value={fecha} onChange={(e) => setFecha(e.target.value)}>
              {fechas.map((f) => <option key={f} value={f}>{estado === 'balance' || estado === 'ecpn' ? 'A ' : 'Hasta el '}{ddmm(f)}</option>)}
            </select>
          </label>
          <Link to={rutaLibros('anuales', 'mapeo')} className="cx-boton-sec">Qué cuentas alimentan cada línea</Link>
          <button type="button" className={salida === 'pdf' ? 'cx-boton' : 'cx-boton-sec'} onClick={() => exportar('pdf')} disabled={!calc}>Exportar PDF</button>
          <button type="button" className={salida === 'excel' ? 'cx-boton' : 'cx-boton-sec'} onClick={() => exportar('excel')} disabled={!calc}>Excel</button>
        </div>
      </div>
      {hecho && <div className="cx-guardado" role="status">{hecho}</div>}
      {L.ejercicio.origen === 'migrated' && <div className="cx-tarjeta cxd-franja" role="status">Ejercicio <strong>traído</strong> de {L.ejercicio.cierre ? 'Folvy' : 'otro programa'}: se enseña tal cual, sin recalcular su cierre.</div>}

      {!calc && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={36} />)}</div>}
      {calc && d.datos && <BarraIa calc={calc} estado={estado} modelo={d.datos.modelo} plantilla={L.ejercicio.plantillaMedia} anterior={null} />}

      {calc && estado === 'balance' && (
        <div className="cxl-estados">
          {(['activo', 'pn_pasivo'] as const).map((lado) => (
            <div key={lado} className="cx-tarjeta cxl-estado">
              <h3>{lado === 'activo' ? 'Activo' : 'Patrimonio neto y pasivo'}</h3>
              <TablaEstado lineas={calc.actual.lineas.filter((l) => l.side === lado)} anterior={calc.anterior} col={col} fecha={fecha}
                anioAnterior={L.anterior?.code ?? null} abiertas={vista === 'detallado' ? null : abiertas} alternar={(c) => setAbiertas(alternar(abiertas, c))} />
              {lado === 'pn_pasivo' && <PieCuadre r={calc.actual} />}
            </div>
          ))}
        </div>
      )}
      {calc && estado === 'pyg' && vista !== 'local' && (
        <div className="cx-tarjeta cxl-estado">
          <TablaEstado lineas={calc.actual.lineas} anterior={calc.anterior} col={col} fecha={fecha} anioAnterior={L.anterior?.code ?? null}
            abiertas={vista === 'detallado' ? null : abiertas} alternar={(c) => setAbiertas(alternar(abiertas, c))} />
          {calc.actual.sinSitio.length > 0 && <SinSitio r={calc.actual} />}
        </div>
      )}
      {calc && estado === 'pyg' && vista === 'local' && d.datos?.porLocal && (
        <PorLocal saldos={d.datos.porLocal} lineas={d.datos.lineas} mapeo={mapeoEfectivo(d.datos.mapeo.serie, d.datos.mapeo.propio)} total={calc.actual} repartido={d.datos.repartido} />
      )}
      {calc && estado === 'ecpn' && d.datos && <Ecpn d={d.datos} />}
      {calc && <p className="cxl-pie">Toca «+» para ver las cuentas de cada línea; toca una cuenta para ir a su Mayor. {col.sale ? `La columna gris es el ejercicio ${L.anterior!.code}${col.texto ? ` (${col.texto})` : ''}.` : 'Sin ejercicio anterior: no hay columna que comparar, y no se inventan ceros.'}</p>}
    </section>
  )
}

const alternar = (s: Set<string>, c: string) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n }

function TablaEstado({ lineas, anterior, col, fecha, anioAnterior, abiertas, alternar }: {
  lineas: LineaCalculada[]; anterior: ResultadoEstado | null; col: { sale: boolean; texto: string | null }; fecha: string; anioAnterior: string | null
  abiertas: Set<string> | null; alternar: (c: string) => void
}) {
  const sinAnt = col.sale ? '' : ' cxl-sin-anterior'
  return (
    <div role="table" aria-label="Líneas">
      <div className={`cxl-fila-estado cxl-fila-cabeza${sinAnt}`} role="row">
        <span role="columnheader" /><span /><span className="cxl-cifra-celda" role="columnheader">{ddmm(fecha)}</span>
        {col.sale && <span className="cxl-cifra-celda" role="columnheader">{anioAnterior}</span>}
      </div>
      {lineas.filter((l) => !l.oculta).map((l) => {
        const a = anterior?.lineas.find((x) => x.code === l.code)
        const abierta = abiertas === null || abiertas.has(l.code)
        const hayCuentas = l.cuentas.length > 0
        return (
          <Fragment key={l.code}>
            <div className={`cxl-fila-estado${sinAnt}`} role="row" title={l.legalRef}>
              <span className={l.isTotal ? 'cxl-total' : `cxl-n${Math.min(l.level, 6)}`} role="cell">{l.text}{l.toCreate && <> <Chip tono="ambar">a crear · solo con saldo</Chip></>}</span>
              <span>{hayCuentas && <button type="button" className="cxl-mas" aria-expanded={abierta} aria-label={`${abierta ? 'Ocultar' : 'Ver'} las cuentas de «${l.text}»`} onClick={() => alternar(l.code)}>{abierta ? '−' : '+'}</button>}</span>
              <span className={`cxl-cifra-celda${l.importe < 0 && !l.isTotal ? ' cxl-anomalo' : ''}`} role="cell">{l.importe === 0 && !hayCuentas && !l.isTotal ? '—' : eurosExactos(l.importe)}</span>
              {col.sale && <span className="cxl-cifra-celda cxl-anterior" role="cell">{a ? (a.importe === 0 && !a.cuentas.length && !a.isTotal ? '—' : eurosExactos(a.importe)) : '—'}</span>}
            </div>
            {abierta && l.cuentas.map((c) => (
              <div key={c.code} className={`cxl-cuenta${sinAnt}`} role="row">
                <span role="cell">
                  <Link to={rutaMayor(c.code)} className={c.anomalo ? 'cxl-anomalo' : undefined}>{c.code} · {c.name}</Link>
                  {c.porDefecto && <> <Link to={rutaLibros('anuales', 'mapeo')} className="cxl-defecto">colocada por defecto · Completar</Link></>}
                </span>
                <span />
                <span className={`cxl-cifra-celda${c.anomalo ? ' cxl-anomalo' : ''}`} role="cell">{eurosExactos(c.importe)}</span>
                {col.sale && <span className="cxl-cifra-celda cxl-anterior" role="cell">{eurosExactos(anterior?.lineas.flatMap((x) => x.cuentas).find((y) => y.code === c.code)?.importe ?? 0)}</span>}
              </div>
            ))}
          </Fragment>
        )
      })}
    </div>
  )
}

function PieCuadre({ r }: { r: ResultadoEstado }) {
  const c = cuadreBalance(r)
  return (
    <>
      <div className="cxl-cuadra" role="status" aria-label="Cuadre del balance">
        <span>{c.cuadra ? 'Cuadra' : 'No cuadra'}</span>
        <span className={c.cuadra ? 'cxl-cuadra-si' : 'cxl-cuadra-no'}>Activo = PN + Pasivo · {c.cuadra ? '✓' : '✗'} {eurosExactos(Math.abs(c.diferencia))}</span>
      </div>
      {!c.cuadra && <p className="cxl-sin-sitio" role="alert">{c.porque}</p>}
      {r.sinSitio.length > 0 && <SinSitio r={r} />}
    </>
  )
}

function SinSitio({ r }: { r: ResultadoEstado }) {
  return (
    <div className="cxl-sin-sitio" role="alert">
      <strong>Sin sitio en el modelo:</strong> {r.sinSitio.map((s) => `${s.code} ${s.name} (${eurosExactos(s.saldo)})`).join(' · ')}.
      {' '}Con saldo y sin línea no se puede presentar: <Link to={rutaLibros('anuales', 'mapeo')}>dile dónde va</Link>.
    </div>
  )
}

function BarraIa({ calc, estado, modelo, plantilla }: {
  calc: { actual: ResultadoEstado; pyg: ResultadoEstado; bal: ResultadoEstado | null }; estado: string; modelo: Modelo; plantilla: number; anterior: null
}) {
  const notas: { titulo: string; texto: string; enlace?: { a: string; texto: string } }[] = []
  const cuentas = calc.actual.lineas.flatMap((l) => l.cuentas)
  const clientesNeg = cuentas.filter((c) => c.anomalo && (c.templateCode ?? c.code).startsWith('43'))
  if (clientesNeg.length) {
    const t = clientesNeg.reduce((a, c) => a + c.importe, 0)
    notas.push({ titulo: `Clientes en negativo (${eurosExactos(t)}).`, texto: `Un saldo acreedor en clientes no es normal: suele ser una liquidación asentada dos veces o un cobro sin su venta. Mira la ${clientesNeg[0].code}.`, enlace: { a: rutaMayor(clientesNeg[0].code), texto: 'Ver' } })
  } else {
    const otros = cuentas.filter((c) => c.anomalo)
    if (otros.length) notas.push({ titulo: `${otros.length} ${otros.length === 1 ? 'cuenta con saldo' : 'cuentas con saldo'} del lado contrario.`, texto: `En ámbar en la tabla: ${otros.slice(0, 3).map((c) => c.code).join(', ')}. Puede ser normal (un anticipo) o un apunte en la cuenta equivocada.` })
  }
  if (calc.bal) {
    const pn = calc.bal.lineas.find((l) => l.code === 'PNP.A')?.importe ?? 0
    const capital = calc.bal.lineas.find((l) => l.code === 'PNP.A.A1.I')?.importe ?? 0
    if (pn < 0) notas.push({ titulo: 'Patrimonio neto negativo.', texto: 'Con las pérdidas del año el patrimonio queda por debajo de cero. Si sigue así al cierre, la LSC (art. 363.1.e) obliga a reequilibrarlo. Tu asesora lo ve también.' })
    else if (capital > 0 && pn < capital / 2) notas.push({ titulo: 'Patrimonio neto por debajo de la mitad del capital.', texto: 'Es causa de disolución si sigue así al cierre (LSC art. 363.1.e), salvo que se aumente o reduzca el capital. Solo es un aviso.' })
  }
  const otrosRes = calc.pyg.lineas.find((l) => l.code === 'OR')
  if (otrosRes && otrosRes.cuentas.length) notas.push({ titulo: 'Hay «Otros resultados».', texto: 'La memoria tiene que explicarlos (norma de elaboración de la PyG). Queda apuntado para la memoria (C05b).' })
  if (calc.actual.sinSitio.length) notas.push({ titulo: `${calc.actual.sinSitio.length} ${calc.actual.sinSitio.length === 1 ? 'cuenta' : 'cuentas'} sin sitio en el modelo.`, texto: 'Salen en rojo debajo, con su saldo. Sin línea no se puede presentar.', enlace: { a: rutaLibros('anuales', 'mapeo'), texto: 'Colocar' } })
  const defecto = calc.actual.porDefecto.length
  if (defecto) notas.push({ titulo: `${defecto} ${defecto === 1 ? 'cuenta colocada' : 'cuentas colocadas'} por defecto.`, texto: 'El modelo no las nombra: van con su hermana más parecida. Revísalas.', enlace: { a: rutaLibros('anuales', 'mapeo'), texto: 'Completar' } })
  if (calc.bal || estado === 'pyg') {
    const activo = calc.bal ? calc.bal.lineas.filter((l) => l.side === 'activo' && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0) : 0
    const cifra = calc.pyg.lineas.find((l) => l.code === '1')?.importe ?? 0
    if (calc.bal) {
      const p = modeloPropuesto({ activo, cifraNegocios: cifra, plantillaMedia: plantilla }, null)
      notas.push({ titulo: `Modelo ${modelo}.`, texto: p.frase, enlace: { a: rutaLibros('anuales', 'cuentas-anuales'), texto: 'Cómo se decide' } })
    }
  }
  if (estado === 'pyg' && calc.bal === null) {
    const r = resultadoTresCifras(calc.pyg, calc.pyg, 0)
    notas.push({ titulo: `Resultado ${r.pyg >= 0 ? 'positivo' : 'negativo'}: ${eurosExactos(r.pyg)}.`, texto: 'Es la misma cifra que sale en el balance como resultado del ejercicio; al regularizar pasa a la 129.' })
  }
  return (
    <section className="cxl-ia" aria-label="Lo que veo">
      <div className="cxl-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Lo que veo{estado === 'balance' ? ' en este balance' : ''}</div>
      {notas.length === 0 ? <div>Nada fuera de lo normal: todo tiene su sitio y los saldos están del lado que toca.</div>
        : notas.slice(0, 3).map((n) => <div key={n.titulo}><strong>{n.titulo}</strong> {n.texto} {n.enlace && <Link to={n.enlace.a}>{n.enlace.texto}</Link>}</div>)}
    </section>
  )
}

function PorLocal({ saldos, lineas, mapeo, total, repartido }: {
  saldos: SaldoConLocal[]; lineas: Parameters<typeof calcularEstado>[1]; mapeo: Parameters<typeof calcularEstado>[2]; total: ResultadoEstado
  repartido: { locationId: string | null; resultado: number }[] | null
}) {
  const L = useLibros()
  const grupos = new Map<string | null, SaldoCuenta[]>()
  for (const s of saldos) { const k = s.locationId; grupos.set(k, [...(grupos.get(k) ?? []), aSaldoCuenta(s, 'pyg')]) }
  // Todos los locales de la empresa, aunque no tengan apuntes (regla 7: un
  // local a cero sale a cero, no desaparece), los que traigan los saldos y no
  // estén en la lista, y «Común» al final.
  const columnas: (string | null)[] = [...L.locales.map((x) => x.id), ...[...grupos.keys()].filter((k): k is string => k !== null && !L.locales.some((x) => x.id === k)), null]
  const res = new Map(columnas.map((k) => [k, calcularEstado('pyg', lineas, mapeo, grupos.get(k) ?? [])]))
  const nombre = (k: string | null) => (k === null ? 'Común' : L.locales.find((x) => x.id === k)?.nombre ?? 'Local sin nombre')
  const visibles = total.lineas.filter((l) => !l.oculta && (l.isTotal || l.level <= 2))
  const sumaLocales = (code: string) => Math.round(columnas.reduce((a, k) => a + Math.round((res.get(k)!.lineas.find((x) => x.code === code)?.importe ?? 0) * 100), 0)) / 100
  const cuadra = visibles.every((l) => Math.round(sumaLocales(l.code) * 100) === Math.round(l.importe * 100))
  if (!saldos.length) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay resultado en este periodo." explicacion="Cuando haya ventas y gastos asentados, sale aquí por local." /></div>
  return (
    <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
      <table className="cxl-tabla" aria-label="Pérdidas y ganancias por local">
        <thead><tr><th>Línea</th>{columnas.map((k) => <th key={String(k)} className="cxl-der">{nombre(k)}</th>)}<th className="cxl-der">Total</th></tr></thead>
        <tbody>
          {visibles.map((l) => (
            <tr key={l.code}><td className={l.isTotal ? 'cxl-total' : `cxl-n${l.level}`}>{l.text}</td>
              {columnas.map((k) => <td key={String(k)} className="cxl-der">{eurosExactos(res.get(k)!.lineas.find((x) => x.code === l.code)?.importe ?? 0)}</td>)}
              <td className="cxl-der"><strong>{eurosExactos(l.importe)}</strong></td></tr>
          ))}
        </tbody>
        {repartido && <tfoot><tr><td>Resultado con lo común repartido (tu regla)</td>
          {columnas.map((k) => <td key={String(k)} className="cxl-der">{k === null ? '—' : eurosExactos(repartido.find((x) => x.locationId === k)?.resultado ?? 0)}</td>)}
          <td className="cxl-der">{eurosExactos(repartido.reduce((a, x) => a + x.resultado, 0))}</td></tr></tfoot>}
      </table>
      <p className={cuadra ? 'cxl-pie' : 'cxl-sin-sitio'} role="status">{cuadra ? 'Las columnas suman el total al céntimo.' : 'Las columnas no suman el total: revisa los apuntes sin local ni «común».'}</p>
    </div>
  )
}

/**
 * Cambios en el patrimonio neto. El estado total es una matriz por columna de
 * patrimonio: saldo al empezar el ejercicio (apertura), lo que ha cambiado y
 * el saldo a la fecha. En pymes no hay estado de ingresos y gastos aparte.
 */
function Ecpn({ d }: { d: { modelo: Modelo; lineas: Parameters<typeof calcularEstado>[1]; mapeo: { serie: Parameters<typeof mapeoEfectivo>[0]; propio: Parameters<typeof mapeoEfectivo>[1] }; saldos: SaldoConLocal[] } }) {
  const mapeo = mapeoEfectivo(d.mapeo.serie, d.mapeo.propio)
  const inicio = calcularEstado('balance', d.lineas, mapeo, d.saldos.map((s) => ({ code: s.code, name: s.name, templateCode: s.templateCode, debe: s.aperturaDebe, haber: s.aperturaHaber })))
  const fin = calcularEstado('balance', d.lineas, mapeo, d.saldos.map((s) => aSaldoCuenta(s, 'balance')))
  const pn = fin.lineas.filter((l) => l.code.startsWith('PNP.A') && l.level <= 3 && !l.oculta)
  return (
    <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
      <table className="cxl-tabla" aria-label="Estado de cambios en el patrimonio neto">
        <thead><tr><th>Patrimonio neto</th><th className="cxl-der">Al empezar</th><th className="cxl-der">Cambios</th><th className="cxl-der">A la fecha</th></tr></thead>
        <tbody>
          {pn.map((l) => {
            const a = inicio.lineas.find((x) => x.code === l.code)?.importe ?? 0
            return <tr key={l.code}><td className={`cxl-n${l.level}`}>{l.text}</td><td className="cxl-der">{eurosExactos(a)}</td><td className="cxl-der">{eurosExactos(l.importe - a)}</td><td className="cxl-der">{eurosExactos(l.importe)}</td></tr>
          })}
        </tbody>
      </table>
      <p className="cxl-pie">{d.modelo === 'pymes' ? 'El PGC de pymes no tiene estado de ingresos y gastos reconocidos aparte: el estado de cambios en el patrimonio neto es esta matriz.' : 'El estado de ingresos y gastos reconocidos (grupos 8 y 9) sale cuando la empresa tenga apuntes en ellos.'} Los movimientos salen de las cuentas del grupo 1 y de la 129.</p>
    </div>
  )
}
