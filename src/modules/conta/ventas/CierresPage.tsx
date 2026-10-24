// src/modules/conta/ventas/CierresPage.tsx
//
// V01 · Entrega 2 · Ventas › Cierres del día (captura ventas_3), con la
// plantilla LISTA. Solo con «Vendo en hostelería» (la barra no la enseña sin
// ella; si se llega por la dirección, lo dice).
//
//   · Un cierre por día, local y canal (Uber, Glovo, Just Eat, TPV, tienda),
//     solo de marcas propias: es lo que propone el cierre del día cada hora.
//   · Arriba, el resumen de «ayer» (el último día con cierres) y UN principal:
//     «Validar los N listos», que valida de una vez los que no tienen nada que
//     los frene, cada uno con su factura resumen, su PDF y su asiento, y dice
//     qué ha pasado con cada uno (regla 8).
//   · «Lo que deja el cierre del día» (C11b), la cola de pedidos que esperan
//     una decisión, sigue aquí, como estaba en Ventas.
//   · Pestañas que suman «Todos» (regla 7): Por validar, En espera (con su
//     motivo en una frase, también los días que no se han podido proponer) y
//     Validados.
// Lo que se decide sin React, en lib/cierres.ts; lo que se lee y escribe, en
// services/cierresService.ts. No se envía nada a Diez al validar: entra en el
// traspaso del mes.

import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CONTA, rutaCierre, rutaConta, rutaFacturaVenta, rutaFacturasVenta } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
import { useVendePorPlataformas } from '@/modules/conta/services/plataformasCuenta'
import { diaMes, eurosExactos } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, BotonEnlace, Chip, Dialogo } from '@/modules/conta/diseno'
import { CifrasBandeja, FiltroBuscar, FiltrosLista, PestanasEstado, TablaLista, conCambio, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO_CIERRE, filtrarCierres, listos, pestanaDe, pestanasCierres, resumenDeAyer, type Cierre,
} from '@/modules/conta/lib/cierres'
import { leerCierres, validarCierre } from '@/modules/conta/services/cierresService'
import { LoQueDejaElCierre } from './LoQueDejaElCierre'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const nombreCierre = (x: Cierre) => `${x.canal}${x.marca ? ` · ${x.marca}` : ''} · ${x.local} · ${diaMes(x.dia)}`

type Paso = { id: string; ok: boolean; texto: string }

