// src/modules/conta/libros/TraerErp10.tsx
//
// N07 · «Traer de ERP10» (las maquetas aprobadas el 17/11: maqueta_traer_paso1_empresa_nueva,
// _paso1_un_ejercicio, _paso2 y _paso3). Se sueltan los Excel que saca ERP10, se ve lo que entra, se
// trae en prueba y se da por bueno o se deshace.
//
//   Paso 1 · «Sube los ficheros»: los dos modos, la tabla de qué es cada fichero (con «Leído», «Mira
//   esto» y «Falta»), la zona de soltar, las comprobaciones que se pueden afirmar y «Qué mirar antes de
//   traerlo». Todo se lee en el navegador, con los lectores del N04: no se guarda nada.
//   Paso 2 · «Mira lo que entra»: qué entra, cuántos, importe y cómo entra; lo que hay que decidir; y
//   «Traerlo», que lo mete en prueba (conta_traer_cargar) y dice qué ha entrado (regla 8).
//   Paso 3 · «Comprueba que queda igual»: cuenta a cuenta contra el sumas y saldos de ERP10, las que no
//   quedan igual primero; «Darlo por bueno» (con su confirmación) y «Deshacer el traspaso».
//
// Mientras hay algo traído en prueba, la pantalla abre directamente en el paso 3: se da por bueno o se
// deshace antes de traer otra cosa (la base tampoco deja traer dos a la vez).
//
// Se ve igual que «Salida a ERP10» (X04): usa sus mismas piezas (las clases cxe-*, de erp10.css). Lo que
// la salida no tiene (los modos, la zona de soltar, las etiquetas del paso 3, la confirmación) va en
// traer-erp10.css, con clases cxt-*.

import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros } from '@/config/navegacion'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import {
  frasePagado, MODOS, SIN_CUENTA_DE_GASTO, SIN_SALDOS, TODAVIA_NO, abrirExcel, avisosPaso1, avisosPaso2, comprobacionesPaso1, filasPaso1,
  conLoDeLaTabla, filasPaso2, lineaDadoPorBueno, lineaDeshecho, filasPaso3, leerCarga, lineaEnPrueba, paraLaBase, puedeTraer, puedeVerLoQueEntra, queSeTrajoSoloCuentas, soloCuentas,
  soltadosQueNoSeTraen,
  type Aviso, type Modo, type Subido,
} from '@/modules/conta/lib/traer'
import { antesDeDarlo, asientosApuntados, darPorBueno, deshacer, diaDeInicio, leerEnPrueba, leerUltima, leerYaEnSumied, resumenPagado, traer, type Ultima } from '@/modules/conta/services/traerService'

// Con el punto de los miles también en las de cuatro cifras («1.650,00», como en la maqueta): el español de serie no lo pone.
const n = (x: number | undefined) => (x ?? 0).toLocaleString('es-ES')
const euros = (x: number) => x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)
/** «Dos cosas que decidir · 2», o «Nada que decidir». */
const decidir = (n: number) => (n === 0 ? 'Nada que decidir' : `${n === 1 ? 'Una cosa' : n === 2 ? 'Dos cosas' : `${n} cosas`} que decidir · ${n}`)
const ETIQUETA = { leido: ['cxe-etq-listo', 'Leído'], mira: ['cxe-etq-mira', 'Mira esto'], falta: ['cxe-etq-gris', 'Falta'] } as const

/** Abre lo que se suelta: los que no son un Excel se dicen, no se pierden. */
async function abrir(fs: FileList | File[]): Promise<Subido[]> {
  return Promise.all([...fs].map(async (f): Promise<Subido> => {
    try { return abrirExcel(f.name, await f.arrayBuffer()) } catch (e) { return { nombre: f.name, noSeAbre: e instanceof Error ? e.message : 'no se abre' } }
  }))
}

