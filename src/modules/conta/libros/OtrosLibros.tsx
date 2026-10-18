// src/modules/conta/libros/OtrosLibros.tsx
//
// C05 · Los otros libros del área «Libros registro de IVA»:
//   · Bienes de inversión (art. 65 RIVA): el registro de los bienes con su
//     cuota deducible, con alta a mano (lo que vino de una factura entra solo
//     cuando su anotación lleva «bien de inversión»).
//   · Retenciones: lo retenido por modelo (111, 115…) y trimestre, con sus
//     apuntes. Es lo que luego declara el modelo; aquí no se presenta nada.
//     S01e: no es IVA; va en su propio grupo del menú, con periodo y salida.
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
import { periodosDelEjercicio, useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { cuantas } from '@/modules/conta/lib/plural'
import { altaBien, cuentasDeSuplidos, leerBienes, movimientos, retenciones, type BienInversion } from '@/modules/conta/services/librosService'
import { useImpuestoEmpresa } from '@/modules/conta/hooks/useImpuestoEmpresa'

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const c = (n: number) => Math.round(n * 100)

// ── Bienes de inversión ─────────────────────────────────────────────────────

export function BienesInversion() {
  const L = useLibros()
  // S01e: en Canarias, IGIC (y sin las citas de la ley del IVA, que no son las suyas).
  const imp = useImpuestoEmpresa(L.accountId, L.companyId)
  const [alta, setAlta] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const d = useLeer(() => leerBienes(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  const exportar = () => {
    const filas = (d.datos ?? []).map((b) => [b.descripcion, b.tipo, ddmm(b.alta), b.inicioUso ? ddmm(b.inicioUso) : '', b.valor, b.base, b.tipoIva, b.cuota, b.deducible, b.baja ? ddmm(b.baja) : ''])
    const ok = excelTabla(`Bienes de inversión ${L.ejercicio.code}.xlsx`, 'Bienes de inversión', ['Bien', 'Tipo', 'Alta', 'Inicio de uso', 'Valor', 'Base', imp.columnaTipo, 'Cuota', '% deducible', 'Baja'], filas)
    setHecho(ok ? `Bajado: Bienes de inversión ${L.ejercicio.code}.xlsx, ${filas.length} bienes.` : 'No había nada que bajar: aún no hay bienes de inversión.')
  }
  return (
    <section className="cxl-pagina" aria-label="Bienes de inversión">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: imp.libros }]} /><h2>Bienes de inversión</h2></div>
        <div className="cxl-herramientas">
          <button type="button" className="cx-boton" onClick={() => setAlta(true)}>Dar de alta un bien</button>
          <button type="button" className="cx-boton-sec" onClick={exportar} disabled={!d.datos}>Excel</button>
        </div>
      </div>
      <Guardado texto={hecho} />
      <p className="cxl-apoyo">{imp.ley
        ? 'Bienes cuyo IVA se regulariza durante 5 años (muebles) o 10 (inmuebles) si cambia la prorrata (arts. 107–110 LIVA; libro del art. 65 RIVA). Solo los que superan 3.005,06 € (art. 108 LIVA).'
        : `Bienes cuyo ${imp.nombre} se regulariza durante varios años si cambia la prorrata. ${imp.avisoLey}`}</p>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.length && <div className="cx-tarjeta"><Vacio titulo="Aún no hay bienes de inversión." explicacion="Al dar de alta uno queda en este libro y en la hoja BIENES-INVERSIÓN del formato AEAT." /></div>}
      {d.datos && d.datos.length > 0 && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <table className="cxl-tabla cxl-apilada" aria-label="Bienes de inversión">
            <thead><tr><th>Bien</th><th>Alta</th><th>Inicio de uso</th><th className="cxl-der">Base</th><th className="cxl-der">Cuota</th><th className="cxl-der">Deducible</th><th>Regulariza hasta</th></tr></thead>
            <tbody>{d.datos.map((b) => {
              const anios = b.tipo === 'inmueble' ? 10 : 5
              const inicio = Number((b.inicioUso ?? b.alta).slice(0, 4))
              return (
                <tr key={b.id} className={b.baja ? 'cxl-anulada' : undefined}><td>{b.descripcion}<br /><span className="cxl-apoyo">{b.tipo}{b.baja ? ` · baja el ${ddmm(b.baja)}` : ''}</span></td>
                  <td data-titulo="Alta">{ddmm(b.alta)}</td><td data-titulo="Inicio de uso">{b.inicioUso ? ddmm(b.inicioUso) : '—'}</td><td className="cxl-der" data-titulo="Base">{eurosExactos(b.base)}</td>
                  <td className="cxl-der" data-titulo="Cuota">{eurosExactos(b.cuota)}{b.tipoIva !== null ? ` (${b.tipoIva} %)` : ''}</td><td className="cxl-der" data-titulo="Deducible">{b.deducible} %</td><td data-titulo="Regulariza hasta">{inicio + anios - 1}</td></tr>
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

/** S01e: qué es cada modelo, en llano (antes salía el número solo). */
const MODELOS_RETENCION: Record<string, string> = {
  '111': 'trabajadores y profesionales', '115': 'alquileres', '123': 'intereses y dividendos', '216': 'no residentes',
}
const nombreModelo = (m: string): string => (MODELOS_RETENCION[m] ? `${m} · ${MODELOS_RETENCION[m]}` : m)

export function Retenciones() {
  const L = useLibros()
  // S01e: con periodo y salida, como los demás libros.
  const ps = periodosDelEjercicio(L.ejercicio.inicio, L.ejercicio.fin)
  const hoy = new Date().toISOString().slice(0, 10)
  const [periodo, setPeriodo] = useState(() => (ps.find((p) => p.id !== 'año' && p.desde <= hoy && hoy <= p.hasta) ?? ps[ps.length - 1]).id)
  const p = ps.find((x) => x.id === periodo) ?? ps[ps.length - 1]
  const [hecho, setHecho] = useState<string | null>(null)
  const d = useLeer(() => retenciones(L.accountId, L.companyId, p.desde, p.hasta), `${L.companyId}:${p.desde}:${p.hasta}:${L.vuelta}`)
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
  const exportar = (como: 'pdf' | 'excel') => {
    const filas: FilaTabla[] = (d.datos ?? []).map((r) => [ddmm(r.fecha), nombreModelo(r.modelo), r.cuenta, r.concepto, r.base, r.importe])
    const cab = ['Fecha', 'Modelo', 'Cuenta', 'Concepto', 'Base', 'Retenido']
    const nombre = `Retenciones ${L.ejercicio.code} ${p.nombre}`
    const ok = como === 'pdf'
      ? pdfTabla(`${nombre}.pdf`, 'Retenciones', `${p.nombre} · ${ddmm(p.desde)} a ${ddmm(p.hasta)}`, cab, filas)
      : excelTabla(`${nombre}.xlsx`, 'Retenciones', cab, filas)
    const total = (d.datos ?? []).reduce((a, r) => a + c(r.importe), 0) / 100
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${cuantas(filas.length, 'apunte', 'apuntes')}; retenido ${eurosExactos(total)}.` : `No había nada que bajar: sin retenciones en ${p.nombre === 'Todo el ejercicio' ? L.ejercicio.code : p.nombre}.`)
  }
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Retenciones">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Retenciones' }]} /><h2>Retenciones</h2></div>
        <div className="cxl-herramientas">
          <label><span className="cx-oculto">Periodo</span>
            <select className="cx-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{ps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
          </label>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('pdf')} disabled={!d.datos}>Exportar PDF</button>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('excel')} disabled={!d.datos}>Excel</button>
        </div>
      </div>
      <Guardado texto={hecho} />
      <p className="cxl-apoyo">Lo retenido a otros (nóminas, profesionales, alquileres) que luego se ingresa con el modelo 111 o el 115. Son retenciones de IRPF, no IVA. Aquí no se presenta nada.</p>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.length && <div className="cx-tarjeta"><Vacio titulo={`Sin retenciones en ${p.nombre === 'Todo el ejercicio' ? L.ejercicio.code : p.nombre}.`} explicacion="Salen aquí los apuntes con retención (alquiler, profesionales, nóminas) en cuanto se validen sus asientos." /></div>}
      {grupos.length > 0 && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <table className="cxl-tabla cxl-apilada" aria-label="Retenciones por modelo y trimestre">
            <thead><tr><th>Modelo</th><th>Trimestre</th><th className="cxl-der">Apuntes</th><th className="cxl-der">Base</th><th className="cxl-der">Retenido</th></tr></thead>
            <tbody>{grupos.map((g) => <tr key={`${g.modelo}${g.t}`}><td data-titulo="Modelo">{nombreModelo(g.modelo)}</td><td data-titulo="Trimestre">{g.t}</td><td className="cxl-der" data-titulo="Apuntes">{g.apuntes}</td><td className="cxl-der" data-titulo="Base">{eurosExactos(g.base)}</td><td className="cxl-der" data-titulo="Retenido">{eurosExactos(g.importe)}</td></tr>)}</tbody>
          </table>
          <h3 className="cxl-subtitulo">Apuntes</h3>
          <table className="cxl-tabla cxl-apilada" aria-label="Apuntes con retención">
            <thead><tr><th>Fecha</th><th>Modelo</th><th>Concepto</th><th className="cxl-der">Base</th><th className="cxl-der">Retenido</th></tr></thead>
            <tbody>{d.datos!.map((r, i) => <tr key={`${r.entryId}${i}`}><td><Link to={rutaAsiento(r.entryId)}>{ddmm(r.fecha)}</Link></td><td data-titulo="Modelo">{nombreModelo(r.modelo)}</td>
              <td>{r.terceroId ? <Link to={rutaFichaTercero(r.terceroId)}>{r.concepto}</Link> : r.concepto}</td><td className="cxl-der" data-titulo="Base">{eurosExactos(r.base)}</td><td className="cxl-der" data-titulo="Retenido">{eurosExactos(r.importe)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Suplidos ────────────────────────────────────────────────────────────────

export function Suplidos() {
  const L = useLibros()
  const imp = useImpuestoEmpresa(L.accountId, L.companyId)
  const d = useLeer(async () => {
    const cuentas = await cuentasDeSuplidos(L.accountId, L.companyId)
    const ms = (await Promise.all(cuentas.map((x) => movimientos(L.accountId, L.companyId, L.ejercicio.inicio, L.ejercicio.fin, x.code)))).flat()
    return { cuentas, ms }
  }, `${L.companyId}:${L.ejercicio.id}:${L.vuelta}`)
  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Suplidos">
      <div className="cxl-seccion"><div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: imp.libros }]} /><h2>Suplidos</h2></div></div>
      <p className="cxl-apoyo">{imp.ley
        ? 'Lo que se paga en nombre de un cliente y se le repercute sin IVA (art. 78.Tres.3.º LIVA). No es ingreso ni gasto: va a una cuenta de tercero y no entra en el libro de expedidas.'
        : `Lo que se paga en nombre de un cliente y se le repercute sin ${imp.nombre}. No es ingreso ni gasto: va a una cuenta de tercero y no entra en el libro de expedidas. ${imp.avisoLey}`}</p>
      {!d.datos && <div className="cx-tarjeta" aria-busy="true"><Hueso alto={40} /></div>}
      {d.datos && !d.datos.cuentas.length && <div className="cx-tarjeta"><Vacio titulo="No hay cuentas de suplidos." explicacion="Se marcan en la ficha del tercero (cuenta con papel «suplidos») o en el plan contable." accion={<Link to={rutaPlan()} className="cx-boton-sec">Ir al plan</Link>} /></div>}
      {d.datos?.cuentas.map((cu) => {
        const x = extracto(d.datos!.ms.filter((m) => m.cuenta === cu.code), { desde: L.ejercicio.inicio, hasta: L.ejercicio.fin })
        return (
          <div key={cu.code} className="cx-tarjeta" style={{ overflowX: 'auto' }}>
            <h3 className="cxl-subtitulo">{cu.code} · {cu.name} <Link to={`${rutaLibros('mayor', 'libro-mayor')}?cuenta=${cu.code}`} className="cx-enlace">Mayor</Link></h3>
            {!x.filas.length ? <p className="cxl-pie">Sin movimientos en {L.ejercicio.code}.</p> : (
              <table className="cxl-tabla cxl-apilada" aria-label={`Suplidos en la ${cu.code}`}>
                <thead><tr><th>Fecha</th><th>Concepto</th><th className="cxl-der">Debe</th><th className="cxl-der">Haber</th><th className="cxl-der">Saldo</th></tr></thead>
                <tbody>{x.filas.map((m, i) => <tr key={`${m.entryId}${i}`}><td><Link to={rutaAsiento(m.entryId)}>{ddmm(m.fecha)}</Link></td><td>{m.concepto}</td><td className="cxl-der" data-titulo="Debe">{m.debe ? eurosExactos(m.debe) : ''}</td><td className="cxl-der" data-titulo="Haber">{m.haber ? eurosExactos(m.haber) : ''}</td><td className="cxl-der" data-titulo="Saldo">{eurosExactos(m.saldo)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )
      })}
    </section>
  )
}
