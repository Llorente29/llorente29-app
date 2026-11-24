// src/modules/conta/nucleo/listado/ListadoNucleo.tsx
//
// Q06 · La ventana de listado del núcleo, una sola para todos (maquetas
// nucleo_7 y nucleo_8, aprobadas por Julio el 17/11; ERP10, «Listado: Libro
// mayor de cuenta»). De arriba abajo:
//
//   1. Los listados de su grupo («Sumas y saldos · Mayor · Diario»; en el libro
//      de IVA, «Emitidas · Recibidas»), «Cuadra. 212 cuentas», «3 cosas que
//      mirar» y «Ver como se imprime». Sin «Entregar» ni «Comparar con 2025»:
//      no hay nada detrás (decisión de Julio, 19/11).
//   2. Los datos del informe: el periodo, del … al …, y de la cuenta … a la …
//      (con la lupa: F4 o escribir, cuentasQueEncajan de la K04).
//   3. El listado, que se abre hacia abajo (arbol.ts), con lo que Sumied ha
//      mirado en su fila («Mira esto.»), el total y «Abrir: todo · a 3 cifras ·
//      a 1 cifra».
//   4. A la derecha, el panel de la K04: el documento del movimiento marcado,
//      «Qué mirar» y «Abrir el asiento».
//
// «Ver como se imprime» cambia el listado por la hoja (maqueta 8), página a
// página, con Imprimir, PDF y Excel; la misma paginación que el PDF.
//
// El teclado: ↑ ↓ por las filas; → abre, ← cierra (o sube); Intro sobre un
// movimiento abre su asiento en otra pestaña (sobre un grupo, lo abre o lo
// cierra); F5, el mayor de la cuenta de la fila (el teclado común del K03: cada
// fila lleva data-cuenta); Esc en la hoja vuelve al listado y, si no, cierra la
// pestaña, como la ficha de la K04.
//
// LAS CIFRAS, LAS DE HOY (regla 31): se leen con las mismas funciones que los
// listados de hoy (librosService) y se calculan con las mismas (sumasYSaldos,
// extracto, resumir, cifrasLibro). Detrás del interruptor conta_nucleo: fuera de
// una pestaña del núcleo no se pinta nunca (ListadoSegun).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as TeclaReact } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaLibros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { usePestana, usePestanaActiva } from '@/modules/conta/diseno/plantillas'
import { useConPropias } from '@/modules/conta/marco/nuevo/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { resumir } from '@/modules/conta/lib/extractos'
import { OPCIONES_POR_DEFECTO, sumasYSaldos } from '@/modules/conta/lib/sumasSaldos'
import type { Libro } from '@/modules/conta/lib/libroRegistro'
import {
  cuentasConSaldo, datosFiscales, leerEjerciciosLibros, leerLibroRegistro, movimientoIva, movimientos, nombresPgc, planDeEmpresa, saldosCuentas,
  type Movimiento,
} from '@/modules/conta/services/librosService'
import { EstadoFicha, CasillaFecha } from '../ficha/piezas'
import { PanelDocumento } from '../ficha/PanelDocumento'
import { cuentasQueEncajan } from '../ficha/teclas'
import { conEjercicio } from '../ejercicio'
import {
  abrirHasta, arbolDiario, arbolIva, arbolMayor, arbolSumas, camino, colgar, filasDeMovimientos, periodosDe, queMirar, subtituloHoja, visibles,
  type Arbol, type Celda, type Columna, type Hasta, type QueListado,
} from './arbol'
import { excelDeLaHoja, hojaDe, nombreDeFichero, pdfDeLaHoja, textoCelda, textoPagina, textoSigue, anchosDeLaHoja } from './hoja'
import { documentoDelAsiento } from './servicio'
import './listado.css'