export function TraerErp10() {
  const L = useLibros()
  const [vuelta, setVuelta] = useState(0)
  // Envuelto, para distinguir «todavía leyendo» (null) de «no hay nada en prueba» ({ p: null }).
  const enPrueba = useLeer(async () => ({ p: await leerEnPrueba(L.accountId, L.companyId) }), `${L.companyId}:${vuelta}:${L.vuelta}`)
  const ultima = useLeer(() => leerUltima(L.accountId, L.companyId), `${L.companyId}:${vuelta}:${L.vuelta}`)
  const inicio = useLeer(() => diaDeInicio(L.companyId), `${L.companyId}:${vuelta}:${L.vuelta}`)

  const [modo, setModo] = useState<Modo>('nueva')
  const [ejercicio, setEjercicio] = useState<string>(L.ejercicio.code)
  const [subidos, setSubidos] = useState<Subido[]>([])
  const [pasoElegido, setPaso] = useState<1 | 2>(1)
  const [como, setComo] = useState(false)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [encima, setEncima] = useState(false)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<'dar' | 'deshacer' | null>(null)
  const [cuenta, setCuenta] = useState<string | null>(null)
  const elegir = useRef<HTMLInputElement | null>(null)

  const carga = useMemo(() => leerCarga(subidos), [subidos])
  const datos = useMemo(() => paraLaBase(carga), [carga])
  const p = enPrueba.datos?.p ?? null
  const paso: 1 | 2 | 3 = p ? 3 : pasoElegido
  const ej = modo === 'ejercicio' ? ejercicio : null

  // Paso 2: lo que ya está en Sumied y los asientos apuntados en el periodo de lo que entra.
  const fechas = useMemo(() => datos.asientos.map((a) => a.fecha).filter((f) => ej === null || f.startsWith(ej)).sort(), [datos, ej])
  const ya = useLeer(paso === 2 ? () => leerYaEnSumied(L.accountId, L.companyId) : null, `${L.companyId}:${paso}:${vuelta}`)
  const aMano = useLeer(paso === 2 && fechas.length ? () => asientosApuntados(L.accountId, L.companyId, fechas[0], fechas[fechas.length - 1]) : null,
    `${L.companyId}:${paso}:${fechas[0] ?? ''}:${fechas[fechas.length - 1] ?? ''}:${vuelta}`)
  // Paso 3: la frase de la base, si cuadra y con qué cuentas.
  const antes = useLeer(p ? () => antesDeDarlo(p.id) : null, `${p?.id ?? ''}:${vuelta}`)
  // N09 · Cuántas de lo traído están pagadas, con pago parcial y pendientes (lo que guardó la base al traer).
  const pagado = useLeer(p && !p.soloCuentas ? () => resumenPagado(L.accountId, p.id, p.emitidas) : null, `${p?.id ?? ''}:pagado:${vuelta}`)
  const fPagado = p && (p.pagos.length > 0 || pagado.datos) ? frasePagado(p.pagos, pagado.datos) : null

  // La página no se mueve: la pantalla ocupa lo que queda debajo de su borde de arriba (como «Salida a ERP10»).
  const caja = useRef<HTMLElement | null>(null)
  const [alto, setAlto] = useState<number | null>(null)
  useLayoutEffect(() => {
    const medir = () => {
      const el = caja.current
      if (!el) return
      let debajo = parseFloat(getComputedStyle(el).marginBottom) || 0
      for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
        const c = getComputedStyle(x)
        debajo += (parseFloat(c.paddingBottom) || 0) + (parseFloat(c.borderBottomWidth) || 0) + (parseFloat(c.marginBottom) || 0)
      }
      setAlto(Math.max(480, Math.floor(window.innerHeight - el.getBoundingClientRect().top - window.scrollY - debajo - 4)))
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [enPrueba.datos, paso])

  if (enPrueba.error) return <ErrorConReintento mensaje={enPrueba.error} reintentar={enPrueba.recargar} />
  if (!enPrueba.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Mirando si hay algo traído en prueba"><Hueso alto={40} /></div>

  async function soltar(fs: FileList | File[] | null) {
    if (!fs || !fs.length) return
    setFallo(null)
    const nuevos = await abrir(fs)
    // Uno nuevo con el mismo nombre sustituye al de antes.
    setSubidos((ant) => [...ant.filter((a) => !nuevos.some((x) => x.nombre === a.nombre)), ...nuevos])
  }
  const alSoltar = (e: DragEvent) => { e.preventDefault(); setEncima(false); void soltar(e.dataTransfer.files) }

  // La confirmación de cada botón (regla 8) es lo que la pantalla enseña DESPUÉS, leído de la base: la línea
  // «Traído en prueba el … por …» del paso 3 y, al darlo por bueno o deshacerlo, la de «lo último» del paso 1.
  // No un aviso aparte: un aviso vive en la pantalla y se pierde si se vuelve a montar (e2e 1492 y 1496).
  async function hacer(que: string, f: () => Promise<unknown>, despues?: () => void) {
    setHaciendo(que); setFallo(null)
    try {
      await f()
      despues?.()
      setVuelta((v) => v + 1)
    } catch (e) {
      setFallo(`${e instanceof Error ? e.message : 'No ha contestado.'}`)
    } finally {
      setHaciendo(null); setConfirmar(null)
    }
  }

  const pasos = (
    <ol className="cxe-pasos" aria-label="Pasos">
      <li className={`cxe-paso${paso > 1 ? ' cxe-paso-hecho' : ''}`} aria-current={paso === 1 ? 'step' : undefined}><span className="cxe-paso-num">1</span>Sube los ficheros</li>
      <li className={`cxe-paso${paso > 2 ? ' cxe-paso-hecho' : ''}`} aria-current={paso === 2 ? 'step' : undefined}><span className="cxe-paso-num">2</span>Mira lo que entra</li>
      <li className="cxe-paso" aria-current={paso === 3 ? 'step' : undefined}><span className="cxe-paso-num">3</span>Comprueba que queda igual</li>
    </ol>
  )

  // ── Paso 1 ──
  const filas1 = filasPaso1(carga, modo)
  const avisos1 = avisosPaso1(carga, modo)
  const comp1 = comprobacionesPaso1(carga)
  const ver = puedeVerLoQueEntra(carga, modo)
  const noSeTraen = soltadosQueNoSeTraen(carga, modo)
  const nAmbar1 = avisos1.filter((a) => a.tono === 'ambar').length

  // ── Paso 2 ──
  const r2 = paso === 2 && ya.datos ? filasPaso2(datos, ya.datos, ej, inicio.datos ?? null) : null
  const avisos2 = r2 ? avisosPaso2(datos, aMano.datos, r2.fuera, inicio.datos ?? null) : []
  const listo2 = !!r2 && (fechas.length === 0 || !!aMano.datos)
  const puede2 = !!r2 && listo2 && puedeTraer(r2.filas, aMano.datos)

  // ── Paso 3 ──
  const a = antes.datos
  const r3 = p && a ? filasPaso3(p.sumas, a.diferencias) : null
  const sel = r3 ? ([...r3.distintas, ...r3.iguales].find((x) => x.cuenta === cuenta) ?? r3.distintas[0] ?? null) : null
  // Solo cuentas: dicho como la tabla («0 cuentas nuevas (las 16 ya estaban), 4 proveedores y 1 cliente»).
  const queSeTrajo = p ? (p.soloCuentas ? queSeTrajoSoloCuentas(p.cuentas, p.texto)
    : `${p.cuentas.asientos ?? 0} ${p.cuentas.asientos === 1 ? 'asiento' : 'asientos'} y ${(p.cuentas.facturas_recibidas ?? 0) + (p.cuentas.facturas_emitidas ?? 0)} facturas`) : ''

  /** La frase de la base, con las cuentas dichas como la tabla cuando son solo cuentas y fichas. */
  const comoLaTabla = (frase: string) => (p?.soloCuentas ? conLoDeLaTabla(frase, queSeTrajo) : frase)
  const fraseAntes = a ? comoLaTabla(a.texto) : ''

  const avisoCaja = (x: Aviso) => x.tono === 'nota'
    ? <div key={x.id} className="cxe-nota"><p><strong>{x.titulo}</strong> {x.texto}</p></div>
    : (
      <div key={x.id} className="cxe-aviso" role="note">
        <p><strong>{x.titulo}</strong> {x.texto}</p>
        {x.lista.length > 0 && (
          <div className="cxe-aviso-botones">
            <button type="button" className="cxe-ambar" aria-expanded={abiertos.has(x.id)}
              onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n })}>
              {abiertos.has(x.id) ? 'Ocultarlos' : `Ver ${x.lista.length === 1 ? 'cuál' : `los ${x.lista.length}`}`}
            </button>
          </div>
        )}
        {abiertos.has(x.id) && <ul>{x.lista.map((l) => <li key={l}>{l}</li>)}</ul>}
      </div>
    )

  return (
    <section className="cxe cxt" aria-labelledby="cxt-titulo" ref={caja} style={alto ? { height: alto } : undefined}
      onDragOver={(e) => { if (paso === 1) { e.preventDefault(); setEncima(true) } }} onDragLeave={() => setEncima(false)} onDrop={(e) => { if (paso === 1) alSoltar(e) }}>
      <div className="cxe-cabeza">
        <h1 className="cxe-titulo" id="cxt-titulo">Traer de ERP10</h1>
        <select className="cxe-mes" aria-label="Ejercicio" value={ejercicio} disabled={paso !== 1 || modo !== 'ejercicio'} onChange={(e) => setEjercicio(e.target.value)}
          title={modo === 'nueva' ? 'Empresa nueva: se trae todo lo que lleven los ficheros' : undefined}>
          {L.ejercicios.map((x) => <option key={x.code} value={x.code}>Ejercicio {x.code}</option>)}
        </select>
        {pasos}
        <div className="cxe-botones">
          {paso === 1 && <button type="button" className="cxe-grande" disabled={!ver.puede} title={ver.porque ?? undefined} onClick={() => setPaso(2)}>Ver lo que entra</button>}
          {paso === 2 && <>
            <button type="button" className="cxe-sec" onClick={() => setPaso(1)}>Volver a los ficheros</button>
            <button type="button" className="cxe-grande" disabled={!puede2 || !!haciendo}
              onClick={() => { void hacer('Trayendo en prueba…', async () => {
                await traer(L.companyId, ej, datos, L.quien)
              }, () => { setSubidos([]); setPaso(1) }) }}>Traerlo</button>
          </>}
          {paso === 3 && <button type="button" className="cxe-grande" disabled={!a?.puede || !!haciendo} title={a && !a.puede ? fraseAntes : undefined} onClick={() => setConfirmar('dar')}>Darlo por bueno</button>}
        </div>
      </div>

      {paso === 1 && ultima.datos && <LoUltimo u={ultima.datos} />}

      {paso === 3 && p && (
        <div className="cxt-prueba" role="status">{lineaEnPrueba(p.quien, new Date(p.cuando), queSeTrajo)}</div>
      )}

      {/* ── Paso 1 · Sube los ficheros ── */}
      {paso === 1 && (
        <div className="cxe-cuerpo">
          <div className="cxe-izq">
            {/* «Cómo se saca de ERP10», aquí y no en la cabecera: con dos botones, a 1456 los pasos se pisaban (capturas de la e2e 1508). */}
            <div className="cxt-fila-modos">
              <div className="cxt-modos" role="group" aria-label="Qué traes">
                {(['nueva', 'ejercicio'] as const).map((m) => (
                  <button key={m} type="button" className="cxt-modo" aria-pressed={modo === m} onClick={() => setModo(m)}>{MODOS[m].texto}</button>
                ))}
              </div>
              <button type="button" className="cxe-enlace cxt-como" aria-expanded={como} onClick={() => setComo((v) => !v)}>Cómo se saca de ERP10</button>
            </div>
            <p className="cxt-ayuda">{MODOS[modo].ayuda}</p>
            <div className="cxe-marco">
              <div className="cxe-rueda">
                <table className="cxe-tabla" aria-label="Los ficheros">
                  <thead><tr><th>Qué</th><th>Fichero</th><th className="cxe-num">Ha leído</th><th>Cómo está</th></tr></thead>
                  <tbody>
                    {filas1.map((f) => (
                      <tr key={f.tipo} className={f.estado === 'mira' ? 'cxt-fila-mira' : undefined}>
                        <td><strong>{f.que}</strong>{f.siLoTiene && <span className="cxt-gris"> · si lo tiene</span>}</td>
                        <td>{f.fichero ?? ''}</td>
                        <td className="cxe-num cxt-leido"><strong>{f.haLeido ?? ''}</strong></td>
                        <td><span className={`cxe-etq ${ETIQUETA[f.estado][0]}`}>{ETIQUETA[f.estado][1]}</span>{f.nota}</td>
                      </tr>
                    ))}
                    <tr><td colSpan={4} className="cxt-todavia">{TODAVIA_NO}{noSeTraen.length ? ` Has soltado ${noSeTraen.join(' y ')}: se lee, pero no se trae.` : ''}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className={`cxt-soltar${encima ? ' cxt-soltar-encima' : ''}`}>
                <span className="cxt-soltar-icono" aria-hidden="true">↥</span>
                <p><strong>Arrastra aquí los ficheros, todos a la vez.</strong> Sumied reconoce cuál es cada uno por lo que lleva dentro.</p>
                <button type="button" className="cxe-sec cxt-elegir" onClick={() => elegir.current?.click()}>Elegir ficheros</button>
                <input ref={elegir} type="file" multiple accept=".xlsx,.xls" hidden aria-label="Elegir ficheros"
                  onChange={(e) => { void soltar(e.target.files); e.target.value = '' }} />
              </div>
            </div>
            {comp1.verdes.length > 0 && <ul className="cxe-comprobaciones" aria-label="Comprobaciones">{comp1.verdes.map((c) => <li key={c}>{c}</li>)}</ul>}
            {comp1.gris && <p className="cxt-gris cxt-linea">{comp1.gris}</p>}
          </div>
          <aside className="cxe-der" aria-labelledby="cxt-mirar">
            {como ? (
              <>
                <h2 className="cxe-der-titulo" id="cxt-mirar">Cómo se saca de ERP10</h2>
                <div className="cxe-der-cuerpo">
                  <div className="cxe-nota"><p><strong>Plan de cuentas.</strong> Definiciones › Plan de cuentas › «Subcuentas» › «Listado plan de cuentas», con el botón XLS.</p></div>
                  <div className="cxe-nota"><p><strong>Proveedores y clientes.</strong> Definiciones › Listados › «Clientes proveedores», con el botón XLS: uno para los proveedores y otro para los clientes.</p></div>
                  <div className="cxe-nota"><p><strong>Diario y sumas y saldos.</strong> Sus listados del año, en Excel.</p></div>
                  <div className="cxe-nota"><p><strong>Facturas emitidas y recibidas.</strong> Los libros registro de la AEAT, en Excel.</p></div>
                  <p className="cxt-gris">Se sueltan todos juntos, con el nombre que traigan: Sumied sabe cuál es cada uno por lo que lleva dentro.</p>
                </div>
              </>
            ) : (
              <>
                <h2 className="cxe-der-titulo" id="cxt-mirar">Qué mirar antes de traerlo · {nAmbar1}</h2>
                <div className="cxe-der-cuerpo">
                  {!subidos.length && <div className="cxe-nota"><p><strong>Todavía no has soltado ningún fichero.</strong> Con el plan de cuentas y los proveedores ya puedes traer las cuentas y las fichas; el diario y las facturas, cuando los tengas.</p></div>}
                  {avisos1.map(avisoCaja)}
                  {subidos.length > 0 && nAmbar1 === 0 && <div className="cxe-nota"><p><strong>Nada que mirar.</strong> Todo lo leído cuadra.</p></div>}
                  <p className="cxt-gris">Lo que ERP10 no saca en un fichero (la cuenta de gasto de cada proveedor, su IVA, su retención, cómo se paga) Sumied lo aprende de las facturas del año. No se rellena a mano.</p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* ── Paso 2 · Mira lo que entra ── */}
      {paso === 2 && (
        <div className="cxe-cuerpo">
          <div className="cxe-izq">
            <div className="cxe-marco">
              <div className="cxe-rueda">
                {!r2 && !ya.error && <div aria-busy="true" aria-label="Mirando lo que ya está en Sumied"><Hueso alto={160} /></div>}
                {ya.error && <p className="cxe-mal" role="alert">No se ha podido mirar lo que ya está en Sumied: {ya.error}</p>}
                {r2 && (
                  <table className="cxe-tabla" aria-label="Qué entra">
                    <thead><tr><th>Qué entra</th><th className="cxe-num">Cuántos</th><th className="cxe-num">Importe</th><th>Cómo entra</th></tr></thead>
                    <tbody>
                      {r2.filas.map((f) => (
                        <tr key={f.id} className={f.mira ? 'cxt-fila-mira' : undefined}>
                          <td><strong>{f.que}</strong></td><td className="cxe-num"><strong>{f.cuantos}</strong></td>
                          <td className="cxe-num">{f.importe === null ? '' : euros(f.importe / 100)}</td><td>{f.como}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="cxe-pie cxt-pie"><strong>Todavía no se ha guardado nada.</strong><span className="cxe-pie-gris">«Traerlo» lo mete en prueba, todo o nada. Se puede deshacer entero hasta que lo des por bueno.</span></div>
            </div>
          </div>
          <aside className="cxe-der" aria-labelledby="cxt-decidir">
            <h2 className="cxe-der-titulo" id="cxt-decidir">{decidir(avisos2.filter((x) => x.tono === 'ambar').length)}</h2>
            <div className="cxe-der-cuerpo">
              {aMano.error && <div className="cxe-aviso" role="alert"><p>No se ha podido mirar si hay asientos apuntados: {aMano.error}</p></div>}
              {avisos2.map(avisoCaja)}
              {soloCuentas(carga) && <div className="cxe-nota"><p><strong>Sin la cuenta de gasto.</strong> {SIN_CUENTA_DE_GASTO}</p></div>}
            </div>
          </aside>
        </div>
      )}

      {/* ── Paso 3 · Comprueba que queda igual ── */}
      {paso === 3 && p && (
        <div className="cxe-cuerpo">
          <div className="cxe-izq">
            <div className="cxt-chips">
              <span className="cxt-chip cxt-chip-verde">Traído en prueba</span>
              {a && !p.soloCuentas && (a.comparado
                ? (r3 && r3.distintas.length
                  ? <span className="cxt-chip cxt-chip-ambar">{r3.distintas.length} {r3.distintas.length === 1 ? 'cuenta' : 'cuentas'} con diferencia</span>
                  : <span className="cxt-chip cxt-chip-verde">Cuadra con el sumas y saldos</span>)
                : <span className="cxt-chip">Sin el sumas y saldos: no se puede comparar</span>)}
              {!p.soloCuentas && <span className="cxt-chip">IVA: sin los 303 no se puede comprobar</span>}
              <button type="button" className="cxe-enlace cxt-deshacer" disabled={!!haciendo} onClick={() => setConfirmar('deshacer')}>Deshacer el traspaso</button>
            </div>
            <div className="cxe-marco">
              <div className="cxe-rueda">
                {antes.error && <p className="cxe-mal" role="alert">No se ha podido comparar: {antes.error}</p>}
                {!a && !antes.error && <div aria-busy="true" aria-label="Comparando"><Hueso alto={160} /></div>}
                {a && p.soloCuentas && <>
                  <table className="cxe-tabla" aria-label="Lo traído">
                    <thead><tr><th>Qué se ha traído</th><th className="cxe-num">Cuántos</th><th>Cómo ha entrado</th></tr></thead>
                    <tbody>
                      <tr><td><strong>Cuentas</strong></td><td className="cxe-num"><strong>{n(p.cuentas.cuentas_nuevas)} {p.cuentas.cuentas_nuevas === 1 ? 'nueva' : 'nuevas'}</strong></td>
                        <td>{p.cuentas.cuentas_estaban ? `${p.cuentas.cuentas_estaban === 1 ? 'La otra ya estaba' : `Las otras ${n(p.cuentas.cuentas_estaban)} ya estaban`} en Sumied` : 'Con sus números de ERP10'}</td></tr>
                      <tr><td><strong>Proveedores y clientes</strong></td><td className="cxe-num"><strong>{n((p.cuentas.proveedores_nuevos ?? 0) + (p.cuentas.clientes_nuevos ?? 0))} {(p.cuentas.proveedores_nuevos ?? 0) + (p.cuentas.clientes_nuevos ?? 0) === 1 ? 'nuevo' : 'nuevos'}</strong></td>
                        <td>{p.cuentas.enlazados ? `${n(p.cuentas.enlazados)} ya ${p.cuentas.enlazados === 1 ? 'estaba' : 'estaban'} en Sumied: se ${p.cuentas.enlazados === 1 ? 'ha' : 'han'} completado con su cuenta` : 'Cada uno con su NIF y su cuenta'}</td></tr>
                    </tbody>
                  </table>
                  <p className="cxt-vacio">{SIN_SALDOS}</p>
                </>}
                {a && !p.soloCuentas && !a.comparado && <p className="cxt-vacio">No se trajo el sumas y saldos: no hay saldos de ERP10 con los que comparar. Se puede dar por bueno igual.</p>}
                {r3 && !p.soloCuentas && a?.comparado && (
                  <table className="cxe-tabla" aria-label="Cuenta a cuenta">
                    <thead><tr><th>Cuenta</th><th>Nombre</th><th className="cxe-num">Saldo en ERP10</th><th className="cxe-num">Saldo en Sumied</th><th className="cxe-num">Diferencia</th></tr></thead>
                    <tbody>
                      {r3.distintas.length > 0 && <tr className="cxt-grupo"><td colSpan={5} className="cxt-grupo-ambar">{r3.distintas.length} {r3.distintas.length === 1 ? 'cuenta no queda igual' : 'cuentas no quedan igual'}</td></tr>}
                      {r3.distintas.map((x) => (
                        <tr key={x.cuenta} className="cxe-fila cxt-fila-mira" aria-selected={sel?.cuenta === x.cuenta} tabIndex={0} onClick={() => setCuenta(x.cuenta)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setCuenta(x.cuenta) }}>
                          <td>{x.cuenta}</td><td>{x.nombre}</td><td className="cxe-num">{euros(x.erp10)}</td><td className="cxe-num">{euros(x.sumied)}</td><td className="cxe-num"><strong>{euros(x.diferencia)}</strong></td>
                        </tr>
                      ))}
                      <tr className="cxt-grupo"><td colSpan={5} className="cxt-grupo-verde">{r3.iguales.length} {r3.iguales.length === 1 ? 'cuenta queda igual' : 'cuentas quedan igual'}</td></tr>
                      {r3.iguales.map((x) => (
                        <tr key={x.cuenta}><td><Link className="cx-enlace" to={`${rutaLibros('mayor', 'libro-mayor')}?cuenta=${x.cuenta}`}>{x.cuenta}</Link></td><td>{x.nombre}</td>
                          <td className="cxe-num">{euros(x.erp10)}</td><td className="cxe-num">{euros(x.sumied)}</td><td className="cxe-num" /></tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="cxt-total">
                        <td colSpan={2}>Total de las {r3.distintas.length + r3.iguales.length} cuentas</td>
                        <td className="cxe-num">{euros(r3.total.erp10)}</td><td className="cxe-num">{euros(r3.total.sumied)}</td>
                        <td className="cxe-num">{r3.total.diferencia ? euros(r3.total.diferencia) : ''}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>
          <aside className="cxe-der" aria-labelledby="cxt-porque">
            <div className="cxt-der-cabeza">
              <h2 className="cxe-der-titulo" id="cxt-porque">{sel ? 'Por qué no queda igual' : 'Antes de darlo por bueno'}</h2>
              {sel && <Link className="cx-enlace" to={`${rutaLibros('mayor', 'libro-mayor')}?cuenta=${sel.cuenta}`}>Abrir su mayor</Link>}
            </div>
            <div className="cxe-der-cuerpo">
              {sel && <>
                <div className="cxt-sel"><span>{sel.cuenta} · {sel.nombre}</span><strong>{euros(sel.diferencia)}</strong></div>
                <div className="cxe-aviso" role="note">
                  <p><strong>En esta cuenta, lo traído no da lo mismo que el sumas y saldos de ERP10.</strong> En ERP10, {euros(sel.erp10)}; en Sumied, {euros(sel.sumied)}. Suele ser un asiento que falta o sobra en el diario que se sacó, o un sumas y saldos de otras fechas.</p>
                  <p>Mira su mayor. Si el diario de ERP10 está bien, deshaz el traspaso, vuelve a sacar los ficheros y tráelos otra vez.</p>
                  <div className="cxe-aviso-botones">
                    <button type="button" className="cxe-ambar" onClick={() => setConfirmar('deshacer')}>Deshacer el traspaso</button>
                  </div>
                </div>
              </>}
              {a && !a.puede && <div className="cxe-aviso" role="alert"><p><strong>{fraseAntes}</strong></p></div>}
              {a && a.puede && <div className="cxe-nota"><p>{fraseAntes}</p></div>}
              {/* N09 · Lo pagado y cobrado de cada factura traída: lo que no se ha podido casar, y si cuadra con el sumas y saldos. */}
              {!p.soloCuentas && fPagado && (fPagado.aviso
                ? <div className="cxe-aviso" role="note"><p><strong>{fPagado.titulo}</strong></p>{fPagado.lista.length > 0 && <ul>{fPagado.lista.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>
                : <div className="cxe-nota"><p>{fPagado.titulo}</p></div>)}
              {p.soloCuentas && <div className="cxe-nota"><p><strong>Sin la cuenta de gasto.</strong> {SIN_CUENTA_DE_GASTO}</p></div>}
              {p.mirar.length > 0 && (
                <div className="cxe-aviso" role="note">
                  <p><strong>Al traerlo {p.mirar.length === 1 ? 'se apuntó una cosa' : `se apuntaron ${p.mirar.length} cosas`}.</strong></p>
                  <ul>{p.mirar.map((m, i) => <li key={i}>{m.frase}</li>)}</ul>
                </div>
              )}
              <div className="cxe-nota"><p><strong>Al darlo por bueno queda fijo.</strong> Ya no se puede deshacer. Queda apuntado quién y cuándo. {a?.si_hay_un_error ?? ''}</p></div>
            </div>
          </aside>
        </div>
      )}

      {confirmar && p && (
        <div className="cxt-velo" role="dialog" aria-modal="true" aria-labelledby="cxt-confirmar">
          <div className="cxt-confirmar">
            <h2 id="cxt-confirmar">{confirmar === 'dar' ? 'Darlo por bueno' : 'Deshacer el traspaso'}</h2>
            <p>{confirmar === 'dar' ? fraseAntes : 'Vas a deshacer lo traído en prueba: se quita todo lo que entró y la empresa queda como estaba antes de traerlo.'}</p>
            <div className="cxt-confirmar-botones">
              {confirmar === 'dar'
                ? <button type="button" className="cxe-grande" disabled={!!haciendo}
                    onClick={() => { void hacer('Dándolo por bueno…', () => darPorBueno(p.id, L.quien)) }}>Darlo por bueno</button>
                : <button type="button" className="cxe-grande" disabled={!!haciendo}
                    onClick={() => { void hacer('Deshaciendo…', () => deshacer(p.id, L.quien)) }}>Deshacer el traspaso</button>}
              <button type="button" className="cxe-sec cxt-igual" disabled={!!haciendo} onClick={() => setConfirmar(null)}>Todavía no</button>
            </div>
          </div>
        </div>
      )}

      <div className="cxe-estado" role="status" aria-live="polite">
        {haciendo && <span>{haciendo}</span>}
        {!haciendo && paso === 1 && !ver.puede && subidos.length > 0 && <span className="cxt-gris">{ver.porque}</span>}
      </div>
      {fallo && <div className="cxe-estado cxe-mal" role="alert">{fallo}</div>}
    </section>
  )
}

/** Lo último que se dio por bueno o se deshizo, arriba del paso 1: la confirmación de esos dos botones, leída de la base. */
function LoUltimo({ u }: { u: Ultima }) {
  const cuando = new Date(u.cuando)
  // Las facturas, las que se trajeron: las emitidas traídas no existen hasta darlo por bueno, y la base las cuenta 0 al quitar.
  if (u.estado === 'deshecha') {
    const quitado = { ...u.quitado, recibidas: u.cuentas.facturas_recibidas ?? u.quitado.recibidas ?? 0, emitidas: u.cuentas.facturas_emitidas ?? u.quitado.emitidas ?? 0 }
    return <div className="cxt-prueba cxt-ultimo" role="status">{lineaDeshecho(u.quien, cuando, quitado)}</div>
  }
  const texto = u.soloCuentas && u.texto ? conLoDeLaTabla(u.texto, queSeTrajoSoloCuentas(u.cuentas, u.textoAlTraer)) : (u.texto ?? 'Hecho.')
  return (
    <div className="cxt-prueba cxt-ultimo cxt-ultimo-bueno" role="status">
      {lineaDadoPorBueno(u.quien, cuando, texto)}
      {u.soloCuentas && <> {SIN_CUENTA_DE_GASTO}</>}
    </div>
  )
}
