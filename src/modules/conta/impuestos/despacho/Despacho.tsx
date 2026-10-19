// src/modules/conta/impuestos/despacho/Despacho.tsx
//
// P01 · Impuestos › Tus clientes: «Impuestos de tus clientes»
// (maqueta_despacho.png, aprobada). Para una asesoría: todos los clientes que
// le han dado permiso, el trimestre de cada uno y presentar por lotes.
//
//   · Arriba, el trimestre y cinco cifras; la última, en rojo si hay algo que
//     vence en 2 días.
//   · Filtros que se encienden a mano (regla 7: apagados, se ven todos; con
//     alguno encendido, el pie dice «N de M clientes»).
//   · Una fila por cliente (en el móvil, una tarjeta): sus modelos como chips,
//     a ingresar, a compensar, responsable y el siguiente paso en palabras.
//     Al pulsar el nombre se abre su trimestre (hoy, su calendario; la
//     pantalla del 303 de C cuando acepte la empresa por la ruta).
//   · La barra de lotes, fija abajo, con lo elegido: solo entra lo revisado y,
//     por ahora, solo el 303 se presenta desde Sumied. Antes de presentar, la
//     confirmación con la lista; si la conexión con Hacienda está cerrada, el
//     botón dice por qué (regla 8). Por detrás, de uno en uno, con lo que ya
//     existe: conta_cert_confirmar y conta-hacienda «presentar_303».
//   · Cada cosa importante dice en pantalla qué ha pasado (regla 8).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Boton, Chip, Dialogo, Selector, Tarjeta, TarjetaCifra } from '@/modules/conta/diseno'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { rutaClienteImpuestos } from '@/config/navegacion'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { baseDeDatos } from '@/services/versionApp'
import { confirmarCertificado, hacienda, leerPuerta } from '@/modules/conta/services/impuestosService'
import { leerEquipo, leerTrimestre, ponerResponsable } from '@/modules/conta/services/despachoService'
import type { Puerta } from '@/modules/conta/impuestos/declaracion'
import {
  SIN_FILTROS, chipDeCertificado, chipDeModelo, filtrar, hayFiltros, hoyDeLaPantalla, lineaDelTrimestre, loteDe, modelosDelTrimestre,
  porQueNoPresenta, resumenLote, textoPresentar, tipoDeCliente, trimestreDe, trimestresParaElegir,
  type ClienteDespacho, type EnLote, type Filtros, type PersonaEquipo, type TrimestreDespacho,
} from './despacho'

type Aviso = { tono: 'ok' | 'falta'; texto: string } | null

