// src/modules/conta/gestoria/ClientesCuotas.tsx
//
// G01 · Tarea 4 · Ventas › Clientes y cuotas (solo en una cuenta de asesoría):
//   · en la barra de arriba, el emisor (cada empresa de la cuenta o «Los dos»);
//   · arriba, «Leer ahora» (Bitrix24 y, detrás, GoCardless) y «Tarifas»;
//   · «Te toca hoy»: lo que no cuadra entre Bitrix24, GoCardless y Sumied, un
//     chip por cosa con su número (los que dan 0 no salen), que filtran;
//   · la tabla densa: Cliente · Emisor · Figura · Servicios (C L S) ·
//     Empleados · Total al mes en Sumied · Total hoy en GoCardless · Forma de
//     cobro · Mandato · Último cobro · Diferencias;
//   · a la derecha, la ficha del cliente abierto (FichaCliente).
// Regla 7: «Todos» enseña todos y el pie dice cuántos de cuántos.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TablaDensa, type ColumnaDensa } from '@/modules/conta/ui/tabla/TablaDensa'
import { AccionesPantalla, BotonAccion } from '@/modules/conta/ui/marco/AccionesPantalla'
import { PeriodoEnBarra } from '@/modules/conta/ui/marco/PeriodoEnBarra'
import { cumpleFiltros, type CampoFiltro } from '@/modules/conta/ui/tabla/tablaDensa'
import { Vacio } from '@/modules/conta/ui/piezas'
import {
  CHIPS, FORMA_COBRO, NOMBRE_LETRA, contarChips, empleadosDe, euros, figura, filtrarPorChip, filtrarPorEmisor, fichaDe, letrasDeServicios,
  palabrasDeServicios, queSeVe, sinLinea, type Conectados, textoCobro, textoDiferencias, textoMandato, type ClienteGestoria,
} from '@/modules/conta/gestoria/vista'
import type { DatosGestoria } from '@/modules/conta/services/gestoriaService'
import { FichaCliente, type AccionesFicha } from '@/modules/conta/gestoria/FichaCliente'

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}`

export function ClientesCuotas({ datos, emisores, conectados, rutaConectar, mes, movil, rutaTarifas, tarifasDe, acciones, alHecho, alLeer, leyendo, aviso }: {
  datos: DatosGestoria
  emisores: { id: string; nombre: string }[]
  /** El mes que se compara («2026-11»). */
  mes: string
  movil: boolean
  rutaTarifas: string
  /** Tarifas ya rellena con un cliente y su emisor. */
  tarifasDe: (cliente: string, emisor: string) => string
  acciones: AccionesFicha
  /** Después de hacer algo en la ficha: se vuelve a leer. */
  alHecho: (frase: string) => void
  alLeer: () => void
  leyendo: boolean
  aviso: { ok: boolean; texto: string } | null
  /** Lo conectado: lo de GoCardless sale solo en las empresas que lo tienen; lo de Bitrix24, si la cuenta lo tiene. */
  conectados: Conectados
  /** Ajustes › Cobros, donde se conecta. */
  rutaConectar: string
}) {
  const [emisor, setEmisor] = useState<string | null>(null)
  const [chip, setChip] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<Record<string, string>>({})

  const lineasDe = useMemo(() => {
    const m = new Map<string, DatosGestoria['lineas']>()
    for (const l of datos.lineas as (DatosGestoria['lineas'][number] & { clienteId?: string })[]) {
      const k = `${l.clienteId}|${l.emisor}`
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
  }, [datos.lineas])
  const porEmpleado = useMemo(() => new Set(datos.servicios.filter((s) => s.forma === 'por_empleado').map((s) => s.clave)), [datos.servicios])
  // Lo que cobra GoCardless a cada fila: por su cliente de Sumied o, sin ficha, por su cliente de GoCardless.
  const suscDe = (f: ClienteGestoria) => datos.suscripciones.filter((s) => s.emisor === f.emisorId
    && (f.clienteId ? s.clienteId === f.clienteId : s.gcClienteId === f.diferencias.find((d) => d.gcClienteId)?.gcClienteId))
  const fichas = useMemo(() => new Map(datos.filas.map((f) => [f.id, f.clienteId
    ? fichaDe(f.clienteId, f.emisorId, mes, lineasDe.get(`${f.clienteId}|${f.emisorId}`) ?? [], datos.tarifas, suscDe(f), (s) => porEmpleado.has(s))
    : null])), [datos, lineasDe, mes, porEmpleado]) // eslint-disable-line react-hooks/exhaustive-deps
  /** ¿Se le cobra por GoCardless? Si no (transferencia, sin mandato ni cobros), «Total hoy en GoCardless» dice «—», no 0. */
  const conGc = (f: ClienteGestoria) => conectados.gocardless.has(f.emisorId) && (suscDe(f).length > 0 || f.cobros.length > 0 || f.mandato !== null)
  const totalGc = (f: ClienteGestoria) => suscDe(f).reduce((t, s) => t + s.alMesCent, 0)

  const delEmisor = filtrarPorEmisor(datos.filas, emisor)
  const numeros = contarChips(delEmisor)
  const campos: CampoFiltro[] = [
    { id: 'forma', etiqueta: 'Forma de cobro', tipo: 'opciones', opciones: [{ valor: '', texto: 'Todas' }, ...Object.entries(FORMA_COBRO).map(([v, t]) => ({ valor: v, texto: t }))] },
    { id: 'texto', etiqueta: 'Buscar', tipo: 'texto', pista: 'Cliente, NIF, empleado…' },
  ]
  const filas = filtrarPorChip(delEmisor, chip).filter((f) => cumpleFiltros(campos, filtros, {
    opcion: () => f.formaCobro ?? '',
    texto: [f.nombre, f.nif ?? '', f.emisor, ...(lineasDe.get(`${f.clienteId}|${f.emisorId}`) ?? []).map((l) => l.empleado ?? '')].join(' '),
  }))
  const abiertaFila = datos.filas.find((f) => f.id === abierto) ?? null

  const lin = (f: ClienteGestoria) => lineasDe.get(`${f.clienteId}|${f.emisorId}`) ?? []
  const columnas: ColumnaDensa<ClienteGestoria>[] = [
    { id: 'cliente', titulo: 'Cliente', celda: (f) => <span className="cxg-cliente"><strong>{f.nombre}</strong>{f.nif && <span className="cxg-apoyo-fila">{f.nif}</span>}</span>, exportar: (f) => f.nombre, pesoPdf: 3 },
    ...(emisor ? [] : [{ id: 'emisor', titulo: 'Emisor', celda: (f: ClienteGestoria) => f.emisor, exportar: (f: ClienteGestoria) => f.emisor, pesoPdf: 2 }]),
    { id: 'figura', titulo: 'Figura', ancho: '84px', celda: (f) => figura(f.nif) ?? '—', exportar: (f) => figura(f.nif) ?? '' },
    { id: 'servicios', titulo: 'Servicios', ancho: '86px', celda: (f) => <span className="cxg-letras" aria-label={palabrasDeServicios(lin(f))}>{letrasDeServicios(lin(f)).map((x) => <abbr key={x} title={NOMBRE_LETRA[x]} className="cxg-letra" data-letra={x}>{x}</abbr>)}</span>, exportar: (f) => palabrasDeServicios(lin(f)) },
    { id: 'empleados', titulo: 'Empleados', ancho: '100px', cifra: true, celda: (f) => empleadosDe(lin(f), mes) || '—', exportar: (f) => empleadosDe(lin(f), mes) },
    { id: 'sumied', titulo: 'Total al mes en Sumied', ancho: '120px', cifra: true, celda: (f) => { const x = fichas.get(f.id); return x ? euros(x.comparacion.sumiedCent) : '—' }, exportar: (f) => (fichas.get(f.id)?.comparacion.sumiedCent ?? 0) / 100 },
    { id: 'gocardless', titulo: 'Total hoy en GoCardless', ancho: '124px', cifra: true, celda: (f) => { if (!conGc(f)) return <span title="No se le cobra por GoCardless">—</span>; const x = fichas.get(f.id); const d = x?.comparacion.diferenciaCent ?? 0; return <span className={x && d !== 0 ? 'cxg-distinto' : undefined}>{euros(totalGc(f))}</span> }, exportar: (f) => (conGc(f) ? totalGc(f) / 100 : '') },
    { id: 'forma', titulo: 'Forma de cobro', ancho: '106px', celda: (f) => (f.formaCobro ? FORMA_COBRO[f.formaCobro] : 'Sin decir'), exportar: (f) => (f.formaCobro ? FORMA_COBRO[f.formaCobro] : '') },
    { id: 'mandato', titulo: 'Mandato', ancho: '118px', celda: (f) => { if (!conectados.gocardless.has(f.emisorId)) return <span title="GoCardless no está conectado en esta empresa">—</span>; const m = textoMandato(f.mandato); return <span className="cxg-estado" data-tono={m.tono}>{m.texto}</span> }, exportar: (f) => (conectados.gocardless.has(f.emisorId) ? textoMandato(f.mandato).texto : '') },
    { id: 'ultimo', titulo: 'Último cobro', ancho: '168px', celda: (f) => { const c = conectados.gocardless.has(f.emisorId) ? f.cobros[0] : undefined; if (!c) return '—'; const t = textoCobro(c.estado); return <span className="cxg-cobro" title={c.motivo ?? undefined}><span className="cxg-punto" data-tono={t.tono} aria-hidden="true" />{fechaCorta(c.fecha)} · {t.texto}</span> }, exportar: (f) => (f.cobros[0] ? `${f.cobros[0].fecha} ${textoCobro(f.cobros[0].estado).texto}` : '') },
    { id: 'diferencias', titulo: 'Diferencias', ancho: '200px', celda: (f) => <span className={f.diferencias.length ? 'cxg-dif' : 'cxg-apoyo-fila'}>{textoDiferencias(f.diferencias)}</span>, exportar: (f) => f.diferencias.map((d) => d.porque).join(' · ') },
  ]

  // Con la ficha abierta, lo que ya dice la ficha sale de la tabla: así cabe el cliente.
  const conFicha = !!abiertaFila && !movil
  // Sin GoCardless en ninguna de las empresas elegidas, sus columnas no salen.
  const ve = queSeVe(conectados, emisor, emisores.map((e) => e.id))
  const deConectores = ve.gocardless ? columnas : columnas.filter((c) => !['gocardless', 'mandato', 'ultimo'].includes(c.id))
  const visibles = conFicha ? deConectores.filter((c) => !['emisor', 'figura', 'forma', 'ultimo'].includes(c.id)) : deConectores
  const nombreDe = (id: string) => emisores.find((e) => e.id === id)?.nombre ?? id
  const nada = conectados.gocardless.size === 0 && !conectados.bitrix

  const clientes = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of datos.filas) if (f.clienteId) m.set(f.clienteId, f.nombre)
    return [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [datos.filas])
  const fichaAbierta = abiertaFila && (
    <FichaCliente key={abiertaFila.id} fila={abiertaFila} ficha={fichas.get(abiertaFila.id) ?? null} mes={mes} lineas={lin(abiertaFila)}
      servicios={datos.servicios.filter((s) => s.emisorId === abiertaFila.emisorId)} sinLinea={sinLinea(suscDe(abiertaFila), lin(abiertaFila), abiertaFila.emisorId)}
      clientes={clientes} rutaTarifas={abiertaFila.clienteId ? tarifasDe(abiertaFila.clienteId, abiertaFila.emisorId) : null}
      conGocardless={conectados.gocardless.has(abiertaFila.emisorId)} conBitrix={conectados.bitrix}
      acciones={acciones} alHecho={alHecho} alCerrar={() => setAbierto(null)} />
  )

  const tarjeta = (f: ClienteGestoria) => {
    const x = fichas.get(f.id)
    const m = textoMandato(f.mandato)
    return (
      <div className="cxg-tarjeta-movil">
        <div className="cxg-tarjeta-fila"><strong>{f.nombre}</strong><span className="cxg-cifra">{x ? euros(x.comparacion.sumiedCent) : '—'}</span></div>
        <div className="cxg-tarjeta-fila cxg-apoyo-fila"><span>{emisor ? '' : `${f.emisor} · `}{palabrasDeServicios(lin(f)) || 'Sin líneas'}{empleadosDe(lin(f), mes) ? ` · ${empleadosDe(lin(f), mes)} ${empleadosDe(lin(f), mes) === 1 ? 'empleado' : 'empleados'}` : ''}</span>{conectados.gocardless.has(f.emisorId) && <span className="cxg-estado" data-tono={m.tono}>{m.texto}</span>}</div>
        {f.diferencias.length > 0 && <div className="cxg-dif">{textoDiferencias(f.diferencias)}</div>}
      </div>
    )
  }

  return (
    <div className="cxg-pagina">
      <PeriodoEnBarra>
        <label className="cxg-emisor">
          <span>Empresa que factura</span>
          <select value={emisor ?? ''} onChange={(e) => { setEmisor(e.target.value || null); setAbierto(null) }}>
            {emisores.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            <option value="">{emisores.length === 2 ? 'Los dos' : 'Todos'}</option>
          </select>
        </label>
      </PeriodoEnBarra>
      <AccionesPantalla>
        <BotonAccion principal onClick={alLeer} disabled={leyendo || nada}>{leyendo ? `Leyendo ${[conectados.bitrix ? 'Bitrix24' : null, conectados.gocardless.size ? 'GoCardless' : null].filter(Boolean).join(' y ')}…` : 'Leer ahora'}</BotonAccion>
        <Link to={rutaTarifas} className="cxm-boton">Tarifas</Link>
      </AccionesPantalla>
      <h2 className="cx-oculto">Clientes y cuotas</h2>
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
      {/* Cada conector se enciende aparte: lo que falta se dice, y lo suyo no sale (regla 7). */}
      {(ve.sinGocardless.length > 0 || !conectados.bitrix) && (
        <p className="cxg-conectores">
          {[ve.sinGocardless.length > 0 ? `GoCardless no está conectado en ${ve.sinGocardless.map(nombreDe).join(' ni en ')}: ${ve.gocardless ? 'en sus clientes no sale' : 'no sale'} lo que cobra, el mandato ni los cobros.` : null,
            !conectados.bitrix ? 'Bitrix24 no está conectado: no sale lo que dice su ficha ni lo que lo compara con GoCardless.' : null].filter(Boolean).join(' ')}
          {' '}<Link to={rutaConectar} className="pg-enlace">Conectar en Ajustes › Cobros</Link>
        </p>
      )}

      {/* En el móvil, la ficha ocupa la pantalla; «Cerrar» vuelve a la lista. */}
      {movil && abiertaFila ? (
        <div className="cxg-lado">{fichaAbierta}</div>
      ) : (
      <div className={conFicha ? 'cxg-cuerpo cxg-con-ficha' : 'cxg-cuerpo'}>
        <section aria-label="Clientes" className="cxg-lista">
          <TablaDensa<ClienteGestoria>
            etiqueta="Clientes y cuotas" nombreFila={['cliente', 'clientes']} filas={filas} total={delEmisor.length}
            clave={(f) => f.id} columnas={visibles} movil={movil} tarjeta={tarjeta}
            teTocaHoy={CHIPS.filter((c) => ve.chips.includes(c.id)).map((c) => ({ id: c.id, etiqueta: c.etiqueta, numero: numeros[c.id], activo: chip === c.id, alPulsar: () => setChip(chip === c.id ? null : c.id) }))}
            vistas={{ lista: [{ id: 'todos', texto: 'Todos', n: delEmisor.length }, ...(chip ? [{ id: chip, texto: CHIPS.find((c) => c.id === chip)!.etiqueta, n: filas.length }] : [])],
              activa: chip ?? 'todos', alElegir: (id) => setChip(id === 'todos' ? null : id) }}
            filtros={{ campos, valores: filtros, alCambiar: setFiltros }}
            exportar={{ nombre: 'Clientes y cuotas', titulo: 'Clientes y cuotas', subtitulo: emisores.find((e) => e.id === emisor)?.nombre ?? 'Todos los emisores' }}
            abierta={abierto} alAbrir={(f) => setAbierto(abierto === f.id ? null : f.id)}
            vacio={datos.filas.length === 0
              ? <Vacio titulo="Aún no hay clientes." explicacion="Salen cuando se conecta Bitrix24 y la cuenta de GoCardless de cada empresa, en Ajustes › Cobros. Después se leen solos cada noche." />
              : <Vacio titulo="Ningún cliente con lo que hay puesto." explicacion="Prueba con «Todos» o quita los filtros." />}
          />
          {!movil && <p className="cxg-leyenda"><span>Servicios:</span><span><abbr className="cxg-letra" data-letra="C">C</abbr> Contabilidad</span><span><abbr className="cxg-letra" data-letra="L">L</abbr> Laboral</span><span><abbr className="cxg-letra" data-letra="S">S</abbr> Otros servicios</span></p>}
        </section>
        {conFicha && abiertaFila && (
          <aside className="cxg-lado" aria-label={`Ficha de ${abiertaFila.nombre}`}>
            {fichaAbierta}
          </aside>
        )}
      </div>
      )}
    </div>
  )
}
