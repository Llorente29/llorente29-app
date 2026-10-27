// src/modules/conta/ventas/CobrosPage.tsx
//
// PC01 · Entrega 3 · Ventas › Cobros (tablero cobros-1, aprobado por Julio el
// 25/10), con la plantilla LISTA:
//
//   · Encabezado: «Cobros», su frase y «Más acciones ▾» («Remesas de recibos»).
//     El botón principal es el de la barra de abajo, «Cobrar por remesa»: uno
//     solo por pantalla.
//   · Cuatro cifras: Por cobrar, Vencido (en rojo), Próxima remesa (con su día
//     de cargo) y Cobrado en el mes.
//   · El aviso del cliente domiciliado sin mandato firmado, con «Enviarle el
//     mandato para firmar».
//   · Pestañas: Por cobrar (todas las que quedan: regla 7), Vencidas, Próxima
//     remesa, Remesas (la lista de remesas de recibos), Devueltos y Cobrados.
//   · Filtros: buscar (cliente, número o importe), Vence: hasta el…, Cómo
//     paga y Local.
//   · La tabla: Vence · Cliente · Factura · Cómo paga · Pendiente · Estado, con
//     casillas.
//   · Al marcar, la barra de abajo: los recibos y su total, en qué banco se
//     cobra y el día del cargo, y «Cobrar por remesa» (Intro) prepara la remesa
//     y abre su ficha. Las que no van por remesa (transferencia, plataforma,
//     sin mandato…) se dicen en la barra, con su porqué, y no entran.
//   · Debajo, tres avisos: los domiciliados, las plataformas y la caja.
// La columna «Recordatorios» del tablero y «Tarjeta o Bizum» con enlace de pago
// son de la entrega 4: aquí no salen (no se enseña lo que aún no existe).
// Lo que se decide sin React, en lib/cobros.ts; lo que se lee y escribe, en
// services/cobrosService.ts (todo por funciones conta_*: dueño único, N8).

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaCobros, rutaLiquidacionesVentas, rutaRemesaCobros, rutaFacturaVenta } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { diaMesCorto, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { bancos } from '@/modules/conta/services/bancosService'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Chip } from '@/modules/conta/diseno'
import { CifrasBandeja, FiltroBuscar, FiltroSelector, FiltrosLista, PestanasEstado, TablaLista, conCambio, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO_REMESA, PESTANAS_COBROS, chipEstado, cifrasCobros, enPestana, estadoCobro, filtrar, leerPestana, libre, nombreForma, ordenarCobros,
  porQueNoEnRemesa, textoDias, textoRecordatorios, type FilaCobro, type FormaCobro,
} from '@/modules/conta/lib/cobros'
import { crearRemesaCobros, leerCobros, leerEnlacesPago, leerRecordatorios, leerRemesasCobros, type RemesaCobrosResumen, type SinMandato } from '@/modules/conta/services/cobrosService'
import { ComoTePagan } from './ComoTePagan'
import { DialogoMandato, DialogoRecordatorios } from './DialogosCobros'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function opcionesVence(hoy: string): { valor: string; texto: string }[] {
  const mas = (d: number) => { const x = new Date(`${hoy}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
  const finMes = (() => { const x = new Date(`${hoy}T12:00:00Z`); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) })()
  const finSiguiente = (() => { const x = new Date(`${hoy}T12:00:00Z`); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 2, 0)).toISOString().slice(0, 10) })()
  return [
    { valor: '', texto: 'Cuando sea' },
    { valor: mas(7), texto: `Hasta el ${diaMesCorto(mas(7))}` },
    { valor: finMes, texto: `Hasta el ${diaMesCorto(finMes)}` },
    { valor: finSiguiente, texto: `Hasta el ${diaMesCorto(finSiguiente)}` },
  ]
}

function textoSinMandato(s: SinMandato): string {
  const enviado = s.enviado ? ` Le preparaste el mandato ${s.enviado.ref}${s.enviado.at ? ` el ${diaMesCorto(s.enviado.at.slice(0, 10))}` : ''}: aún no lo ha firmado.` : ''
  return `Sin él, el banco puede devolver el recibo hasta 13 meses después.${enviado}`
}

export default function CobrosPage() {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const { state } = useLocation() as { state: { marcar?: string[]; frase?: string } | null }
  const [query, setQuery] = useSearchParams()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerCobros(activa.id, hoy) : null, `${activa?.id}:${hoy}:${vuelta}:cobros`)
  const losBancos = useLeer(accountId && activa ? () => bancos.bancosDeLaEmpresa(accountId, activa.id) : null, `${accountId}:${activa?.id}:bancos-cobros`)
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales`)
  const cambiar = (c: Record<string, string | null>) => setQuery((antes) => new URLSearchParams(conCambio(antes.toString(), c)), { replace: true })

  const pestana = leerPestana(query.get('pestana'))
  const recordatorios = useLeer(activa ? () => leerRecordatorios(activa.id) : null, `${activa?.id}:${vuelta}:recordatorios`)
  const enlaces = useLeer(activa ? () => leerEnlacesPago(activa.id) : null, `${activa?.id}:${vuelta}:enlaces-pago`)
  const remesas = useLeer(activa && pestana === 'remesas' ? () => leerRemesasCobros(activa.id) : null, `${activa?.id}:${vuelta}:${pestana === 'remesas' ? 'con' : 'sin'}:remesas-cobros`)
  const fl = { buscar: query.get('q') ?? '', hasta: query.get('hasta') || null, forma: (query.get('forma') || 'todas') as FormaCobro | 'todas', local: query.get('local') || null }
  const d = datos.datos
  const todas = useMemo(() => d?.filas ?? [], [d])
  const filas = useMemo(() => ordenarCobros(filtrar(todas, pestana, fl)), [todas, pestana, fl.buscar, fl.hasta, fl.forma, fl.local]) // eslint-disable-line react-hooks/exhaustive-deps
  const cif = d ? cifrasCobros(todas, d.cobradoMes, d.cobradasMes, hoy) : null

  // La selección (la de «Pasar el devuelto en la próxima remesa» llega ya marcada) y la barra de abajo.
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(state?.marcar ?? []))
  const [aviso, setAviso] = useState<{ tono: 'seguro' | 'falta'; texto: string } | null>(state?.frase ? { tono: 'seguro', texto: state.frase } : null)
  useEffect(() => { if (state?.marcar || state?.frase) window.history.replaceState({}, '') }, [state])
  const deLaLista = new Set(filas.map((f) => f.id))
  const vivas = [...marcadas].filter((id) => deLaLista.has(id)).map((id) => todas.find((f) => f.id === id)!).filter(Boolean)
  const cobrables = vivas.filter((f) => porQueNoEnRemesa(f) === null)
  const noCobrables = vivas.filter((f) => porQueNoEnRemesa(f) !== null)
  const totalCobrables = Math.round(cobrables.reduce((t, f) => t + libre(f), 0) * 100) / 100
  const conIban = (losBancos.datos ?? []).filter((b) => b.kind === 'bank' && b.iban)
  const [bancoElegido, setBancoId] = useState<string>('')
  const bancoId = bancoElegido || (conIban[0]?.id ?? '')
  const [fechaElegida, setFechaCargo] = useState<string>('')
  const fechaCargo = fechaElegida || cif?.proxima.cargo || ''
  const [ocupado, setOcupado] = useState(false)
  const [mandatoA, setMandatoA] = useState<SinMandato | null>(null)
  const [verRecordatorios, setVerRecordatorios] = useState(false)

  const cobrar = async () => {
    if (!activa || cobrables.length === 0 || ocupado) return
    if (!bancoId) { setAviso({ tono: 'falta', texto: 'Elige en qué banco se cobra: ninguno de tus bancos tiene IBAN.' }); return }
    setOcupado(true); setAviso(null)
    try {
      const r = await crearRemesaCobros(activa.id, bancoId, fechaCargo, cobrables.map((f) => ({ id: f.id, importe: libre(f) })))
      setMarcadas(new Set())
      navegar(rutaRemesaCobros(r.remesa), { state: { frase: r.frase } })
    } catch (e) {
      setAviso({ tono: 'falta', texto: `No se ha preparado la remesa: ${(e as Error).message}` })
    } finally { setOcupado(false) }
  }

  // Intro cobra (como en el tablero), si hay algo que cobrar y no se está escribiendo en un campo.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Enter' || !cobrables.length || mandatoA || verRecordatorios || (t && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(t.tagName))) return
      e.preventDefault(); void cobrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  })

  const pestanas = PESTANAS_COBROS.map((p) => ({
    id: p.id, etiqueta: p.etiqueta, siempre: true,
    n: p.id === 'remesas' ? (d?.remesas ?? 0) : todas.filter((f) => enPestana(f, p.id)).length,
  }))
  const mes = MES[Number(hoy.slice(5, 7)) - 1]
  const cifras = cif ? [
    { etiqueta: 'Por cobrar', valor: eurosExactos(cif.porCobrar.importe), apoyo: plural(cif.porCobrar.n, 'factura', 'facturas'), a: rutaCobros('por_cobrar') },
    { etiqueta: 'Vencido', valor: eurosExactos(cif.vencido.importe), apoyo: cif.vencido.n ? `${plural(cif.vencido.n, 'factura', 'facturas')} · ${plural(cif.vencido.dias ?? 0, 'día', 'días')}` : 'Nada vencido', a: rutaCobros('vencidas') },
    { etiqueta: 'Próxima remesa', valor: eurosExactos(cif.proxima.importe), apoyo: cif.proxima.n ? `${plural(cif.proxima.n, 'recibo', 'recibos')} · cargo el ${diaMesCorto(cif.proxima.cargo)}` : 'Ningún recibo', a: rutaCobros('proxima') },
    { etiqueta: `Cobrado en ${mes}`, valor: eurosExactos(cif.cobradoMes.importe), apoyo: plural(cif.cobradoMes.n, 'factura', 'facturas'), a: rutaCobros('cobrados') },
  ] : []

  const columnas: ColumnaLista<FilaCobro>[] = [
    { id: 'vence', titulo: 'Vence', ancho: '84px', minimo: 72, celda: (f) => {
      const e = estadoCobro(f)
      if (!f.vence) return <span className="pg-vence-sin">{e === 'cobrada' ? '—' : 'sin fecha'}</span>
      return <span className={e === 'vencida' ? 'pg-vence-rojo' : undefined}>{diaMesCorto(f.vence)}</span>
    } },
    { id: 'cliente', titulo: 'Cliente', celda: (f) => f.cliente, minimo: 160 },
    { id: 'factura', titulo: 'Factura', celda: (f) => f.numero ?? 'sin número', prioridad: 3, minimo: 110 },
    { id: 'forma', titulo: 'Cómo paga', celda: (f) => <Chip tono={f.forma === 'direct_debit' ? 'duda' : 'neutro'}>{nombreForma(f.forma)}</Chip>, prioridad: 4, minimo: 130 },
    { id: 'pendiente', titulo: 'Pendiente', cifra: true, celda: (f) => <strong>{eurosExactos(estadoCobro(f) === 'cobrada' ? f.total : f.pendiente).replace(' €', '')}</strong>, minimo: 90 },
    { id: 'recordatorios', titulo: 'Recordatorios', celda: (f) => <span className="cx-ayuda">{estadoCobro(f) === 'cobrada' ? '—' : textoRecordatorios(recordatorios.datos?.facturas.get(f.id), enlaces.datos?.get(f.id))}</span>, prioridad: 5, minimo: 160 },
    { id: 'estado', titulo: 'Estado', celda: (f) => { const c = chipEstado(f); return <Chip tono={c.tono}>{c.texto}</Chip> }, minimo: 150 },
  ]
  const tarjeta = (f: FilaCobro) => {
    const c = chipEstado(f)
    return (
      <span className="pg-tarjeta">
        <span className="pg-tarjeta-fila"><strong>{f.cliente}</strong><strong className="s-cifra">{eurosExactos(f.pendiente)}</strong></span>
        <span className="pg-tarjeta-fila cx-ayuda"><span>{f.numero ?? 'sin número'} · {f.vence ? `vence ${diaMesCorto(f.vence)}` : 'sin fecha'}</span><Chip tono={c.tono}>{c.texto}</Chip></span>
      </span>
    )
  }
  const pendienteFiltro = Math.round(filas.reduce((t, f) => t + f.pendiente, 0) * 100) / 100
  const primero = d?.sinMandato[0] ?? null

  return (
    <div className="pg-pagina">
      <EncabezadoPagina titulo="Cobros"
        frase="Lo que te deben y cómo te lo van a pagar. Cada cobro marca su factura, venga del banco, de una remesa, de la caja o de una plataforma."
        secundarios={<Boton onClick={() => setVerRecordatorios(true)} disabled={!recordatorios.datos}>Recordatorios</Boton>}
        masAcciones={[{ titulo: 'Cobros', acciones: [
          { id: 'remesas', etiqueta: 'Remesas de recibos', alPulsar: () => cambiar({ pestana: 'remesas' }), grupo: 'Cobros', dato: 'Las remesas de recibos domiciliados, con su estado' },
        ] }]} />

      {datos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los cobros: {datos.error}</p>}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role={aviso.tono === 'falta' ? 'alert' : 'status'} data-prueba="aviso-cobros">{aviso.texto}</p>}
      {cif && <div className="pg-cifras" data-vencido={cif.vencido.n > 0 ? 'si' : 'no'}><CifrasBandeja cifras={cifras} /></div>}
      {primero && (
        <div className="pg-aviso-ambar" role="status" data-prueba="sin-mandato">
          <p>
            <strong>{primero.nombre} paga por domiciliación y no tiene mandato firmado.</strong>{' '}
            {textoSinMandato(primero)}
            {d!.sinMandato.length > 1 && ` Y ${plural(d!.sinMandato.length - 1, 'cliente más', 'clientes más')} igual: ${d!.sinMandato.slice(1).map((s) => s.nombre).join(', ')}.`}
          </p>
          <button type="button" className="pg-enlace" onClick={() => setMandatoA(primero)}>Enviarle el mandato para firmar</button>
        </div>
      )}

      <section className="pg-caja">
        <PestanasEstado etiqueta="Estado de los cobros" pestanas={pestanas} actual={pestana} alCambiar={(id) => cambiar({ pestana: id === 'por_cobrar' ? null : id })} />
        {pestana !== 'remesas' && (
          <FiltrosLista etiqueta="Filtros de los cobros">
            <FiltroBuscar valor={fl.buscar} alCambiar={(q) => cambiar({ q: q || null })} placeholder="Buscar cliente, número o importe" etiqueta="Buscar un cobro" />
            <FiltroSelector etiqueta="Vence" valor={fl.hasta ?? ''} alCambiar={(v) => cambiar({ hasta: v || null })} opciones={opcionesVence(hoy)} />
            <FiltroSelector etiqueta="Cómo paga" valor={fl.forma === 'todas' ? '' : fl.forma ?? ''} alCambiar={(v) => cambiar({ forma: v || null })}
              opciones={[{ valor: '', texto: 'Todas' }, { valor: 'direct_debit', texto: 'Domiciliación' }, { valor: 'transfer', texto: 'Transferencia' }, { valor: 'plataforma', texto: 'Plataforma' }, { valor: 'card', texto: 'Tarjeta' }, { valor: 'cash', texto: 'Efectivo' }]} />
            {ejeLocal && (locales.datos ?? []).length > 1 && (
              <FiltroSelector etiqueta={ejeLocal.nombre} valor={fl.local ?? ''} alCambiar={(v) => cambiar({ local: v || null })}
                opciones={[{ valor: '', texto: 'Todos' }, ...(locales.datos ?? []).map((l) => ({ valor: l.id, texto: l.nombre }))]} />
            )}
          </FiltrosLista>
        )}
        {!d && !datos.error && <div className="s-lista" aria-busy="true" aria-label="Cargando los cobros"><div className="s-lista-cargando" /></div>}
        {d && pestana === 'remesas' && <ListaRemesas remesas={remesas.datos} error={remesas.error} alAbrir={(id) => navegar(rutaRemesaCobros(id))} />}
        {d && pestana !== 'remesas' && (
          <TablaLista<FilaCobro>
            etiqueta={`Cobros · ${PESTANAS_COBROS.find((p) => p.id === pestana)!.etiqueta}`}
            columnas={columnas} filas={filas} clave={(f) => f.id} nombre={(f) => `${f.cliente} ${f.numero ?? ''}`.trim()}
            alAbrir={(f) => navegar(f.remesa && estadoCobro(f) === 'en_remesa' ? rutaRemesaCobros(f.remesa.id) : f.devuelto ? rutaRemesaCobros(f.devuelto.remesa) : rutaFacturaVenta(f.id))}
            movil={movil} tarjeta={tarjeta}
            vacio={<p className="s-lista-vacia">{pestana === 'cobrados' ? 'Aún no hay facturas cobradas.' : pestana === 'proxima' ? 'Ningún recibo domiciliado espera remesa.' : 'No hay facturas en esta pestaña.'}</p>}
            pie={<div className="pg-pie"><span>{plural(filas.length, 'factura', 'facturas')}{filas.length !== todas.filter((f) => enPestana(f, pestana)).length ? ` de ${todas.filter((f) => enPestana(f, pestana)).length}` : ''}</span><span>Pendiente del filtro <strong className="s-cifra">{eurosExactos(pendienteFiltro)}</strong></span></div>}
            seleccion={pestana === 'cobrados' ? undefined : {
              marcadas: new Set(vivas.map((f) => f.id)),
              alMarcar: (id, m) => setMarcadas((s) => { const n = new Set(s); if (m) n.add(id); else n.delete(id); return n }),
              alMarcarTodas: (m) => setMarcadas(m ? new Set(filas.filter((f) => porQueNoEnRemesa(f) === null).map((f) => f.id)) : new Set()),
            }} />
        )}
      </section>

      {vivas.length > 0 && pestana !== 'remesas' && (
        <div className="pg-barra" role="region" aria-label="Cobrar las seleccionadas" data-prueba="barra-cobrar">
          <span className="pg-barra-total"><strong>{plural(cobrables.length, 'recibo', 'recibos')} · <span className="s-cifra">{eurosExactos(totalCobrables)}</span></strong>
            {noCobrables.length > 0 && <span className="pg-barra-fuera">{noCobrables.length === 1 ? `1 no entra: ${porQueNoEnRemesa(noCobrables[0])}` : `${noCobrables.length} no entran (${noCobrables.map((f) => `${f.cliente}: ${porQueNoEnRemesa(f)}`).join('; ')})`}</span>}
          </span>
          <label className="pg-barra-campo"><span>Cobrar en</span>
            <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} aria-label="En qué banco se cobra">
              {conIban.length === 0 && <option value="">Ningún banco con IBAN</option>}
              {conIban.map((b) => <option key={b.id} value={b.id}>{b.alias ?? b.nombre}{b.iban ? ` ···${b.iban.replace(/\s/g, '').slice(-4)}` : ''}</option>)}
            </select>
          </label>
          <label className="pg-barra-campo"><span>Cargo el</span>
            <input type="date" value={fechaCargo} min={cif?.proxima.cargo} onChange={(e) => setFechaCargo(e.target.value)} aria-label="Día del cargo a los clientes" />
          </label>
          <Boton variante="principal" onClick={() => void cobrar()} disabled={cobrables.length === 0 || ocupado || !bancoId}>
            {ocupado ? 'Preparando…' : 'Cobrar por remesa'} <kbd className="pg-kbd">Intro</kbd>
          </Boton>
        </div>
      )}
      {vivas.length > 0 && pestana !== 'remesas' && <p className="cx-ayuda pg-barra-nota">Te preparo la remesa de recibos (el fichero para subir al banco). Cuando llegue el abono, las facturas quedan cobradas; si devuelven alguno, te lo digo.</p>}

      <div className="pg-notas">
        <p><strong>Recordatorios que se mandan solos{recordatorios.datos && !recordatorios.datos.activos ? ' (apagados)' : ''}:</strong>{' '}
          {recordatorios.datos && !recordatorios.datos.activos
            ? 'ahora no se manda ninguno; se encienden en Ajustes › Cobros.'
            : `${textoDias(recordatorios.datos?.dias ?? [-3, 0, 7, 15])}, cada vez con la factura en PDF. Se paran solos cuando cobras.`}</p>
        <p><strong>Domiciliados, con su mandato.</strong> Un recibo solo se pasa a quien ha firmado el mandato. Te lo mando yo con el nombre de tu empresa, lo firma desde el correo con el móvil, y queda en su ficha de Contactos.</p>
        <p><strong>Plataformas.</strong> Lo que pagan Uber, Glovo y Just Eat se cobra en <a className="pg-enlace" href={rutaLiquidacionesVentas()} onClick={(e) => { e.preventDefault(); navegar(rutaLiquidacionesVentas()) }}>Liquidaciones</a>: al cobrar una liquidación, las facturas de sus cierres quedan cobradas.</p>
        <p><strong>Cobro en caja y con tarjeta del datáfono.</strong> Lo cobrado en el cierre del día ya entra cobrado. El abono del datáfono se casa en Bancos con los cierres de esos días.</p>
      </div>

      {activa && <ComoTePagan empresaId={activa.id} />}

      {verRecordatorios && activa && recordatorios.datos && (
        <DialogoRecordatorios empresaId={activa.id} datos={recordatorios.datos} filas={todas}
          alCerrar={() => setVerRecordatorios(false)} alCambiar={() => setVuelta((v) => v + 1)} />
      )}
      {mandatoA && activa && (
        <DialogoMandato empresaId={activa.id} cliente={mandatoA}
          alCerrar={(frase) => { setMandatoA(null); if (frase) { setAviso({ tono: 'seguro', texto: frase }); setVuelta((v) => v + 1) } }} />
      )}
    </div>
  )
}

