// src/modules/conta/libros/SumasSaldos.tsx
//
// C05 · Sumas y saldos con niveles (grupo, subgrupo, cuenta, subcuenta) como
// píldoras y las siete opciones de Diez como casillas en una línea (saldos a
// 0, periodo, acumulado, saldo inicial, apertura, PyG, cierre), más rango de
// cuentas y salida a pantalla, PDF o Excel (respuesta 1). Los totales de Debe
// y Haber cuadran; cada nivel suma a sus hijos (regla 5). Y Acumulados: el
// saldo de cada cuenta mes a mes.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaMayor } from '@/config/navegacion'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { OPCIONES_POR_DEFECTO, filasQueNoSuman, sumasYSaldos, totales, type Nivel, type OpcionesSumas } from '@/modules/conta/lib/sumasSaldos'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla } from '@/modules/conta/libros/exportar'
import { saldosCuentas } from '@/modules/conta/services/librosService'
import { tabla, mensaje } from '@/modules/conta/services/bd'

const NIVELES: { id: Nivel; texto: string }[] = [
  { id: 'grupo', texto: 'Grupo' }, { id: 'subgrupo', texto: 'Subgrupo' }, { id: 'cuenta', texto: 'Cuenta' }, { id: 'subcuenta', texto: 'Subcuenta' },
]
const OPCIONES: { id: keyof OpcionesSumas; texto: string }[] = [
  { id: 'saldosACero', texto: 'Saldos a 0' }, { id: 'soloPeriodo', texto: 'Solo el periodo' }, { id: 'saldoInicial', texto: 'Saldo inicial' },
  { id: 'apertura', texto: 'Apertura' }, { id: 'pyg', texto: 'PyG (regularización)' }, { id: 'cierre', texto: 'Cierre' },
]

