// src/modules/conta/libros/LibroMayor.tsx
//
// C05 · El libro mayor dentro de Libros: eliges la cuenta (o un nivel: «400»
// trae todas sus subcuentas) y el periodo, y sale el extracto con su saldo
// inicial (lo de antes del periodo, apertura incluida) y el saldo arrastrado
// fila a fila. Filtros de local y marca (regla 10): el saldo inicial se filtra
// igual, para que el arrastre no mezcle. Cada apunte lleva a su asiento; la
// cuenta, a su ficha del plan (Mayor de la cuenta, C02).

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaMayor } from '@/config/navegacion'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { extracto } from '@/modules/conta/lib/extractos'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { cuentasConSaldo, movimientos } from '@/modules/conta/services/librosService'

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const SERIES: Record<number, string> = { 1: 'Ventas', 2: 'Compras', 3: 'Bancos', 4: 'General' }
const textoSaldo = (n: number) => (Math.round(n * 100) === 0 ? '0,00 €' : `${eurosExactos(Math.abs(n))} ${n > 0 ? 'D' : 'H'}`)

export function LibroMayor() {
  const L = useLibros()
  const [params, setParams] = useSearchParams()
  const cuenta = params.get('cuenta') ?? ''
  const [desde, setDesde] = useState(L.ejercicio.inicio)
  const [hasta, setHasta] = useState(L.ejercicio.fin)
  const [local, setLocal] = useState<string>('')
  const [marca, setMarca] = useState<string>('')
  const [hecho, setHecho] = useState<string | null>(null)

  const cuentas = useLeer(() => cuentasConSaldo(L.companyId, L.ejercicio.inicio, L.ejercicio.fin), `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  const d = useLeer(cuenta ? () => movimientos(L.accountId, L.companyId, L.ejercicio.inicio, hasta, cuenta) : null, `${L.companyId}:${L.ejercicio.id}:${cuenta}:${hasta}:${L.vuelta}`)
  const x = useMemo(() => (d.datos ? extracto(d.datos, {
    desde, hasta,
    localId: local === '' ? undefined : local === 'comun' ? null : local,
    marcaId: marca === '' ? undefined : marca === 'sin' ? null : marca,
    soloComun: local === 'comun',
  }) : null), [d.datos, desde, hasta, local, marca])

  const elegir = (c: string) => { const p = new URLSearchParams(params); if (c) p.set('cuenta', c); else p.delete('cuenta'); setParams(p, { replace: true }) }
  const nombreCuenta = cuentas.datos?.find((c) => c.code === cuenta)?.name ?? (cuenta.length < 4 ? `Nivel ${cuenta}` : '')
  const filtrosTexto = [local === 'comun' ? 'solo lo común' : local ? L.locales.find((l) => l.id === local)?.nombre : null, marca === 'sin' ? 'sin marca' : marca ? L.marcas.find((m) => m.id === marca)?.nombre : null].filter(Boolean).join(' · ')

  const exportar = (como: 'pdf' | 'excel') => {
    if (!x) return
    const cab = ['Fecha', 'Asiento', 'Cuenta', 'Concepto', 'Debe', 'Haber', 'Saldo']
    const filas: FilaTabla[] = [
      [ddmm(desde), '', cuenta, 'Saldo inicial', null, null, x.inicial],
      ...x.filas.map((m): FilaTabla => [ddmm(m.fecha), m.numero === null ? '' : `${SERIES[m.serie] ?? m.serie} ${m.numero}`, m.cuenta, m.concepto, m.debe || null, m.haber || null, m.saldo]),
      ['', '', '', 'Sumas del periodo', x.debe, x.haber, x.final],
    ]
    const nombre = `Mayor ${cuenta} ${ddmm(desde).replace(/\//g, '-')} a ${ddmm(hasta).replace(/\//g, '-')}`
    const ok = como === 'pdf'
      ? pdfTabla(`${nombre}.pdf`, `Mayor de la ${cuenta} ${nombreCuenta}`, `Del ${ddmm(desde)} al ${ddmm(hasta)}${filtrosTexto ? ` · ${filtrosTexto}` : ''}`, cab, filas)
      : excelTabla(`${nombre}.xlsx`, `Mayor ${cuenta}`, cab, filas)
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${x.filas.length} apuntes; saldo final ${textoSaldo(x.final)}.` : 'No había nada que bajar.')
  }

  return (
    <section className="cxl-pagina" aria-label="Libro mayor">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Mayor y saldos' }]} /><h2>Libro mayor</h2></div>
        <div className="cxl-herramientas">
          <button type="button" className="cx-boton-sec" onClick={() => exportar('pdf')} disabled={!x}>Exportar PDF</button>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('excel')} disabled={!x}>Excel</button>
        </div>
      </div>
      <div className="cx-tarjeta cxl-opciones">
        <label>Cuenta
          <input className="cx-input" list="cxl-cuentas" value={cuenta} placeholder="57200001 o 400" inputMode="numeric"
            onChange={(e) => elegir(e.target.value.replace(/\D/g, ''))} aria-describedby="cxl-cuenta-ayuda" />
          <datalist id="cxl-cuentas">{cuentas.datos?.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
        </label>
        <label>Desde<input type="date" className="cx-input" value={desde} min={L.ejercicio.inicio} max={hasta} onChange={(e) => setDesde(e.target.value || L.ejercicio.inicio)} /></label>
        <label>Hasta<input type="date" className="cx-input" value={hasta} min={desde} max={L.ejercicio.fin} onChange={(e) => setHasta(e.target.value || L.ejercicio.fin)} /></label>
        {L.locales.length > 0 && (
          <label>Local<select className="cx-input" value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Todos</option>{L.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}<option value="comun">Solo lo común</option>
          </select></label>
        )}
        {L.marcas.length > 0 && (
          <label>Marca<select className="cx-input" value={marca} onChange={(e) => setMarca(e.target.value)}>
            <option value="">Todas</option>{L.marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}<option value="sin">Sin marca</option>
          </select></label>
        )}
        <p id="cxl-cuenta-ayuda" className="cxl-apoyo">Una cuenta de apunte, o un nivel («400», «57») para ver todas las de dentro juntas.</p>
      </div>
      <Guardado texto={hecho} />
      {cuentas.error && <ErrorConReintento mensaje={cuentas.error} reintentar={cuentas.recargar} />}
      {d.error && <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />}
      {!cuenta && <div className="cx-tarjeta"><Vacio titulo="Elige una cuenta." explicacion={cuentas.datos ? `Hay ${cuentas.datos.length} cuentas con movimiento o saldo en ${L.ejercicio.code}.` : 'Escribe su número o elígela de la lista.'} /></div>}
      {cuenta && !x && !d.error && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2].map((i) => <Hueso key={i} alto={32} />)}</div>}
      {cuenta && x && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <h3 className="cxl-subtitulo">{cuenta} · {nombreCuenta} {cuenta.length >= 4 && <Link to={rutaMayor(cuenta)} className="cx-enlace">Ficha de la cuenta</Link>}</h3>
          {filtrosTexto && <p className="cxl-apoyo">Filtrado: {filtrosTexto}. El saldo inicial está filtrado igual.</p>}
          <table className="cxl-tabla" aria-label={`Mayor de la ${cuenta}`}>
            <thead><tr><th>Fecha</th><th>Asiento</th>{cuenta.length < 4 && <th>Cuenta</th>}<th>Concepto</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th><th className="cxl-der">Saldo</th></tr></thead>
            <tbody>
              <tr><td>{ddmm(desde)}</td><td />{cuenta.length < 4 && <td />}<td><em>Saldo inicial</em>{desde === L.ejercicio.inicio ? ' (apertura)' : ''}</td><td /><td /><td className="cxl-der">{textoSaldo(x.inicial)}</td></tr>
              {x.filas.map((m, i) => (
                <tr key={`${m.entryId}-${i}`}>
                  <td>{ddmm(m.fecha)}</td>
                  <td><Link to={rutaAsiento(m.entryId)}>{m.numero === null ? 'Sin nº' : `${SERIES[m.serie] ?? m.serie} ${m.numero}`}</Link></td>
                  {cuenta.length < 4 && <td>{m.cuenta}</td>}
                  <td>{m.concepto}</td>
                  <td className="cxl-der">{m.debe ? eurosExactos(m.debe) : ''}</td><td className="cxl-der">{m.haber ? eurosExactos(m.haber) : ''}</td>
                  <td className="cxl-der">{textoSaldo(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={cuenta.length < 4 ? 4 : 3} className="cxl-total">Sumas del periodo</td><td className="cxl-der cxl-total">{eurosExactos(x.debe)}</td><td className="cxl-der cxl-total">{eurosExactos(x.haber)}</td><td className="cxl-der cxl-total">{textoSaldo(x.final)}</td></tr></tfoot>
          </table>
          {!x.filas.length && <p className="cxl-pie">Sin apuntes entre el {ddmm(desde)} y el {ddmm(hasta)}: el saldo es el inicial.</p>}
        </div>
      )}
    </section>
  )
}
