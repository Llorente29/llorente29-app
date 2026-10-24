// src/modules/conta/libro/NuevoAsientoPage.tsx
//
// C04 · Un asiento a mano. La cuenta se busca por nombre o por código entre
// las de apunte del plan; cada apunte lleva su local o «común»; el cuadre se
// ve mientras se escribe y dice cuánto falta y dónde. Se guarda como borrador
// o se guarda y se valida (entonces lleva número y huella). Un asiento nunca
// se guarda descuadrado: la base tampoco lo deja validar.
//
// S01: la cinta de Asientos lo abre con ?tipo= («Tesorería» → Banco,
// «Predefinidos» → elegir uno de entry_template). Y lo que se escribe aquí se
// puede guardar como predefinido (regla 8: lo dice al guardar).
//
// S01d: en una expedida se elige su PDF (o una foto) y se ve al lado mientras
// se escribe; al «Guardar y validar» se sube y se enlaza al asiento validado.
// Si eso falla, el asiento queda guardado y validado igual, y la pantalla del
// asiento lo dice con el motivo y deja volver a adjuntarla.
//
// S02 · PR 2 · La plantilla HOJA DE LÍNEAS del patrón único (tablero 5):
//   · Encabezado del marco: migas del mapa (Contabilidad › Asientos, o
//     Facturación › Facturas emitidas cuando se entra por «Nueva factura
//     emitida»), el título del tipo, su ayuda como frase; UN principal,
//     «Guardar y validar» con Ctrl Intro dibujado y funcionando; «Guardar
//     borrador» y «Cancelar» en blanco. En el móvil, el principal abajo.
//   · La cabecera de la hoja: fecha, serie, concepto y, en la emitida, su
//     documento (el PDF, que se ve al lado).
//   · Las líneas son filas de la tabla con data-campo-hoja: Intro pasa de campo
//     y en la última columna añade línea (introEnLaHoja); F4 en la cuenta abre
//     la búsqueda (BuscarCuentaHoja).
//   · Pie con los totales y lo que dice el cuadre (cuánto falta y dónde), y
//     debajo el asiento dicho en palabras (asientoEnPalabras: solo lo que dicen
//     las cuentas; si no cuadra, nada).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaFacturasEmitidas, rutaLibroDiario } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, BotonEnlace } from '@/modules/conta/diseno'
import { BuscarCuentaHoja, HojaDeLineas, introEnLaHoja } from '@/modules/conta/diseno/plantillas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { cuadreMano, importeMano, problemasMano, type LineaMano } from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE, SERIES, type Serie } from '@/modules/conta/lib/libro'
import { asientoEnPalabras, lineasDePredefinido, predefinidoDeMano, tipoDeAsiento, type Predefinido } from '@/modules/conta/lib/tipoAsiento'
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
/** Los totales del pie, como se escriben en la hoja («1.234,56»). */
const cifra = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** S02 · PR 2 · `tipo`: el de la dirección (Facturación › Nueva factura emitida es la expedida); si no, el de ?tipo=. */
export default function NuevoAsientoPage({ tipo }: { tipo?: string } = {}) {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const [query] = useSearchParams()
  const def = tipoDeAsiento(tipo ?? query.get('tipo'))
  // Entrando por Facturación, Cancelar vuelve a sus facturas emitidas; si no, al libro diario.
  const volverA = tipo === 'expedida' ? rutaFacturasEmitidas() : rutaLibroDiario()
  const titulo = def?.titulo ?? 'Nuevo asiento'
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
  // F4: la línea cuya cuenta se está buscando.
  const [buscando, setBuscando] = useState<number | null>(null)
  const hoja = useRef<HTMLDivElement | null>(null)

  const codigos = useMemo(() => new Set((base?.cuentas ?? []).map((c) => c.code)), [base])
  const porCodigo = useMemo(() => new Map((base?.cuentas ?? []).map((c) => [c.code, c])), [base])
  const paraBuscar = useMemo(() => (base?.cuentas ?? []).map((c) => ({ codigo: c.code, nombre: c.nombre })), [base])
  // S01: con el eje «local» apagado (Definiciones › Analítica), ni la columna ni el aviso; los apuntes van sin local.
  const { local: ejeLocal } = useAnalitica()
  const problemas = problemasMano(concepto, fecha, lineas.map((l) => ({ ...l, localId: l.localId ?? unLocal })), codigos, !!ejeLocal)
  const c = cuadreMano(lineas)
  const ejercicio = base?.ejercicios.find((e) => fecha >= e.inicio && fecha <= e.fin) ?? null
  const enPalabras = asientoEnPalabras(lineas.map((l) => {
    const cta = porCodigo.get(l.cuenta.trim())
    return { codigo: cta?.code ?? '', nombre: cta?.nombre ?? '', debe: importeMano(l.debe) || 0, haber: importeMano(l.haber) || 0 }
  }))
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

  // Una línea nueva y el foco en su cuenta (Intro en la última columna, o «Añadir línea»).
  const enfocarLinea = useRef<number | null>(null)
  useEffect(() => {
    if (enfocarLinea.current === null) return
    hoja.current?.querySelector<HTMLElement>(`[data-linea-cuenta="${enfocarLinea.current}"]`)?.focus()
    enfocarLinea.current = null
  })
  const anadir = () => { enfocarLinea.current = lineas.length; setLineas((ls) => [...ls, vacia(null)]) }

  /** El campo que va después de `el` en la hoja (el orden de data-campo-hoja). */
  const siguienteCampo = (el: HTMLElement | null | undefined) => {
    const campos = [...(hoja.current?.querySelectorAll<HTMLElement>('[data-campo-hoja]') ?? [])]
    const i = el ? campos.indexOf(el) : -1
    campos[i + 1]?.focus()
  }
  const cuentaDe = (i: number) => hoja.current?.querySelector<HTMLElement>(`[data-linea-cuenta="${i}"]`)

  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    // F4 en la cuenta de una línea: la búsqueda debajo del campo.
    if (e.key === 'F4' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = (e.target as HTMLElement).getAttribute('data-linea-cuenta')
      if (i !== null) { e.preventDefault(); setBuscando(Number(i)) }
      return
    }
    introEnLaHoja(e, anadir)
  }

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

  // Ctrl Intro (⌘ Intro en el Mac): guardar y validar, desde cualquier campo de la página.
  // La función cambia en cada pintada; el oyente lee siempre la última.
  const validarConTecla = useRef<() => void>(() => undefined)
  useEffect(() => { validarConTecla.current = () => { if (!ocupado && base) void guardar(true) } })
  useEffect(() => {
    const oir = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      validarConTecla.current()
    }
    window.addEventListener('keydown', oir)
    return () => window.removeEventListener('keydown', oir)
  }, [])

  const textoPrincipal = adjuntando ? 'Adjuntando la factura…' : ocupado ? 'Guardando…' : 'Guardar y validar'
  const principal = (
    <Boton variante="principal" onClick={() => void guardar(true)} disabled={ocupado || !base} tecla="Ctrl Intro" atajo="Control+Enter">{textoPrincipal}</Boton>
  )
  const encabezado = (
    <EncabezadoPagina titulo={titulo} migasExtra={[{ etiqueta: titulo }]}
      // S01e: en Canarias, «IGIC repercutido», no «IVA».
      frase={def ? <TextoConImpuesto texto={def.ayuda} /> : 'Escribe los apuntes: el debe y el haber tienen que sumar lo mismo. Se guarda como borrador o se guarda y se valida.'}
      secundarios={<>
        <BotonEnlace a={volverA}>Cancelar</BotonEnlace>
        <Boton onClick={() => void guardar(false)} disabled={ocupado || !base}>Guardar borrador</Boton>
      </>}
      principal={principal} />
  )

  if (error) {
    return (
      <div className="s-pagina">
        {encabezado}
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer el plan de cuentas: {error} <button type="button" className="s-boton s-boton-enlace" onClick={() => setVuelta((v) => v + 1)}>Reintentar</button></p>
      </div>
    )
  }
  if (!base) {
    return (
      <div className="s-pagina">
        {encabezado}
        <div className="s-lista" aria-busy="true" aria-label="Cargando el plan"><div className="s-lista-cargando" /></div>
      </div>
    )
  }

  const columnas = [
    { titulo: 'Cuenta' }, { titulo: 'Concepto' }, ...(ejeLocal ? [{ titulo: ejeLocal.nombre }] : []),
    { titulo: 'Debe', cifra: true }, { titulo: 'Haber', cifra: true }, { titulo: 'Quitar', oculta: true },
  ]
  const conPapel = esExpedida && !!pdf

  const cabecera = (
    <div className="s-hoja-cabecera-campos">
      <label className="s-hoja-campo">Fecha
        <input className="s-control" type="date" data-campo-hoja="fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        {!ejercicio && <span className="s-hoja-nota" data-tono="duda">No hay ejercicio abierto para esa fecha.</span>}
      </label>
      <label className="s-hoja-campo">Serie
        <select className="s-control s-control-selector" data-campo-hoja="serie" value={serie} onChange={(e) => setSerie(Number(e.target.value) as Serie)}>
          {SERIES.map((s) => <option key={s} value={s}>{NOMBRE_SERIE[s]}</option>)}
        </select>
      </label>
      <label className="s-hoja-campo s-hoja-campo-ancho">Concepto
        <input className="s-control" data-campo-hoja="concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: Alquiler del local de octubre" />
      </label>
      {esExpedida && (
        <section className="s-hoja-campo s-hoja-campo-ancho" aria-label="Factura">
          <span>Documento</span>
          {!pdf && <ElegirExpedida etiqueta="Adjuntar el PDF de la factura" alElegir={elegirPdf} deshabilitado={ocupado} />}
          {pdf && (
            <span className="s-hoja-nota">
              <strong>{pdf.fichero.name}</strong> · {tamano(pdf.fichero.size)}{claseDeFichero(pdf.fichero.name, pdf.fichero.type) !== 'pdf' ? ' · foto: se convierte a PDF' : ''}{' '}
              <button type="button" className="s-boton s-boton-enlace" onClick={() => elegirPdf(null)} disabled={ocupado}>Quitar</button>
              <br />Se adjunta al pulsar «Guardar y validar». Con «Guardar borrador» no se adjunta: el PDF se adjunta al validar.{serie !== 1 ? ` Ojo: solo la lleva la serie ${NOMBRE_SERIE[1]}, y has elegido ${NOMBRE_SERIE[serie]}.` : ''}
            </span>
          )}
          {!pdf && <span className="s-hoja-nota">Adjunta su PDF y lo tienes al lado mientras copias los datos. Se guarda con el asiento al «Guardar y validar»; una vez adjunta no se cambia.</span>}
        </section>
      )}
    </div>
  )

  const filas = lineas.map((l, i) => {
    const cta = porCodigo.get(l.cuenta.trim())
    const n = i + 1
    return (
      <tr key={i}>
        <td>{n}</td>
        <td className="s-hoja-cuenta" data-titulo="Cuenta">
          <input className="s-control" aria-label={`Cuenta del apunte ${n}`} list="cuentas-de-apunte" data-campo-hoja="cuenta" data-linea-cuenta={i}
            aria-keyshortcuts="F4" value={l.cuenta} onChange={(e) => cambia(i, { cuenta: buscarCodigo(e.target.value, base.cuentas) })} placeholder="Nombre o número · F4" />
          {cta && <span className="s-hoja-cuenta-nombre">{cta.nombre}<span className="s-campo-ficha-codigo">{cta.code}</span></span>}
          {buscando === i && (
            <BuscarCuentaHoja cuentas={paraBuscar} inicial={l.cuenta}
              alElegir={(x) => { cambia(i, { cuenta: x.codigo }); setBuscando(null); siguienteCampo(cuentaDe(i)) }}
              alCerrar={(volver) => { setBuscando(null); if (volver) cuentaDe(i)?.focus() }} />
          )}
        </td>
        <td data-titulo="Concepto">
          <input className="s-control" aria-label={`Concepto del apunte ${n}`} data-campo-hoja="concepto" value={l.concepto} onChange={(e) => cambia(i, { concepto: e.target.value })} />
        </td>
        {ejeLocal && (
          <td data-titulo={ejeLocal.nombre}>
            <select className="s-control s-control-selector" aria-label={`${ejeLocal.nombre} del apunte ${n}`} data-campo-hoja="local"
              value={l.comun ? 'comun' : l.localId ?? unLocal ?? ''} onChange={(e) => cambia(i, e.target.value === 'comun' ? { comun: true, localId: null } : { comun: false, localId: e.target.value || null })}>
              <option value="">Elige el {ejeLocal.nombre.toLowerCase()}</option>
              {base.locales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              <option value="comun">Común (se reparte)</option>
            </select>
          </td>
        )}
        <td data-titulo="Debe">
          <input className="s-control s-control-cifra s-cifra" aria-label={`Debe del apunte ${n}`} data-campo-hoja="debe" inputMode="decimal" value={l.debe} onChange={(e) => cambia(i, { debe: e.target.value })} />
        </td>
        <td data-titulo="Haber">
          <input className="s-control s-control-cifra s-cifra" aria-label={`Haber del apunte ${n}`} data-campo-hoja="haber" inputMode="decimal" value={l.haber} onChange={(e) => cambia(i, { haber: e.target.value })} />
        </td>
        <td className="s-hoja-quitar">
          <button type="button" className="s-boton s-boton-enlace" aria-label={`Quitar el apunte ${n}`} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} disabled={lineas.length <= 2}>Quitar</button>
        </td>
      </tr>
    )
  })

  return (
    <div className="s-pagina">
      {encabezado}
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
      {intentado && problemas.length > 0 && (
        <div className="s-aviso-lista" data-tono="falta" role="alert">
          Aún no se puede guardar:
          <ul>{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {def?.tipo === 'predefinido' && (
        <section className="s-tarjeta-blanca s-hoja-bloque" aria-label="Tus asientos predefinidos">
          <h2>Tus asientos predefinidos</h2>
          {predefinidos === null && !falloPredef && <div className="s-lista-cargando" aria-busy="true" aria-label="Cargando los predefinidos" />}
          {predefinidos && predefinidos.length === 0 && (
            <p>Aún no tienes ninguno. Escribe el asiento abajo y, al final, guárdalo como predefinido con un nombre.</p>
          )}
          {predefinidos && predefinidos.length > 0 && (
            <ul>
              {predefinidos.map((p) => (
                <li key={p.id}>
                  <Boton onClick={() => usar(p)} disabled={ocupado}>{p.nombre}</Boton>
                  <span className="s-hoja-nota">{NOMBRE_SERIE[p.serie]} · {p.lineas.length} apuntes · {p.concepto}</span>
                </li>
              ))}
            </ul>
          )}
          <div role="status" aria-live="polite">{puesto && <p className="s-aviso-lista" data-tono="ok">{puesto}</p>}</div>
        </section>
      )}

      <div className={conPapel ? 's-hoja-con-papel' : undefined}>
        <div ref={hoja} onKeyDown={teclas}>
          <datalist id="cuentas-de-apunte">{base.cuentas.map((x) => <option key={x.id} value={x.code}>{x.nombre}</option>)}</datalist>
          <HojaDeLineas cabecera={cabecera} columnas={columnas}
            totales={{ debe: cifra(c.debe), haber: cifra(c.haber) }} cuadra={c.cuadra} textoCuadre={c.texto}
            alAnadir={anadir} enPalabras={enPalabras ?? undefined}>
            {filas}
          </HojaDeLineas>
        </div>
        {conPapel && pdf && (
          <PapelExpedida titulo={`${pdf.fichero.name} · aún sin adjuntar`} url={pdf.url} movil={movil}
            esFoto={claseDeFichero(pdf.fichero.name, pdf.fichero.type) !== 'pdf'} />
        )}
      </div>

      <section className="s-tarjeta-blanca s-hoja-bloque" aria-label="Guardar como predefinido">
        <h2>Guardar como predefinido</h2>
        <p className="s-hoja-nota">Para un asiento que se repite (el alquiler, una cuota): guarda la serie, el concepto y los apuntes. No guarda el asiento.</p>
        <div className="s-hoja-bloque-fila">
          <label className="s-hoja-campo s-hoja-campo-ancho">Nombre del predefinido<input className="s-control" value={nombrePredef} onChange={(e) => setNombrePredef(e.target.value)} maxLength={80} placeholder="Ej.: Alquiler del local" /></label>
          <label className="s-hoja-campo"><span><input type="checkbox" checked={conImportes} onChange={(e) => setConImportes(e.target.checked)} /> Con sus importes</span></label>
          <Boton onClick={() => void guardarComoPredefinido()} disabled={ocupado}>Guardar como predefinido</Boton>
        </div>
        <div role="status" aria-live="polite">{guardadoPredef && <p className="s-aviso-lista" data-tono="ok">{guardadoPredef}</p>}</div>
        {falloPredef && <p className="s-aviso-lista" data-tono="falta" role="alert">{falloPredef}</p>}
      </section>

      <BotonPulgar>{principal}</BotonPulgar>
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
