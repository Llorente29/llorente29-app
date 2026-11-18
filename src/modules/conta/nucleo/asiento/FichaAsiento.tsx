// src/modules/conta/nucleo/asiento/FichaAsiento.tsx
//
// N08 · La ficha del asiento del núcleo (maqueta nucleo_5_asiento, aprobada el 17/11; ERP10,
// «Introducción de asientos»). Solo con `conta_nucleo` encendido y en el ordenador (AsientoSegun);
// si no, la de hoy, tal cual.
//
// Tres estados: nuevo (se escribe), propuesto o borrador (lo trae Sumied; se valida con Intro) y
// validado o anulado (solo lectura, con «Anular» en «Más»). Lo que guarda y valida es lo de hoy:
// guardarAMano, validar y anular (diarioService), con la misma comprobación (problemasMano).
//
// El teclado: Intro de casilla en casilla y, al final de la línea, la siguiente; con el asiento
// cuadrado y la línea nueva vacía, Intro guarda y pasa al siguiente (la maqueta). F4 en la cuenta
// busca; F5 y F8 son del marco (nucleo/teclado.ts: la fila lleva `data-cuenta`); Esc lo deja sin
// guardar, con la pregunta del K03 (useAvisoSalir).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { rutaAsiento, rutaLibroDiario, rutaMayor, rutaNuevoAsiento } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { BuscarCuentaHoja } from '@/modules/conta/diseno/plantillas'
import { useAvisoSalir } from '@/modules/conta/diseno/plantillas/avisoSalir'
import { useNombreDePestana, useSeVe } from '@/modules/conta/diseno/plantillas/pestana'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { problemasMano, type AsientoDiario, type LineaMano } from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE, SERIES, type Serie } from '@/modules/conta/lib/libro'
import { atajoDeSubcuenta, conConceptoDeCabecera, cuadrarLaUltima, importeEscrito, lineaNueva, siguienteCasilla, totales, type Casilla } from '@/modules/conta/lib/asientoNucleo'
import { anular, cuentasDeApunte, guardarAMano, leerAsiento, leerEjercicios, localesDeLaCuenta, validar, type CuentaPlan, type EjercicioLibro, type LocalEmpresa } from '@/modules/conta/services/diarioService'
import { guardarExpedidaPdf } from '@/modules/conta/services/documentosService'
import { useLeer } from '@/modules/conta/libros/contexto'
import './asiento.css'
import { asientosDeAlLado, leerMayorDeCuenta, type MovimientoMayor } from '@/modules/conta/services/asientoNucleoService'
import { useFicheroElegido } from '@/modules/conta/libro/ficheroElegido'
import { claseDeFichero, motivoExpedida } from '@/modules/conta/lib/expedidaPdf'

/** «1.850,00» */
const cifra = importeEscrito
const ddmmaaaa = (f: string) => f.split('-').reverse().join('/')
/** «31/07/2026», «31/7/26» o «31/7» (del año de la fecha de antes) → «2026-07-31»; null si no es una fecha. */
function leerFecha(t: string, antes: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t.trim())
  if (!m) return null
  const a = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : antes.slice(0, 4)
  const f = `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = new Date(`${f}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f ? null : f
}
const DIGITOS_POR_DEFECTO = 8

interface Base { cuentas: CuentaPlan[]; locales: LocalEmpresa[]; ejercicios: EjercicioLibro[] }