export function Despacho() {
  const { accountId } = useCuentaConta()
  const { search } = useLocation()
  // «Hoy»: el de verdad; `?hoy=` solo contra una base de pruebas (demo y capturas).
  const { hoy, forzado } = useMemo(() => hoyDeLaPantalla(search, baseDeDatos().tipo !== 'pruebas'), [search])
  const opciones = useMemo(() => trimestresParaElegir(hoy), [hoy])
  const [trimestre, setTrimestre] = useState(() => trimestreDe(hoy))
  const [datos, setDatos] = useState<TrimestreDespacho | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [equipo, setEquipo] = useState<PersonaEquipo[]>([])
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS)
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set())
  const [puerta, setPuerta] = useState<Puerta | null>(null)
  const [aviso, setAviso] = useState<Aviso>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [responsableDe, setResponsableDe] = useState<ClienteDespacho | null>(null)
  const [resumen, setResumen] = useState(false)

  // Cada vez que cambia algo (o se pide otra vez), se vuelve a leer; lo que llega tarde de una lectura vieja, no pisa.
  const [vuelta, setVuelta] = useState(0)
  const cargar = useCallback(() => setVuelta((v) => v + 1), [])
  useEffect(() => {
    if (!accountId) return
    let vivo = true
    leerTrimestre(accountId, trimestre.ejercicio, trimestre.periodo, forzado ? hoy : undefined)
      .then((d) => {
        if (!vivo) return
        setError(null); setDatos(d)
        setElegidos((e) => new Set([...e].filter((id) => d.clientes.some((c) => c.empresa === id))))
      })
      .catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [accountId, trimestre, hoy, forzado, vuelta])
  useEffect(() => { if (accountId) leerEquipo(accountId).then(setEquipo).catch(() => setEquipo([])) }, [accountId])
  useEffect(() => { let vivo = true; leerPuerta().then((p) => { if (vivo) setPuerta(p) }); return () => { vivo = false } }, [])

  const clientes = useMemo(() => datos?.clientes ?? [], [datos])
  const visibles = useMemo(() => filtrar(clientes, filtros), [clientes, filtros])
  const lote = useMemo(() => loteDe(clientes.filter((c) => elegidos.has(c.empresa))), [clientes, elegidos])
  const modelos = useMemo(() => modelosDelTrimestre(clientes), [clientes])
  const r = datos?.resumen

  const elegir = (id: string, si: boolean) => setElegidos((e) => { const n = new Set(e); if (si) n.add(id); else n.delete(id); return n })

  const exportar = () => {
    const filas = [['Cliente', 'Tipo', 'Modelos', 'A ingresar', 'A compensar', 'Responsable', 'Siguiente paso']]
      .concat(visibles.map((c) => [c.nombre, tipoDeCliente(c), c.modelos.map((m) => chipDeModelo(m).texto).join(' | '),
        c.a_ingresar === null ? '' : eurosExactos(c.a_ingresar), c.a_compensar === null ? '' : eurosExactos(c.a_compensar),
        c.responsable?.nombre ?? '', c.siguiente_paso]))
    const csv = filas.map((f) => f.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const nombre = `impuestos-clientes-${trimestre.ejercicio}-${trimestre.periodo}.csv`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = nombre
    a.click()
    URL.revokeObjectURL(a.href)
    setAviso({ tono: 'ok', texto: `Exportado ${nombre}: ${visibles.length} ${visibles.length === 1 ? 'cliente' : 'clientes'}.` })
  }

  const descargar = async () => {
    const lista = lote.aPresentar
    if (lista.length === 0) { setAviso({ tono: 'falta', texto: 'No hay ningún 303 revisado entre lo elegido: no hay fichero que descargar.' }); return }
    const fallos: string[] = []
    for (const x of lista) {
      const s = await hacienda('fichero_303', { declaracion: x.modelo.declaracion })
      if (!s.ok) { fallos.push(`${x.cliente.nombre}: ${s.mensaje}`); continue }
      const texto = String(s.fichero ?? '')
      const bytes = Uint8Array.from(texto, (ch) => ch.charCodeAt(0) & 0xff)   // ISO-8859-1, como lo lee Hacienda
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' }))
      a.download = String(s.nombre ?? `303-${x.cliente.nombre}.txt`)
      a.click()
      URL.revokeObjectURL(a.href)
    }
    const bien = lista.length - fallos.length
    setAviso(fallos.length === 0
      ? { tono: 'ok', texto: `Descargados ${bien} ${bien === 1 ? 'fichero' : 'ficheros'} del 303.` }
      : { tono: 'falta', texto: `Descargados ${bien} de ${lista.length}. No se han podido: ${fallos.join(' · ')}` })
  }

  if (!accountId) return null

  return (
    <div className="s-pantalla s-despacho">
      <header className="s-despacho-cabecera">
        <div>
          <h1 className="s-despacho-titulo">Impuestos de tus clientes</h1>
          {datos && <p className="s-apoyo s-despacho-linea">{lineaDelTrimestre(datos)}{forzado && ' (fecha de prueba)'}</p>}
        </div>
        <div className="s-despacho-acciones">
          <label className="s-despacho-trimestre">
            <span className="cx-oculto">Trimestre</span>
            <Selector aria-label="Trimestre" valor={`${trimestre.ejercicio}·${trimestre.periodo}`}
              alCambiar={(v) => { const [e, p] = v.split('·'); setTrimestre({ ejercicio: Number(e), periodo: p }); setElegidos(new Set()) }}
              opciones={opciones.map((o) => ({ valor: `${o.ejercicio}·${o.periodo}`, texto: `Trimestre: ${o.ejercicio} · ${o.periodo}` }))} />
          </label>
          <Boton variante="secundario" onClick={exportar} disabled={!datos}>Exportar</Boton>
        </div>
      </header>

      {aviso && (
        <p className="s-despacho-aviso" role="status" data-tono={aviso.tono}>
          {aviso.texto} <button type="button" className="s-despacho-cerrar" onClick={() => setAviso(null)} aria-label="Cerrar el aviso">×</button>
        </p>
      )}

      {error && (
        <Tarjeta titulo="No se han podido leer los impuestos de tus clientes" tono="falta" accion={<Boton onClick={cargar}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo los impuestos de tus clientes…"><p className="s-apoyo">Un momento.</p></Tarjeta>}

      {datos && r && (
        <>
          <section className="s-despacho-cifras" aria-label="Cifras del trimestre">
            <TarjetaCifra etiqueta="Modelos del trimestre">{r.modelos}</TarjetaCifra>
            <TarjetaCifra etiqueta="Presentados">{r.presentados}</TarjetaCifra>
            <TarjetaCifra etiqueta="Revisados, listos para presentar">{r.listos}</TarjetaCifra>
            <TarjetaCifra etiqueta="Para revisar">{r.para_revisar}</TarjetaCifra>
            <TarjetaCifra etiqueta="De ellos, vencen en 2 días" tono={r.vencen > 0 ? 'falta' : 'normal'}>{r.vencen}</TarjetaCifra>
          </section>
          {r.atrasados > 0 && <p className="s-despacho-atrasados" role="note">Y {r.atrasados} {r.atrasados === 1 ? 'modelo ya venció' : 'modelos ya vencieron'} sin presentar.</p>}

          <div className="s-despacho-filtros" role="group" aria-label="Filtros">
            <Filtro activo={!hayFiltros(filtros)} alPulsar={() => setFiltros(SIN_FILTROS)}>Todos</Filtro>
            <Filtro activo={filtros.conAvisos} alPulsar={() => setFiltros((f) => ({ ...f, conAvisos: !f.conAvisos }))}>Con avisos · {r.filtros.con_avisos}</Filtro>
            <Filtro activo={filtros.listos} alPulsar={() => setFiltros((f) => ({ ...f, listos: !f.listos }))}>Listos para presentar · {r.filtros.listos}</Filtro>
            <Filtro activo={filtros.sinCertificado} alPulsar={() => setFiltros((f) => ({ ...f, sinCertificado: !f.sinCertificado }))}>Sin certificado o sin permiso · {r.filtros.sin_certificado}</Filtro>
            <label className="s-despacho-filtro-lista">
              <span className="cx-oculto">Responsable</span>
              <select aria-label="Responsable" className="s-despacho-filtro" data-activo={filtros.responsable !== null ? 'si' : undefined}
                value={filtros.responsable ?? ''} onChange={(e) => setFiltros((f) => ({ ...f, responsable: e.target.value || null }))}>
                <option value="">Responsable: todos</option>
                {equipo.map((p) => <option key={p.usuario} value={p.usuario}>Responsable: {p.nombre}</option>)}
                <option value="—">Sin responsable</option>
              </select>
            </label>
            <label className="s-despacho-filtro-lista">
              <span className="cx-oculto">Modelo</span>
              <select aria-label="Modelo" className="s-despacho-filtro" data-activo={filtros.modelo !== null ? 'si' : undefined}
                value={filtros.modelo ?? ''} onChange={(e) => setFiltros((f) => ({ ...f, modelo: e.target.value || null }))}>
                <option value="">Modelo: todos</option>
                {modelos.map((m) => <option key={m} value={m}>Modelo: {m}</option>)}
              </select>
            </label>
            <Filtro activo={filtros.domiciliados} alPulsar={() => setFiltros((f) => ({ ...f, domiciliados: !f.domiciliados }))}>Domiciliados · {r.filtros.domiciliados}</Filtro>
          </div>

          <section className="s-tarjeta s-despacho-lista" aria-label="Clientes">
            {clientes.length === 0 ? (
              <div className="s-despacho-vacio">
                <h2 className="s-tarjeta-titulo">Aún no llevas los impuestos de ningún cliente</h2>
                <p className="s-apoyo">Cuando un cliente te invite desde Sumied (Impuestos › Certificados › «Invitar a mi asesoría») y aceptes, saldrá aquí con su trimestre. Solo ves a quien te ha dado permiso.</p>
              </div>
            ) : (
              <>
                <TablaClientes clientes={visibles} elegidos={elegidos} elegir={elegir} alResponsable={setResponsableDe}
                  todosElegidos={visibles.length > 0 && visibles.every((c) => elegidos.has(c.empresa))}
                  elegirTodos={(si) => setElegidos((e) => { const n = new Set(e); for (const c of visibles) { if (si) n.add(c.empresa); else n.delete(c.empresa) } return n })} />
                <TarjetasClientes clientes={visibles} elegidos={elegidos} elegir={elegir} alResponsable={setResponsableDe} />
                <p className="s-despacho-pie">
                  {hayFiltros(filtros)
                    ? <>{visibles.length} de {clientes.length} clientes · <button type="button" className="s-despacho-enlace" onClick={() => setFiltros(SIN_FILTROS)}>quitar los filtros</button></>
                    : `${clientes.length} ${clientes.length === 1 ? 'cliente' : 'clientes'} con permiso`}
                </p>
              </>
            )}
          </section>

          {elegidos.size > 0 && (
            <BarraLote resumen={resumenLote(lote)} hayAlgo={lote.aPresentar.length > 0} texto={textoPresentar(lote)}
              alDescargar={descargar} alResumen={() => setResumen(true)} alPresentar={() => setConfirmar(true)}
              alQuitar={() => setElegidos(new Set())} />
          )}
        </>
      )}

      {confirmar && datos && (
        <ConfirmarPresentar lote={lote} puerta={puerta} puedeGestionar={datos.puede_gestionar}
          alCerrar={() => setConfirmar(false)}
          alTerminar={(a) => { setConfirmar(false); setAviso(a); setElegidos(new Set()); cargar() }} />
      )}
      {responsableDe && accountId && (
        <ElegirResponsable cliente={responsableDe} equipo={equipo} puede={datos?.puede_gestionar ?? false}
          alCerrar={() => setResponsableDe(null)}
          alGuardar={async (usuario) => {
            const s = await ponerResponsable(accountId, responsableDe.empresa, usuario)
            setResponsableDe(null); setAviso({ tono: 'ok', texto: s.mensaje }); cargar()
          }} />
      )}
      {resumen && (
        <Dialogo titulo="Enviar el resumen a los clientes" alCerrar={() => setResumen(false)}
          acciones={<Boton variante="principal" onClick={() => setResumen(false)}>Entendido</Boton>}>
          <p>El envío está preparado y <strong>cerrado</strong>: lo abre Julio cuando dé el visto bueno, y el primero será un correo de prueba.</p>
          <p className="s-apoyo">No se ha mandado nada. Cuando se abra, cada cliente elegido recibirá el resumen de su trimestre desde impuestos@sumied.com, y sus respuestas llegarán al correo de tu asesoría.</p>
        </Dialogo>
      )}
    </div>
  )
}

function Filtro({ activo, alPulsar, children }: { activo: boolean; alPulsar: () => void; children: ReactNode }) {
  return <button type="button" className="s-despacho-filtro" aria-pressed={activo} onClick={alPulsar}>{children}</button>
}

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}

function Responsable({ c, alPulsar }: { c: ClienteDespacho; alPulsar: () => void }) {
  return (
    <button type="button" className="s-despacho-responsable" onClick={alPulsar}
      aria-label={c.responsable ? `Responsable de ${c.nombre}: ${c.responsable.nombre}. Cambiar` : `${c.nombre} sin responsable. Asignar`}>
      {c.responsable
        ? <><span className="s-despacho-iniciales" aria-hidden="true">{iniciales(c.responsable.nombre)}</span>{c.responsable.nombre.split(' ')[0]}</>
        : <span className="s-despacho-sin">Asignar</span>}
    </button>
  )
}

function Chips({ c }: { c: ClienteDespacho }) {
  const cert = chipDeCertificado(c.certificado, c.pendiente)
  return (
    <span className="s-despacho-chips">
      {c.modelos.map((m) => { const v = chipDeModelo(m); return <Chip key={`${m.modelo}-${m.ejercicio}-${m.periodo}`} tono={v.tono} titulo={v.titulo}>{v.texto}</Chip> })}
      {cert && <Chip tono={cert.tono} titulo={cert.titulo}>{cert.texto}</Chip>}
      {c.modelos.length === 0 && <span className="s-apoyo">Sin modelos este trimestre</span>}
    </span>
  )
}

const importe = (n: number | null) => (n === null ? '—' : eurosExactos(n).replace(' €', ''))

function TablaClientes({ clientes, elegidos, elegir, alResponsable, todosElegidos, elegirTodos }: {
  clientes: ClienteDespacho[]; elegidos: ReadonlySet<string>; elegir: (id: string, si: boolean) => void
  alResponsable: (c: ClienteDespacho) => void; todosElegidos: boolean; elegirTodos: (si: boolean) => void
}) {
  return (
    <table className="s-tabla s-despacho-tabla" aria-label="Impuestos de tus clientes">
      <thead>
        <tr>
          <th scope="col" className="s-despacho-col-elegir">
            <input type="checkbox" aria-label="Elegir todos los que se ven" checked={todosElegidos} onChange={(e) => elegirTodos(e.target.checked)} />
          </th>
          <th scope="col">Cliente</th>
          <th scope="col">Modelos del trimestre</th>
          <th scope="col" className="s-despacho-cifra">A ingresar</th>
          <th scope="col" className="s-despacho-cifra">A compensar</th>
          <th scope="col">Responsable</th>
          <th scope="col">Siguiente paso</th>
        </tr>
      </thead>
      <tbody>
        {clientes.map((c) => (
          <tr key={c.empresa} data-elegido={elegidos.has(c.empresa) ? 'si' : undefined}>
            <td className="s-despacho-col-elegir">
              <input type="checkbox" aria-label={`Elegir ${c.nombre}`} checked={elegidos.has(c.empresa)} onChange={(e) => elegir(c.empresa, e.target.checked)} />
            </td>
            <td>
              <Link className="s-despacho-cliente" to={rutaClienteImpuestos(c.empresa)}>{c.razon_social ?? c.nombre}</Link>
              <span className="s-despacho-tipo">{tipoDeCliente(c)}</span>
            </td>
            <td><Chips c={c} /></td>
            <td className="s-despacho-cifra">{importe(c.a_ingresar)}</td>
            <td className="s-despacho-cifra">{importe(c.a_compensar)}</td>
            <td><Responsable c={c} alPulsar={() => alResponsable(c)} /></td>
            <td className="s-despacho-paso">{c.siguiente_paso}</td>
          </tr>
        ))}
        {clientes.length === 0 && (
          <tr><td colSpan={7} className="s-despacho-ninguno">Ningún cliente cumple los filtros encendidos.</td></tr>
        )}
      </tbody>
    </table>
  )
}

function TarjetasClientes({ clientes, elegidos, elegir, alResponsable }: {
  clientes: ClienteDespacho[]; elegidos: ReadonlySet<string>; elegir: (id: string, si: boolean) => void; alResponsable: (c: ClienteDespacho) => void
}) {
  return (
    <ul className="s-despacho-tarjetas" aria-label="Impuestos de tus clientes">
      {clientes.map((c) => (
        <li key={c.empresa} className="s-despacho-tarjeta" data-elegido={elegidos.has(c.empresa) ? 'si' : undefined}>
          <div className="s-despacho-tarjeta-cabeza">
            <input type="checkbox" aria-label={`Elegir ${c.nombre}`} checked={elegidos.has(c.empresa)} onChange={(e) => elegir(c.empresa, e.target.checked)} />
            <div>
              <Link className="s-despacho-cliente" to={rutaClienteImpuestos(c.empresa)}>{c.razon_social ?? c.nombre}</Link>
              <span className="s-despacho-tipo">{tipoDeCliente(c)}</span>
            </div>
          </div>
          <Chips c={c} />
          <dl className="s-despacho-datos">
            <div><dt>A ingresar</dt><dd className="s-despacho-cifra">{importe(c.a_ingresar)}</dd></div>
            <div><dt>A compensar</dt><dd className="s-despacho-cifra">{importe(c.a_compensar)}</dd></div>
            <div><dt>Responsable</dt><dd><Responsable c={c} alPulsar={() => alResponsable(c)} /></dd></div>
          </dl>
          <p className="s-despacho-paso"><span className="s-apoyo">Siguiente paso:</span> {c.siguiente_paso}</p>
        </li>
      ))}
      {clientes.length === 0 && <li className="s-despacho-ninguno">Ningún cliente cumple los filtros encendidos.</li>}
    </ul>
  )
}

function BarraLote({ resumen, hayAlgo, texto, alDescargar, alResumen, alPresentar, alQuitar }: {
  resumen: string; hayAlgo: boolean; texto: string
  alDescargar: () => void; alResumen: () => void; alPresentar: () => void; alQuitar: () => void
}) {
  return (
    <div className="s-despacho-lote" role="region" aria-label="Lo elegido">
      <p className="s-despacho-lote-resumen" aria-live="polite">{resumen}</p>
      <div className="s-despacho-lote-acciones">
        <button type="button" className="s-despacho-lote-quitar" onClick={alQuitar}>Quitar la elección</button>
        <Boton variante="secundario" onClick={alDescargar} disabled={!hayAlgo}>Descargar ficheros</Boton>
        <Boton variante="secundario" onClick={alResumen}>Enviar resumen a los clientes</Boton>
        {/* Se abre siempre: la confirmación dice qué entra y, si no se puede, por qué (regla 8). */}
        <Boton variante="principal" onClick={alPresentar}>{texto}</Boton>
      </div>
    </div>
  )
}

function LineaLote({ x }: { x: EnLote }) {
  const imp = x.modelo.importe === null ? '—' : eurosExactos(x.modelo.importe)
  const que = x.modelo.resultado === 'to_offset' ? 'a compensar' : x.modelo.resultado === 'to_refund' ? 'a devolver' : x.modelo.resultado === 'to_pay' ? 'a ingresar' : ''
  return <li><span>{x.cliente.razon_social ?? x.cliente.nombre} · {x.modelo.modelo} {x.modelo.periodo}</span><span className="s-despacho-cifra">{imp} {que}</span></li>
}

function ConfirmarPresentar({ lote, puerta, puedeGestionar, alCerrar, alTerminar }: {
  lote: ReturnType<typeof loteDe>; puerta: Puerta | null; puedeGestionar: boolean
  alCerrar: () => void; alTerminar: (a: Aviso) => void
}) {
  const [enviando, setEnviando] = useState<string | null>(null)
  const motivo = porQueNoPresenta(lote, puerta, puedeGestionar)

  const presentar = async () => {
    const hechos: string[] = []
    const fallos: string[] = []
    // De uno en uno: cada presentación con su permiso de un solo uso y su registro de uso del certificado.
    for (const x of lote.aPresentar) {
      setEnviando(`${x.cliente.nombre} · ${x.modelo.modelo}`)
      try {
        if (!x.cliente.certificado.id || !x.modelo.declaracion) throw new Error('falta el certificado o la declaración')
        const token = await confirmarCertificado(x.cliente.certificado.id, 'file', x.modelo.declaracion, x.cliente.empresa)
        const s = await hacienda('presentar_303', { declaracion: x.modelo.declaracion, confirmacion: token })
        if (!s.ok) throw new Error(s.mensaje)
        hechos.push(x.cliente.nombre)
      } catch (e) {
        fallos.push(`${x.cliente.nombre}: ${(e as Error).message}`)
      }
    }
    setEnviando(null)
    alTerminar(fallos.length === 0
      ? { tono: 'ok', texto: `Presentados ${hechos.length} ${hechos.length === 1 ? 'modelo' : 'modelos'} a Hacienda: ${hechos.join(', ')}.` }
      : { tono: 'falta', texto: `Presentados ${hechos.length} de ${lote.aPresentar.length}. No se han presentado: ${fallos.join(' · ')}` })
  }

  return (
    <Dialogo titulo="Presentar a Hacienda" alCerrar={enviando ? () => undefined : alCerrar}
      explicacion={lote.aPresentar.length > 0 ? 'Esto es lo que se va a presentar, de uno en uno, con el certificado de cada cliente.' : undefined}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar} disabled={!!enviando}>Volver</Boton>
        <Boton variante="principal" onClick={presentar} disabled={!!motivo || !!enviando}>{enviando ? `Presentando ${enviando}…` : `${textoPresentar(lote)}`}</Boton>
      </>}>
      {lote.aPresentar.length > 0 && (
        <ul className="s-despacho-confirmar" aria-label="Lo que se presenta">{lote.aPresentar.map((x) => <LineaLote key={x.modelo.declaracion} x={x} />)}</ul>
      )}
      {lote.fuera.length > 0 && (
        <>
          <p className="s-despacho-confirmar-nota">El 111 y el 115 se presentan todavía fuera de Sumied. Estos están revisados, pero no se mandan desde aquí:</p>
          <ul className="s-despacho-confirmar s-despacho-confirmar-fuera" aria-label="Lo que se presenta fuera">{lote.fuera.map((x) => <LineaLote key={x.modelo.declaracion ?? x.modelo.modelo} x={x} />)}</ul>
        </>
      )}
      {lote.sinCertificado.length > 0 && (
        <p className="s-despacho-confirmar-nota">No entran, porque su certificado no vale: {lote.sinCertificado.map((c) => c.nombre).join(', ')}.</p>
      )}
      {lote.sinRevisar > 0 && (
        <p className="s-despacho-confirmar-nota">Y {lote.sinRevisar} {lote.sinRevisar === 1 ? 'modelo elegido no está revisado' : 'modelos elegidos no están revisados'}: solo se presenta lo revisado.</p>
      )}
      {motivo && <p className="s-despacho-motivo" role="alert">{motivo}</p>}
    </Dialogo>
  )
}

function ElegirResponsable({ cliente, equipo, puede, alCerrar, alGuardar }: {
  cliente: ClienteDespacho; equipo: PersonaEquipo[]; puede: boolean
  alCerrar: () => void; alGuardar: (usuario: string | null) => Promise<void>
}) {
  const [valor, setValor] = useState(cliente.responsable?.usuario ?? '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    setGuardando(true); setError(null)
    try { await alGuardar(valor || null) } catch (e) { setError((e as Error).message); setGuardando(false) }
  }
  return (
    <Dialogo titulo={`Responsable de ${cliente.razon_social ?? cliente.nombre}`} alCerrar={alCerrar}
      explicacion="Quién de tu asesoría lleva los impuestos de este cliente. El cliente no lo ve."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" onClick={guardar} disabled={!puede || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
      </>}>
      <fieldset className="s-despacho-equipo">
        <legend className="cx-oculto">Personas de tu asesoría</legend>
        {equipo.map((p) => (
          <label key={p.usuario} className="s-despacho-persona">
            <input type="radio" name="responsable" value={p.usuario} checked={valor === p.usuario} onChange={() => setValor(p.usuario)} disabled={!puede} />
            <span className="s-despacho-iniciales" aria-hidden="true">{iniciales(p.nombre)}</span>
            {p.nombre}
          </label>
        ))}
        <label className="s-despacho-persona">
          <input type="radio" name="responsable" value="" checked={valor === ''} onChange={() => setValor('')} disabled={!puede} />
          Sin responsable
        </label>
      </fieldset>
      {!puede && <p className="s-despacho-motivo" role="note">Solo la administración o una encargada de la asesoría reparte los clientes.</p>}
      {error && <p className="s-despacho-motivo" role="alert">{error}</p>}
      {cliente.responsable && !cliente.responsable.activa && <p className="s-apoyo">{cliente.responsable.nombre} ya no está activa en tu asesoría.</p>}
    </Dialogo>
  )
}
