// src/modules/conta/nucleo/asiento/AsientoGeneral.tsx
//
// K12 · El asiento general, copia de ERP10 (maqueta nucleo_19, aprobada el 22/11; captura erp10/04). Sustituye a la
// ficha del asiento del núcleo (N08): con el interruptor encendido y en el ordenador. La del móvil y la del
// interruptor apagado se quedan como están (Julio, 22/11). Hecha con las piezas comunes (nucleo/piezas):
//   · la ventana «Asiento general», con la pestaña «Apuntes» abajo (sin «Analítica»: nuestra rejilla ya la lleva);
//   · la barra: guardar, cancelar, nuevo, ← →, y «Documento»;
//   · «Datos asiento»: tipo de introducción y periodo (grises: los pone el programa), documento (el número, gris), la
//     fecha y el concepto, con su ⊕ para «Otros datos» (tercero, documento externo y fecha del documento);
//   · «Apuntes», uno por fila (subcuenta y nombre, concepto, local, marca, plataforma, debe y haber), y debajo la línea
//     que se edita, con «saldo a la fecha»; Intro la sube; la nueva trae en ámbar lo que falta para cuadrar;
//   · los totales: debe, haber y descuadre. Con descuadre no se graba y el descuadre va en ámbar, sin frase;
//   · «Observaciones» y el documento a la derecha («Adjuntar el documento»), con el separador que se mueve.
// La serie es la del asiento a mano, fija (sin casilla). Uno nuevo se graba como hasta hoy (las filas y validar); uno
// validado a mano se cambia mientras el IVA de su trimestre no esté presentado (conta_asiento_modificar, el mismo
// número). Los que vienen de otro sitio (una factura, el banco, las ventas) se ven aquí y se cambian en su ficha.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario, rutaNuevoAsiento } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useConPropias } from '@/modules/conta/marco/nuevo/contexto'
import { useAvisoSalir } from '@/modules/conta/diseno/plantillas/avisoSalir'
import { useNombreDePestana, useSeVe } from '@/modules/conta/diseno/plantillas/pestana'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { atajoDeSubcuenta } from '@/modules/conta/lib/asientoNucleo'
import { fechaEscrita, fechaVista } from '@/modules/conta/nucleo/ficha/teclas'
import { cifra } from '@/modules/conta/nucleo/ficha/textos'
import { anular, cuentasDeApunte, leerEjercicios, localesDeLaCuenta, validar, type CuentaPlan, type EjercicioLibro } from '@/modules/conta/services/diarioService'
import { asientosDeAlLado } from '@/modules/conta/services/asientoNucleoService'
import {
  SERIE_ASIENTO_GENERAL, cambiarValidado, grabarNuevo, guardarJustificante, leerAsientoGeneral, marcasDeLaCuenta, plataformasDeLaCuenta,
  saldoALaFecha, sePuedeCambiar, tercerosDeLaCuenta, type AsientoGeneral as Asiento, type Opcion,
} from '@/modules/conta/services/asientoGeneralService'
import { documentoDelAsiento } from '@/modules/conta/nucleo/listado/servicio'
import { claseDeFichero, motivoExpedida } from '@/modules/conta/lib/expedidaPdf'
import { useFicheroElegido } from '@/modules/conta/libro/ficheroElegido'
import { Barra, Bloque, BotonMas, Casilla, OtrosDatos, Ventana } from '@/modules/conta/nucleo/piezas/Ventana'
import { CasillaLupa } from '@/modules/conta/nucleo/piezas/Lupa'
import { ConDocumento, DocumentoDerecha } from '@/modules/conta/nucleo/piezas/Documento'
import { Lineas, type Columna } from '@/modules/conta/nucleo/piezas/Lineas'
import { siguienteEscribible } from '@/modules/conta/nucleo/piezas/logica'
import { aLineas, apunteVacio, deLineas, lineaVacia, porQueNoSeGraba, problemasDeLaLinea, subirLinea, totalesDe, type ApunteEd } from './asientoGeneral'
import './asientoGeneral.css'

/** Lo menos que ocupa la pantalla sin plegar: lo que tiene a 1366 sin cortar ningún rótulo (la maqueta: 871 px; medido con el banco de pruebas). */
const MINIMO_PANTALLA = 860

interface Base {
  cuentas: CuentaPlan[]; ejercicios: EjercicioLibro[]
  locales: Opcion[]; marcas: Opcion[]; plataformas: Opcion[]; terceros: Opcion[]
}
type Cabecera = { fecha: string; concepto: string; notas: string; tercero: string | null; documento: string; fechaDocumento: string | null }
const cabeceraVacia = (hoy: string): Cabecera => ({ fecha: hoy, concepto: '', notas: '', tercero: null, documento: '', fechaDocumento: null })
type Aviso = { texto: string; tono: 'bien' | 'ambar' | 'gris'; id?: string }