function ListaRemesas({ remesas, error, alAbrir }: { remesas: RemesaCobrosResumen[] | null; error: string | null; alAbrir: (id: string) => void }) {
  if (error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las remesas: {error}</p>
  if (!remesas) return <div className="s-lista" aria-busy="true" aria-label="Cargando las remesas"><div className="s-lista-cargando" /></div>
  if (remesas.length === 0) return <p className="s-lista-vacia">Aún no hay remesas de recibos. Marca las facturas domiciliadas y pulsa «Cobrar por remesa».</p>
  return (
    <table className="pg-tabla" aria-label="Remesas de recibos">
      <thead><tr><th>Cargo</th><th>Remesa</th><th>Banco</th><th>Recibos</th><th className="pg-num">Total</th><th>Estado</th></tr></thead>
      <tbody>
        {remesas.map((r) => (
          <tr key={r.id} className="pg-fila-abrible" tabIndex={0} onClick={() => alAbrir(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') alAbrir(r.id) }}>
            <td>{diaMesCorto(r.cargo)}</td>
            <td><strong>{r.codigo}</strong></td>
            <td>{r.banco ?? '—'}</td>
            <td>{plural(r.recibos, 'recibo', 'recibos')}{r.devueltos ? ` · ${plural(r.devueltos, 'devuelto', 'devueltos')}` : ''}</td>
            <td className="pg-num">{eurosExactos(r.total).replace(' €', '')}</td>
            <td><Chip tono={r.estado === 'en_banco' || r.estado === 'preparada' ? 'duda' : r.devueltos ? 'falta' : 'seguro'}>{NOMBRE_ESTADO_REMESA[r.estado]}{r.estado === 'plazo' && r.plazoHasta ? ` hasta el ${diaMesCorto(r.plazoHasta)}` : ''}</Chip></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