/** Los listados de cada grupo, como la maqueta: el segmento de arriba. */
const GRUPO: Record<QueListado, { que: QueListado; nombre: string; ruta: string }[]> = (() => {
  const generales = [
    { que: 'sumas' as const, nombre: 'Sumas y saldos', ruta: rutaLibros('mayor', 'sumas-saldos') },
    { que: 'mayor' as const, nombre: 'Mayor', ruta: rutaLibros('mayor', 'libro-mayor') },
    { que: 'diario' as const, nombre: 'Diario', ruta: rutaLibros('diario', 'diario-resumido') },
  ]
  const iva = [
    { que: 'emitidas' as const, nombre: 'Emitidas', ruta: rutaLibros('registro', 'expedidas') },
    { que: 'recibidas' as const, nombre: 'Recibidas', ruta: rutaLibros('registro', 'recibidas') },
  ]
  return { sumas: generales, mayor: generales, diario: generales, emitidas: iva, recibidas: iva }
})()

/** El ancho de cada columna en pantalla (%), el mismo en el listado y en su total. */
const ANCHOS: Record<QueListado, number[]> = {
  sumas: [17, 30, 13, 13, 13.5, 13.5],
  mayor: [13, 8, 31, 12, 12, 12, 12],
  diario: [18, 46, 18, 18],
  emitidas: [11, 15, 12, 20, 11, 6, 12, 13],
  recibidas: [11, 15, 12, 20, 11, 6, 12, 13],
}

const LIBROS: Record<'emitidas' | 'recibidas', Libro[]> = { emitidas: ['issued'], recibidas: ['received', 'investment'] }
const conCuentas = (q: QueListado) => q === 'sumas' || q === 'mayor'
const cuantasTexto = (q: QueListado, n: number) =>
  q === 'diario' ? `${n} ${n === 1 ? 'asiento' : 'asientos'}` : q === 'emitidas' || q === 'recibidas' ? `${n} ${n === 1 ? 'factura' : 'facturas'}` : `${n} ${n === 1 ? 'cuenta' : 'cuentas'}`

type Mov = Movimiento & { concepto: string }

