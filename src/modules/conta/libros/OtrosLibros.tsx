// src/modules/conta/libros/OtrosLibros.tsx
//
// C05 · Los otros libros del área «Libros registro de IVA»:
//   · Bienes de inversión (art. 65 RIVA): el registro de los bienes con su
//     cuota deducible, con alta a mano (lo que vino de una factura entra solo
//     cuando su anotación lleva «bien de inversión»).
//   · Retenciones: lo retenido por modelo (111, 115…) y trimestre, con sus
//     apuntes. Es lo que luego declara el modelo; aquí no se presenta nada.
//   · Suplidos: el mayor de las cuentas que la empresa marcó como suplidos
//     (C03). Sin cuentas marcadas, lo dice y explica dónde se marcan.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaFichaTercero, rutaLibros, rutaPlan } from '@/config/navegacion'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { extracto } from '@/modules/conta/lib/extractos'
import { trimestre } from '@/modules/conta/lib/libroRegistro'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla } from '@/modules/conta/libros/exportar'
import { altaBien, cuentasDeSuplidos, leerBienes, movimientos, retenciones, type BienInversion } from '@/modules/conta/services/librosService'

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const c = (n: number) => Math.round(n * 100)

// ── Bienes de inversión ─────────────────────────────────────────────────────

export function BienesInversion() {
  const L = useLibros()
  const [alta, setAlta] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const d = useLeer(() => leerBienes(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  const exportar = () => {
    const filas = (d.datos ?? []).map((b) => [b.descripcion, b.tipo, ddmm(b.alta), b.inicioUso ? ddmm(b.inicioUso) : '', b.valor, b.base, b.tipoIva, b.cuota, b.deducible, b.baja ? ddmm(b.baja) : ''])
    const ok = excelTabla(`Bienes de inversión ${L.ejercicio.code}.xlsx`, 'Bienes de inversión', ['Bien', 'Tipo', 'Alta', 'Inicio de uso', 'Valor', 'Base', '% IVA', 'Cuota', '% deducible', 'Baja'], filas)
    setHecho(ok ? `Bajado: Bienes de inversión ${L.ejercicio.code}.xlsx, ${filas.length} bienes.` : 'No había nada que bajar: aún no hay bienes de inversión.')
  }
  return (
    <section className="cxl-pagina" aria-label="Bienes de inversión">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libros registro de IVA' }]} /><h2>Bienes de inversión</h2></div>
        <div className="cxl-herramientas">
          <button type="button" className="cx-boton" onClick={() => setAlta(true)}>Dar de alta un bien</button>
          <button type="button" className="cx-boton-sec" onClick={exportar} disabled={!d.datos}>Excel</button>
        </div>
      </div>
      <Guardado texto={hecho} />
      <p className="cxl-apoyo">Bienes cuyo IVA se regulariza durante 5 años (muebles) o 10 (inmuebles) si cambia la prorrata (arts. 107–110 LIVA; libro del art. 65 RIVA). Solo los que superan 3.005,06 € (art. 108 LIVA).</p>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.length && <div className="cx-tarjeta"><Vacio titulo="Aún no hay bienes de inversión." explicacion="Al dar de alta uno queda en este libro y en la hoja BIENES-INVERSIÓN del formato AEAT." /></div>}
      {d.datos && d.datos.length > 0 && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <table className="cxl-tabla" aria-label="Bienes de inversión">
            <thead><tr><th>Bien</th><th>Alta</th><th>Inicio de uso</th><th className="cxl-der">Base</th><th className="cxl-der">Cuota</th><th className="cxl-der">Deducible</th><th>Regulariza hasta</th></tr></thead>
            <tbody>{d.datos.map((b) => {
              const anios = b.tipo === 'inmueble' ? 10 : 5
              const inicio = Number((b.inicioUso ?? b.alta).slice(0, 4))
              return (
                <tr key={b.id} className={b.baja ? 'cxl-anulada' : undefined}><td>{b.descripcion}<br /><span className="cxl-apoyo">{b.tipo}{b.baja ? ` · baja el ${ddmm(b.baja)}` : ''}</span></td>
                  <td>{ddmm(b.alta)}</td><td>{b.inicioUso ? ddmm(b.inicioUso) : '—'}</td><td className="cxl-der">{eurosExactos(b.base)}</td>
                  <td className="cxl-der">{eurosExactos(b.cuota)}{b.tipoIva !== null ? ` (${b.tipoIva} %)` : ''}</td><td className="cxl-der">{b.deducible} %</td><td>{inicio + anios - 1}</td></tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      {alta && <AltaBien alCerrar={() => setAlta(false)} alGuardar={(t) => { setAlta(false); setHecho(t); d.recargar() }} />}
    </section>
  )
}

function AltaBien({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (t: string) => void }) {
  const L = useLibros()
  const [b, setB] = useState({ descripcion: '', tipo: 'mueble' as BienInversion['tipo'], alta: L.ejercicio.inicio, inicioUso: '', base: '', tipoIva: '21', deducible: '100' })
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const n = (s: string) => Number(s.replace(',', '.'))
  const base = n(b.base); const tipo = n(b.tipoIva); const cuota = Math.round(base * tipo) / 100
  async function guardar() {
    if (!b.descripcion.trim()) { setError('Pon qué bien es.'); return }
    if (!(base > 0)) { setError('La base tiene que ser mayor que cero.'); return }
    setOcupado(true); setError(null)
    try {
      await altaBien(L.accountId, L.companyId, { descripcion: b.descripcion.trim(), tipo: b.tipo, alta: b.alta, inicioUso: b.inicioUso || null, valor: Math.round((base + cuota) * 100) / 100, base, tipoIva: tipo, cuota, deducible: n(b.deducible) }, L.quien)
      alGuardar(`Alta de «${b.descripcion.trim()}»: ${eurosExactos(base)} de base y ${eurosExactos(cuota)} de IVA; regulariza hasta ${Number((b.inicioUso || b.alta).slice(0, 4)) + (b.tipo === 'inmueble' ? 9 : 4)}.${base <= 3005.06 ? ' Ojo: no pasa de 3.005,06 €, así que para el IVA no es bien de inversión (art. 108 LIVA).' : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido dar de alta.') } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo="Dar de alta un bien de inversión" alCerrar={alCerrar}>
      <label>Bien<input className="cx-input" value={b.descripcion} onChange={(e) => setB({ ...b, descripcion: e.target.value })} placeholder="Horno mixto de 10 bandejas" /></label>
      <label>Tipo<select className="cx-input" value={b.tipo} onChange={(e) => setB({ ...b, tipo: e.target.value as BienInversion['tipo'] })}><option value="mueble">Mueble (5 años)</option><option value="inmueble">Inmueble (10 años)</option></select></label>
      <label>Fecha de compra<input type="date" className="cx-input" value={b.alta} onChange={(e) => setB({ ...b, alta: e.target.value })} /></label>
      <label>Empieza a usarse<input type="date" className="cx-input" value={b.inicioUso} onChange={(e) => setB({ ...b, inicioUso: e.target.value })} /></label>
      <label>Base imponible<input className="cx-input" inputMode="decimal" value={b.base} onChange={(e) => setB({ ...b, base: e.target.value })} /></label>
      <label>% IVA<input className="cx-input" inputMode="decimal" value={b.tipoIva} onChange={(e) => setB({ ...b, tipoIva: e.target.value })} /></label>
      <label>% deducible (prorrata)<input className="cx-input" inputMode="decimal" value={b.deducible} onChange={(e) => setB({ ...b, deducible: e.target.value })} /></label>
      <p className="cxl-apoyo">Cuota: {eurosExactos(cuota)}.</p>
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Dar de alta'}</button>
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}

// ── Retenciones ─────────────────────────────────────────────────────────────

export function Retenciones() {
  const L = useLibros()
  const d = useLeer(() => retenciones(L.accountId, L.companyId, L.ejercicio.inicio, L.ejercicio.fin), `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  const grupos = useMemo(() => {
    const m = new Map<string, { modelo: string; t: string; base: number; importe: number; apuntes: number }>()
    for (const r of d.datos ?? []) {
      const k = `${r.modelo}·${trimestre(r.fecha)}`
      const g = m.get(k) ?? { modelo: r.modelo, t: trimestre(r.fecha), base: 0, importe: 0, apuntes: 0 }
      g.base = (c(g.base) + c(r.base)) / 100; g.importe = (c(g.importe) + c(r.importe)) / 100; g.apuntes++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.t.localeCompare(b.t))
  }, [d.datos])
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Retenciones">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libros registro de IVA' }]} /><h2>Retenciones</h2></div></div>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.length && <div className="cx-tarjeta"><Vacio titulo={`Sin retenciones en ${L.ejercicio.code}.`} explicacion="Salen aquí los apuntes con retención (alquiler, profesionales, nóminas) en cuanto se validen sus asientos." /></div>}
      {grupos.length > 0 && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <table className="cxl-tabla" aria-label="Retenciones por modelo y trimestre">
            <thead><tr><th>Modelo</th><th>Trimestre</th><th className="cxl-der">Apuntes</th><th className="cxl-der">Base</th><th className="cxl-der">Retenido</th></tr></thead>
            <tbody>{grupos.map((g) => <tr key={`${g.modelo}${g.t}`}><td>{g.modelo}</td><td>{g.t}</td><td className="cxl-der">{g.apuntes}</td><td className="cxl-der">{eurosExactos(g.base)}</td><td className="cxl-der">{eurosExactos(g.importe)}</td></tr>)}</tbody>
          </table>
          <h3 className="cxl-subtitulo">Apuntes</h3>
          <table className="cxl-tabla" aria-label="Apuntes con retención">
            <thead><tr><th>Fecha</th><th>Modelo</th><th>Concepto</th><th className="cxl-der">Base</th><th className="cxl-der">Retenido</th></tr></thead>
            <tbody>{d.datos!.map((r, i) => <tr key={`${r.entryId}${i}`}><td><Link to={rutaAsiento(r.entryId)}>{ddmm(r.fecha)}</Link></td><td>{r.modelo}</td>
              <td>{r.terceroId ? <Link to={rutaFichaTercero(r.terceroId)}>{r.concepto}</Link> : r.concepto}</td><td className="cxl-der">{eurosExactos(r.base)}</td><td className="cxl-der">{eurosExactos(r.importe)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Suplidos ────────────────────────────────────────────────────────────────

export function Suplidos() {
  const L = useLibros()
  const d = useLeer(async () => {
    const cuentas = await cuentasDeSuplidos(L.accountId, L.companyId)
    const ms = (await Promise.all(cuentas.map((x) => movimientos(L.accountId, L.companyId, L.ejercicio.inicio, L.ejercicio.fin, x.code)))).flat()
    return { cuentas, ms }
  }, `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Suplidos">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libros registro de IVA' }]} /><h2>Suplidos</h2></div></div>
      <p className="cxl-apoyo">Lo que se paga en nombre de un cliente y se le repercute sin IVA (art. 78.Tres.3.º LIVA). No es ingreso ni gasto: va a una cuenta de tercero y no entra en el libro de expedidas.</p>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.cuentas.length && <div className="cx-tarjeta"><Vacio titulo="No hay cuentas de suplidos." explicacion="Se marcan en la ficha del tercero (cuenta con papel «suplidos») o en el plan contable." accion={<Link to={rutaPlan()} className="cx-boton-sec">Ir al plan</Link>} /></div>}
      {d.datos?.cuentas.map((cu) => {
        const x = extracto(d.datos!.ms.filter((m) => m.cuenta === cu.code), { desde: L.ejercicio.inicio, hasta: L.ejercicio.fin })
        return (
          <div key={cu.code} className="cx-tarjeta" style={{ overflowX: 'auto' }}>
            <h3 className="cxl-subtitulo">{cu.code} · {cu.name} <Link to={`${rutaLibros('mayor', 'libro-mayor')}?cuenta=${cu.code}`} className="cx-enlace">Mayor</Link></h3>
            {!x.filas.length ? <p className="cxl-pie">Sin movimientos en {L.ejercicio.code}.</p> : (
              <table className="cxl-tabla" aria-label={`Suplidos en la ${cu.code}`}>
                <thead><tr><th>Fecha</th><th>Concepto</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th><th className="cxl-der">Saldo</th></tr></thead>
                <tbody>{x.filas.map((m, i) => <tr key={`${m.entryId}${i}`}><td><Link to={rutaAsiento(m.entryId)}>{ddmm(m.fecha)}</Link></td><td>{m.concepto}</td><td className="cxl-der">{m.debe ? eurosExactos(m.debe) : ''}</td><td className="cxl-der">{m.haber ? eurosExactos(m.haber) : ''}</td><td className="cxl-der">{eurosExactos(m.saldo)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )
      })}
    </section>
  )
}