export default function CierresPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const hosteleria = useHosteleria()
  const vende = useVendePorPlataformas()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { search } = useLocation()
  const [query, setQuery] = useSearchParams()
  const [vuelta, setVuelta] = useState(0)
  const [confirmar, setConfirmar] = useState(false)
  const [validando, setValidando] = useState<{ hecho: number; total: number } | null>(null)
  const [pasos, setPasos] = useState<Paso[] | null>(null)
  const pestana = pestanaDe(query.get('ver'))
  const q = query.get('q') ?? ''
  const datos = useLeer(accountId && activa && hosteleria ? () => leerCierres(activa.id) : null, `${accountId}:${activa?.id}:cierres:${vuelta}`)
  const cambiar = (c: Record<string, string | null>) => setQuery(new URLSearchParams(conCambio(search, c)), { replace: true })

  const todos = datos.datos ?? []
  const preparados = listos(todos)
  const principal = (
    <Boton variante="principal" disabled={preparados.length === 0 || !!validando} onClick={() => { setPasos(null); setConfirmar(true) }}
      title={preparados.length === 0 ? 'Ningún cierre está listo para validar' : undefined}>
      {validando ? `Validando ${validando.hecho} de ${validando.total}…` : preparados.length ? `Validar los ${preparados.length} listos` : 'Validar los listos'}
    </Boton>
  )
  const encabezado = (
    <EncabezadoPagina titulo="Cierres del día"
      frase="Lo que vendes cada día en cada local y canal. Al validarlo se hace su factura resumen, su PDF y su asiento, y entra en el traspaso del mes."
      principal={principal} />
  )
  if (!accountId && !cargando) return <div className="s-pagina">{encabezado}<p className="s-apoyo">No hay cuenta activa: elige una cuenta para ver sus cierres.</p></div>
  if (!activa) return <div className="s-pagina">{encabezado}<p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí salen sus cierres.</p></div>
  if (!hosteleria) {
    return (
      <div className="s-pagina">
        <EncabezadoPagina titulo="Cierres del día" />
        <p className="s-apoyo">Los cierres del día son de las empresas que venden en hostelería (Ajustes › Tu empresa). Tus ventas están en <BotonEnlace a={rutaFacturasVenta()} variante="enlace">Facturas</BotonEnlace>.</p>
      </div>
    )
  }

  const pestanas = pestanasCierres(todos)
  const filas = filtrarCierres(todos, pestana, q)
  const ayer = resumenDeAyer(todos)
  const lista = rutaConta(CONTA.rutas.cierres)
  const cifras = ayer ? [
    { etiqueta: `Ayer · ${diaMes(ayer.dia)}`, valor: eurosExactos(ayer.total), apoyo: plural(ayer.tiques, 'tique', 'tiques'), a: `${lista}?ver=todos&q=${ayer.dia}` },
    ...ayer.porCanal.slice(0, 3).map((c) => ({ etiqueta: c.canal, valor: eurosExactos(c.total), apoyo: `el ${diaMes(ayer.dia)}`, a: `${lista}?ver=todos&q=${encodeURIComponent(c.canal)}` })),
    { etiqueta: 'Por validar', valor: (pestanas.find((p) => p.id === 'por-validar')?.n ?? 0).toLocaleString('es-ES'), apoyo: plural(preparados.length, 'listo', 'listos'), a: `${lista}?ver=por-validar` },
  ] : []

  const estado = (x: Cierre) => {
    const e = NOMBRE_ESTADO_CIERRE[x.estado]
    return <Chip tono={e.tono}>{e.texto}</Chip>
  }
  const columnas: ColumnaLista<Cierre>[] = [
    { id: 'dia', titulo: 'Día', prioridad: 1, minimo: 70, ancho: '80px', celda: (x) => <span className="s-cifra">{diaMes(x.dia)}</span> },
    {
      id: 'canal', titulo: 'Canal', prioridad: 1, minimo: 180,
      celda: (x) => (
        <span className="s-lista-texto-doble">
          <span className="s-lista-principal">{x.canal}{x.marca ? ` · ${x.marca}` : ''}</span>
          {x.estado === 'en_espera' && x.motivo ? <span className="s-tarjeta-apoyo" data-tono="duda">{x.motivo}</span> : <span className="s-tarjeta-apoyo">{x.local}</span>}
        </span>
      ),
    },
    { id: 'local', titulo: 'Local', prioridad: 4, minimo: 120, celda: (x) => x.local },
    { id: 'tiques', titulo: 'Tiques', cifra: true, prioridad: 3, minimo: 70, celda: (x) => x.tiques.toLocaleString('es-ES') },
    { id: 'total', titulo: 'Total', cifra: true, prioridad: 1, minimo: 110, celda: (x) => <strong>{eurosExactos(x.total)}</strong> },
    {
      id: 'factura', titulo: 'Factura', prioridad: 3, minimo: 130,
      celda: (x) => x.factura ? <span className="s-cifra">{x.factura}</span> : <span className="s-tarjeta-apoyo">{x.ajustes ? `${plural(x.ajustes, 'cambio', 'cambios')}` : '—'}</span>,
    },
    { id: 'estado', titulo: 'Estado', prioridad: 2, minimo: 120, celda: estado },
  ]
  const tarjeta = (x: Cierre) => (
    <>
      <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{x.canal}{x.marca ? ` · ${x.marca}` : ''}</span><strong className="s-cifra">{eurosExactos(x.total)}</strong></span>
      <span className="s-tarjeta-apoyo">{[diaMes(x.dia), x.local, plural(x.tiques, 'tique', 'tiques'), x.factura].filter(Boolean).join(' · ')}</span>
      <span className="s-tarjeta-pie">{estado(x)}{x.estado === 'en_espera' && x.motivo && <span className="s-tarjeta-apoyo">{x.motivo}</span>}</span>
    </>
  )
  const nombrePestana = pestanas.find((p) => p.id === pestana)?.etiqueta ?? 'Todos'
  const total = Math.round(filas.reduce((t, x) => t + (x.estado === 'anulado' ? 0 : x.total), 0) * 100) / 100

  async function validarListos() {
    setConfirmar(false)
    const xs = listos(filtrarCierres(todos, 'todos', ''))
    const hechos: Paso[] = []
    setValidando({ hecho: 0, total: xs.length })
    for (const [i, x] of xs.entries()) {
      try {
        const r = await validarCierre(x.asientoId!, userName)
        hechos.push({ id: x.id!, ok: true, texto: `${nombreCierre(x)}: validado con la factura ${r.factura ?? '—'}, su PDF y el asiento nº ${r.numero.toLocaleString('es-ES')} (${eurosExactos(x.total)}).` })
      } catch (e) {
        hechos.push({ id: x.id!, ok: false, texto: `${nombreCierre(x)}: no se ha validado. ${e instanceof Error ? e.message : String(e)}` })
      }
      setValidando({ hecho: i + 1, total: xs.length })
      setPasos([...hechos])
    }
    setValidando(null)
    setVuelta((v) => v + 1)
  }

  return (
    <div className="s-pagina" data-prueba="cierres">
      {encabezado}
      {datos.error && (
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los cierres: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>
      )}
      <div role="status" aria-live="polite">
        {pasos && (
          <div className="s-aviso-lista" data-tono={pasos.every((p) => p.ok) ? 'ok' : 'duda'} data-prueba="resultado-validar">
            <p><strong>{validando ? `Validando ${validando.hecho} de ${validando.total}…` : `${plural(pasos.filter((p) => p.ok).length, 'cierre validado', 'cierres validados')}${pasos.some((p) => !p.ok) ? ` · ${plural(pasos.filter((p) => !p.ok).length, 'no se ha validado', 'no se han validado')}` : ''}.`}</strong> Entran en el traspaso del mes.</p>
            <ul>{pasos.map((p) => <li key={p.id}>{p.ok ? '✓' : '✕'} {p.texto}</li>)}</ul>
          </div>
        )}
      </div>
      {ayer && <CifrasBandeja cifras={cifras} />}
      <LoQueDejaElCierre conPlataformas={vende} />

      <PestanasEstado etiqueta="Estado de los cierres" pestanas={pestanas} actual={pestana} alCambiar={(id) => cambiar({ ver: id === 'por-validar' ? null : id })} />
      <FiltrosLista etiqueta="Filtros de los cierres">
        <FiltroBuscar valor={q} alCambiar={(x) => cambiar({ q: x || null })} placeholder="Canal, local, día o importe" etiqueta="Buscar cierre" />
      </FiltrosLista>

      {!datos.datos && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando los cierres"><div className="s-lista-cargando" /></div>}
      {datos.datos && (
        <TablaLista<Cierre>
          etiqueta={`Cierres del día · ${nombrePestana}`}
          columnas={columnas} filas={filas} clave={(x) => x.id ?? `sin:${x.localId}:${x.dia}`} nombre={nombreCierre}
          alAbrir={(x) => { if (x.id) navegar(`${rutaCierre(x.id)}${search}`); else if (x.facturaId) navegar(rutaFacturaVenta(x.facturaId)) }}
          movil={movil} tarjeta={tarjeta}
          vacio={todos.length === 0
            ? <><strong>Aún no hay cierres.</strong> El cierre del día propone cada hora las ventas de los días ya cerrados, una por local y canal, y salen aquí.</>
            : q
              ? <>Ningún cierre con «{q}». <button type="button" className="s-boton s-boton-enlace" onClick={() => cambiar({ q: null })}>Quitar la búsqueda</button></>
              : pestana === 'por-validar' ? <>Nada por validar: todo al día.</> : <>Ninguno en «{nombrePestana}».</>}
          pie={<><span>{plural(filas.length, 'cierre', 'cierres')}</span><span className="s-lista-pie-totales"><span>Total <strong className="s-cifra">{eurosExactos(total)}</strong></span></span></>}
        />
      )}

      {confirmar && (
        <Dialogo titulo={`Validar ${plural(preparados.length, 'cierre', 'cierres')}`} alCerrar={() => setConfirmar(false)}
          explicacion="Cada uno se valida con su factura resumen (la siguiente de la serie de su canal), su PDF guardado junto al asiento y su asiento. Los que están en espera no se tocan. Entran en el traspaso del mes."
          acciones={<>
            <Boton variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
            <Boton variante="principal" onClick={() => void validarListos()}>Validar {plural(preparados.length, 'cierre', 'cierres')}</Boton>
          </>}>
          <ul className="s-apoyo">{preparados.slice(0, 8).map((x) => <li key={x.id}>{nombreCierre(x)} · {eurosExactos(x.total)}</li>)}{preparados.length > 8 && <li>y {preparados.length - 8} más</li>}</ul>
        </Dialogo>
      )}
      <BotonPulgar>{principal}</BotonPulgar>
    </div>
  )
}