/** Las casillas de la línea que se edita, en el orden de Intro (como ERP10). */
const EDICION = ['subcuenta', 'concepto', 'local', 'marca', 'plataforma', 'debe', 'haber'] as const
type CasillaEd = (typeof EDICION)[number]

export function AsientoGeneral({ entryId }: { entryId?: string }) {
  const { accountId, cargando, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const location = useLocation()
  const seVe = useSeVe()
  useConPropias()
  const hoy = hoyEnMadrid()

  const [base, setBase] = useState<Base | null>(null)
  const [existente, setExistente] = useState<Asiento | null | 'no'>(entryId ? null : 'no')
  const [puedeLeido, setPuede] = useState<{ id: string; puede: boolean; porque: string | null } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>((location.state as { aviso?: Aviso } | null)?.aviso ?? null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (cargando || !accountId || !activa) return
    let vivo = true
    Promise.all([
      cuentasDeApunte(accountId, activa.id), leerEjercicios(accountId, activa.id), localesDeLaCuenta(accountId),
      marcasDeLaCuenta(accountId), plataformasDeLaCuenta(accountId), tercerosDeLaCuenta(accountId),
      entryId ? leerAsientoGeneral(accountId, activa.id, entryId) : Promise.resolve(null),
    ]).then(([cuentas, ejercicios, locales, marcas, plataformas, terceros, a]) => {
      if (!vivo) return
      const locs: Opcion[] = [...locales.map((l, i) => ({ id: l.id, codigo: String(i + 1), descripcion: l.nombre })), { id: 'comun', codigo: 'C', descripcion: 'Común a todos los locales' }]
      setBase({ cuentas, ejercicios, locales: locs, marcas, plataformas, terceros })
      setExistente(entryId ? a ?? 'no' : 'no')
    }, (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, entryId, vuelta])

  const asiento = existente && existente !== 'no' ? existente : null
  const aMano = !!asiento && asiento.estado === 'validado' && asiento.origen === 'manual'
  useEffect(() => {
    if (!asiento || !aMano) return
    let vivo = true
    const id = asiento.id
    sePuedeCambiar(id).then((x) => { if (vivo) setPuede({ id, ...x }) }, (e: unknown) => { if (vivo) setPuede({ id, puede: false, porque: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [asiento, aMano])
  const puede = aMano && puedeLeido?.id === asiento?.id ? puedeLeido : null

  /** Qué se puede hacer: escribir uno nuevo, cambiar uno validado a mano, validar uno propuesto, o solo verlo. */
  const modo: 'nuevo' | 'cambiar' | 'validar' | 'ver' = !entryId ? 'nuevo'
    : !asiento ? 'ver'
      : asiento.estado === 'validado' && asiento.origen === 'manual' && puede?.puede ? 'cambiar'
        : asiento.estado === 'propuesto' || asiento.estado === 'borrador' ? 'validar' : 'ver'
  const escribe = modo === 'nuevo' || modo === 'cambiar'

  // ── Lo que se escribe ──
  const [cab, setCab] = useState<Cabecera>(cabeceraVacia(hoy))
  const [fechaTexto, setFechaTexto] = useState<string | null>(null)
  const [apuntes, setApuntes] = useState<ApunteEd[]>([])
  const [ed, setEd] = useState<ApunteEd>(apunteVacio())
  const [en, setEn] = useState<number | null>(null)
  const [propuesto, setPropuesto] = useState<'debe' | 'haber' | null>(null)
  const [otros, setOtros] = useState(false)
  const [intentado, setIntentado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [pdf, elegirPdf] = useFicheroElegido()
  const [adjuntando, setAdjuntando] = useState(false)
  const [original, setOriginal] = useState<string>('')

  // Lo guardado, a la pantalla (al abrir uno y al volver a leerlo): al pintar, en cuanto llega otro.
  const [puesto, setPuesto] = useState<Asiento | null>(null)
  if (asiento && puesto !== asiento) {
    setPuesto(asiento)
    setCab({ ...asiento.cabecera })
    setApuntes(deLineas(asiento.lineas))
    setEd(apunteVacio(asiento.cabecera.concepto)); setEn(null); setPropuesto(null); setIntentado(false)
    setOriginal(JSON.stringify({ c: asiento.cabecera, l: deLineas(asiento.lineas) }))
  }

  const porCodigo = useMemo(() => new Map((base?.cuentas ?? []).map((c) => [c.code, c])), [base])
  const porId = useMemo(() => new Map((base?.cuentas ?? []).map((c) => [c.id, c])), [base])
  const digitos = base?.cuentas[0]?.code.length ?? 8
  const plan = useMemo(() => (base?.cuentas ?? []).map((c) => ({ code: c.code, nombre: c.oficial })), [base])
  const registrosCuenta = useMemo(() => (base?.cuentas ?? []).map((c) => ({ id: c.id, codigo: c.code, descripcion: c.oficial })), [base])
  const nombreDe = (lista: readonly Opcion[] | undefined, id: string | null) => (id ? lista?.find((o) => o.id === id)?.descripcion ?? '' : '')

  const t = totalesDe(apuntes)
  const ejercicio = base?.ejercicios.find((e) => cab.fecha >= e.inicio && cab.fecha <= e.fin) ?? null
  const hayCambios = modo === 'nuevo' ? (cab.concepto.trim() !== '' || apuntes.length > 0)
    : modo === 'cambiar' && JSON.stringify({ c: cab, l: apuntes }) !== original

  // El saldo a la fecha de la subcuenta de la línea que se edita.
  const [saldoLeido, setSaldo] = useState<{ clave: string; valor: number | null } | null>(null)
  const claveSaldo = `${ed.cuentaId}:${cab.fecha}`
  useEffect(() => {
    if (!accountId || !activa || !ed.cuentaId) return
    let vivo = true
    const clave = `${ed.cuentaId}:${cab.fecha}`
    saldoALaFecha(accountId, activa.id, ed.cuentaId, cab.fecha).then((x) => { if (vivo) setSaldo({ clave, valor: x }) }, () => { if (vivo) setSaldo({ clave, valor: null }) })
    return () => { vivo = false }
  }, [accountId, activa, ed.cuentaId, cab.fecha])
  const saldo = ed.cuentaId && saldoLeido?.clave === claveSaldo ? saldoLeido.valor : null

  // El documento: el guardado del asiento, o el elegido para uno nuevo.
  type Doc = { url: string; foto: boolean; titulo: string }
  const [docLeido, setDoc] = useState<{ clave: string; doc: Doc | null } | null>(null)
  const claveDoc = `${entryId}:${vuelta}`
  useEffect(() => {
    if (!accountId || !entryId) return
    let vivo = true
    const clave = `${entryId}:${vuelta}`
    documentoDelAsiento(accountId, entryId).then((d) => { if (vivo) setDoc({ clave, doc: d }) }, () => { if (vivo) setDoc({ clave, doc: null }) })
    return () => { vivo = false }
  }, [accountId, entryId, vuelta])
  const doc: Doc | null | undefined = !entryId ? null : docLeido?.clave === claveDoc ? docLeido.doc : docLeido?.doc ?? undefined
  const documento = pdf ? { url: pdf.url, foto: !!claseDeFichero(pdf.fichero.name, pdf.fichero.type)?.startsWith('image/'), titulo: pdf.fichero.name } : doc

  const limpiar = () => {
    setCab(cabeceraVacia(hoy)); setFechaTexto(null); setApuntes([]); setEd(apunteVacio()); setEn(null); setPropuesto(null)
    setIntentado(false); setFallo(null); elegirPdf(null); setOtros(false)
  }
  const { pedirSalir, aviso: dialogoSalir } = useAvisoSalir({
    hay: hayCambios, cambios: hayCambios ? [{ campo: 'asiento', etiqueta: 'El asiento', antes: '', ahora: cab.concepto || 'sin concepto' }] : [],
    donde: cab.concepto ? `Asiento · ${cab.concepto}` : 'Asiento nuevo',
    onGuardar: async () => (await guardar()) ? true : (fallo ?? 'No se ha guardado.'),
    onDescartar: () => { if (modo === 'nuevo') limpiar(); else setVuelta((v) => v + 1) },
  })
  useNombreDePestana(asiento ? `Asiento · ${asiento.numero ? `${asiento.serie} / ${asiento.numero}` : asiento.cabecera.concepto}` : cab.concepto ? `Asiento · ${cab.concepto}` : 'Asiento nuevo')

  // ← →: el de antes y el de después.
  const [lado, setLado] = useState<{ antes: string | null; despues: string | null }>({ antes: null, despues: null })
  useEffect(() => {
    if (!accountId || !activa || existente === null) return
    let vivo = true
    asientosDeAlLado(accountId, activa.id, asiento ? { id: asiento.id, fecha: asiento.cabecera.fecha } : null).then((x) => { if (vivo) setLado(x) }, () => undefined)
    return () => { vivo = false }
  }, [accountId, activa, existente, asiento])
  const ir = (id: string | null) => { if (id) pedirSalir(() => navegar(rutaAsiento(id))) }

  // ── El foco y el teclado ──
  const ventana = useRef<HTMLDivElement>(null)
  // El foco va ya si la casilla existe (las teclas pueden llegar seguidas: la siguiente tiene que caer en la nueva); si
  // aún no está pintada («Otros datos» al abrirse), en cuanto se pinte.
  const enfocar = (sel: string) => {
    const el = ventana.current?.querySelector<HTMLElement>(sel)
    if (el) el.focus(); else window.setTimeout(() => ventana.current?.querySelector<HTMLElement>(sel)?.focus(), 0)
  }
  const enfocarEd = (c: CasillaEd) => enfocar(`#ag-ed-${c}`)
  useEffect(() => { if (modo === 'nuevo' && base) enfocar('#ag-fecha') }, [modo, base])

  function subir(): boolean {
    if (problemasDeLaLinea(ed).length) { enfocarEd(ed.cuentaId ? 'debe' : 'subcuenta'); return false }
    const r = subirLinea(apuntes, ed, en)
    setApuntes(r.apuntes); setEd(r.nueva); setPropuesto(r.propuesto); setEn(null)
    enfocarEd('subcuenta')
    return true
  }
  function siguienteEd(c: CasillaEd) {
    if (c === 'debe' && ed.debe.trim() && !(propuesto === 'debe' && !ed.cuentaId)) { subir(); return }
    const i = siguienteEscribible(EDICION.map(() => ({ escribible: true })), EDICION.indexOf(c))
    if (i === 'fin') { subir(); return }
    enfocarEd(EDICION[i])
  }
  const teclaEd = (c: CasillaEd, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    // En la subcuenta, con la línea vacía: guarda si cuadra (como ERP10); si no, el descuadre ya está en ámbar.
    if (c === 'subcuenta' && lineaVacia(ed, propuesto)) { if (en === null) void guardarYSiguiente(); return }
    siguienteEd(c)
  }
  const cambiaEd = (x: Partial<ApunteEd>) => {
    setEd((a) => ({ ...a, ...x }))
    if (propuesto && (x.debe !== undefined || x.haber !== undefined)) setPropuesto(null)
  }
  const elegirFila = (i: number) => {
    if (!escribe) return
    setEn(i); setEd({ ...apuntes[i] }); setPropuesto(null); enfocarEd('subcuenta')
  }
  const quitarFila = (i: number) => {
    setApuntes((ls) => ls.filter((_, j) => j !== i))
    if (en === i) { setEn(null); setEd(apunteVacio(cab.concepto)) }
  }
  const teclaCabecera = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey) return
    const campos = [...ventana.current!.querySelectorAll<HTMLInputElement>('[data-cab]')].filter((x) => !x.readOnly)
    const k = campos.indexOf(e.target as HTMLInputElement)
    if (k < 0) return
    e.preventDefault()
    if (k < campos.length - 1) campos[k + 1].focus(); else enfocarEd('subcuenta')
  }

  // ── Guardar ──
  async function guardar(): Promise<{ id: string; texto: string; validado: boolean } | false> {
    setIntentado(true); setFallo(null)
    if (!accountId || !activa || !base || !escribe) return false
    // Lo que quedó escrito abajo sin subir, sube antes de guardar (si está completo).
    let lista = apuntes
    if (!lineaVacia(ed, propuesto) && !problemasDeLaLinea(ed).length) { const r = subirLinea(apuntes, ed, en); lista = r.apuntes; setApuntes(lista); setEd(r.nueva); setEn(null); setPropuesto(r.propuesto) }
    const no = porQueNoSeGraba(cab, lista)
    if (no.length) { if (no[0] === 'concepto') enfocar('#ag-concepto'); else if (no[0] === 'fecha') enfocar('#ag-fecha'); return false }
    if (!ejercicio) { setFallo(`No hay ejercicio para el ${fechaVista(cab.fecha)}: ábrelo en Ajustes › Ejercicio.`); return false }
    setOcupado(true)
    try {
      if (modo === 'cambiar' && asiento) {
        const r = await cambiarValidado(asiento.id, cab, aLineas(lista), userName)
        const x = { id: asiento.id, texto: r.texto, validado: true }
        setAviso({ texto: r.texto, tono: r.cambiado ? 'bien' : 'gris', id: asiento.id })
        setVuelta((v) => v + 1)
        return x
      }
      const r = await grabarNuevo(accountId, activa.id, ejercicio.id, cab, aLineas(lista), userName)
      let texto = r.validado
        ? `Guardado y validado: ${r.serie} / ${String(r.numero).padStart(4, '0')} · ${cab.concepto.trim()} · ${cifra(totalesDe(lista).debe)} al debe y al haber.`
        : `Guardado como borrador, sin validar: ${r.porque}`
      if (pdf && r.validado) {
        try { const j = await guardarJustificante(accountId, r.id, pdf.fichero, userName); texto += ` Justificante adjunto: ${j.nombre}.` }
        catch (e) { texto += ` El justificante no se ha adjuntado: ${motivoExpedida(e instanceof Error ? e.message : String(e))}.` }
      }
      setAviso({ texto, tono: r.validado ? 'bien' : 'ambar', id: r.id })
      return { id: r.id, texto, validado: r.validado }
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha guardado.'); return false }
    finally { setOcupado(false) }
  }
  async function guardarYSiguiente() {
    if (modo === 'validar') { await validarPropuesto(); return }
    const r = await guardar()
    if (!r || modo !== 'nuevo') return
    if (r.validado) { limpiar(); enfocar('#ag-fecha'); return }
    limpiar()
    navegar(rutaAsiento(r.id), { state: { aviso: { texto: r.texto, tono: 'ambar', id: r.id } } })
  }
  async function validarPropuesto() {
    if (!asiento) return
    setOcupado(true); setFallo(null)
    try {
      const v = await validar(asiento.id, userName)
      const a: Aviso = { texto: `Validado: ${v.serie} / ${String(v.numero).padStart(4, '0')} · ${asiento.cabecera.concepto} · ${cifra(t.debe)} al debe y al haber.`, tono: 'bien', id: asiento.id }
      setAviso(a)
      if (lado.despues) navegar(rutaAsiento(lado.despues), { state: { aviso: a } }); else setVuelta((x) => x + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha validado.') }
    finally { setOcupado(false) }
  }
  async function adjuntar(f: File) {
    if (modo === 'nuevo') { elegirPdf(f); return }
    if (!accountId || !asiento) return
    setAdjuntando(true); setFallo(null)
    try {
      const j = await guardarJustificante(accountId, asiento.id, f, userName)
      setAviso({ texto: j.yaEstaba ? `Ese justificante ya estaba adjunto: ${j.nombre}.` : `Justificante adjunto: ${j.nombre}.`, tono: 'bien', id: asiento.id })
      setVuelta((v) => v + 1)
    } catch (e) { setFallo(`El justificante no se ha adjuntado: ${motivoExpedida(e instanceof Error ? e.message : String(e))}.`) }
    finally { setAdjuntando(false) }
  }
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  async function hacerAnular() {
    if (!asiento || !motivo.trim()) return
    setOcupado(true); setFallo(null)
    try {
      const r = await anular(asiento.id, motivo.trim(), null, userName)
      setAviso({ texto: `Anulado con el contraasiento ${r.serie} / ${String(r.numero).padStart(4, '0')} del ${fechaVista(r.fecha)}.`, tono: 'bien', id: r.contraasiento })
      setAnulando(false); setVuelta((x) => x + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha anulado.') }
    finally { setOcupado(false) }
  }

  // Esc: dejarlo sin guardar (con la pregunta si hay cambios). Intro fuera de una casilla: guardar o validar.
  const teclas = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    teclas.current = (e) => {
      if (!seVe() || e.defaultPrevented) return
      const enCasilla = (e.target as HTMLElement)?.closest?.('input, select, textarea, button, [role="dialog"], tr[tabindex]')
      // Esc con «Otros datos» abierto lo cierra (aunque el foco esté fuera de la hoja); si no, deja el asiento.
      if (e.key === 'Escape' && otros) { e.preventDefault(); setOtros(false); return }
      if (e.key === 'Escape' && !anulando) { e.preventDefault(); pedirSalir(() => { limpiar(); navegar(rutaLibroDiario()) }); return }
      if (e.key === 'Enter' && !enCasilla && !e.altKey && !e.shiftKey && (modo === 'validar' || escribe)) { e.preventDefault(); void guardarYSiguiente() }
    }
  })
  useEffect(() => {
    const f = (e: globalThis.KeyboardEvent) => teclas.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  if (fallo && !base) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">{fallo}</p></div>
  if (!base || existente === null) return <div className="kp-ventana" aria-busy="true" aria-label="Cargando el asiento"><p className="ag-cargando">Abriendo el asiento…</p></div>
  if (entryId && !asiento) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">Ese asiento no existe o no es de esta empresa. <Link to={rutaNuevoAsiento()}>Escribir uno nuevo</Link></p></div>

  const estado = !asiento ? null
    : modo === 'validar' ? { texto: asiento.estado === 'propuesto' ? 'Propuesto: Intro lo valida.' : 'Borrador: Intro lo valida.', tono: 'ambar' as const }
      : asiento.estado === 'anulado' ? { texto: 'Anulado.', tono: 'gris' as const }
        : asiento.origen !== 'manual' ? { texto: 'Viene de su ficha: se cambia allí.', tono: 'gris' as const }
          : puede && !puede.puede ? { texto: puede.porque ?? 'No se puede cambiar.', tono: 'gris' as const } : null
  const descuadre = t.descuadre !== 0
  const ed1 = ed.cuentaId ? porId.get(ed.cuentaId) ?? null : null
  const cuentaDeFila = (a: ApunteEd) => (a.cuentaId ? porId.get(a.cuentaId) ?? porCodigo.get(a.codigo) : porCodigo.get(a.codigo)) ?? null

  const columnas: Columna[] = [
    { clave: 'subcuenta', titulo: <span className="ag-con-lupa-cabeza"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="M15.5 15.5l5 5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" /></svg>Subcuenta</span>, ancho: '92px' },
    { clave: 'nombre', titulo: '', ancho: '19%' },
    { clave: 'concepto', titulo: 'Concepto', ancho: '22%' },
    { clave: 'local', titulo: 'Local', ancho: '10%' },
    { clave: 'marca', titulo: 'Marca', ancho: '8%' },
    { clave: 'plataforma', titulo: 'Plataforma', ancho: '11%' },
    { clave: 'debe', titulo: 'Debe', cifra: true, ancho: '9%' },
    { clave: 'haber', titulo: 'Haber', cifra: true, ancho: '9%' },
  ]
  const celda = (a: ApunteEd, c: string, i: number) => {
    switch (c) {
      case 'subcuenta': return <span data-cuenta={cuentaDeFila(a)?.code}>{a.codigo}</span>
      case 'nombre': return cuentaDeFila(a)?.oficial ?? ''
      case 'concepto': return a.concepto
      case 'local': return nombreDe(base.locales, a.local)
      case 'marca': return nombreDe(base.marcas, a.marca)
      case 'plataforma': return nombreDe(base.plataformas, a.plataforma)
      case 'debe': return a.debe
      case 'haber': return <span className="ag-haber">{a.haber}{escribe && <button type="button" className="ag-quitar" aria-label={`Quitar la línea ${i + 1}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); quitarFila(i) }}>×</button>}</span>
      default: return null
    }
  }

  const izquierda = (
    <div className="ag-pantalla">
      <Barra
        guardar={{ hacer: () => void guardarYSiguiente(), puede: (escribe || modo === 'validar') && !ocupado, titulo: modo === 'validar' ? 'Validar (Intro)' : 'Guardar (Intro)' }}
        cancelar={{ hacer: () => { if (modo === 'nuevo') limpiar(); else setVuelta((v) => v + 1) }, puede: escribe && !!hayCambios, titulo: 'Cancelar lo escrito' }}
        nuevo={{ hacer: () => pedirSalir(() => { limpiar(); navegar(rutaNuevoAsiento()) }), titulo: 'Nuevo asiento' }}
        anterior={{ hacer: () => ir(lado.antes), puede: !!lado.antes, titulo: 'El asiento de antes' }}
        siguiente={{ hacer: () => ir(lado.despues), puede: !!lado.despues, titulo: 'El asiento de después' }}
        documento={{ hacer: () => enfocar('.kp-documento-barra button'), hay: !!documento, titulo: documento ? documento.titulo : 'Sin documento' }}
        extra={asiento?.estado === 'validado' ? <button type="button" className="kp-barra-mas ag-anular" onClick={() => setAnulando(true)}>Anular</button> : undefined}
        aviso={<>
          {estado && <span className="kp-aviso" data-tono={estado.tono} role="status" title={estado.texto}>{estado.texto}</span>}
          {aviso && <span className="kp-aviso" data-tono={aviso.tono} role="status" title={aviso.texto}>{aviso.texto}{aviso.id && <> <Link to={rutaAsiento(aviso.id)}>Verlo</Link></>}</span>}
          {fallo && <span className="kp-aviso" data-tono="ambar" role="alert" title={fallo}>{fallo}</span>}
        </>}
      />
      <div className="ag-cuerpo">
        <Bloque titulo="Datos asiento" className="ag-datos">
          <div className="ag-fila-datos" onKeyDown={teclaCabecera}>
            <Casilla rotulo="Tipo de introducción" htmlFor="ag-tipo" gris><input id="ag-tipo" readOnly value="Asiento general" title="F8 cambia a factura recibida o emitida" /></Casilla>
            <Casilla rotulo="Periodo contable" htmlFor="ag-periodo" gris className="ag-periodo">
              <input id="ag-periodo" readOnly value={ejercicio?.code ?? ''} /><input readOnly aria-label="Ejercicio" value={ejercicio ? `Ejercicio ${ejercicio.code}` : 'Sin ejercicio'} />
            </Casilla>
            <Casilla rotulo="Documento" htmlFor="ag-documento" gris><input id="ag-documento" readOnly value={asiento?.numero ? String(asiento.numero) : ''} title={`Serie ${asiento?.serie ?? SERIE_ASIENTO_GENERAL}`} /></Casilla>
            <Casilla rotulo="Fecha" htmlFor="ag-fecha" gris={!escribe} ambar={intentado && !/^\d{4}-\d{2}-\d{2}$/.test(cab.fecha)}>
              <input id="ag-fecha" data-cab readOnly={!escribe} value={fechaTexto ?? fechaVista(cab.fecha)}
                onChange={(e) => setFechaTexto(e.target.value)}
                onBlur={() => { if (fechaTexto !== null) { const f = fechaEscrita(fechaTexto, hoy); if (f) setCab((c) => ({ ...c, fecha: f })); setFechaTexto(null) } }}
                onKeyDown={(e) => { if (e.key === 'Enter' && fechaTexto !== null) { const f = fechaEscrita(fechaTexto, hoy); if (f) setCab((c) => ({ ...c, fecha: f })); setFechaTexto(null) } }} />
            </Casilla>
          </div>
          <div className="ag-fila-concepto" onKeyDown={teclaCabecera}>
            <Casilla rotulo="Concepto asiento" htmlFor="ag-concepto" gris={!escribe} ambar={intentado && !cab.concepto.trim()}>
              <input id="ag-concepto" data-cab readOnly={!escribe} value={cab.concepto}
                onChange={(e) => {
                  const v = e.target.value
                  // El concepto de la cabecera pasa a la línea que se edita si llevaba el de antes (o nada).
                  setEd((a) => (a.concepto === cab.concepto || !a.concepto.trim() ? { ...a, concepto: v } : a))
                  setCab((c) => ({ ...c, concepto: v }))
                }} />
            </Casilla>
            <BotonMas etiqueta="Otros datos" abierto={otros} hacer={() => setOtros((x) => !x)} />
            {otros && (
              <OtrosDatos alCerrar={() => { setOtros(false); enfocar('#ag-concepto') }}>
                <Casilla rotulo="Tercero" htmlFor="ag-tercero" gris={!escribe} className="kp-ancha">
                  <CasillaLupa id="ag-tercero" etiqueta="Tercero" registros={base.terceros} valor={cab.tercero} gris={!escribe}
                    vista={(r) => r.descripcion} poner={(r) => setCab((c) => ({ ...c, tercero: r?.id ?? null }))} alIntro={() => enfocar('#ag-doc-externo')} />
                </Casilla>
                <Casilla rotulo="Documento externo" htmlFor="ag-doc-externo" gris={!escribe}>
                  <input id="ag-doc-externo" readOnly={!escribe} value={cab.documento} onChange={(e) => setCab((c) => ({ ...c, documento: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enfocar('#ag-fecha-doc') } }} />
                </Casilla>
                <Casilla rotulo="Fecha del documento" htmlFor="ag-fecha-doc" gris={!escribe}>
                  <FechaLibre id="ag-fecha-doc" iso={cab.fechaDocumento} hoy={hoy} gris={!escribe} poner={(f) => setCab((c) => ({ ...c, fechaDocumento: f }))}
                    alIntro={() => { setOtros(false); enfocarEd('subcuenta') }} />
                </Casilla>
              </OtrosDatos>
            )}
          </div>
        </Bloque>

        <Bloque titulo="Apuntes" crece className="ag-apuntes">
          <Lineas etiqueta="Apuntes" columnas={columnas} filas={apuntes} celda={celda} elegida={en} alElegir={escribe ? elegirFila : undefined}
            otra={escribe ? () => { setEn(null); setEd(apunteVacio(cab.concepto)); setPropuesto(null); enfocarEd('subcuenta') } : undefined}
            edicion={escribe ? (
              <div className="ag-edicion" data-cuenta={ed1?.code}>
                <Casilla rotulo="Subcuenta" htmlFor="ag-ed-subcuenta">
                  <CasillaLupa id="ag-ed-subcuenta" etiqueta="Subcuenta" registros={registrosCuenta} valor={ed.cuentaId}
                    resolver={(texto) => { const a = atajoDeSubcuenta(texto, digitos, plan); const c = a.codigo ? registrosCuenta.find((r) => r.codigo === a.codigo) ?? null : null; return { registro: c, abrir: !c } }}
                    poner={(r) => cambiaEd({ cuentaId: r?.id ?? null, codigo: r?.codigo ?? '' })} alIntro={() => siguienteEd('subcuenta')}
                    teclas={(e) => teclaEd('subcuenta', e)} />
                </Casilla>
                <Casilla rotulo="" htmlFor="ag-ed-nombre" gris><input id="ag-ed-nombre" readOnly tabIndex={-1} aria-label="Nombre de la subcuenta" value={ed1?.oficial ?? ''} /></Casilla>
                <Casilla rotulo="Saldo a la fecha" htmlFor="ag-ed-saldo" gris><input id="ag-ed-saldo" className="kp-num" readOnly tabIndex={-1} value={saldo === null ? '' : cifra(saldo)} /></Casilla>
                <Casilla rotulo="Concepto" htmlFor="ag-ed-concepto">
                  <input id="ag-ed-concepto" data-ed="concepto" value={ed.concepto} onChange={(e) => cambiaEd({ concepto: e.target.value })} onKeyDown={(e) => teclaEd('concepto', e)} />
                </Casilla>
                <Casilla rotulo="Local" htmlFor="ag-ed-local">
                  <CasillaLupa id="ag-ed-local" etiqueta="Local" registros={base.locales} valor={ed.local} vista={(r) => r.descripcion}
                    poner={(r) => cambiaEd({ local: r?.id ?? null })} alIntro={() => siguienteEd('local')} teclas={(e) => teclaEd('local', e)} />
                </Casilla>
                <Casilla rotulo="Marca" htmlFor="ag-ed-marca">
                  <CasillaLupa id="ag-ed-marca" etiqueta="Marca" registros={base.marcas} valor={ed.marca} vista={(r) => r.descripcion}
                    poner={(r) => cambiaEd({ marca: r?.id ?? null })} alIntro={() => siguienteEd('marca')} teclas={(e) => teclaEd('marca', e)} />
                </Casilla>
                <Casilla rotulo="Plataforma" htmlFor="ag-ed-plataforma">
                  <CasillaLupa id="ag-ed-plataforma" etiqueta="Plataforma" registros={base.plataformas} valor={ed.plataforma} vista={(r) => r.descripcion}
                    poner={(r) => cambiaEd({ plataforma: r?.id ?? null })} alIntro={() => siguienteEd('plataforma')} teclas={(e) => teclaEd('plataforma', e)} />
                </Casilla>
                <Casilla rotulo="Debe" htmlFor="ag-ed-debe" ambar={propuesto === 'debe'}>
                  <input id="ag-ed-debe" data-ed="debe" className="kp-num" inputMode="decimal" value={ed.debe} onChange={(e) => cambiaEd({ debe: e.target.value })} onKeyDown={(e) => teclaEd('debe', e)} />
                </Casilla>
                <Casilla rotulo="Haber" htmlFor="ag-ed-haber" ambar={propuesto === 'haber'}>
                  <input id="ag-ed-haber" data-ed="haber" className="kp-num" inputMode="decimal" value={ed.haber} onChange={(e) => cambiaEd({ haber: e.target.value })} onKeyDown={(e) => teclaEd('haber', e)} />
                </Casilla>
              </div>
            ) : undefined}
            suma={(
              <div className="ag-totales" aria-label="Totales">
                <Casilla rotulo="Total debe" htmlFor="ag-total-debe" gris><input id="ag-total-debe" className="kp-num" readOnly value={cifra(t.debe)} /></Casilla>
                <Casilla rotulo="Total haber" htmlFor="ag-total-haber" gris><input id="ag-total-haber" className="kp-num" readOnly value={cifra(t.haber)} /></Casilla>
                <Casilla rotulo="Descuadre" htmlFor="ag-descuadre" gris ambar={descuadre}><input id="ag-descuadre" className="kp-num" readOnly value={cifra(t.descuadre)} data-ambar={descuadre ? 'si' : undefined} /></Casilla>
              </div>
            )} />
        </Bloque>

        <Bloque titulo="Observaciones" className="ag-observaciones">
          <input aria-label="Observaciones" readOnly={!escribe} value={cab.notas} onChange={(e) => setCab((c) => ({ ...c, notas: e.target.value }))} />
        </Bloque>
      </div>
    </div>
  )

  return (
    <div className="ag" ref={ventana}>
      <Ventana id="ag" titulo="Asiento general" pestanas={['Apuntes']} alCerrar={() => pedirSalir(() => { limpiar(); navegar(rutaLibroDiario()) })}>
        <ConDocumento minimo={MINIMO_PANTALLA} persona={accountId && userId ? { cuenta: accountId, usuario: userId } : null}
          izquierda={izquierda}
          derecha={<DocumentoDerecha documento={documento} adjuntando={adjuntando}
            alAdjuntar={modo === 'nuevo' || (asiento?.origen === 'manual' && asiento.estado === 'validado') ? (f) => void adjuntar(f) : undefined}
            acepta="application/pdf,image/jpeg,image/png" />} />
      </Ventana>
      {anulando && asiento && (
        <div className="kp-lupa-velo" role="dialog" aria-modal="true" aria-labelledby="ag-anular">
          <div className="kp-lupa ag-confirmar">
            <header className="kp-lupa-titulo"><strong id="ag-anular">Anular el asiento {asiento.serie} / {String(asiento.numero ?? '').padStart(4, '0')}</strong></header>
            <div className="ag-confirmar-cuerpo">
              <Casilla rotulo="Por qué" htmlFor="ag-motivo"><input id="ag-motivo" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Casilla>
              <div className="ag-confirmar-botones">
                <button type="button" className="kp-barra-mas" disabled={!motivo.trim() || ocupado} onClick={() => void hacerAnular()}>Anular</button>
                <button type="button" className="kp-barra-mas" onClick={() => setAnulando(false)}>Todavía no</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {dialogoSalir}
    </div>
  )
}

/** Una fecha que se escribe como en ERP10 (12112026, 12/11, 12-11-26…) y se puede dejar vacía. */
function FechaLibre({ id, iso, hoy, poner, gris, alIntro }: { id: string; iso: string | null; hoy: string; poner: (f: string | null) => void; gris: boolean; alIntro: () => void }) {
  const [texto, setTexto] = useState<string | null>(null)
  const fijar = () => { if (texto !== null) { poner(texto.trim() ? fechaEscrita(texto, hoy) : null); setTexto(null) } }
  return (
    <input id={id} readOnly={gris} value={texto ?? (iso ? fechaVista(iso) : '')} onChange={(e) => setTexto(e.target.value)} onBlur={fijar}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fijar(); alIntro() } }} />
  )
}
