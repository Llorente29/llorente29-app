// src/modules/conta/libro/AsientoPage.tsx
//
// C04 · Un asiento (maqueta N12Asiento). Cabecera con su estado y su
// confianza, la serie por su palabra, la fecha y el documento. Los apuntes con
// «Cambiar» en cada línea mientras no está validado (la cuenta se busca por
// nombre o por código y la corrección se aprende para la siguiente del mismo
// origen, regla 11), y el cuadre al pie. A la derecha, «Por qué lo propongo
// así» con una frase y su cita por decisión, y el documento. Abajo, «Detalle
// contable»: el código de la serie, el número, la huella y la cadena.
//
// Validar, Descartar y Anular dicen lo que han hecho con su contenido (regla 8).
// Lo validado no se toca: se anula con un contraasiento enlazado.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario, rutaMayor } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { deDondeSale, estadoDe, estadoMes, mesDe, nombreMes, pastillas, type AsientoDiario, type CierreMes } from '@/modules/conta/lib/diario'
import { NOMBRE_CONFIANZA, NOMBRE_SERIE, cuadre } from '@/modules/conta/lib/libro'
import {
  anular, cambiarCuenta, comprobarCadena, cuentasDeApunte, descartar, leerAsiento, leerCierres, validar, type CuentaPlan,
} from '@/modules/conta/services/diarioService'
import { TonoChip } from '@/modules/conta/libro/piezasLibro'

interface Datos { asiento: AsientoDiario | null; cuentas: CuentaPlan[]; cierres: CierreMes[] }

