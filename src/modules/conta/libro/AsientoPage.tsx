// src/modules/conta/libro/AsientoPage.tsx
//
// C04 · Un asiento (maqueta N12Asiento). Cabecera con su estado y su
// confianza, la serie por su palabra, la fecha y el documento. Los apuntes, en
// la tabla común del asiento (TablaAsiento: Cuenta · Nombre · Debe · Haber, la
// cuenta delante y enlazada a su mayor, con sus columnas de local, marca, IVA y
// retención), con «Cambiar cuenta» en cada línea mientras no está validado (la
// cuenta se busca por nombre o por código y la corrección se aprende para la
// siguiente del mismo origen, regla 11), y el cuadre al pie. A la derecha, «Por qué lo propongo
// así» con una frase y su cita por decisión, y el documento. Abajo, «Detalle
// contable»: el código de la serie, el número, la huella y la cadena.
//
// Validar, Descartar y Anular dicen lo que han hecho con su contenido (regla 8).
// Lo validado no se toca: se anula con un contraasiento enlazado.
//
// S01d: una expedida a mano (serie 1) lleva la tarjeta «Factura» en vez de
// «Documento»: su PDF al lado, o «Adjuntar el PDF» si está validada y aún no
// lo tiene. Una vez adjunta no se cambia.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario, rutaMayor } from '@/config/navegacion'
import { NoConfirmadosDelDia } from '@/modules/conta/libro/NoConfirmados'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { diaMesCorto, fechaLarga } from '@/modules/conta/lib/formato'
import { deDondeSale, estadoDe, estadoMes, mesDe, nombreMes, type AsientoDiario, type CierreMes } from '@/modules/conta/lib/diario'
import { TablaAsiento } from '@/modules/conta/diseno/plantillas'
import { apoyoApunte, columnasApuntes, lineasDeApuntes } from '@/modules/conta/libro/apuntesAsiento'
import { NOMBRE_CONFIANZA, NOMBRE_SERIE, cuadre } from '@/modules/conta/lib/libro'
import {
  cambiarCuenta, comprobarCadena, cuentasDeApunte, descartar, leerAsiento, leerCierres, validar, type CuentaPlan,
} from '@/modules/conta/services/diarioService'
import { TonoChip } from '@/modules/conta/libro/piezasLibro'
import { nombresDeCuentas, palabrasLlanas } from '@/modules/conta/libro/palabrasLlanas'
import { MARCA } from '../cuenta/marca'
import { VerDocumento } from '@/modules/conta/libro/ConDiez'
import type { ConDiez } from '@/modules/conta/lib/conDiez'
import { anularConDiez, enviarADiez, leerConDiez, validarConDocumento } from '@/modules/conta/services/conDiezService'
import { leerEnviosDiez, useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import { detalleDiez, type EnvioAsiento } from '@/modules/conta/lib/enDiez'
import { DetalleDiezPieza } from '@/modules/conta/libro/DetalleDiez'
import { noSeValida } from '@/modules/conta/lib/validarConPdf'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { TarjetaExpedida } from '@/modules/conta/libro/FacturaExpedida'
import { esExpedidaAMano } from '@/modules/conta/lib/expedidaPdf'
import { useIsMobile } from '@/shell/useIsMobile'
import { motivosParaValidar } from '@/modules/conta/services/esperanService'
import { porQueNoSeValida, type MotivoEspera } from '@/modules/conta/lib/esperan'

interface Datos {
  asiento: AsientoDiario | null; cuentas: CuentaPlan[]; cierres: CierreMes[]; conDiez: ConDiez | null; conDiezError: string | null
  /** C07: su envío a Diez y, si está anulado, el de su contraasiento (cualquier tipo de asiento). */
  envio: EnvioAsiento | null; contra: EnvioAsiento | null
  /** C06b (21/10): por qué no lo validaría la base (conta_motivos_para_validar); null si no se ha podido leer. */
  motivos: MotivoEspera[] | null; motivosError: string | null
}

export default function AsientoPage() {
  // S01: el local y la marca de cada apunte, solo con su eje encendido (Definiciones › Analítica).
  const analitica = useAnalitica()
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
      // R15 · Si es de ventas de una plataforma: su documento y su envío a Diez.
      .then(async ([asiento, cuentas, cierres]) => {
        // Si no se puede leer (p. ej. la base aún sin la 0100 del R15), el asiento se ve igual y se dice por qué falta «Con Diez».
        let conDiezError: string | null = null
        const conDiez = asiento?.origen === 'sales_day'
          ? (await leerConDiez(accountId, activa.id, [asiento.id]).catch((e: unknown) => { conDiezError = e instanceof Error ? e.message : String(e); return new Map<string, ConDiez>() })).get(asiento.id) ?? null
          : null
        // C07: el envío a Diez de cualquier asiento (y el de su contraasiento, si está anulado).
        const envios = asiento
          ? await leerEnviosDiez(accountId, [asiento.id], asiento.anuladoCon ? new Map([[asiento.id, asiento.anuladoCon]]) : new Map())
            .catch((e: unknown) => { conDiezError = conDiezError ?? (e instanceof Error ? e.message : String(e)); return null })
          : null
        // C06b (21/10): lo que haría que la base no lo valide (un envío por aclarar, entre otros), para decirlo antes de pulsar.
        let motivosError: string | null = null
        const motivos = asiento && (asiento.estado === 'propuesto' || asiento.estado === 'borrador')
          ? await motivosParaValidar(asiento.id).catch((e: unknown) => { motivosError = e instanceof Error ? e.message : String(e); return null })
          : []
        return { asiento, cuentas, cierres, conDiez, conDiezError, motivos, motivosError,
          envio: (asiento && envios?.envios.get(asiento.id)) ?? null, contra: (asiento && envios?.contras.get(asiento.id)) ?? null }
      })
      .then((d) => { if (vivo) setR({ clave, datos: d, error: null }) },
        (e: unknown) => { if (vivo) setR({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, entryId, clave])
  const datos = r.clave === clave ? r.datos : null
  const error = r.clave === clave ? r.error : null
  // C07: «Enviar a Diez» de la empresa. Apagado (o aún sin saberlo), nada de Diez en la pantalla.
  const envioDiez = useEnvioDiez(accountId, activa?.id)
  const encendido = envioDiez.envio?.encendido === true
  const recargar = () => setVuelta((v) => v + 1)

  // S01d: desde «Nueva factura expedida», si el PDF no se pudo adjuntar, llega por qué (falloPdf).
  const llegada = useLocation().state as { aviso?: string; falloPdf?: string } | null
  const [hecho, setHecho] = useState<string | null>(llegada?.aviso ?? null)
  const [fallo, setFallo] = useState<string | null>(llegada?.falloPdf ?? null)
  const movil = useIsMobile()
  const [ocupado, setOcupado] = useState(false)
  const [cambiando, setCambiando] = useState<number | null>(null)
  const [dialogo, setDialogo] = useState<'descartar' | 'anular' | null>(null)
  const [detalle, setDetalle] = useState(false)

  const a = datos?.asiento ?? null
  const c = useMemo(() => (a ? cuadre(a.apuntes) : null), [a])
  const lineas = useMemo(() => (a ? lineasDeApuntes(a.apuntes) : []), [a])

  if (error) return <ErrorConReintento mensaje={error} reintentar={recargar} />
  if (!datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el asiento" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={44} />)}</div>
  if (!a) return <div className="cx-tarjeta"><Vacio titulo="Ese asiento no está." explicacion="Puede que se descartara, o que sea de otra cuenta." accion={<Link to={rutaLibroDiario()} className="cx-enlace">Volver al libro</Link>} /></div>

  const editable = a.estado === 'propuesto' || a.estado === 'borrador'
  // C07: el detalle junto al número («En Diez · 4/1.234» o «No enviado · motivo · Reintentar»).
  const diez = detalleDiez(a, datos.envio, { encendido, contraasiento: datos.contra })
  const e = estadoDe(a)
  const mes = estadoMes(mesDe(a.fecha), datos.cierres)

  async function hacerValidar() {
    if (!a) return
    setOcupado(true); setFallo(null); setHecho(null)
    const validado = (v: { serie: number; numero: number }) => `Validado: ${NOMBRE_SERIE[v.serie as 1]} nº ${v.numero.toLocaleString('es-ES')}, encadenado con su huella. Ya está en el Mayor y no se toca: si hiciera falta, se anula.`
    // Respuesta 8: las ventas de una plataforma se validan con su PDF, en una sola transacción.
    let dicho: string
    try {
      dicho = datos?.conDiez
        ? `${validado(await validarConDocumento(a.id, userName))} Con su «Resumen de ventas» guardado en ${MARCA.nombre}.`
        : validado(await validar(a.id, userName))
    } catch (x) {
      setFallo(datos?.conDiez ? noSeValida(x instanceof Error ? x.message : String(x)) : x instanceof Error ? x.message : 'No se ha validado.')
      setOcupado(false)
      return
    }
    // C07: con «Enviar a Diez» encendido, sale a Diez en ese momento, sin botón aparte.
    if (encendido) {
      const r = await enviarADiez(a.id).catch((x: unknown) => ({ estado: 'no_llega' as const, motivo: x instanceof Error ? x.message : 'no ha contestado', reintentar: true, texto: '' }))
      if (r.estado === 'en_diez') setHecho(`${dicho} ${r.texto}`)
      else { setHecho(dicho); setFallo(`No se ha enviado a Diez: ${r.motivo}. Sigue validado; «Reintentar» está junto a su número.`) }
    } else setHecho(dicho)
    recargar()
    setOcupado(false)
  }

  async function hacerCambio(posicion: number, nueva: CuentaPlan) {
    if (!a || !accountId || !activa) return
    setFallo(null); setHecho(null)
    try { setHecho(await cambiarCuenta(accountId, activa.id, a, posicion, nueva, userName)); setCambiando(null); recargar() }
    catch (x) { setFallo(x instanceof Error ? x.message : 'No se ha cambiado.') }
  }

  // C06b (21/10): con un motivo de la base (un envío a Diez por aclarar, entre otros), los dos botones de validar en gris y su porqué.
  const frena = editable ? porQueNoSeValida(datos.motivos ?? []) : null
  // S01e: el porqué en palabras normales, con el nombre junto a cada cuenta.
  const nombres = nombresDeCuentas([...a.apuntes, ...datos.cuentas.map((x) => ({ cuenta: x.code, nombreCuenta: x.nombre }))])
  const llano = (t: string) => palabrasLlanas(t, nombres)
  const migaFinal = editable ? 'Para revisar' : a.numero ? `${NOMBRE_SERIE[a.serie]} nº ${a.numero.toLocaleString('es-ES')}` : 'Asiento'
  return (
    <div className="cxd-pagina">
      <header className="cxp-cabecera cxd-cabecera">
        <div className="cxp-titulos">
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libro diario', ruta: rutaLibroDiario() }, { etiqueta: migaFinal }]} />
          <h1 className="cxp-nombre">{a.concepto}</h1>
          <div className="cxd-chips">
            {a.estado === 'propuesto' && a.confianza
              ? <Chip tono={a.confianza === 'seguro' ? 'ia' : 'ambar'}>{MARCA.id === 'folvy' ? 'Propuesto por Folvy' : 'Propuesto automáticamente'} · {NOMBRE_CONFIANZA[a.confianza]}</Chip>
              : <TonoChip tono={e.tono}>{e.texto}</TonoChip>}
            <Chip>Serie {NOMBRE_SERIE[a.serie]}</Chip>
            {encendido && a.numero != null && <Chip>{MARCA.nombre} {a.numero.toLocaleString('es-ES')}</Chip>}
            <DetalleDiezPieza d={diez} alHacer={(t) => { setFallo(null); setHecho(t); recargar() }} alFallar={(t) => { setHecho(null); setFallo(t); recargar() }} />
            <Chip>Fecha {fechaLarga(a.fecha)}</Chip>
            <Chip tono="azul">{deDondeSale(a)}</Chip>
          </div>
        </div>
        <div className="cxd-acciones">
          {editable && <button type="button" className="cx-boton-sec" onClick={() => setDialogo('descartar')} disabled={ocupado}>Descartar</button>}
          {datos.conDiez?.documento && <VerDocumento ruta={datos.conDiez.documento.ruta} alFallar={(t) => { setHecho(null); setFallo(t) }} />}
          {editable && <button type="button" className={frena ? 'cx-boton-sec' : 'cx-boton'} onClick={hacerValidar} disabled={ocupado || !c?.cuadra || mes.cerrado || !!frena} title={frena?.texto ?? undefined}>{ocupado ? (encendido ? 'Validando y enviando…' : 'Validando…') : 'Validar asiento'}</button>}
          {a.estado === 'validado' && a.origen !== 'reversal' && esAdmin && <button type="button" className="cx-boton-sec" onClick={() => setDialogo('anular')}>Anular</button>}
        </div>
      </header>
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {encendido && datos.conDiezError && <p className="cx-ayuda cxt-ambar" role="note">No he podido leer cómo está con Diez: {datos.conDiezError}</p>}
      {editable && frena?.franja && (
        <div className="cx-tarjeta cxd-franja" role="status" aria-label="Por qué no se valida" data-prueba="no-se-valida">
          <span><strong>No se valida todavía</strong> · {frena.franja}</span>
        </div>
      )}
      {editable && datos.motivosError && <p className="cx-ayuda cxt-ambar" role="note">No he podido comprobar si se puede validar: {datos.motivosError}. Si no se puede, lo dirá al pulsar.</p>}
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
          {/* Asientos › asiento abierto: la tabla común del asiento (diseno/plantillas), con todas sus opciones de antes. */}
          <TablaAsiento etiqueta="Apuntes del asiento" lineas={lineas} compacta={movil}
            enlaceCuenta={(l) => rutaMayor(l.apunte.cuenta)}
            columnas={columnasApuntes(a.apuntes, { local: !!analitica.local, marca: !!analitica.marca })}
            apoyo={(l) => apoyoApunte(l.apunte)}
            tituloAcciones="Cambiar la cuenta"
            acciones={editable ? (l) => (
              <button type="button" className="cx-enlace" aria-expanded={cambiando === l.apunte.posicion}
                onClick={() => setCambiando(cambiando === l.apunte.posicion ? null : l.apunte.posicion)}>Cambiar cuenta</button>
            ) : undefined}
            debajo={(l) => (editable && cambiando === l.apunte.posicion
              ? <BuscarCuenta cuentas={datos.cuentas} actual={l.apunte.cuenta} alElegir={(x) => hacerCambio(l.apunte.posicion, x)} alCerrar={() => setCambiando(null)} />
              : null)} />
          {a.origen === 'sales_day' && a.origenId && accountId && activa && <NoConfirmadosDelDia accountId={accountId} companyId={activa.id} resumenId={a.origenId} />}
          {editable && <p className="cx-ayuda">Cambia cualquier cuenta: se busca por nombre («comisiones») o por código. Un asiento nunca se guarda descuadrado.</p>}
        </section>

        <aside className="cxd-lado">
          {a.razones.length > 0 || a.porque ? (
            <section className="cxd-ia" aria-label="Por qué lo propongo así">
              <h2 className="cxd-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Por qué lo propongo así</h2>
              {a.porque && <p className="cxd-ia-apoyo">{llano(a.porque)}</p>}
              {a.razones.map((x, i) => (
                <div key={i} className="cxd-ia-fila"><div>
                  <span className="cxd-ia-hecho">{llano(x.decision)}</span>
                  <span className="cxd-ia-apoyo">{llano(x.porque)}{x.cita ? ` · ${x.cita}` : ''}</span>
                </div></div>
              ))}
              {editable && <p className="cxd-ia-apoyo">Si me corriges, aprendo para la siguiente del mismo origen.</p>}
            </section>
          ) : null}
          {esExpedidaAMano(a) && accountId && (
            <TarjetaExpedida a={a} accountId={accountId} quien={userName} movil={movil}
              alHacer={(t) => { setFallo(null); setHecho(t) }} alFallar={(t) => { setHecho(null); setFallo(t) }} />
          )}
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
            // Respuesta 8: si su factura ya está en Diez, el contraasiento va solo a Diez.
            const x = await anularConDiez(a.id, motivo, fecha, userName)
            setDialogo(null)
            const dicho = `Anulado. Contraasiento ${NOMBRE_SERIE[x.serie as 1]} nº ${x.numero.toLocaleString('es-ES')} del ${diaMesCorto(x.fecha)}, enlazado con este.`
            if (x.diez?.estado === 'no_llega') { setHecho(dicho); setFallo(`No se ha anulado en Diez: ${x.diez.motivo}. «Reintentar» está junto a su número.`) }
            else setHecho(x.diez ? `${dicho} ${x.diez.texto}` : dicho)
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
  const encontradas = (t ? cuentas.filter((c) => c.code.startsWith(t) || c.nombre.toLowerCase().includes(t) || c.oficial.toLowerCase().includes(t)) : cuentas).filter((c) => c.code !== actual).slice(0, 12)
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
      {/* S01e: de dónde sale, en palabras (antes, el nombre interno: «supplier_invoice»). */}
      <dt>Origen</dt><dd>{deDondeSale(a)}{a.origenId ? ` · ${a.origenId.slice(0, 8)}` : ''}</dd>
      <dt>Cuentas (título del PGC)</dt>
      <dd><ul className="cxd-detalle-cuentas">{[...new Map(a.apuntes.map((l) => [l.cuenta, l])).values()].map((l) => (
        <li key={l.cuenta}><span className="cxd-codigo">{l.cuenta}</span> {l.tituloOficial ?? l.nombreCuenta}</li>
      ))}</ul></dd>
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