export function ListadoNucleo({ que, cuentaDada }: { que: QueListado; cuentaDada?: string | null }) {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const pestana = usePestana()
  const viva = usePestanaActiva()
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const hoy = hoyEnMadrid()
  // Su encabezado es el suyo (el segmento de la maqueta): sin el «Ver: …» que la pestaña pone a las pantallas de hoy.
  useConPropias()

  // ── El ejercicio: el de arriba (?ejercicio=), o el de hoy.
  const ejs = useLeer(accountId && activa ? () => leerEjerciciosLibros(accountId, activa.id) : null, `${accountId}:${activa?.id}`)
  const pedido = params.get('ejercicio')
  const ejercicio = ejs.datos ? (ejs.datos.find((e) => e.code === pedido) ?? ejs.datos.find((e) => hoy >= e.inicio && hoy <= e.fin) ?? ejs.datos[0] ?? null) : null
  const periodos = useMemo(() => (ejercicio ? periodosDe(ejercicio.inicio, ejercicio.fin, hoy) : []), [ejercicio, hoy])

  // ── Los datos del informe.
  const porDefecto = () => {
    if (!ejercicio) return null
    if (que === 'emitidas' || que === 'recibidas') {
      const t = periodos.find((p) => p.id.endsWith('T') && p.desde <= hoy && hoy <= p.hasta)
      if (t) return t
    }
    return periodos.find((p) => p.id === 'hoy') ?? periodos.find((p) => p.id === 'ejercicio') ?? null
  }
  const [fechas, setFechas] = useState<{ ejercicio: string; desde: string; hasta: string } | null>(null)
  const p0 = porDefecto()
  const vigentes = fechas && ejercicio && fechas.ejercicio === ejercicio.id ? fechas : p0 && ejercicio ? { ejercicio: ejercicio.id, desde: p0.desde, hasta: p0.hasta } : null
  const desde = vigentes?.desde ?? ''
  const hasta = vigentes?.hasta ?? ''
  const elegido = periodos.find((p) => p.desde === desde && p.hasta === hasta)?.id ?? 'otras'
  const deLaDireccion = cuentaDada ?? params.get('cuenta') ?? ''
  const [rango, setRango] = useState({ desde: deLaDireccion, hasta: deLaDireccion })

  // ── Leer: con las funciones de los listados de hoy.
  const clave = `${que}:${accountId}:${activa?.id}:${ejercicio?.id}:${desde}:${hasta}:${conCuentas(que) ? `${rango.desde}-${rango.hasta}` : ''}`
  const listo = !!(accountId && activa && ejercicio && desde && hasta)
  const datos = useLeer<Arbol>(listo ? async () => {
    const empresa = activa!.id
    if (que === 'sumas') {
      const [saldos, plan] = await Promise.all([saldosCuentas(empresa, desde, hasta), planDeEmpresa(accountId!, empresa)])
      const filas = sumasYSaldos(saldos, ['grupo', 'subgrupo', 'subcuenta'], { ...OPCIONES_POR_DEFECTO, desdeCuenta: rango.desde || undefined, hastaCuenta: rango.hasta || undefined })
      const nombres = await nombresPgc(plan, filas.filter((f) => f.nivel !== 'subcuenta').map((f) => f.code))
      return arbolSumas(filas, nombres, !!(rango.desde || rango.hasta))
    }
    if (que === 'mayor') {
      // Una sola cuenta: solo la suya (como el mayor de hoy, por su prefijo). Si no, todas las del rango.
      const una = rango.desde && rango.desde === rango.hasta ? rango.desde : undefined
      const ms = await movimientos(accountId!, empresa, ejercicio!.inicio, hasta, una)
      return arbolMayor(ms, desde, hasta, rango)
    }
    if (que === 'diario') {
      const ms = await movimientos(accountId!, empresa, desde, hasta)
      return arbolDiario(resumir(ms, null), ms)
    }
    const anot = await leerLibroRegistro(accountId!, empresa, LIBROS[que], desde, hasta)
    const diario = await movimientoIva(accountId!, empresa, que === 'emitidas' ? 'issued' : 'received', desde, hasta)
    return arbolIva(anot, que === 'emitidas' ? 'issued' : 'received', diario)
  } : null, clave)

  // El árbol de esta lectura, con lo que se va colgando (los movimientos de cada subcuenta, al abrirla).
  const [arbol, setArbol] = useState<{ clave: string; a: Arbol } | null>(null)
  const a = arbol?.clave === clave ? arbol.a : datos.datos
  const [abiertas, setAbiertas] = useState<{ clave: string; ids: Set<string> } | null>(null)
  // Al abrir: sumas y saldos y el libro de IVA, a 3 cifras (como la maqueta); el mayor de una cuenta, entero; lo demás, cerrado.
  const ab = useMemo(() => (abiertas?.clave === clave ? abiertas.ids
    : a ? abrirHasta(a, que === 'sumas' || que === 'emitidas' || que === 'recibidas' ? 3 : que === 'mayor' && a.raiz.length === 1 ? 'todo' : 1) : new Set<string>()), [abiertas, clave, a, que])
  const [leyendo, setLeyendo] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const cuentas = useLeer(conCuentas(que) && activa && ejercicio ? () => cuentasConSaldo(activa.id, ejercicio.inicio, ejercicio.fin) : null, `${activa?.id}:${ejercicio?.id}`)

  /** Lee y cuelga los movimientos de unas subcuentas de sumas y saldos (de una en una, o todas de una vez). */
  const leerMovimientos = async (base: Arbol, ids: string[]): Promise<Arbol> => {
    if (!ids.length || !accountId || !activa || !ejercicio) return base
    setLeyendo((s) => new Set([...s, ...ids]))
    try {
      const codigos = ids.map((id) => base.filas.get(id)?.cuenta).filter((x): x is string => !!x)
      const porCuenta = new Map<string, Mov[]>()
      if (codigos.length > 3) {
        for (const m of await movimientos(accountId, activa.id, ejercicio.inicio, hasta)) {
          if (!porCuenta.has(m.cuenta)) porCuenta.set(m.cuenta, [])
          porCuenta.get(m.cuenta)!.push(m)
        }
      } else {
        for (const c of codigos) porCuenta.set(c, (await movimientos(accountId, activa.id, ejercicio.inicio, hasta, c)).filter((m) => m.cuenta === c))
      }
      let x = base
      // Sumas y saldos acumula desde el primer día del ejercicio (como hoy): sus movimientos, también.
      for (const id of ids) { const f = x.filas.get(id); if (f?.cuenta) x = colgar(x, id, filasDeMovimientos(f, porCuenta.get(f.cuenta) ?? [], ejercicio.inicio, hasta, 'sumas')) }
      return x
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
      return base
    } finally {
      setLeyendo((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n })
    }
  }

  const abrir = async (ids: Set<string>) => {
    if (!a) return
    setAbiertas({ clave, ids })
    const porLeer = [...ids].filter((id) => a.filas.get(id)?.porLeer && !leyendo.has(id))
    if (porLeer.length) { const x = await leerMovimientos(a, porLeer); setArbol({ clave, a: x }) }
  }
  const alternar = (id: string) => { const n = new Set(ab); if (n.has(id)) n.delete(id); else n.add(id); void abrir(n) }

  const filas = useMemo(() => (a ? visibles(a, ab) : []), [a, ab])
  const mirar = useMemo(() => (a ? queMirar(a) : []), [a])
  const cosas = mirar.length + (a?.avisos.length ?? 0)

  // ── El documento del movimiento marcado.
  const marcada = sel && a ? a.filas.get(sel) ?? null : null
  const entryId = marcada?.entryId ?? null
  // Envuelto: «sin documento» (null) no es lo mismo que «aún leyendo» (useLeer da null mientras lee). E2e 44473399528.
  const doc = useLeer(entryId && accountId ? async () => ({ doc: await documentoDelAsiento(accountId, entryId) }) : null, `doc:${entryId}`)

  // ── Moverse con el teclado.
  const tabla = useRef<HTMLTableSectionElement | null>(null)
  const enfocar = (id: string) => { setSel(id); requestAnimationFrame(() => tabla.current?.querySelector<HTMLElement>(`tr[data-fila="${CSS.escape(id)}"]`)?.focus()) }
  const abrirAsiento = (id: string | undefined) => { if (id) navegar(rutaAsiento(id)) }
  const tecla = (e: TeclaReact<HTMLTableSectionElement>) => {
    const i = filas.findIndex((v) => v.fila.id === sel)
    const v = filas[i]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const j = Math.max(0, Math.min(filas.length - 1, (i < 0 ? -1 : i) + (e.key === 'ArrowDown' ? 1 : -1)))
      if (filas[j]) enfocar(filas[j].fila.id)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const f = e.key === 'Home' ? filas[0] : filas[filas.length - 1]
      if (f) enfocar(f.fila.id)
    } else if (e.key === 'ArrowRight' && v) {
      e.preventDefault()
      if (v.conHijos && !v.abierta) alternar(v.fila.id)
      else if (v.abierta && filas[i + 1]) enfocar(filas[i + 1].fila.id)
    } else if (e.key === 'ArrowLeft' && v) {
      e.preventDefault()
      if (v.abierta) alternar(v.fila.id)
      else if (v.fila.padre) enfocar(v.fila.padre)
    } else if (e.key === 'Enter' && v) {
      e.preventDefault()
      if (v.fila.entryId) abrirAsiento(v.fila.entryId)
      else if (v.conHijos) alternar(v.fila.id)
    }
  }

  // ── La hoja (maqueta 8).
  const [imprimiendo, setImprimiendo] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hecho, setHecho] = useState<string | null>(null)
  const fiscal = useLeer(activa ? () => datosFiscales(activa.id) : null, `fiscal:${activa?.id}`)
  const hoja = useMemo(() => (a && imprimiendo ? hojaDe(a, que, {
    empresa: fiscal.datos?.razon || activa?.razonSocial || activa?.nombre || '', nif: fiscal.datos?.nif ?? activa?.nif ?? null,
    subtitulo: subtituloHoja(desde, hasta, rango, que), hoy,
  }) : null), [a, imprimiendo, que, fiscal.datos, activa, desde, hasta, rango, hoy])
  const pag = hoja ? hoja.paginas[Math.min(pagina, hoja.paginas.length - 1)] : null
  const nombre = hoja ? nombreDeFichero(hoja.titulo, desde, hasta) : ''
  useEffect(() => { if (!hecho) return; const t = window.setTimeout(() => setHecho(null), 8000); return () => window.clearTimeout(t) }, [hecho])
  const paginas = (n: number) => `${n} ${n === 1 ? 'página' : 'páginas'}`
  const bajarPdf = () => {
    if (!hoja) return
    pdfDeLaHoja(hoja).save(`${nombre}.pdf`)
    setHecho(`Bajado: ${nombre}.pdf, ${paginas(hoja.paginas.length)}.`)
  }
  const bajarExcel = () => {
    if (!hoja) return
    const ok = excelDeLaHoja(hoja, nombre)
    setHecho(ok ? `Bajado: ${nombre}.xlsx, ${hoja.paginas.reduce((x, p) => x + p.lineas.length, 0)} filas.` : 'No había nada que bajar con estas fechas.')
  }
  const imprimir = () => {
    if (!hoja) return
    const d = pdfDeLaHoja(hoja)
    d.autoPrint()
    const v = window.open(String(d.output('bloburl')), '_blank')
    setHecho(v ? `Abierta para imprimir: ${paginas(hoja.paginas.length)}.` : 'El navegador no ha dejado abrir la impresión: baja el PDF e imprímelo desde ahí.')
  }

  // Esc: en la hoja, vuelve al listado; en el listado (no en una casilla), cierra la pestaña como la ficha.
  const raiz = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!viva) return
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const foco = document.activeElement
      if (!foco || !raiz.current?.contains(foco)) return
      if (imprimiendo) { e.preventDefault(); setImprimiendo(false); return }
      if (foco.matches('input, select, textarea')) return
      if (pestana?.cerrar) { e.preventDefault(); pestana.cerrar() }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [viva, imprimiendo, pestana])

  const ir = (q: QueListado) => {
    const destino = GRUPO[que].find((x) => x.que === q)
    if (!destino || q === que) return
    navegar(`${destino.ruta}${pedido ? conEjercicio('', pedido) : ''}`)
  }
  const ponerFechas = (d: string, h: string) => { if (ejercicio) setFechas({ ejercicio: ejercicio.id, desde: d, hasta: h }) }
  const anchos = ANCHOS[que]
  const columnas = a?.columnas ?? []
  const cargando = !datos.datos && !datos.error

  return (
    <div className="kl-listado" ref={raiz} data-prueba="listado-nucleo" data-listado={que} aria-busy={cargando || undefined}>
      <header className="kl-cabecera">
        <div className="kf-segmentos kl-segmentos" role="tablist" aria-label="Listados">
          {GRUPO[que].map((x) => <button key={x.que} type="button" role="tab" aria-selected={x.que === que} onClick={() => ir(x.que)}>{x.nombre}</button>)}
        </div>
        {a && (a.cuadra === null
          ? <EstadoFicha tono="gris" fuerte={cuantasTexto(que, a.cuantas)} resto="" />
          : a.cuadra
            ? <EstadoFicha tono="verde" fuerte="Cuadra." resto={cuantasTexto(que, a.cuantas)} />
            : <EstadoFicha tono="ambar" fuerte="No cuadra." resto={cuantasTexto(que, a.cuantas)} />)}
        {a && cosas > 0 && <EstadoFicha tono="ambar" fuerte={`${cosas} ${cosas === 1 ? 'cosa' : 'cosas'} que mirar`} resto="" />}
        <div className="kl-cabecera-botones">
          <button type="button" className="kf-boton-hueco" disabled={!a} onClick={() => { setPagina(0); setImprimiendo(!imprimiendo) }}>
            {imprimiendo ? 'Volver al listado' : 'Ver como se imprime'}
          </button>
        </div>
      </header>
      <div className="kl-cuerpo">
        <div className="kl-izquierda">
          {imprimiendo && hoja && pag ? (
            <>
              <div className="kl-datos kl-barra-hoja">
                <span className="kl-apoyo" role="status">{hecho ?? 'Así sale en papel y en PDF'}</span>
                <button type="button" className="kf-flecha" aria-label="Página anterior" disabled={pag.numero <= 1} onClick={() => setPagina(pag.numero - 2)}>‹</button>
                <span data-prueba="pagina">Página {pag.numero} de {hoja.paginas.length}</span>
                <button type="button" className="kf-flecha" aria-label="Página siguiente" disabled={pag.numero >= hoja.paginas.length} onClick={() => setPagina(pag.numero)}>›</button>
                <span className="kl-hueco" />
                <button type="button" className="kf-boton-hueco" onClick={imprimir}>Imprimir</button>
                <button type="button" className="kf-boton-hueco" onClick={bajarPdf}>PDF</button>
                <button type="button" className="kf-boton-hueco" onClick={bajarExcel}>Excel</button>
              </div>
              <div className="kl-mesa">
                <article className="kl-hoja" data-apaisada={anchosDeLaHoja(que).length > 6 || undefined} aria-label={`${hoja.titulo}, página ${pag.numero}`}>
                  <header className="kl-hoja-cabecera">
                    <div><strong>{hoja.cabecera.empresa}</strong>{hoja.cabecera.nif && <span>N.I.F. {hoja.cabecera.nif}</span>}</div>
                    <div className="kl-der"><strong>{hoja.titulo}</strong><span>{hoja.cabecera.subtitulo}</span></div>
                  </header>
                  <table className="kl-hoja-tabla">
                    <colgroup>{anchosDeLaHoja(que).map((w, i, t) => <col key={i} style={{ width: `${(100 * w) / t.reduce((x, y) => x + y, 0)}%` }} />)}</colgroup>
                    <thead><tr>{hoja.columnas.map((c) => <th key={c.titulo} className={c.cifra ? 'kl-der' : undefined}>{c.titulo}</th>)}</tr></thead>
                    <tbody>
                      {pag.lineas.map((l, i) => (
                        <tr key={i} data-clase={l.clase}>{l.celdas.map((v, k) => <td key={k} className={hoja.columnas[k].cifra ? 'kl-der' : undefined}>{textoCelda(v, hoja.columnas[k])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                  <footer className="kl-hoja-pie"><span>{textoSigue(pag)}</span><span>{textoPagina(hoja, pag)}</span></footer>
                </article>
              </div>
            </>
          ) : (
            <>
              <div className="kl-datos" role="group" aria-label="Datos del informe">
                <select aria-label="Periodo" value={elegido} onChange={(e) => { const p = periodos.find((x) => x.id === e.target.value); if (p) ponerFechas(p.desde, p.hasta) }}>
                  {periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  {elegido === 'otras' && <option value="otras">Otras fechas</option>}
                </select>
                <span className="kl-apoyo">del</span>
                <CasillaFecha id="kl-desde" etiqueta="Desde" iso={desde} hoy={hoy} casilla={false} poner={(f) => f && ponerFechas(f, f > hasta ? f : hasta)} />
                <span className="kl-apoyo">al</span>
                <CasillaFecha id="kl-hasta" etiqueta="Hasta" iso={hasta} hoy={hoy} casilla={false} poner={(f) => f && ponerFechas(f < desde ? f : desde, f)} />
                {conCuentas(que) && (
                  <>
                    <span className="kl-apoyo">De la cuenta</span>
                    <CasillaCuenta id="kl-cuenta-desde" etiqueta="De la cuenta" valor={rango.desde} marca="primera" cuentas={cuentas.datos ?? []} poner={(v) => setRango((r) => ({ ...r, desde: v }))} />
                    <span className="kl-apoyo">a la</span>
                    <CasillaCuenta id="kl-cuenta-hasta" etiqueta="A la cuenta" valor={rango.hasta} marca="última" cuentas={cuentas.datos ?? []} poner={(v) => setRango((r) => ({ ...r, hasta: v }))} />
                  </>
                )}
              </div>
              <div className="kl-caja">
                <div className="kl-rueda">
                  <table className="kl-tabla" role="treegrid" aria-label={GRUPO[que].find((x) => x.que === que)?.nombre ?? 'Listado'}>
                    <colgroup>{anchos.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                    <thead><tr>{columnas.map((c) => <th key={c.titulo} className={c.cifra ? 'kl-der' : undefined}>{c.titulo}</th>)}</tr></thead>
                    <tbody ref={tabla} onKeyDown={tecla}>
                      {filas.map((v, idx) => {
                        const f = v.fila
                        const elegida = f.id === sel || (!sel && idx === 0)
                        return [
                          <tr key={f.id} data-fila={f.id} data-clase={f.clase} data-nivel={f.nivel} data-cuenta={f.cuenta} data-mirar={f.mirar ? 'si' : undefined}
                            aria-level={f.nivel + 1} aria-expanded={v.conHijos ? v.abierta : undefined} aria-selected={f.id === sel} tabIndex={elegida ? 0 : -1}
                            onClick={() => { setSel(f.id); if (v.conHijos) alternar(f.id) }} onDoubleClick={() => abrirAsiento(f.entryId)} onFocus={() => setSel(f.id)}>
                            {celdasDe(f.celdas, columnas, f.junta, f.nivel, v.conHijos, v.abierta, leyendo.has(f.id))}
                          </tr>,
                          f.mirar && (
                            <tr key={`${f.id}:mirar`} className="kl-mira" aria-hidden="false">
                              <td colSpan={columnas.length}><strong>Mira esto.</strong> {f.mirar}</td>
                            </tr>
                          ),
                        ]
                      })}
                    </tbody>
                  </table>
                  {cargando && <p className="kl-nota" aria-busy="true">Leyendo el listado…</p>}
                  {datos.error && <p className="kl-nota" data-tono="mal" role="alert">No se ha podido leer el listado: {datos.error} <button type="button" className="kf-enlace" onClick={datos.recargar}>Volver a intentarlo</button></p>}
                  {a && !filas.length && <p className="kl-nota">Sin movimientos entre el {desde.split('-').reverse().join('/')} y el {hasta.split('-').reverse().join('/')}.</p>}
                  {fallo && <p className="kl-nota" data-tono="mal" role="alert">{fallo}</p>}
                </div>
                <table className="kl-tabla kl-total" aria-label="Total">
                  <colgroup>{anchos.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
                  <tbody>
                    <tr>
                      <td colSpan={primeraCifra(columnas)}>
                        <strong>Total</strong>
                        <span className="kl-abrir">Abrir: {(['todo', 3, 1] as Hasta[]).map((h, i) => (
                          <span key={String(h)}>{i > 0 && ' · '}<button type="button" className="kf-enlace" onClick={() => a && void abrir(abrirHasta(a, h))}>{h === 'todo' ? 'todo' : h === 3 ? 'a 3 cifras' : 'a 1 cifra'}</button></span>
                        ))}</span>
                      </td>
                      {a?.total.slice(primeraCifra(columnas)).map((v, k) => <td key={k} className="kl-der" data-prueba={`total-${columnas[primeraCifra(columnas) + k]?.titulo}`}>{textoCelda(v, columnas[primeraCifra(columnas) + k])}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          <footer className="kl-ayuda">
            <span>Pulsa un grupo o una cuenta y se abre ahí mismo</span>
            <span>Pulsa un movimiento y a la derecha sale su documento</span>
            <span>Dos veces sobre un movimiento abre su asiento en otra pestaña</span>
          </footer>
        </div>
        <PanelDocumento
          documento={entryId ? (doc.error ? null : doc.datos === null ? undefined : doc.datos.doc) : null}
          sinDocumentoTexto={entryId ? 'Este movimiento no tiene documento.' : 'Marca un movimiento y aquí sale su documento.'}
          accion={<button type="button" className="kf-enlace" disabled={!entryId} onClick={() => abrirAsiento(entryId ?? undefined)}>Abrir el asiento</button>}
          otra={{
            nombre: `Qué mirar · ${cosas}`,
            contenido: (
              <div className="kl-que-mirar">
                {!cosas && a && <p className="kf-panel-nota">Nada que mirar en este listado.</p>}
                {a?.avisos.map((t) => <p key={t} className="kl-aviso">{t}</p>)}
                {mirar.length > 0 && (
                  <ul>
                    {mirar.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => { setAbiertas({ clave, ids: new Set([...ab, ...camino(a!, m.id)]) }); enfocar(m.id) }}>
                          <strong>{m.cuenta}</strong> {m.texto}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          }} />
      </div>
    </div>
  )
}

/** La primera columna de cifras (donde acaba el «Total» de la izquierda). */
const primeraCifra = (cs: readonly Columna[]): number => Math.max(1, cs.findIndex((c) => c.cifra))

/** Las celdas de una fila: la primera con su sangría y su flecha; las dos primeras juntas si la fila lo pide. */
function celdasDe(celdas: readonly Celda[], cs: readonly Columna[], junta: number | undefined, nivel: number, conHijos: boolean, abierta: boolean, leyendo: boolean) {
  const flecha = conHijos ? <span className="kl-flecha" aria-hidden="true">{leyendo ? '…' : abierta ? '⌄' : '›'}</span> : <span className="kl-flecha" aria-hidden="true" />
  const juntas = junta ?? 1
  const primera = <td key={0} colSpan={juntas > 1 ? juntas : undefined} style={{ paddingLeft: 6 + nivel * 12 }}>{flecha}{textoCelda(celdas[0], cs[0])}</td>
  const resto = celdas.slice(juntas).map((v, k) => {
    const col = cs[k + juntas]
    return <td key={k + 1} className={col?.cifra ? 'kl-der' : undefined}>{col ? textoCelda(v, col) : ''}</td>
  })
  return [primera, ...resto]
}

/** De la cuenta … a la …: se escribe como en ERP10 («4300», «430.12») y F4 o escribir enseña la lupa (cuentasQueEncajan). */
function CasillaCuenta({ id, etiqueta, valor, marca, cuentas, poner }: { id: string; etiqueta: string; valor: string; marca: string; cuentas: readonly { code: string; name: string }[]; poner: (v: string) => void }) {
  const [texto, setTexto] = useState<string | null>(null)
  const [lupa, setLupa] = useState(false)
  const [i, setI] = useState(0)
  const digitos = cuentas[0]?.code.length ?? 8
  const plan = useMemo(() => cuentas.map((c) => ({ codigo: c.code, nombre: c.name })), [cuentas])
  const t = texto ?? valor
  const encajan = lupa && t ? cuentasQueEncajan(t, plan, digitos).slice(0, 8) : lupa ? plan.slice(0, 8) : []
  const fijar = (v: string) => { poner(v); setTexto(null); setLupa(false) }
  return (
    <span className="kf-con-sugerencias">
      <input id={id} aria-label={etiqueta} className="kl-cuenta" placeholder={marca} value={t} inputMode="numeric" autoComplete="off"
        role="combobox" aria-expanded={encajan.length > 0} aria-controls={`${id}-lista`}
        onChange={(e) => { setTexto(e.target.value); setLupa(true); setI(0) }}
        onBlur={() => { if (texto !== null) fijar(texto.trim() === '' ? '' : /^\d+$/.test(texto.trim()) ? texto.trim() : valor); setLupa(false) }}
        onKeyDown={(e) => {
          if (e.key === 'F4') { e.preventDefault(); setLupa(true); setI(0); return }
          if (e.key === 'ArrowDown' && encajan.length) { e.preventDefault(); setI((x) => Math.min(encajan.length - 1, x + 1)) }
          if (e.key === 'ArrowUp' && encajan.length) { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          if (e.key === 'Enter') { e.preventDefault(); fijar(encajan[i]?.codigo ?? (texto ?? valor).trim()) }
          if (e.key === 'Escape' && lupa) { e.preventDefault(); setLupa(false) }
        }} />
      {encajan.length > 0 && (
        <ul className="kf-sugerencias" id={`${id}-lista`} role="listbox">
          {encajan.map((c, k) => (
            <li key={c.codigo} role="option" aria-selected={k === i} onMouseDown={(e) => { e.preventDefault(); fijar(c.codigo) }}>{c.codigo} · {c.nombre}</li>
          ))}
        </ul>
      )}
    </span>
  )
}