export default function AsientoPage() {
  const { entryId = '' } = useParams()
  const { accountId, cargando, userName, esAdmin } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  const [r, setR] = useState<{ clave: string; datos: Datos | null; error: string | null }>({ clave: '', datos: null, error: null })
  const clave = `${accountId}:${entryId}:${vuelta}`
  useEffect(() => {
    if (cargando || !accountId || !activa) return
    let vivo = true
    Promise.all([leerAsiento(accountId, entryId), cuentasDeApunte(accountId, activa.id), leerCierres(accountId, activa.id)])
      .then(([asiento, cuentas, cierres]) => { if (vivo) setR({ clave, datos: { asiento, cuentas, cierres }, error: null }) },
        (e: unknown) => { if (vivo) setR({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, entryId, clave])
  const datos = r.clave === clave ? r.datos : null
  const error = r.clave === clave ? r.error : null
  const recargar = () => setVuelta((v) => v + 1)

  const llegada = useLocation().state as { aviso?: string } | null
  const [hecho, setHecho] = useState<string | null>(llegada?.aviso ?? null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [cambiando, setCambiando] = useState<number | null>(null)
  const [dialogo, setDialogo] = useState<'descartar' | 'anular' | null>(null)
  const [detalle, setDetalle] = useState(false)

  const a = datos?.asiento ?? null
  const c = useMemo(() => (a ? cuadre(a.apuntes) : null), [a])

  if (error) return <ErrorConReintento mensaje={error} reintentar={recargar} />
  if (!datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el asiento" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={44} />)}</div>
  if (!a) return <div className="cx-tarjeta"><Vacio titulo="Ese asiento no está." explicacion="Puede que se descartara, o que sea de otra cuenta." accion={<Link to={rutaLibroDiario()} className="cx-enlace">Volver al libro</Link>} /></div>

  const editable = a.estado === 'propuesto' || a.estado === 'borrador'
  const e = estadoDe(a)
  const mes = estadoMes(mesDe(a.fecha), datos.cierres)

  async function hacerValidar() {
    if (!a) return
    setOcupado(true); setFallo(null); setHecho(null)
    try {
      const v = await validar(a.id, userName)
      setHecho(`Validado: ${NOMBRE_SERIE[v.serie as 1]} nº ${v.numero.toLocaleString('es-ES')}, encadenado con su huella. Ya está en el Mayor y no se toca: si hiciera falta, se anula.`)
      recargar()
    } catch (x) { setFallo(x instanceof Error ? x.message : 'No se ha validado.') }
    finally { setOcupado(false) }
  }

  async function hacerCambio(posicion: number, nueva: CuentaPlan) {
    if (!a || !accountId || !activa) return
    setFallo(null); setHecho(null)
    try { setHecho(await cambiarCuenta(accountId, activa.id, a, posicion, nueva, userName)); setCambiando(null); recargar() }
    catch (x) { setFallo(x instanceof Error ? x.message : 'No se ha cambiado.') }
  }

  const migaFinal = editable ? 'Para revisar' : a.numero ? `${NOMBRE_SERIE[a.serie]} nº ${a.numero.toLocaleString('es-ES')}` : 'Asiento'
  return (
    <div className="cxd-pagina">
      <header className="cxp-cabecera cxd-cabecera">
        <div className="cxp-titulos">
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libro diario', ruta: rutaLibroDiario() }, { etiqueta: migaFinal }]} />
          <h1 className="cxp-nombre">{a.concepto}</h1>
          <div className="cxd-chips">
            {a.estado === 'propuesto' && a.confianza
              ? <Chip tono={a.confianza === 'seguro' ? 'ia' : 'ambar'}>Propuesto por Folvy · {NOMBRE_CONFIANZA[a.confianza]}</Chip>
              : <TonoChip tono={e.tono}>{e.texto}</TonoChip>}
            <Chip>Serie {NOMBRE_SERIE[a.serie]}</Chip>
            <Chip>Fecha {fechaLarga(a.fecha)}</Chip>
            <Chip tono="azul">{deDondeSale(a)}</Chip>
          </div>
        </div>
        <div className="cxd-acciones">
          {editable && <button type="button" className="cx-boton-sec" onClick={() => setDialogo('descartar')} disabled={ocupado}>Descartar</button>}
          {editable && <button type="button" className="cx-boton" onClick={hacerValidar} disabled={ocupado || !c?.cuadra || mes.cerrado}>{ocupado ? 'Validando…' : 'Validar asiento'}</button>}
          {a.estado === 'validado' && a.origen !== 'reversal' && esAdmin && <button type="button" className="cx-boton-sec" onClick={() => setDialogo('anular')}>Anular</button>}
        </div>
      </header>
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {editable && mes.cerrado && (
        <div className="cx-tarjeta cxd-franja" role="status">
          <span><strong>{nombreMes(mesDe(a.fecha))} está {mes.texto.toLowerCase()}</strong> · {mes.apoyo}. No se valida con esa fecha: desbloquéalo desde el libro o descártalo y lo vuelvo a proponer en el primer día abierto.</span>
          <Link to={rutaLibroDiario()} className="cx-enlace">Ir al libro</Link>
        </div>
      )}
      {a.estado === 'anulado' && (
        <div className="cx-tarjeta cxd-franja" role="status">
          <span><strong>Anulado</strong>{a.anuladoPor ? ` por ${a.anuladoPor}` : ''}{a.anuladoEn ? ` el ${diaMesCorto(a.anuladoEn.slice(0, 10))}` : ''}: «{a.motivoAnulacion}». Sigue en el libro, compensado por su contraasiento.</span>
          {a.anuladoCon && <Link to={rutaAsiento(a.anuladoCon)} className="cx-enlace">Ver el contraasiento</Link>}
        </div>
      )}
      {a.origen === 'reversal' && a.anulaA && (
        <div className="cx-tarjeta cxd-franja" role="status"><span>Este asiento da la vuelta a otro, apunte por apunte.</span>
          <Link to={rutaAsiento(a.anulaA)} className="cx-enlace">Ver el asiento anulado</Link></div>
      )}

      <div className="cxd-cuerpo">
        <section className="cx-tarjeta cxd-asiento" aria-label="Apuntes">
          <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">Apuntes</h2></div>
          <div className="cxd-linea cxd-linea-cabeza" aria-hidden="true"><span>Cuenta · local · marca</span><span className="cxd-der">Debe</span><span className="cxd-der">Haber</span><span /></div>
          {a.apuntes.map((l) => (
            <div key={l.posicion} className="cxd-linea-envoltura">
              <div className="cxd-linea">
                <span className="cxd-linea-cuenta">
                  <span className="cxd-linea-nombre">{l.nombreCuenta}</span>
                  <span className="cxd-concepto-apoyo">
                    {pastillas({ apuntes: [l] }).map((p) => <Chip key={p.texto} tono={p.tono}>{p.texto}</Chip>)}
                    <Link to={rutaMayor(l.cuenta)} className="cxd-codigo">{l.cuenta}</Link>
                    {l.concepto && <span className="cxd-sale">· {l.concepto}</span>}
                    {l.iva && <span className="cxd-sale">· IVA {l.iva.tipo ?? ''} % sobre {eurosExactos(l.iva.base)}</span>}
                    {l.retencion && <span className="cxd-sale">· retención ({l.retencion.modelo}) sobre {eurosExactos(l.retencion.base)}</span>}
                  </span>
                </span>
                <span className="cxd-importe">{l.debe ? eurosExactos(l.debe) : '—'}</span>
                <span className="cxd-importe">{l.haber ? eurosExactos(l.haber) : '—'}</span>
                <span>{editable && <button type="button" className="cx-enlace" onClick={() => setCambiando(cambiando === l.posicion ? null : l.posicion)}>Cambiar</button>}</span>
              </div>
              {cambiando === l.posicion && <BuscarCuenta cuentas={datos.cuentas} actual={l.cuenta} alElegir={(x) => hacerCambio(l.posicion, x)} alCerrar={() => setCambiando(null)} />}
            </div>
          ))}
          {c && (
            <div className="cxd-cuadre">
              <strong>{c.cuadra ? 'Cuadra' : 'No cuadra'}</strong>
              <span className="cxd-importe">Debe {eurosExactos(c.debe)}</span>
              <span className="cxd-importe">Haber {eurosExactos(c.haber)}</span>
              <span className={c.cuadra ? 'cxt-verde' : 'cxt-ambar'}>{c.cuadra ? '✓ 0,00 €' : c.texto}</span>
            </div>
          )}
          {editable && <p className="cx-ayuda">Cambia cualquier cuenta: se busca por nombre («comisiones») o por código. Un asiento nunca se guarda descuadrado.</p>}
        </section>

        <aside className="cxd-lado">
          {a.razones.length > 0 || a.porque ? (
            <section className="cxd-ia" aria-label="Por qué lo propongo así">
              <h2 className="cxd-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Por qué lo propongo así</h2>
              {a.porque && <p className="cxd-ia-apoyo">{a.porque}</p>}
              {a.razones.map((x, i) => (
                <div key={i} className="cxd-ia-fila"><div>
                  <span className="cxd-ia-hecho">{x.decision}</span>
                  <span className="cxd-ia-apoyo">{x.porque}{x.cita ? ` · ${x.cita}` : ''}</span>
                </div></div>
              ))}
              {editable && <p className="cxd-ia-apoyo">Si me corriges, aprendo para la siguiente del mismo origen.</p>}
            </section>
          ) : null}
          <section className="cx-tarjeta" aria-label="Documento">
            <h2 className="cx-tarjeta-titulo">Documento</h2>
            <p>{a.documento ?? 'Sin documento propio'}</p>
            <span className="cx-ayuda">{deDondeSale(a)}{a.creadoPor ? ` · lo preparó ${a.creadoPor}` : ''}</span>
          </section>
          <section className="cx-tarjeta" aria-label="Detalle contable">
            <button type="button" className="cxd-detalle-boton" aria-expanded={detalle} onClick={() => setDetalle((v) => !v)}>
              <h2 className="cx-tarjeta-titulo">Detalle contable</h2><span aria-hidden="true">{detalle ? '▾' : '▸'}</span>
            </button>
            {detalle && <DetalleContable a={a} companyId={activa?.id ?? null} />}
          </section>
        </aside>
      </div>

      {dialogo === 'descartar' && (
        <ConMotivo titulo="Descartar la propuesta" boton="Descartar" ayuda="No la vuelvo a proponer: queda escrito por qué. Si era un error mío, dímelo aquí."
          alCerrar={() => setDialogo(null)}
          hacer={async (motivo) => { await descartar(a.id, motivo, userName); navegar(rutaLibroDiario('revisar'), { replace: true }) }} />
      )}
      {dialogo === 'anular' && (
        <ConMotivo titulo={`Anular ${NOMBRE_SERIE[a.serie]} nº ${a.numero?.toLocaleString('es-ES') ?? ''}`} boton="Anular" conFecha
          ayuda="No se borra: hago un contraasiento que le da la vuelta, apunte por apunte, enlazado con este (CCom 29). Si su mes está cerrado, va al primer día abierto."
          alCerrar={() => setDialogo(null)}
          hacer={async (motivo, fecha) => {
            const x = await anular(a.id, motivo, fecha, userName)
            setDialogo(null)
            setHecho(`Anulado. Contraasiento ${NOMBRE_SERIE[x.serie as 1]} nº ${x.numero.toLocaleString('es-ES')} del ${diaMesCorto(x.fecha)}, enlazado con este.`)
            recargar()
          }} />
      )}
    </div>
  )
}

/** Buscar una cuenta de apunte por nombre o por código. */
function BuscarCuenta({ cuentas, actual, alElegir, alCerrar }: { cuentas: CuentaPlan[]; actual: string; alElegir: (c: CuentaPlan) => void; alCerrar: () => void }) {
  const [busca, setBusca] = useState('')
  const t = busca.trim().toLowerCase()
  const encontradas = (t ? cuentas.filter((c) => c.code.startsWith(t) || c.nombre.toLowerCase().includes(t)) : cuentas).filter((c) => c.code !== actual).slice(0, 12)
  return (
    <div className="cxd-buscar">
      <label className="cx-oculto" htmlFor={`buscar-${actual}`}>Buscar cuenta por nombre o código</label>
      <input id={`buscar-${actual}`} className="cx-input" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busca por nombre o código"
        onKeyDown={(e) => { if (e.key === 'Escape') alCerrar() }} />
      <ul className="cxd-buscar-lista">
        {encontradas.length === 0 && <li className="cx-ayuda">Ninguna cuenta de apunte coincide con «{busca.trim()}».</li>}
        {encontradas.map((c) => <li key={c.id}><button type="button" className="cxd-buscar-opcion" onClick={() => alElegir(c)}><span className="cxd-codigo">{c.code}</span> {c.nombre}</button></li>)}
      </ul>
    </div>
  )
}

function DetalleContable({ a, companyId }: { a: AsientoDiario; companyId: string | null }) {
  const [cadena, setCadena] = useState<string | null>(null)
  const [mirando, setMirando] = useState(false)
  async function comprobar() {
    if (!companyId) return
    setMirando(true)
    try {
      const r = await comprobarCadena(companyId)
      setCadena(r.mal.length === 0
        ? `La cadena está intacta: ${r.total} asientos validados, cada uno encadenado con el anterior.`
        : `${r.mal.length} de ${r.total} no encadenan: ${r.mal.slice(0, 3).map((m) => `${NOMBRE_SERIE[m.serie as 1]} nº ${m.numero} (${m.motivo})`).join('; ')}.`)
    } catch (e) { setCadena(e instanceof Error ? e.message : 'No se ha podido comprobar.') }
    finally { setMirando(false) }
  }
  const corta = (h: string | null) => (h ? `${h.slice(0, 12)}…${h.slice(-6)}` : '—')
  return (
    <dl className="cxd-detalle">
      <dt>Serie</dt><dd>{NOMBRE_SERIE[a.serie]} · código {a.serie}</dd>
      <dt>Número</dt><dd>{a.numero ?? 'se pone al validar'}</dd>
      {a.traido && <><dt>Traído</dt><dd>{a.traido.programa}{a.traido.serie ? ` · serie ${a.traido.serie}` : ''}{a.traido.numero ? ` · nº ${a.traido.numero}` : ''}</dd></>}
      <dt>Validado</dt><dd>{a.validadoEn ? `${fechaLarga(a.validadoEn.slice(0, 10))}${a.validadoPor ? ` · ${a.validadoPor}` : ''}` : 'aún no'}</dd>
      <dt>Orden en la cadena</dt><dd>{a.cadena ?? '—'}</dd>
      <dt>Huella</dt><dd className="cxd-codigo" title={a.huella ?? undefined}>{corta(a.huella)}</dd>
      <dt>Huella anterior</dt><dd className="cxd-codigo" title={a.huellaAnterior ?? undefined}>{a.cadena === 1 ? 'es el primero' : corta(a.huellaAnterior)}</dd>
      <dt>Origen</dt><dd>{a.origen}{a.origenId ? ` · ${a.origenId.slice(0, 8)}` : ''}</dd>
      <dd className="cxd-detalle-accion">
        <button type="button" className="cx-boton-sec" onClick={comprobar} disabled={mirando}>{mirando ? 'Comprobando…' : 'Comprobar la cadena'}</button>
        {cadena && <span className="cx-ayuda" role="status">{cadena}</span>}
      </dd>
    </dl>
  )
}

function ConMotivo({ titulo, boton, ayuda, conFecha = false, alCerrar, hacer }: {
  titulo: string; boton: string; ayuda: string; conFecha?: boolean; alCerrar: () => void; hacer: (motivo: string, fecha: string | null) => Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function ir() {
    setOcupado(true); setFallo(null)
    try { await hacer(motivo.trim(), fecha || null) } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido.') }
    finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar}>
      <p className="cx-ayuda">{ayuda}</p>
      <label className="cxd-campo">Por qué
        <textarea className="cx-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {conFecha && <label className="cxd-campo">Fecha del contraasiento (si la dejas vacía, la del asiento o hoy)
        <input className="cx-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>}
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cxd-dialogo-acciones">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" onClick={ir} disabled={ocupado || !motivo.trim()}>{ocupado ? 'Un momento…' : boton}</button>
      </div>
    </Dialogo>
  )
}
