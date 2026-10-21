// src/modules/conta/libro/NuevoAsientoPage.tsx
//
// C04 · Un asiento a mano. La cuenta se busca por nombre o por código entre
// las de apunte del plan; cada apunte lleva su local o «común»; el cuadre se
// ve mientras se escribe y dice cuánto falta y dónde. Se guarda como borrador
// o se guarda y se valida (entonces lleva número y huella). Un asiento nunca
// se guarda descuadrado: la base tampoco lo deja validar.
//
// S01: la cinta de Asientos lo abre con ?tipo= («Expedida» → serie Ventas,
// «Tesorería» → Banco, «Predefinidos» → elegir uno de entry_template). Y lo que
// se escribe aquí se puede guardar como predefinido (regla 8: lo dice al guardar).
//
// S01d: en una expedida se elige su PDF (o una foto) y se ve al lado mientras
// se escribe; al «Guardar y validar» se sube y se enlaza al asiento validado.
// Si eso falla, el asiento queda guardado y validado igual, y la pantalla del
// asiento lo dice con el motivo y deja volver a adjuntarla.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid, eurosExactos } from '@/modules/conta/lib/formato'
import { cuadreMano, problemasMano, type LineaMano } from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE, SERIES, type Serie } from '@/modules/conta/lib/libro'
import { lineasDePredefinido, predefinidoDeMano, tipoDeAsiento, type Predefinido } from '@/modules/conta/lib/tipoAsiento'
import {
  cuentasDeApunte, guardarAMano, guardarPredefinido, leerEjercicios, leerPredefinidos, localesDeLaCuenta, validar,
  type CuentaPlan, type EjercicioLibro, type LocalEmpresa,
} from '@/modules/conta/services/diarioService'
import { guardarExpedidaPdf } from '@/modules/conta/services/documentosService'
import { claseDeFichero, motivoExpedida, tamano, textoAdjunta } from '@/modules/conta/lib/expedidaPdf'
import { useFicheroElegido } from '@/modules/conta/libro/ficheroElegido'
import { ElegirExpedida, PapelExpedida } from '@/modules/conta/libro/FacturaExpedida'
import { useIsMobile } from '@/shell/useIsMobile'
import { TextoConImpuesto } from '@/modules/conta/ui/TextoConImpuesto'

const vacia = (localId: string | null): LineaMano => ({ cuenta: '', debe: '', haber: '', localId, comun: false, concepto: '' })

