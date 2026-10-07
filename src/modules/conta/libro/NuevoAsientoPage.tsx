// src/modules/conta/libro/NuevoAsientoPage.tsx
//
// C04 · Un asiento a mano. La cuenta se busca por nombre o por código entre
// las de apunte del plan; cada apunte lleva su local o «común»; el cuadre se
// ve mientras se escribe y dice cuánto falta y dónde. Se guarda como borrador
// o se guarda y se valida (entonces lleva número y huella). Un asiento nunca
// se guarda descuadrado: la base tampoco lo deja validar.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid, eurosExactos } from '@/modules/conta/lib/formato'
import { cuadreMano, problemasMano, type LineaMano } from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE, SERIES, type Serie } from '@/modules/conta/lib/libro'
import {
  cuentasDeApunte, guardarAMano, leerEjercicios, localesDeLaCuenta, validar, type CuentaPlan, type EjercicioLibro, type LocalEmpresa,
} from '@/modules/conta/services/diarioService'

const vacia = (localId: string | null): LineaMano => ({ cuenta: '', debe: '', haber: '', localId, comun: false, concepto: '' })

export default function NuevoAsientoPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const [base, setBase] = useState<{ cuentas: CuentaPlan[]; locales: LocalEmpresa[]; ejercicios: EjercicioLibro[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (cargando || !accountId || !activa) return
    let vivo = true
    Promise.all([cuentasDeApunte(accountId, activa.id), localesDeLaCuenta(accountId), leerEjercicios(accountId, activa.id)])
      .then(([cuentas, locales, ejercicios]) => { if (vivo) { setBase({ cuentas, locales, ejercicios }); setError(null) } },
        (e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, vuelta])

  const [fecha, setFecha] = useState(hoyEnMadrid())
  const [serie, setSerie] = useState<Serie>(4)
  const [concepto, setConcepto] = useState('')
  const unLocal = base && base.locales.length === 1 ? base.locales[0].id : null
  const [lineas, setLineas] = useState<LineaMano[]>([vacia(null), vacia(null)])
  const [intentado, setIntentado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const codigos = useMemo(() => new Set((base?.cuentas ?? []).map((c) => c.code)), [base])
  const problemas = problemasMano(concepto, fecha, lineas.map((l) => ({ ...l, localId: l.localId ?? unLocal })), codigos)
  const c = cuadreMano(lineas)
  const ejercicio = base?.ejercicios.find((e) => fecha >= e.inicio && fecha <= e.fin) ?? null
  const cambia = (i: number, p: Partial<LineaMano>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))

  async function guardar(yValidar: boolean) {
    setIntentado(true); setFallo(null)
    if (!accountId || !activa || !base) return
    if (!ejercicio) { setFallo(`No hay ejercicio para el ${fecha.split('-').reverse().join('/')}: ábrelo en Ajustes › Ejercicio.`); return }
    if (problemas.length) return
    setOcupado(true)
    try {
      const id = await guardarAMano(accountId, activa.id, ejercicio.id, serie, fecha, concepto, lineas.map((l) => ({ ...l, localId: l.localId ?? unLocal })), base.cuentas, userName)
      if (yValidar) {
        try {
          const v = await validar(id, userName)
          navegar(rutaAsiento(id), { replace: true, state: { aviso: `Validado: ${NOMBRE_SERIE[v.serie as Serie]} nº ${v.numero}.` } })
        } catch (e) {
          navegar(rutaAsiento(id), { replace: true, state: { aviso: `Guardado como borrador, pero no se ha validado: ${e instanceof Error ? e.message : ''}` } })
        }
      } else {
        navegar(rutaAsiento(id), { replace: true, state: { aviso: 'Guardado como borrador: sale en «Para revisar» hasta que lo valides.' } })
      }
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha guardado.') }
    finally { setOcupado(false) }
  }

  if (error) return <ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} />
  if (!base) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el plan">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>

  return (
    <div className="cxd-pagina">
      <header className="cxp-cabecera cxd-cabecera">
        <div className="cxp-titulos">
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libro diario', ruta: rutaLibroDiario() }, { etiqueta: 'Nuevo asiento' }]} />
          <h1 className="cxp-nombre">Nuevo asiento</h1>
        </div>
        <div className="cxd-acciones">
          <Link to={rutaLibroDiario()} className="cx-boton-sec">Cancelar</Link>
          <button type="button" className="cx-boton-sec" onClick={() => guardar(false)} disabled={ocupado}>Guardar borrador</button>
          <button type="button" className="cx-boton" onClick={() => guardar(true)} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar y validar'}</button>
        </div>
      </header>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}

      <section className="cx-tarjeta cxd-mano" aria-label="Datos del asiento">
        <div className="cxd-mano-cabeza">
          <label className="cxd-campo">Fecha<input className="cx-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="cxd-campo">Serie
            <select className="cx-input" value={serie} onChange={(e) => setSerie(Number(e.target.value) as Serie)}>
              {SERIES.map((s) => <option key={s} value={s}>{NOMBRE_SERIE[s]}</option>)}
            </select>
          </label>
          <label className="cxd-campo cxd-campo-ancho">Concepto<input className="cx-input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: Alquiler del local de octubre" /></label>
        </div>
        {!ejercicio && <span className="cxt-ambar">No hay ejercicio abierto para esa fecha.</span>}
      </section>

      <section className="cx-tarjeta" aria-label="Apuntes">
        <datalist id="cuentas-de-apunte">{base.cuentas.map((c) => <option key={c.id} value={c.code}>{c.nombre}</option>)}</datalist>
        <div className="cxd-mano-linea cxd-linea-cabeza" aria-hidden="true"><span>Cuenta</span><span>Local</span><span className="cxd-der">Debe</span><span className="cxd-der">Haber</span><span>Concepto</span><span /></div>
        {lineas.map((l, i) => {
          const cta = base.cuentas.find((x) => x.code === l.cuenta.trim())
          return (
            <div key={i} className="cxd-mano-linea">
              <label><span className="cx-oculto">Cuenta del apunte {i + 1}</span>
                <input className="cx-input" list="cuentas-de-apunte" value={l.cuenta} onChange={(e) => cambia(i, { cuenta: buscarCodigo(e.target.value, base.cuentas) })} placeholder="Nombre o código" />
                <span className="cx-ayuda">{cta ? cta.nombre : ' '}</span></label>
              <label><span className="cx-oculto">Local del apunte {i + 1}</span>
                <select className="cx-input" value={l.comun ? 'comun' : l.localId ?? unLocal ?? ''} onChange={(e) => cambia(i, e.target.value === 'comun' ? { comun: true, localId: null } : { comun: false, localId: e.target.value || null })}>
                  <option value="">Elige el local</option>
                  {base.locales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  <option value="comun">Común (se reparte)</option>
                </select></label>
              <label><span className="cx-oculto">Debe del apunte {i + 1}</span><input className="cx-input cxd-der" inputMode="decimal" value={l.debe} onChange={(e) => cambia(i, { debe: e.target.value })} /></label>
              <label><span className="cx-oculto">Haber del apunte {i + 1}</span><input className="cx-input cxd-der" inputMode="decimal" value={l.haber} onChange={(e) => cambia(i, { haber: e.target.value })} /></label>
              <label><span className="cx-oculto">Concepto del apunte {i + 1}</span><input className="cx-input" value={l.concepto} onChange={(e) => cambia(i, { concepto: e.target.value })} /></label>
              <button type="button" className="cx-enlace" aria-label={`Quitar el apunte ${i + 1}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} disabled={lineas.length <= 2}>Quitar</button>
            </div>
          )
        })}
        <button type="button" className="cx-enlace" onClick={() => setLineas((ls) => [...ls, vacia(null)])}>+ Añadir apunte</button>
        <div className="cxd-cuadre" role="status" aria-live="polite">
          <strong>{c.cuadra ? 'Cuadra' : 'No cuadra'}</strong>
          <span className="cxd-importe">Debe {eurosExactos(c.debe)}</span>
          <span className="cxd-importe">Haber {eurosExactos(c.haber)}</span>
          <span className={c.cuadra ? 'cxt-verde' : 'cxt-ambar'}>{c.cuadra ? '✓ 0,00 €' : c.texto}</span>
        </div>
        {intentado && problemas.length > 0 && (
          <ul className="cx-error" role="alert">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </section>
    </div>
  )
}

/** Si se escribe un nombre que es de una sola cuenta, se queda su código. */
function buscarCodigo(texto: string, cuentas: readonly CuentaPlan[]): string {
  const t = texto.trim().toLowerCase()
  if (!t || /^\d+$/.test(t)) return texto
  const por = cuentas.filter((c) => c.nombre.toLowerCase().includes(t))
  return por.length === 1 ? por[0].code : texto
}