export function SumasSaldos() {
  const L = useLibros()
  const [desde, setDesde] = useState(L.ejercicio.inicio)
  const [hasta, setHasta] = useState(L.ejercicio.fin)
  const [niveles, setNiveles] = useState<Nivel[]>(['grupo', 'subcuenta'])
  const [o, setO] = useState<OpcionesSumas>(OPCIONES_POR_DEFECTO)
  const [rango, setRango] = useState({ desde: '', hasta: '' })
  const [hecho, setHecho] = useState<string | null>(null)
  const d = useLeer(() => saldosCuentas(L.companyId, desde, hasta), `${L.companyId}:${desde}:${hasta}:${L.vuelta}`)
  const opciones = { ...o, desdeCuenta: rango.desde || undefined, hastaCuenta: rango.hasta || undefined }
  const filas = useMemo(() => (d.datos ? sumasYSaldos(d.datos, niveles.length ? niveles : ['subcuenta'], opciones) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.datos, niveles, o, rango])
  const nivelTotal = (['grupo', 'subgrupo', 'cuenta', 'subcuenta'] as Nivel[]).find((n) => niveles.includes(n)) ?? 'subcuenta'
  const t = totales(filas, nivelTotal)
  const malSumadas = filasQueNoSuman(filas)
  const conInicial = o.soloPeriodo && o.saldoInicial
  const cab = ['Cuenta', ...(conInicial ? ['Inicial'] : []), 'Debe', 'Haber', 'Saldo']
  const exportar = (como: 'pdf' | 'excel') => {
    const filasX = filas.map((f) => [`${f.code} ${f.name}`.trim(), ...(conInicial ? [f.inicial] : []), f.debe, f.haber, f.saldo])
    const nombre = `Sumas y saldos ${L.ejercicio.code} ${desde} a ${hasta}`
    const ok = como === 'pdf' ? pdfTabla(`${nombre}.pdf`, 'Sumas y saldos', `Del ${desde} al ${hasta} · ${niveles.join(', ')}`, cab, filasX) : excelTabla(`${nombre}.xlsx`, 'Sumas y saldos', cab, filasX)
    setHecho(ok ? `Bajado: ${nombre}, ${filas.length} filas. Debe ${eurosExactos(t.debe)} · Haber ${eurosExactos(t.haber)}.` : 'No había nada que bajar con estas opciones.')
  }

  return (
    <section className="cxl-pagina" aria-label="Sumas y saldos">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Mayor y saldos' }]} /><h2>Sumas y saldos</h2></div>
        <div className="cxl-herramientas">
          <label className="cx-campo"><span className="cx-etiqueta">Desde</span><input className="cx-input" type="date" value={desde} min={L.ejercicio.inicio} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="cx-campo"><span className="cx-etiqueta">Hasta</span><input className="cx-input" type="date" value={hasta} min={desde} max={L.ejercicio.fin} onChange={(e) => setHasta(e.target.value)} /></label>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('pdf')} disabled={!filas.length}>PDF</button>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('excel')} disabled={!filas.length}>Excel</button>
        </div>
      </div>
      <div className="cx-tablas-filtros" role="group" aria-label="Niveles">
        {NIVELES.map((n) => <button key={n.id} type="button" className="cx-pildora" aria-pressed={niveles.includes(n.id)}
          onClick={() => setNiveles(niveles.includes(n.id) ? niveles.filter((x) => x !== n.id) : [...niveles, n.id])}>{n.texto}</button>)}
      </div>
      <div className="cxl-opciones" role="group" aria-label="Opciones">
        {OPCIONES.map((x) => <label key={x.id}><input type="checkbox" checked={Boolean(o[x.id])} onChange={(e) => setO({ ...o, [x.id]: e.target.checked })} /> {x.texto}</label>)}
        <label>Cuentas de <input className="cx-input" style={{ width: 90 }} value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value.replace(/\D/g, '') })} aria-label="Desde la cuenta" /></label>
        <label>a <input className="cx-input" style={{ width: 90 }} value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value.replace(/\D/g, '') })} aria-label="Hasta la cuenta" /></label>
      </div>
      <Guardado texto={hecho} />
      {d.error && <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />}
      {!d.datos && !d.error && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2].map((i) => <Hueso key={i} alto={30} />)}</div>}
      {d.datos && (filas.length === 0
        ? <div className="cx-tarjeta"><Vacio titulo="Sin movimientos con estas opciones." explicacion="Marca «Saldos a 0» para ver también las cuentas saldadas, o cambia el periodo." /></div>
        : (
          <div className="cx-tarjeta">
            <table className="cxl-tabla" aria-label="Sumas y saldos">
              <thead><tr>{cab.map((c, i) => <th key={c} className={i ? 'cxl-der' : undefined}>{c}</th>)}</tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.nivel}:${f.code}`}>
                    <td className={f.nivel === 'grupo' ? 'cxl-n1' : f.nivel === 'subgrupo' ? 'cxl-n2' : f.nivel === 'cuenta' ? 'cxl-n3' : 'cxl-n4'}>
                      {f.nivel === 'subcuenta' ? <Link to={rutaMayor(f.code)}>{f.code} · {f.name}</Link> : <>{f.nivel === 'grupo' ? 'Grupo ' : ''}{f.code}</>}
                    </td>
                    {conInicial && <td className="cxl-der">{eurosExactos(f.inicial)}</td>}
                    <td className="cxl-der">{eurosExactos(f.debe)}</td><td className="cxl-der">{eurosExactos(f.haber)}</td>
                    <td className="cxl-der">{eurosExactos(Math.abs(f.saldo))} {f.saldo > 0 ? 'D' : f.saldo < 0 ? 'H' : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Totales ({nivelTotal})</td>{conInicial && <td className="cxl-der">{eurosExactos(t.inicial)}</td>}
                <td className="cxl-der">{eurosExactos(t.debe)}</td><td className="cxl-der">{eurosExactos(t.haber)}</td><td className="cxl-der">{eurosExactos(t.saldo)}</td></tr></tfoot>
            </table>
            <p className={t.cuadra && !malSumadas.length ? 'cxl-pie' : 'cxl-sin-sitio'} role="status">
              {t.cuadra && !malSumadas.length ? `Cuadra: Debe = Haber (${eurosExactos(t.debe)}) y cada nivel suma a sus hijos.`
                : malSumadas.length ? `No suman a sus hijos: ${malSumadas.join(', ')}.` : rango.desde || rango.hasta ? 'Con un rango de cuentas Debe y Haber no tienen por qué cuadrar.' : `Debe y Haber no cuadran (${eurosExactos(t.debe - t.haber)}).`}
            </p>
          </div>
        ))}
    </section>
  )
}

/** Acumulados: el saldo de cada cuenta al final de cada mes del ejercicio. */
export function Acumulados() {
  const L = useLibros()
  const d = useLeer(async () => {
    const { data, error } = await tabla('journal_ledger').select('account_code, account_name, entry_date, debit, credit')
      .eq('account_id', L.accountId).eq('company_id', L.companyId).gte('entry_date', L.ejercicio.inicio).lte('entry_date', L.ejercicio.fin)
    if (error) throw new Error(mensaje('No se han podido leer los movimientos', error))
    return (data ?? []) as { account_code: string; account_name: string; entry_date: string; debit: number; credit: number }[]
  }, `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  const meses = useMemo(() => {
    const r: string[] = []
    let y = Number(L.ejercicio.inicio.slice(0, 4)); let m = Number(L.ejercicio.inicio.slice(5, 7))
    while (`${y}-${String(m).padStart(2, '0')}` <= L.ejercicio.fin.slice(0, 7)) { r.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
    return r
  }, [L.ejercicio])
  const filas = useMemo(() => {
    if (!d.datos) return []
    const m = new Map<string, { nombre: string; mov: Map<string, number> }>()
    for (const x of d.datos) {
      const f = m.get(x.account_code) ?? { nombre: x.account_name, mov: new Map() }
      const mes = x.entry_date.slice(0, 7)
      f.mov.set(mes, (f.mov.get(mes) ?? 0) + Math.round(Number(x.debit) * 100) - Math.round(Number(x.credit) * 100))
      m.set(x.account_code, f)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, f]) => {
      let acc = 0
      return { code, nombre: f.nombre, saldos: meses.map((mes) => { acc += f.mov.get(mes) ?? 0; return acc / 100 }) }
    })
  }, [d.datos, meses])
  return (
    <section className="cxl-pagina" aria-label="Acumulados">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Mayor y saldos' }]} /><h2>Acumulados</h2></div></div>
      {d.error && <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />}
      {!d.datos && !d.error && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={30} /></div>}
      {d.datos && (filas.length === 0
        ? <div className="cx-tarjeta"><Vacio titulo="Aún no hay movimientos en el ejercicio." explicacion="Cuando haya asientos validados, aquí sale el saldo de cada cuenta al final de cada mes." /></div>
        : (
          <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
            <table className="cxl-tabla" aria-label="Saldo de cada cuenta al final de cada mes">
              <thead><tr><th>Cuenta</th>{meses.map((m) => <th key={m} className="cxl-der">{m.slice(5)}/{m.slice(2, 4)}</th>)}</tr></thead>
              <tbody>{filas.map((f) => <tr key={f.code}><td><Link to={rutaMayor(f.code)}>{f.code}</Link><span className="cxl-apoyo">{f.nombre}</span></td>
                {f.saldos.map((s, i) => <td key={i} className="cxl-der">{s === 0 ? '—' : eurosExactos(s)}</td>)}</tr>)}</tbody>
            </table>
            <p className="cxl-pie">Saldo deudor en positivo y acreedor en negativo, al cierre de cada mes, desde el primer día del ejercicio.</p>
          </div>
        ))}
    </section>
  )
}