export default function NuevoAsientoPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const [query] = useSearchParams()
  const def = tipoDeAsiento(query.get('tipo'))
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
  const [serie, setSerie] = useState<Serie>(def?.serie ?? 4)
  // Desde la cinta se puede pasar de un tipo a otro sin salir de la pantalla: la serie sigue al tipo.
  const [tipoVisto, setTipoVisto] = useState(def?.tipo ?? null)
  if (tipoVisto !== (def?.tipo ?? null)) { setTipoVisto(def?.tipo ?? null); setSerie(def?.serie ?? 4) }
  const [concepto, setConcepto] = useState('')
  const unLocal = base && base.locales.length === 1 ? base.locales[0].id : null
  const [lineas, setLineas] = useState<LineaMano[]>([vacia(null), vacia(null)])
  const [intentado, setIntentado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // S01d: el PDF de la expedida, elegido antes de guardar para verlo al lado.
  const esExpedida = def?.tipo === 'expedida'
  const [pdf, elegirPdf] = useFicheroElegido()
  const [adjuntando, setAdjuntando] = useState(false)
  const movil = useIsMobile()

  const codigos = useMemo(() => new Set((base?.cuentas ?? []).map((c) => c.code)), [base])
  // S01: con el eje «local» apagado (Definiciones › Analítica), ni la columna ni el aviso; los apuntes van sin local.
  const { local: ejeLocal } = useAnalitica()
  const problemas = problemasMano(concepto, fecha, lineas.map((l) => ({ ...l, localId: l.localId ?? unLocal })), codigos, !!ejeLocal)
  const c = cuadreMano(lineas)
  const ejercicio = base?.ejercicios.find((e) => fecha >= e.inicio && fecha <= e.fin) ?? null
  // Predefinidos: los de la empresa (solo con ?tipo=predefinido) y guardar el que se escribe.
  const [predefinidos, setPredefinidos] = useState<Predefinido[] | null>(null)
  const [falloPredef, setFalloPredef] = useState<string | null>(null)
  const [puesto, setPuesto] = useState<string | null>(null)
  const [vueltaPredef, setVueltaPredef] = useState(0)
  useEffect(() => {
    if (def?.tipo !== 'predefinido' || !accountId || !activa) return
    let vivo = true
    leerPredefinidos(accountId, activa.id).then((p) => { if (vivo) { setPredefinidos(p); setFalloPredef(null) } },
      (e: unknown) => { if (vivo) setFalloPredef(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [def?.tipo, accountId, activa, vueltaPredef])
  function usar(p: Predefinido) {
    if (!base) return
    const { lineas: ls, sinCuenta } = lineasDePredefinido(p, new Map(base.cuentas.map((x) => [x.id, x.code])))
    setSerie(p.serie); setConcepto(p.concepto)
    setLineas(ls.length >= 2 ? ls : [...ls, ...Array.from({ length: 2 - ls.length }, () => vacia(null))])
    const faltan = ls.filter((l) => !l.debe && !l.haber).length
    setPuesto(`Puesto «${p.nombre}»: ${ls.length} apuntes${faltan ? `; escribe ${faltan === 1 ? 'el importe que falta' : `los ${faltan} importes que faltan`}` : ''}${sinCuenta ? `. ${sinCuenta === 1 ? 'Una cuenta ya no se puede usar' : `${sinCuenta} cuentas ya no se pueden usar`}: elígela${sinCuenta === 1 ? '' : 's'} de nuevo` : ''}.`)
  }
  const [nombrePredef, setNombrePredef] = useState('')
  const [conImportes, setConImportes] = useState(false)
  const [guardadoPredef, setGuardadoPredef] = useState<string | null>(null)
  async function guardarComoPredefinido() {
    setGuardadoPredef(null); setFalloPredef(null)
    if (!accountId || !activa || !base) return
    const ls = predefinidoDeMano(lineas, new Map(base.cuentas.map((x) => [x.code, x.id])), conImportes)
    if (!nombrePredef.trim()) { setFalloPredef('Ponle un nombre al predefinido.'); return }
    if (!concepto.trim()) { setFalloPredef('Escribe el concepto: es el que llevará cada vez que lo uses.'); return }
    setOcupado(true)
    try {
      await guardarPredefinido(accountId, activa.id, nombrePredef, serie, concepto, ls)
      setGuardadoPredef(`Guardado como predefinido «${nombrePredef.trim()}»: ${ls.length} apuntes, serie ${NOMBRE_SERIE[serie]}${conImportes ? ', con sus importes' : ', sin importes'}. Lo tienes en Asientos › Predefinidos.`)
      setNombrePredef(''); setVueltaPredef((v) => v + 1)
    } catch (e) { setFalloPredef(e instanceof Error ? e.message : String(e)) }
    finally { setOcupado(false) }
  }
  const cambia = (i: number, p: Partial<LineaMano>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))

  async function guardar(yValidar: boolean) {
    setIntentado(true); setFallo(null)
    if (!accountId || !activa || !base) return
    if (!ejercicio) { setFallo(`No hay ejercicio para el ${fecha.split('-').reverse().join('/')}: ábrelo en Ajustes › Ejercicio.`); return }
    if (problemas.length) return
    setOcupado(true)
    try {
      const id = await guardarAMano(accountId, activa.id, ejercicio.id, serie, fecha, concepto, lineas.map((l) => (ejeLocal ? { ...l, localId: l.localId ?? unLocal } : { ...l, localId: null, comun: false })), base.cuentas, userName)
      // S01d: la factura solo se adjunta a una expedida (serie Ventas) validada.
      const conPdf = esExpedida && pdf ? pdf.fichero : null
      const sinAdjuntar = conPdf ? ` La factura (${conPdf.name}) no se ha adjuntado: se adjunta con el asiento validado.` : ''
      if (yValidar) {
        let v: Awaited<ReturnType<typeof validar>>
        try {
          v = await validar(id, userName)
        } catch (e) {
          navegar(rutaAsiento(id), { replace: true, state: { aviso: `Guardado como borrador, pero no se ha validado: ${e instanceof Error ? e.message : ''}${sinAdjuntar}` } })
          return
        }
        if (!conPdf) { navegar(rutaAsiento(id), { replace: true, state: { aviso: `Validado: ${NOMBRE_SERIE[v.serie as Serie]} nº ${v.numero}.` } }); return }
        const validado = `Guardado y validado: ${NOMBRE_SERIE[v.serie as Serie]} nº ${v.numero}.`
        if (serie !== 1) {
          navegar(rutaAsiento(id), { replace: true, state: { aviso: validado,
            falloPdf: `La factura (${conPdf.name}) no se ha adjuntado: solo la lleva una expedida de la serie ${NOMBRE_SERIE[1]}, y este asiento es de ${NOMBRE_SERIE[serie]}.` } })
          return
        }
        setAdjuntando(true)
        try {
          const r = await guardarExpedidaPdf(accountId, id, conPdf, userName)
          navegar(rutaAsiento(id), { replace: true, state: { aviso: `${validado} ${textoAdjunta(r.nombre, r.yaEstaba)}` } })
        } catch (e) {
          navegar(rutaAsiento(id), { replace: true, state: { aviso: validado,
            falloPdf: `La factura (${conPdf.name}) no se ha adjuntado: ${motivoExpedida(e instanceof Error ? e.message : String(e))}. El asiento está guardado y validado: adjúntala en la tarjeta «Factura», con «Adjuntar el PDF».` } })
        }
      } else {
        navegar(rutaAsiento(id), { replace: true, state: { aviso: `Guardado como borrador: sale en «Para revisar» hasta que lo valides.${sinAdjuntar}` } })
      }
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha guardado.') }
    finally { setOcupado(false); setAdjuntando(false) }
  }

  if (error) return <ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} />
  if (!base) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el plan">{[0, 1, 2].map((i) => <Hueso key={i} alto={40} />)}</div>

  return (
    <div className="cxd-pagina">
      <header className="cxp-cabecera cxd-cabecera">
        <div className="cxp-titulos">
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libro diario', ruta: rutaLibroDiario() }, { etiqueta: def?.titulo ?? 'Nuevo asiento' }]} />
          <h1 className="cxp-nombre">{def?.titulo ?? 'Nuevo asiento'}</h1>
          {/* S01e: en Canarias, «IGIC repercutido», no «IVA». */}
          {def && <p className="cx-ayuda cxd-ayuda-tipo"><TextoConImpuesto texto={def.ayuda} /></p>}
        </div>
        <div className="cxd-acciones">
          <Link to={rutaLibroDiario()} className="cx-boton-sec">Cancelar</Link>
          {esExpedida && pdf && <span className="cx-ayuda">El PDF se adjunta al validar</span>}
          <button type="button" className="cx-boton-sec" onClick={() => guardar(false)} disabled={ocupado}>Guardar borrador</button>
          <button type="button" className="cx-boton" onClick={() => guardar(true)} disabled={ocupado}>{adjuntando ? 'Adjuntando la factura…' : ocupado ? 'Guardando…' : 'Guardar y validar'}</button>
        </div>
      </header>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}

      {def?.tipo === 'predefinido' && (
        <section className="cx-tarjeta" aria-label="Tus asientos predefinidos">
          <h2 className="cx-tarjeta-titulo">Tus asientos predefinidos</h2>
          {predefinidos === null && !falloPredef && <Hueso alto={32} />}
          {predefinidos && predefinidos.length === 0 && (
            <p>Aún no tienes ninguno. Escribe el asiento abajo y, al final, guárdalo como predefinido con un nombre.</p>
          )}
          {predefinidos && predefinidos.length > 0 && (
            <ul className="cxd-predefinidos">
              {predefinidos.map((p) => (
                <li key={p.id}>
                  <button type="button" className="cx-boton-sec" onClick={() => usar(p)} disabled={ocupado}>{p.nombre}</button>
                  <span className="cx-ayuda">{NOMBRE_SERIE[p.serie]} · {p.lineas.length} apuntes · {p.concepto}</span>
                </li>
              ))}
            </ul>
          )}
          <div role="status" aria-live="polite">{puesto && <p className="cxt-verde">{puesto}</p>}</div>
        </section>
      )}

      <div className={esExpedida && pdf ? 'cxd-expedida-con-papel' : 'cxd-expedida-form'}>
      <div className="cxd-expedida-form">
      {esExpedida && (
        <section className="cx-tarjeta cxd-expedida" aria-label="Factura">
          <h2 className="cx-tarjeta-titulo">Factura</h2>
          {!pdf && (
            <>
              <p className="cx-ayuda">Adjunta su PDF y lo tienes al lado mientras copias los datos. Se guarda con el asiento al «Guardar y validar»; una vez adjunta no se cambia.</p>
              <ElegirExpedida etiqueta="Adjuntar el PDF de la factura" alElegir={elegirPdf} deshabilitado={ocupado} />
            </>
          )}
          {pdf && (
            <div className="cxd-expedida-elegido">
              <span><strong className="cxd-expedida-nombre">{pdf.fichero.name}</strong> · {tamano(pdf.fichero.size)}{claseDeFichero(pdf.fichero.name, pdf.fichero.type) !== 'pdf' ? ' · foto: se convierte a PDF' : ''}</span>
              <button type="button" className="cx-enlace" onClick={() => elegirPdf(null)} disabled={ocupado}>Quitar</button>
              <span className="cx-ayuda">Se adjunta al pulsar «Guardar y validar». Con «Guardar borrador» no se adjunta: el PDF se adjunta al validar.{serie !== 1 ? ` Ojo: solo la lleva la serie ${NOMBRE_SERIE[1]}, y has elegido ${NOMBRE_SERIE[serie]}.` : ''}</span>
            </div>
          )}
        </section>
      )}

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
        <div className={`cxd-mano-linea cxd-linea-cabeza${ejeLocal ? '' : ' cxd-mano-sin-local'}`} aria-hidden="true"><span>Cuenta</span>{ejeLocal && <span>{ejeLocal.nombre}</span>}<span className="cxd-der">Debe</span><span className="cxd-der">Haber</span><span>Concepto</span><span /></div>
        {/* Móvil: no hay fila de cabecera; cada campo lleva su etiqueta visible (cxd-mano-etiqueta, aria-hidden: el nombre accesible es el aria-label «Debe del apunte 1»). */}
        {lineas.map((l, i) => {
          const cta = base.cuentas.find((x) => x.code === l.cuenta.trim())
          return (
            <div key={i} className={`cxd-mano-linea${ejeLocal ? '' : ' cxd-mano-sin-local'}`}>
              <label><span className="cxd-mano-etiqueta" aria-hidden="true">Cuenta</span>
                <input className="cx-input" aria-label={`Cuenta del apunte ${i + 1}`} list="cuentas-de-apunte" value={l.cuenta} onChange={(e) => cambia(i, { cuenta: buscarCodigo(e.target.value, base.cuentas) })} placeholder="Nombre o código" />
                <span className="cx-ayuda">{cta ? cta.nombre : ' '}</span></label>
              {ejeLocal && (
                <label><span className="cxd-mano-etiqueta" aria-hidden="true">{ejeLocal.nombre}</span>
                  <select className="cx-input" aria-label={`${ejeLocal.nombre} del apunte ${i + 1}`} value={l.comun ? 'comun' : l.localId ?? unLocal ?? ''} onChange={(e) => cambia(i, e.target.value === 'comun' ? { comun: true, localId: null } : { comun: false, localId: e.target.value || null })}>
                    <option value="">Elige el {ejeLocal.nombre.toLowerCase()}</option>
                    {base.locales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    <option value="comun">Común (se reparte)</option>
                  </select></label>
              )}
              <label><span className="cxd-mano-etiqueta cxd-der" aria-hidden="true">Debe</span><input className="cx-input cxd-der" aria-label={`Debe del apunte ${i + 1}`} inputMode="decimal" value={l.debe} onChange={(e) => cambia(i, { debe: e.target.value })} /></label>
              <label><span className="cxd-mano-etiqueta cxd-der" aria-hidden="true">Haber</span><input className="cx-input cxd-der" aria-label={`Haber del apunte ${i + 1}`} inputMode="decimal" value={l.haber} onChange={(e) => cambia(i, { haber: e.target.value })} /></label>
              <label><span className="cxd-mano-etiqueta" aria-hidden="true">Concepto</span><input className="cx-input" aria-label={`Concepto del apunte ${i + 1}`} value={l.concepto} onChange={(e) => cambia(i, { concepto: e.target.value })} /></label>
              <button type="button" className="cx-enlace" aria-label={`Quitar el apunte ${i + 1}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} disabled={lineas.length <= 2}>Quitar</button>
            </div>
          )
        })}
        <button type="button" className="cx-enlace" onClick={() => setLineas((ls) => [...ls, vacia(null)])}>+ Añadir apunte</button>
        {/* Un solo estado (cuadre().estado): sin importes, «Faltan importes» neutro; descuadrado, cuánto y dónde
            en ámbar, una vez; cuadrado, en verde con su ✓ y la diferencia a cero. El pie no se contradice. */}
        <div className={`cxd-cuadre cxd-mano-cuadre cxd-cuadre-${c.estado}`} role="status" aria-live="polite">
          <strong className={c.estado === 'cuadra' ? 'cxt-verde' : c.estado === 'descuadre' ? 'cxt-ambar' : 'cxd-cuadre-neutro'}>{c.texto}</strong>
          <span className="cxd-importe">Debe {eurosExactos(c.debe)}</span>
          <span className="cxd-importe">Haber {eurosExactos(c.haber)}</span>
          {c.estado === 'cuadra' && <span className="cxt-verde">✓ 0,00 €</span>}
        </div>
        {intentado && problemas.length > 0 && (
          <ul className="cx-error" role="alert">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </section>

      <section className="cx-tarjeta" aria-label="Guardar como predefinido">
        <h2 className="cx-tarjeta-titulo">Guardar como predefinido</h2>
        <p className="cx-ayuda">Para un asiento que se repite (el alquiler, una cuota): guarda la serie, el concepto y los apuntes. No guarda el asiento.</p>
        <div className="cxd-predef-fila">
          <label className="cxd-campo cxd-predef-nombre">Nombre del predefinido<input className="cx-input" value={nombrePredef} onChange={(e) => setNombrePredef(e.target.value)} maxLength={80} placeholder="Ej.: Alquiler del local" /></label>
          <label className="cxd-predef-importes"><input type="checkbox" checked={conImportes} onChange={(e) => setConImportes(e.target.checked)} /> Con sus importes</label>
          <button type="button" className="cx-boton-sec" onClick={() => void guardarComoPredefinido()} disabled={ocupado}>Guardar como predefinido</button>
        </div>
        <div role="status" aria-live="polite">{guardadoPredef && <p className="cxt-verde">{guardadoPredef}</p>}</div>
        {falloPredef && <p className="cx-error" role="alert">{falloPredef}</p>}
      </section>
      </div>
      {esExpedida && pdf && (
        <PapelExpedida titulo={`${pdf.fichero.name} · aún sin adjuntar`} url={pdf.url} movil={movil}
          esFoto={claseDeFichero(pdf.fichero.name, pdf.fichero.type) !== 'pdf'} />
      )}
      </div>
    </div>
  )
}

/** Si se escribe un nombre que es de una sola cuenta, se queda su código. */
function buscarCodigo(texto: string, cuentas: readonly CuentaPlan[]): string {
  const t = texto.trim().toLowerCase()
  if (!t || /^\d+$/.test(t)) return texto
  const por = cuentas.filter((c) => c.nombre.toLowerCase().includes(t) || c.oficial.toLowerCase().includes(t))
  return por.length === 1 ? por[0].code : texto
}