export function FichaAsiento({ entryId }: { entryId?: string }) {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const seVe = useSeVe()
  const { local: ejeLocal } = useAnalitica()

  const [base, setBase] = useState<Base | null>(null)
  const [existente, setExistente] = useState<AsientoDiario | null | 'no'>(entryId ? null : 'no')
  const [fallo, setFallo] = useState<string | null>(null)
  // La confirmación de lo último hecho (regla 8). Al pasar al siguiente, viaja con la navegación: la ficha se monta de nuevo.
  const location = useLocation()
  const [hecho, setHecho] = useState<{ texto: string; id: string } | null>((location.state as { hecho?: { texto: string; id: string } } | null)?.hecho ?? null)
  const [vuelta, setVuelta] = useState(0)
  useEffect(() => {
    if (cargando || !accountId || !activa) return
    let vivo = true
    Promise.all([cuentasDeApunte(accountId, activa.id), localesDeLaCuenta(accountId), leerEjercicios(accountId, activa.id), entryId ? leerAsiento(accountId, entryId) : Promise.resolve(null)])
      .then(([cuentas, locales, ejercicios, a]) => { if (vivo) { setBase({ cuentas, locales, ejercicios }); setExistente(entryId ? a ?? 'no' : 'no') } },
        (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, entryId, vuelta])

  const unLocal = base && base.locales.length === 1 ? base.locales[0].id : null
  const asiento = existente && existente !== 'no' ? existente : null
  const editable = !entryId
  const nombreEstado = !asiento ? 'Nuevo' : asiento.estado === 'propuesto' ? 'Propuesto' : asiento.estado === 'borrador' ? 'Borrador' : asiento.estado === 'anulado' ? 'Anulado' : 'Validado'

  // ── Lo que se escribe (nuevo) ──
  const [fecha, setFecha] = useState(hoyEnMadrid())
  const [fechaEscrita, setFechaEscrita] = useState(ddmmaaaa(hoyEnMadrid()))
  const [serie, setSerie] = useState<Serie>(4)
  const [concepto, setConcepto] = useState('')
  const [lineas, setLineas] = useState<LineaMano[]>([lineaNueva('', null, null)])
  const [rellenada, setRellenada] = useState<number | null>(null)
  const [intentado, setIntentado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [buscando, setBuscando] = useState<number | null>(null)
  const [fila, setFila] = useState(0)
  const [pdf, elegirPdf] = useFicheroElegido()
  const rejilla = useRef<HTMLDivElement | null>(null)

  const porCodigo = useMemo(() => new Map((base?.cuentas ?? []).map((c) => [c.code, c])), [base])
  const porId = useMemo(() => new Map((base?.cuentas ?? []).map((c) => [c.id, c])), [base])
  const digitos = base?.cuentas[0]?.code.length ?? DIGITOS_POR_DEFECTO
  const plan = useMemo(() => (base?.cuentas ?? []).map((c) => ({ code: c.code, nombre: c.nombre })), [base])
  const codigos = useMemo(() => new Set(plan.map((c) => c.code)), [plan])
  // El local (no está en la maqueta ni en ERP10; hoy, sin él, no se guarda con el eje «local» encendido):
  // con uno, ese; sin ninguno, «común» (lo único que ofrece hoy la pantalla); con varios, la columna «Local».
  const sinLocales = !!base && base.locales.length === 0
  const columnaLocal = !!ejeLocal && !!base && base.locales.length > 1
  const conLocal = (ls: readonly LineaMano[]) => ls.map((l) => (!ejeLocal ? { ...l, localId: null, comun: false }
    : sinLocales ? { ...l, localId: null, comun: true } : { ...l, localId: l.comun ? null : l.localId ?? unLocal }))
  const usadas = lineas.filter((l) => l.cuenta.trim() || l.debe.trim() || l.haber.trim())
  const t = asiento
    ? { debe: asiento.apuntes.reduce((s, a) => s + a.debe, 0), haber: asiento.apuntes.reduce((s, a) => s + a.haber, 0), descuadre: 0, cuadra: true }
    : totales(usadas)
  if (asiento) t.descuadre = Math.round((t.debe - t.haber) * 100) / 100
  const problemas = editable ? problemasMano(concepto, fecha, conLocal(usadas), codigos, !!ejeLocal) : []
  const ejercicio = base?.ejercicios.find((e) => fecha >= e.inicio && fecha <= e.fin) ?? null

  const hayCambios = editable && (concepto.trim() !== '' || usadas.length > 0)
  const nuevoVacio = () => { setConcepto(''); setLineas([lineaNueva('', null, unLocal)]); setFila(0); setRellenada(null); setIntentado(false); setFallo(null); elegirPdf(null) }
  const { pedirSalir, aviso } = useAvisoSalir({
    hay: hayCambios, cambios: hayCambios ? [{ campo: 'asiento', etiqueta: 'El asiento', antes: '', ahora: concepto || 'sin concepto' }] : [],
    donde: concepto ? `Asiento · ${concepto}` : 'Asiento nuevo',
    onGuardar: async () => (await guardar()) ? true : (problemas[0] ?? fallo ?? 'No se ha guardado.'),
    onDescartar: nuevoVacio,
  })
  useNombreDePestana(asiento ? `Asiento · ${asiento.numero ? `${asiento.serie} / ${asiento.numero}` : asiento.concepto}` : concepto ? `Asiento · ${concepto}` : 'Asiento nuevo')

  // ‹ ›: el de antes y el de después.
  const [lado, setLado] = useState<{ antes: string | null; despues: string | null }>({ antes: null, despues: null })
  useEffect(() => {
    if (!accountId || !activa || existente === null) return
    let vivo = true
    asientosDeAlLado(accountId, activa.id, asiento ? { id: asiento.id, fecha: asiento.fecha } : null).then((x) => { if (vivo) setLado(x) }, () => undefined)
    return () => { vivo = false }
  }, [accountId, activa, existente, asiento])
  const ir = (id: string | null) => { if (id) pedirSalir(() => navegar(rutaAsiento(id))) }

  // ── La rejilla ──
  const foco = useRef<{ fila: number; casilla: Casilla } | null>(null)
  useEffect(() => {
    if (!foco.current) return
    rejilla.current?.querySelector<HTMLElement>(`[data-fila="${foco.current.fila}"][data-casilla="${foco.current.casilla}"]`)?.focus()
    foco.current = null
  })
  function cambia(i: number, c: Partial<LineaMano>) {
    // Lo que rellenó Sumied para cuadrar se quita si se escribe en el otro lado (una línea va a un lado).
    const quitar: Partial<LineaMano> = rellenada === i ? (c.debe !== undefined && lineas[i].haber ? { haber: '' } : c.haber !== undefined && lineas[i].debe ? { debe: '' } : {}) : {}
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...c, ...quitar } : l)))
    if (rellenada === i && (c.debe !== undefined || c.haber !== undefined)) setRellenada(null)
  }
  function ponerCuenta(i: number, texto: string): boolean {
    const a = atajoDeSubcuenta(texto, digitos, plan)
    if (a.codigo) { cambia(i, { cuenta: a.codigo }); return true }
    if (a.candidatas.length > 1 || (texto.trim() && !codigos.has(texto.trim()))) { setBuscando(i); return false }
    return true
  }
  function otraLinea() {
    setLineas((ls) => {
      const sig = [...ls, lineaNueva(concepto, ls[ls.length - 1] ?? null, unLocal)]
      foco.current = { fila: sig.length - 1, casilla: 'subcuenta' }
      return sig
    })
  }
  function alSalirDeLaCuenta(i: number) {
    // La última línea cuadra sola en cuanto tiene su cuenta (Julio, 23/10).
    if (i !== lineas.length - 1) return
    const r = cuadrarLaUltima(lineas.slice(0, i + 1))
    if (r.rellena) { setLineas(r.lineas); setRellenada(i) }
  }
  function teclasRejilla(e: KeyboardEvent<HTMLInputElement>, i: number, casilla: Casilla) {
    if (e.key === 'F4' && casilla === 'subcuenta' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setBuscando(i); return }
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    e.preventDefault()
    const l = lineas[i]
    if (casilla === 'subcuenta') {
      // Línea nueva vacía y el asiento cuadrado: Intro guarda y pasa al siguiente.
      if (!l.cuenta.trim() && i === lineas.length - 1 && i > 0 && t.cuadra) { void guardarYSiguiente(); return }
      if (!ponerCuenta(i, l.cuenta)) return
      if (i === lineas.length - 1) {
        const r = cuadrarLaUltima(lineas.map((x, j) => (j === i ? { ...x, cuenta: atajoDeSubcuenta(l.cuenta, digitos, plan).codigo ?? x.cuenta } : x)))
        if (r.rellena) { setLineas(r.lineas); setRellenada(i); foco.current = { fila: i, casilla: 'concepto' }; return }
      }
    }
    const s = siguienteCasilla(i, casilla, lineas.length, l)
    if (s.nuevaLinea) { otraLinea(); return }
    foco.current = { fila: s.fila, casilla: s.casilla }
    setLineas((ls) => [...ls])
  }
  function teclasCabecera(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    const campos = [...(e.currentTarget.closest('.cxa-cabecera')?.querySelectorAll<HTMLElement>('input, select') ?? [])]
    const k = campos.indexOf(e.target as HTMLElement)
    if (k >= 0 && k < campos.length - 1) campos[k + 1].focus()
    else { foco.current = { fila: 0, casilla: 'subcuenta' }; setLineas((ls) => [...ls]) }
  }

  // ── Guardar y validar (lo de hoy) ──
  async function guardar(): Promise<{ quedo: 'validado' | 'borrador'; id: string; texto: string } | false> {
    setIntentado(true); setFallo(null)
    if (!accountId || !activa || !base) return false
    if (!ejercicio) { setFallo(`No hay ejercicio para el ${ddmmaaaa(fecha)}: ábrelo en Ajustes › Ejercicio.`); return false }
    if (problemas.length) return false
    setOcupado(true)
    try {
      const id = await guardarAMano(accountId, activa.id, ejercicio.id, serie, fecha, concepto, conLocal(usadas), base.cuentas, userName)
      let texto: string
      let quedo: 'validado' | 'borrador' = 'validado'
      try {
        const v = await validar(id, userName)
        texto = `Guardado y validado: ${v.serie} / ${String(v.numero).padStart(4, '0')} · ${concepto.trim()} · ${cifra(t.debe)} al debe y al haber.`
      } catch (e) {
        texto = `Guardado como borrador, sin validar: ${e instanceof Error ? e.message : 'no ha contestado'}`
        quedo = 'borrador'
      }
      if (pdf) {
        if (serie !== 1) texto += ` El justificante (${pdf.fichero.name}) no se ha guardado: hoy solo lo lleva un asiento de la serie ${NOMBRE_SERIE[1]}.`
        else {
          try { const r = await guardarExpedidaPdf(accountId, id, pdf.fichero, userName); texto += ` Justificante adjunto: ${r.nombre}.` }
          catch (e) { texto += ` El justificante no se ha adjuntado: ${motivoExpedida(e instanceof Error ? e.message : String(e))}.` }
        }
      }
      setHecho({ texto, id })
      return { quedo, id, texto }
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha guardado.'); return false }
    finally { setOcupado(false) }
  }
  async function guardarYSiguiente() {
    const r = await guardar()
    if (!r) return
    if (r.quedo === 'validado') { nuevoVacio(); return }
    // Sin validar, no se pasa a uno en blanco: se abre ese borrador, con lo que ha dicho la base.
    nuevoVacio()
    navegar(rutaAsiento(r.id), { state: { hecho: { texto: r.texto, id: r.id } } })
  }
  async function validarPropuesto() {
    if (!asiento) return
    setOcupado(true); setFallo(null)
    try {
      const v = await validar(asiento.id, userName)
      const h = { texto: `Validado: ${v.serie} / ${String(v.numero).padStart(4, '0')} · ${asiento.concepto} · ${cifra(t.debe)} al debe y al haber.`, id: asiento.id }
      setHecho(h)
      if (lado.despues) navegar(rutaAsiento(lado.despues), { state: { hecho: h } }); else setVuelta((x) => x + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha validado.') }
    finally { setOcupado(false) }
  }
  const [anulando, setAnulando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [mas, setMas] = useState(false)
  async function hacerAnular() {
    if (!asiento || !motivo.trim()) return
    setOcupado(true); setFallo(null)
    try {
      const r = await anular(asiento.id, motivo.trim(), null, userName)
      setHecho({ texto: `Anulado con el contraasiento ${r.serie} / ${String(r.numero).padStart(4, '0')} del ${ddmmaaaa(r.fecha)}.`, id: r.contraasiento })
      setAnulando(false); setVuelta((x) => x + 1)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha anulado.') }
    finally { setOcupado(false) }
  }

  // Intro (con el foco fuera de una casilla) en un propuesto: validarlo. Esc: dejarlo sin guardar.
  const teclas = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    teclas.current = (e) => {
      if (!seVe() || e.defaultPrevented) return
      const enCasilla = (e.target as HTMLElement)?.closest?.('input, select, textarea, button, [role="dialog"]')
      if (e.key === 'Escape' && !anulando && buscando === null) { e.preventDefault(); pedirSalir(() => { nuevoVacio(); navegar(rutaLibroDiario()) }); return }
      if (e.key === 'Enter' && !enCasilla && !e.altKey && !e.shiftKey) {
        if (asiento && (asiento.estado === 'propuesto' || asiento.estado === 'borrador')) { e.preventDefault(); void validarPropuesto() }
        else if (editable && (e.ctrlKey || e.metaKey || t.cuadra)) { e.preventDefault(); void guardarYSiguiente() }
      }
    }
  })
  useEffect(() => {
    const f = (e: globalThis.KeyboardEvent) => teclas.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  // La ficha ocupa lo que queda debajo de su borde de arriba: rueda la rejilla, no la página.
  const caja = useRef<HTMLElement | null>(null)
  const [alto, setAlto] = useState<number | null>(null)
  useLayoutEffect(() => {
    const medir = () => {
      const el = caja.current
      if (!el) return
      let debajo = parseFloat(getComputedStyle(el).marginBottom) || 0
      for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
        const c = getComputedStyle(x)
        debajo += (parseFloat(c.paddingBottom) || 0) + (parseFloat(c.borderBottomWidth) || 0)
      }
      setAlto(Math.max(420, Math.floor(window.innerHeight - el.getBoundingClientRect().top - window.scrollY - debajo - 2)))
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [base, existente])

  // La cuenta de la línea elegida: la del mayor de la derecha.
  const cuentaElegida = asiento ? asiento.apuntes[fila]?.cuentaId ?? null : porCodigo.get(lineas[fila]?.cuenta.trim() ?? '')?.id ?? null
  const [panel, setPanel] = useState<'documento' | 'mayor'>('documento')

  if (fallo && !base) return <div className="cxa cx-tarjeta" role="alert">{fallo}</div>
  if (!base || existente === null) return <div className="cxa cx-tarjeta" aria-busy="true" aria-label="Cargando el asiento" />
  if (entryId && !asiento) return <div className="cxa cx-tarjeta" role="alert">Ese asiento no existe o no es de esta empresa. <Link to={rutaNuevoAsiento()}>Escribir uno nuevo</Link></div>

  const filas = asiento
    ? asiento.apuntes.map((a) => ({ cuenta: a.cuenta, nombre: a.nombreCuenta, concepto: a.concepto ?? asiento.concepto, debe: a.debe ? cifra(a.debe) : '', haber: a.haber ? cifra(a.haber) : '' }))
    : null
  const verProblemas = intentado && problemas.length > 0
  const deSumied = !!asiento && (asiento.estado === 'propuesto' || asiento.origen !== 'manual')

  return (
    <section className="cxa" ref={caja} style={alto ? { height: alto } : undefined} aria-labelledby="cxa-titulo">
      <div className="cxa-cabeza">
        <h1 className="cxa-titulo" id="cxa-titulo">Asiento</h1>
        <span className="cxa-estado">{nombreEstado}</span>
        {hecho ? (
          <span className="cxa-chip cxa-chip-hecho" role="status"><span className="cxa-punto" aria-hidden="true" />{hecho.texto} <Link to={rutaAsiento(hecho.id)}>Verlo</Link></span>
        ) : (
          <span className="cxa-chip" role="status"><span className="cxa-punto" aria-hidden="true" />
            {deSumied ? <><strong>Lo propone Sumied.</strong> {asiento?.porque ?? ''}</> : asiento ? <><strong>Lo escribiste tú.</strong></> : <><strong>Lo escribes tú.</strong></>}
          </span>
        )}
        <div className="cxa-botones">
          <button type="button" className="cxa-flecha" aria-label="El asiento de antes" disabled={!lado.antes} onClick={() => ir(lado.antes)}>‹</button>
          <button type="button" className="cxa-flecha" aria-label="El asiento de después" disabled={!lado.despues} onClick={() => ir(lado.despues)}>›</button>
          <div className="cxa-mas-caja">
            <button type="button" className="cxa-sec" aria-expanded={mas} disabled={!asiento || asiento.estado !== 'validado'} onClick={() => setMas((v) => !v)}>Más</button>
            {mas && asiento && <div className="cxa-mas" role="menu"><button type="button" role="menuitem" onClick={() => { setMas(false); setAnulando(true) }}>Anular</button></div>}
          </div>
          {editable && <button type="button" className="cxa-principal" disabled={ocupado} onClick={() => void guardarYSiguiente()}>{ocupado ? 'Guardando…' : 'Guardar y siguiente'} <kbd>Intro</kbd></button>}
          {asiento && (asiento.estado === 'propuesto' || asiento.estado === 'borrador') && (
            <button type="button" className="cxa-principal" disabled={ocupado} onClick={() => void validarPropuesto()}>{ocupado ? 'Validando…' : 'Validar y siguiente'} <kbd>Intro</kbd></button>
          )}
        </div>
      </div>

      <div className="cxa-cuerpo">
        <div className="cxa-izq">
          <div className="cxa-cabecera" onKeyDown={teclasCabecera}>
            <label className="cxa-campo cxa-fecha"><span>Fecha</span>
              {editable
                ? <input value={fechaEscrita} aria-invalid={leerFecha(fechaEscrita, fecha) === null} onChange={(e) => { setFechaEscrita(e.target.value); const f = leerFecha(e.target.value, fecha); if (f) setFecha(f) }}
                    onBlur={() => setFechaEscrita(ddmmaaaa(fecha))} />
                : <input readOnly value={ddmmaaaa(asiento!.fecha)} />}</label>
            <label className="cxa-campo cxa-serie"><span>Serie / documento</span>
              {editable ? (
                <span className="cxa-serie-doc">
                  <select aria-label="Serie" value={serie} onChange={(e) => setSerie(Number(e.target.value) as Serie)}>
                    {SERIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="cxa-doc" title="El número lo pone la validación">/ —</span>
                </span>
              ) : <input readOnly value={`${asiento!.serie} / ${asiento!.numero ? String(asiento!.numero).padStart(4, '0') : '—'}`} />}
            </label>
            <label className="cxa-campo cxa-concepto"><span>Concepto del asiento</span>
              {editable
                ? <input value={concepto} onChange={(e) => { const v = e.target.value; setLineas((ls) => conConceptoDeCabecera(ls, concepto, v)); setConcepto(v) }} />
                : <input readOnly value={asiento!.concepto} />}</label>
          </div>

          <div className="cxa-rejilla-marco" ref={rejilla}>
            <div className="cxa-rueda">
              <table className="cxa-rejilla" aria-label="Apuntes">
                <thead><tr><th className="cxa-c-cuenta">Cuenta</th><th className="cxa-c-nombre">Nombre</th><th>Concepto</th><th className="cxa-num">Debe</th><th className="cxa-num">Haber</th>{columnaLocal && !filas && <th className="cxa-c-local">Local</th>}</tr></thead>
                <tbody>
                  {filas ? filas.map((f, i) => (
                    <tr key={i} data-cuenta={f.cuenta} className={i === fila ? 'cxa-elegida' : undefined} tabIndex={0} onFocus={() => setFila(i)} onClick={() => setFila(i)}>
                      <td className="cxa-c-cuenta"><Link to={rutaMayor(f.cuenta)} tabIndex={-1}>{f.cuenta}</Link></td>
                      <td className="cxa-c-nombre">{f.nombre}</td><td className="cxa-gris">{f.concepto}</td>
                      <td className="cxa-num">{f.debe}</td><td className="cxa-num">{f.haber}</td>
                    </tr>
                  )) : lineas.map((l, i) => {
                    const cta = porCodigo.get(l.cuenta.trim())
                    return (
                      <tr key={i} data-cuenta={cta?.code} className={i === fila ? 'cxa-elegida' : undefined}>
                        <td className="cxa-c-cuenta">
                          <input data-fila={i} data-casilla="subcuenta" aria-label={`Cuenta de la línea ${i + 1}`} aria-keyshortcuts="F4" value={l.cuenta}
                            onFocus={() => setFila(i)} onChange={(e) => cambia(i, { cuenta: e.target.value })}
                            onBlur={(e) => { if (buscando === null && e.target.value.trim()) { ponerCuenta(i, e.target.value); alSalirDeLaCuenta(i) } }}
                            onKeyDown={(e) => teclasRejilla(e, i, 'subcuenta')} />
                          {buscando === i && (
                            <BuscarCuentaHoja cuentas={plan.map((c) => ({ codigo: c.code, nombre: c.nombre }))} inicial={l.cuenta}
                              alElegir={(c) => { cambia(i, { cuenta: c.codigo }); setBuscando(null); foco.current = { fila: i, casilla: 'concepto' } }}
                              alCerrar={(volver) => { setBuscando(null); if (volver) foco.current = { fila: i, casilla: 'subcuenta' } }} />
                          )}
                        </td>
                        <td className="cxa-c-nombre">{cta?.nombre ?? ''}</td>
                        <td><input className="cxa-gris" data-fila={i} data-casilla="concepto" aria-label={`Concepto de la línea ${i + 1}`} value={l.concepto}
                          onFocus={() => setFila(i)} onChange={(e) => cambia(i, { concepto: e.target.value })} onKeyDown={(e) => teclasRejilla(e, i, 'concepto')} /></td>
                        <td className="cxa-num"><span className="cxa-celda">{rellenada === i && l.debe && <small className="cxa-origen">Sumied</small>}<input inputMode="decimal" data-fila={i} data-casilla="debe" aria-label={`Debe de la línea ${i + 1}`} value={l.debe}
                          onFocus={() => setFila(i)} onChange={(e) => cambia(i, { debe: e.target.value })} onKeyDown={(e) => teclasRejilla(e, i, 'debe')} /></span></td>
                        <td className="cxa-num"><span className="cxa-celda">{rellenada === i && l.haber && <small className="cxa-origen">Sumied</small>}<input inputMode="decimal" data-fila={i} data-casilla="haber" aria-label={`Haber de la línea ${i + 1}`} value={l.haber}
                          onFocus={() => setFila(i)} onChange={(e) => cambia(i, { haber: e.target.value })} onKeyDown={(e) => teclasRejilla(e, i, 'haber')} /></span></td>
                        {columnaLocal && (
                          <td className="cxa-c-local"><select aria-label={`Local de la línea ${i + 1}`} value={l.comun ? 'comun' : l.localId ?? ''}
                            onChange={(e) => cambia(i, e.target.value === 'comun' ? { comun: true, localId: null } : { comun: false, localId: e.target.value || null })}>
                            <option value="">—</option>
                            {base.locales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                            <option value="comun">Común</option>
                          </select></td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {editable && <button type="button" className="cxa-otra" onClick={otraLinea}>+ Otra línea</button>}
            </div>
            <div className="cxa-total" aria-label="Total">
              <strong>Total</strong>
              {t.cuadra
                ? <span className="cxa-cuadra">Cuadra</span>
                : t.descuadre !== 0 ? <span className="cxa-descuadre">Descuadre {cifra(Math.abs(t.descuadre))}</span> : <span />}
              <span className="cxa-gris cxa-total-nota">Si no cuadra, lo dice aquí y no deja guardar</span>
              <span className="cxa-num cxa-total-cifra">{cifra(t.debe)}</span>
              <span className="cxa-num cxa-total-cifra">{cifra(t.haber)}</span>
            </div>
          </div>
          {(verProblemas || fallo) && (
            <div className="cxa-problemas" role="alert">{fallo ?? problemas.join(' ')}</div>
          )}
          <ul className="cxa-teclas" aria-label="Teclas">
            <li><kbd>Intro</kbd> guarda y pasa al siguiente</li>
            <li><kbd>Tab</kbd> casilla siguiente</li>
            <li><kbd>F4</kbd> busca la cuenta: escribe 6400 y sale 64000000</li>
            <li><kbd>F5</kbd> abre el mayor de la cuenta en otra pestaña</li>
            <li><kbd>F8</kbd> cambia a factura recibida o emitida</li>
            <li><kbd>Esc</kbd> lo deja sin guardar</li>
          </ul>
        </div>

        <aside className="cxa-der" aria-label="El documento y el mayor">
          <div className="cxa-pestanas" role="tablist">
            <button type="button" role="tab" aria-selected={panel === 'documento'} onClick={() => setPanel('documento')}>El documento</button>
            <button type="button" role="tab" aria-selected={panel === 'mayor'} onClick={() => setPanel('mayor')}>El mayor de la cuenta</button>
          </div>
          {panel === 'documento'
            ? <Documento pdf={pdf} elegir={elegirPdf} editable={editable} />
            : <Mayor accountId={accountId} companyId={activa?.id ?? null} cuentaId={cuentaElegida} cuenta={cuentaElegida ? porId.get(cuentaElegida) ?? null : null} ejercicio={ejercicio ?? (asiento ? base.ejercicios.find((e) => asiento.fecha >= e.inicio && asiento.fecha <= e.fin) ?? null : null)} />}
        </aside>
      </div>

      {anulando && asiento && (
        <div className="cxa-velo" role="dialog" aria-modal="true" aria-labelledby="cxa-anular">
          <div className="cxa-confirmar">
            <h2 id="cxa-anular">Anular el asiento {asiento.serie} / {String(asiento.numero ?? '').padStart(4, '0')}</h2>
            <label className="cxa-campo"><span>Por qué</span><input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
            <div className="cxa-confirmar-botones">
              <button type="button" className="cxa-principal" disabled={!motivo.trim() || ocupado} onClick={() => void hacerAnular()}>Anular</button>
              <button type="button" className="cxa-sec" onClick={() => setAnulando(false)}>Todavía no</button>
            </div>
          </div>
        </div>
      )}
      {aviso}
    </section>
  )
}

function Documento({ pdf, elegir, editable }: { pdf: { fichero: File; url: string } | null; elegir: (f: File | null) => void; editable: boolean }) {
  const [encima, setEncima] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  if (pdf) {
    return claseDeFichero(pdf.fichero.name, pdf.fichero.type)?.startsWith('image/')
      ? <img className="cxa-papel" src={pdf.url} alt={pdf.fichero.name} />
      : <iframe className="cxa-papel" src={pdf.url} title={pdf.fichero.name} />
  }
  return (
    <div className="cxa-doc-zona">
      <div className={`cxa-soltar${encima ? ' cxa-soltar-encima' : ''}`}
        onDragOver={(e) => { if (editable) { e.preventDefault(); setEncima(true) } }} onDragLeave={() => setEncima(false)}
        onDrop={(e) => { e.preventDefault(); setEncima(false); if (editable && e.dataTransfer.files[0]) elegir(e.dataTransfer.files[0]) }}
        onClick={() => { if (editable) input.current?.click() }}>
        <span className="cxa-soltar-icono" aria-hidden="true">↥</span>
        <strong>Arrastra aquí el justificante</strong>
        <span>Un PDF o una foto. El asiento se puede guardar sin documento.</span>
        <input ref={input} type="file" accept="application/pdf,image/*" hidden aria-label="Elegir el justificante" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
      </div>
    </div>
  )
}

function Mayor({ accountId, companyId, cuentaId, cuenta, ejercicio }: { accountId: string | null; companyId: string | null; cuentaId: string | null; cuenta: CuentaPlan | null; ejercicio: EjercicioLibro | null }) {
  const leido = useLeer(accountId && companyId && cuentaId && ejercicio ? () => leerMayorDeCuenta(accountId, companyId, cuentaId, ejercicio.inicio, ejercicio.fin) : null,
    `${companyId}:${cuentaId}:${ejercicio?.id}`)
  const movs: MovimientoMayor[] | null = leido.datos
  const fallo = leido.error
  if (!cuentaId || !cuenta) return <p className="cxa-mayor-nada">Elige una línea con su cuenta.</p>
  if (fallo) return <p className="cxa-mayor-nada" role="alert">{fallo}</p>
  return (
    <div className="cxa-mayor">
      <div className="cxa-mayor-cabeza"><strong>{cuenta.code}</strong> {cuenta.nombre}{ejercicio && <span className="cxa-gris"> · {ejercicio.code}</span>}<Link to={rutaMayor(cuenta.code)}>Abrir <kbd>F5</kbd></Link></div>
      <div className="cxa-rueda">
        <table className="cxa-rejilla" aria-label={`Mayor de la ${cuenta.code}`}>
          <thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th className="cxa-num">Debe</th><th className="cxa-num">Haber</th><th className="cxa-num">Saldo</th></tr></thead>
          <tbody>
            {movs === null ? <tr><td colSpan={6} className="cxa-gris">Leyendo…</td></tr>
              : movs.length === 0 ? <tr><td colSpan={6} className="cxa-gris">Sin movimientos en el ejercicio.</td></tr>
                : movs.map((m, i) => (
                  <tr key={i}><td>{m.fecha.slice(8, 10)}/{m.fecha.slice(5, 7)}</td><td>{m.serie} / {m.numero ? String(m.numero).padStart(4, '0') : '—'}</td><td>{m.concepto}</td>
                    <td className="cxa-num">{m.debe ? cifra(m.debe) : ''}</td><td className="cxa-num">{m.haber ? cifra(m.haber) : ''}</td><td className="cxa-num">{cifra(m.saldo)}</td></tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

