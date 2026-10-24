// src/modules/conta/ventas/CierrePage.tsx
//
// V01 · Entrega 2 · La ficha de un cierre del día (captura ventas_4), con la
// plantilla FICHA: los datos a la izquierda y el PDF a la derecha.
//
//   · Arriba: «‹ 3 de 9 ›» entre los cierres de la lista y UN principal,
//     «Validar y siguiente» (Intro): el asiento, su PDF y su factura resumen
//     en una transacción, y al siguiente por validar. No se envía nada a Diez:
//     entra en el traspaso del mes.
//   · Lo vendido por marca, los pedidos (con su menú «⋯»: quitar de este
//     cierre con su motivo, pasar a otro día, ajustar el importe, deshacer y
//     ver el pedido), la factura resumen, el cobro y el asiento con la pieza
//     común (Cuenta · Nombre · Debe · Haber y «Cuadra»).
//   · Nada se guarda solo: los cambios de los pedidos van a la barra de
//     cambios y se confirman con «Guardar cambios»; salir con cambios avisa.
//     Al guardar, el cierre se rehace y la barra dice con qué total (regla 8).
//     NADA de esto toca el pedido de Folvy: solo cómo cuenta en la contabilidad.
//   · «En espera», con su motivo en una frase: no se valida hasta quitarlo.
//   · Lo que dejó el cierre del día de este local y día (C11: los «para
//     revisar» del TPV y de la tienda), aquí, para decidir.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaCierre, rutaCierres, rutaFacturaVenta } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { diaMes, eurosExactos, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Campo, Chip, Dialogo, Fecha, Texto } from '@/modules/conta/diseno'
import {
  AsientoQueSeCrea, BarraCambios, BloqueFicha, CampoFicha, DocumentoFicha, Ficha, FilaCampos, NavegaFicha, useAvisoSalir,
  type CambioCampo, type MensajeGuardado,
} from '@/modules/conta/diseno/plantillas'
import { leerAsiento } from '@/modules/conta/services/diarioService'
import { urlDocumento, vistaPreviaCierre } from '@/modules/conta/services/conDiezService'
import { useVendePorPlataformas } from '@/modules/conta/services/plataformasCuenta'
import {
  NOMBRE_ESTADO_CIERRE, NOMBRE_ESTADO_PEDIDO, accionesDe, etiquetaAjuste, filtrarCierres, pestanaDe, ponerCambio, siguientePorValidar, textoCambio,
  totalConCambios, vecinos, type CambioPedido, type PedidoCierre,
} from '@/modules/conta/lib/cierres'
import { guardarCambiosCierre, leerCierres, leerPedidosCierre, ponerEnEspera, quitarDeEspera, validarCierre } from '@/modules/conta/services/cierresService'
import { numeroDeTexto, textoDeNumero } from '@/modules/conta/lib/facturasVenta'
import { LoQueDejaElCierre } from './LoQueDejaElCierre'

const importeEs = (n: number) => textoDeNumero(n)

export default function CierrePage() {
  const { cierreId = '' } = useParams()
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const marco = useMarco()
  const vende = useVendePorPlataformas()
  const navegar = useNavigate()
  const { search } = useLocation()
  const query = new URLSearchParams(search)
  const [vuelta, setVuelta] = useState(0)
  const [cambios, setCambios] = useState<CambioPedido[]>([])
  const [mensaje, setMensaje] = useState<MensajeGuardado | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [validando, setValidando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>((useLocation().state as { aviso?: { ok: boolean; texto: string } } | null)?.aviso ?? null)
  const [menu, setMenu] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<{ que: 'quitar' | 'mover' | 'importe' | 'ver'; p: PedidoCierre } | { que: 'espera' } | null>(null)

  const lista = useLeer(accountId && activa ? () => leerCierres(activa.id) : null, `${accountId}:${activa?.id}:cierres:${vuelta}`)
  const pedidos = useLeer(accountId && cierreId ? () => leerPedidosCierre(cierreId) : null, `${cierreId}:pedidos:${vuelta}`)
  const c = (lista.datos ?? []).find((x) => x.id === cierreId) ?? null
  const asiento = useLeer(accountId && c?.asientoId ? () => leerAsiento(accountId, c.asientoId!) : null, `${c?.asientoId}:asiento`)
  const documento = useLeer(c?.documento ? () => urlDocumento(c.documento!) : null, `${c?.documento}:pdf`)
  const previa = useLeer(c && !c.documento && c.asientoId && c.estado !== 'validado' ? () => vistaPreviaCierre(c.asientoId!) : null, `${c?.asientoId}:previa`)
  useEffect(() => () => { if (previa.datos?.url) URL.revokeObjectURL(previa.datos.url) }, [previa.datos?.url])

  // La cola es la de la lista de la que se viene (su pestaña y su búsqueda).
  const cola = filtrarCierres(lista.datos ?? [], pestanaDe(query.get('ver')), query.get('q') ?? '')
  const enCola = cola.some((x) => x.id === cierreId) ? cola : (lista.datos ?? [])
  const { anterior, siguiente } = vecinos(enCola, cierreId)
  const pos = enCola.filter((x) => x.id).findIndex((x) => x.id === cierreId) + 1
  const ps = useMemo(() => pedidos.datos ?? [], [pedidos.datos])
  const porId = new Map(ps.map((p) => [p.id, p]))
  const hay = cambios.length > 0
  const barra: CambioCampo[] = cambios.map((x) => {
    const p = porId.get(x.pedido)
    const antes = !p ? '—' : p.ajuste ? `${etiquetaAjuste(p.ajuste).toLowerCase()}${p.cuenta ? `, ${eurosExactos(p.total)}` : ''}` : eurosExactos(p.total)
    const ahora = x.accion === 'quitar' ? 'quitado' : x.accion === 'mover' ? `al ${diaMes(x.dia)}` : x.accion === 'importe' ? eurosExactos(x.importe) : 'como era'
    return { campo: x.pedido, etiqueta: p?.codigo ?? 'Pedido', antes, ahora }
  })
  const totalNuevo = c ? totalConCambios(ps, cambios, c.dia) : 0

  async function guardar(): Promise<boolean | string> {
    if (!c?.id || !hay) return true
    setGuardando(true); setMensaje(null)
    try {
      const r = await guardarCambiosCierre(c.id, cambios, userName)
      const otros = r.dias.filter((d) => d.dia !== c.dia)
      const este = r.dias.find((d) => d.dia === c.dia)
      const texto = `Guardado: ${r.cambios === 1 ? '1 cambio' : `${r.cambios} cambios`}. El cierre se ha rehecho: ${eurosExactos(r.total)} (antes ${eurosExactos(r.antes)}).`
        + (este && este.resultado !== 'propuesto' ? ` Queda en espera: ${este.porque ?? 'no ha salido asiento'}.` : '')
        + otros.map((d) => ` El del ${diaMes(d.dia)} también: ${d.resultado === 'propuesto' ? `${eurosExactos(d.total ?? 0)}` : `en espera (${d.porque ?? 'sin asiento'})`}.`).join('')
      setCambios([]); setMensaje({ tono: 'ok', texto }); setVuelta((v) => v + 1)
      return true
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setMensaje({ tono: 'falta', texto: `No se ha guardado: ${m}` })
      return m
    } finally { setGuardando(false) }
  }
  const salida = useAvisoSalir({ hay, cambios: barra, donde: c ? `${c.canal} · ${c.local} · ${diaMes(c.dia)}` : undefined, onGuardar: guardar, onDescartar: () => setCambios([]) })

  async function validarYSiguiente() {
    if (!c?.asientoId || hay || validando) return
    setValidando(true); setAviso(null)
    try {
      const r = await validarCierre(c.asientoId, userName)
      const texto = `Validado: factura ${r.factura ?? '—'}, su PDF guardado junto al asiento y el asiento nº ${r.numero.toLocaleString('es-ES')} (${eurosExactos(c.total)}). Entra en el traspaso del mes.`
      const sig = siguientePorValidar(enCola, c.id!)
      if (sig?.id) navegar(`${rutaCierre(sig.id)}${search}`, { state: { aviso: { ok: true, texto: `${c.canal} · ${c.local} · ${diaMes(c.dia)}: ${texto}` } } })
      else { setAviso({ ok: true, texto: `${texto} No queda ninguno por validar.` }); setVuelta((v) => v + 1) }
    } catch (e) {
      setAviso({ ok: false, texto: `No se ha validado: ${(e instanceof Error ? e.message : String(e)).replace(/\.$/, '')}. Sin su PDF y su factura, el cierre sigue sin validar.` })
    } finally { setValidando(false) }
  }

  // Intro valida y pasa al siguiente (fuera de un campo y sin diálogos ni cambios).
  useEffect(() => {
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' || ev.defaultPrevented || dialogo || hay || !c || c.estado !== 'por_validar') return
      const t = ev.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, button, a, [role="dialog"]'))) return
      ev.preventDefault(); void validarYSiguiente()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  })

  if (lista.error) return <div className="s-pagina"><EncabezadoPagina titulo="Cierre del día" /><p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer el cierre: {lista.error} <button type="button" className="s-boton s-boton-enlace" onClick={lista.recargar}>Reintentar</button></p></div>
  if (!lista.datos) return <div className="s-pagina"><EncabezadoPagina titulo="Cierre del día" /><div className="s-lista" aria-busy="true" aria-label="Cargando el cierre"><div className="s-lista-cargando" /></div></div>
  if (!c) return <div className="s-pagina"><EncabezadoPagina titulo="Cierre del día" /><p className="s-apoyo">Ese cierre no está. <Link to={rutaCierres()}>Volver a los cierres</Link></p></div>

  const est = NOMBRE_ESTADO_CIERRE[c.estado]
  const editable = c.estado !== 'validado' && c.estado !== 'anulado'
  const titulo = `${c.canal}${c.marca ? ` · ${c.marca}` : ''} · ${c.local}`
  const frase = `Ventas del ${c.dia.split('-').reverse().join('/')} · ${c.tiques.toLocaleString('es-ES')} ${c.tiques === 1 ? 'tique' : 'tiques'} · ${eurosExactos(c.total)}`
  const principal = c.estado === 'por_validar'
    ? <Boton variante="principal" disabled={hay || validando || !c.asientoId} onClick={() => void validarYSiguiente()} title={hay ? 'Guarda o descarta los cambios antes de validar' : 'Intro'} aria-keyshortcuts="Enter">{validando ? 'Validando…' : 'Validar y siguiente'}</Boton>
    : c.factura && c.facturaId
      ? <Link to={rutaFacturaVenta(c.facturaId)} className="s-boton s-boton-secundario">Ver la factura {c.factura}</Link>
      : <Link to={`${rutaCierres()}${search}`} className="s-boton s-boton-secundario">Volver a los cierres</Link>
  const secundarios = editable ? (
    c.esperaAMano
      ? <Boton variante="secundario" onClick={async () => { try { await quitarDeEspera(c.id!, userName); setAviso({ ok: true, texto: 'Quitado de espera: ya se puede validar.' }); setVuelta((v) => v + 1) } catch (e) { setAviso({ ok: false, texto: `No se ha quitado de espera: ${e instanceof Error ? e.message : String(e)}` }) } }}>Quitar de espera</Boton>
      : <Boton variante="secundario" onClick={() => setDialogo({ que: 'espera' })}>Dejar en espera</Boton>
  ) : null
  const mas: GrupoDeAcciones[] = [{
    titulo: 'Más acciones',
    acciones: [
      ...(c.asientoId ? [{ id: 'asiento', etiqueta: 'Ver el asiento', a: rutaAsiento(c.asientoId), grupo: '' }] : []),
      ...(c.facturaId ? [{ id: 'factura', etiqueta: 'Ver la factura', dato: c.factura ?? undefined, a: rutaFacturaVenta(c.facturaId), grupo: '' }] : []),
      ...(documento.datos ? [{ id: 'abrir', etiqueta: 'Abrir el PDF aparte', alPulsar: () => window.open(documento.datos!, '_blank', 'noopener'), grupo: '' }] : []),
    ],
  }]

  // Lo vendido por marca (lo que cuenta, ya con lo guardado).
  const porMarca = new Map<string, { n: number; total: number }>()
  for (const p of ps.filter((x) => x.cuenta)) {
    const k = p.marca ?? 'Sin marca'
    const x = porMarca.get(k) ?? { n: 0, total: 0 }
    porMarca.set(k, { n: x.n + 1, total: Math.round((x.total + p.total) * 100) / 100 })
  }
  const apuntes = asiento.datos?.apuntes ?? []
  const cobro = apuntes.filter((x) => x.cuenta.startsWith('43')).reduce((t, x) => t + x.debe - x.haber, 0)
  const cobraQuien = apuntes.find((x) => x.cuenta.startsWith('43') && x.debe > 0)
  const lineasAsiento = apuntes.map((x) => ({ nombre: x.nombreCuenta, codigo: x.cuenta, debe: x.debe ? importeEs(x.debe) : null, haber: x.haber ? importeEs(x.haber) : null }))
  const cambioDe = new Map(cambios.map((x) => [x.pedido, x]))

  const datos = (
    <>
      {editable && <div className="cxf-barra"><BarraCambios cambios={barra} onDescartar={() => { setCambios([]); setMensaje(null) }} onGuardar={() => void guardar()} guardando={guardando} mensaje={mensaje} /></div>}
      <div role="status" aria-live="polite">
        {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} data-prueba="aviso-cierre">{aviso.texto}</p>}
      </div>
      {c.estado === 'en_espera' && c.motivo && (
        <p className="s-aviso-lista" data-tono="duda" data-prueba="en-espera"><strong>En espera.</strong> {c.motivo}</p>
      )}

      <BloqueFicha titulo="Lo vendido por marca">
        {porMarca.size === 0 ? <p className="s-apoyo">Ningún pedido cuenta en este cierre.</p> : (
          <table className="cxv-tabla" aria-label="Lo vendido por marca">
            <thead><tr><th>Marca</th><th className="s-cifra">Pedidos</th><th className="s-cifra">Total</th></tr></thead>
            <tbody>{[...porMarca].map(([m, x]) => <tr key={m}><td>{m}</td><td className="s-cifra">{x.n.toLocaleString('es-ES')}</td><td className="s-cifra">{eurosExactos(x.total)}</td></tr>)}</tbody>
          </table>
        )}
      </BloqueFicha>

      <BloqueFicha titulo="Pedidos">
        {pedidos.error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer los pedidos: {pedidos.error}</p>}
        {!pedidos.datos && !pedidos.error && <p className="s-apoyo" aria-busy="true">Leyendo los pedidos…</p>}
        {pedidos.datos && (
          <table className="cxv-tabla" aria-label="Pedidos del cierre">
            <thead><tr><th>Hora</th><th>Pedido</th><th>Marca</th><th>Estado</th><th className="s-cifra">Total</th>{editable && <th><span className="s-oculto">Cambiar</span></th>}</tr></thead>
            <tbody>
              {ps.map((p) => {
                const pend = cambioDe.get(p.id)
                const ac = accionesDe(p)
                return (
                  <tr key={p.id} data-pedido={p.codigo} data-cuenta={p.cuenta ? 'si' : 'no'}>
                    <td className="s-cifra">{p.dia !== c.dia ? `${diaMes(p.dia)} ` : ''}{p.hora}</td>
                    <td>{p.codigo}</td>
                    <td>{p.marca ?? 'Sin marca'}</td>
                    <td>
                      {NOMBRE_ESTADO_PEDIDO[p.estado] ?? p.estado}
                      {p.ajuste && <> <Chip tono="duda">{etiquetaAjuste(p.ajuste)}</Chip></>}
                      {p.ajuste?.motivo && <span className="s-tarjeta-apoyo"> {p.ajuste.motivo}</span>}
                      {pend && <span className="s-campo-cambiado" title={textoCambio(pend, p)}>Sin guardar</span>}
                    </td>
                    <td className="s-cifra">
                      {p.cuenta ? eurosExactos(p.total) : <s>{eurosExactos(p.totalPedido)}</s>}
                      {p.ajuste?.importe != null && <span className="s-campo-antes"> Antes: {eurosExactos(p.ajuste.importeAntes)}</span>}
                    </td>
                    {editable && (
                      <td className="cxv-menu-celda">
                        <button type="button" className="s-boton s-boton-enlace" aria-haspopup="menu" aria-expanded={menu === p.id} aria-label={`Más del pedido ${p.codigo}`} onClick={() => setMenu(menu === p.id ? null : p.id)}>⋯</button>
                        {menu === p.id && (
                          <ul role="menu" className="cxv-menu" aria-label={`Pedido ${p.codigo}`}>
                            {ac.includes('quitar') && <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialogo({ que: 'quitar', p }) }}>Quitar de este cierre</button></li>}
                            {ac.includes('mover') && <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialogo({ que: 'mover', p }) }}>Pasar a otro día</button></li>}
                            {ac.includes('importe') && <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialogo({ que: 'importe', p }) }}>Ajustar el importe</button></li>}
                            {ac.includes('deshacer') && <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setCambios((cs) => ponerCambio(cs, { pedido: p.id, accion: 'deshacer' })) }}>Deshacer lo cambiado</button></li>}
                            <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialogo({ que: 'ver', p }) }}>Ver el pedido</button></li>
                          </ul>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr><td colSpan={4}>{hay ? 'Con los cambios sin guardar' : 'Total del cierre'}</td><td className="s-cifra"><strong>{eurosExactos(hay ? totalNuevo : c.total)}</strong></td>{editable && <td />}</tr></tfoot>
          </table>
        )}
        {editable && <p className="s-apoyo">Cambiar un pedido aquí no toca el pedido en Pedidos: solo cómo cuenta en tu contabilidad.</p>}
      </BloqueFicha>

      <LoQueDejaElCierre conPlataformas={vende} soloDe={{ localId: c.localId, dia: c.dia }} />

      <BloqueFicha titulo="Factura resumen">
        <FilaCampos columnas={2}>
          <CampoFicha etiqueta="Número" valor={c.factura ?? (previa.datos ? `${previa.datos.factura} al validar` : '—')} cifra />
          <CampoFicha etiqueta="Total" valor={eurosExactos(c.total)} cifra />
        </FilaCampos>
        {c.facturaId
          ? <p className="s-apoyo">Está en <Link to={rutaFacturaVenta(c.facturaId)}>Facturas</Link>, con origen «Cierre del día». Si hay que corregirla, «Corregir» en la factura.</p>
          : <p className="s-apoyo">Al validar se numera en la serie de {c.canal} y sale en Facturas con origen «Cierre del día».</p>}
      </BloqueFicha>

      <BloqueFicha titulo="Cobro">
        <FilaCampos columnas={2}>
          <CampoFicha etiqueta="Lo cobra" valor={cobraQuien ? `${cobraQuien.nombreCuenta} (${cobraQuien.cuenta})` : c.canal} />
          <CampoFicha etiqueta="Importe" valor={apuntes.length ? eurosExactos(Math.round(cobro * 100) / 100) : '—'} cifra />
        </FilaCampos>
      </BloqueFicha>

      <AsientoQueSeCrea titulo={c.estado === 'validado' ? 'Su asiento' : 'El asiento que se valida'} lineas={lineasAsiento}
        nota={c.asientoId ? <><Link to={rutaAsiento(c.asientoId)}>Ver el asiento{c.numeroAsiento ? ` ${c.numeroAsiento.toLocaleString('es-ES')}` : ''}</Link>{c.estado === 'validado' ? ' · Validado. Entra en el traspaso del mes.' : ' · Se valida con su PDF y su factura, juntos.'}</> : 'Sin asiento: mira el motivo de arriba.'}
        vacio={c.asientoId ? (asiento.error ? `No se ha podido leer su asiento: ${asiento.error}` : 'Leyendo su asiento…') : 'Este cierre no tiene asiento.'} />
    </>
  )

  const doc = (
    <div className="cxf-derecha">
      <DocumentoFicha titulo={previa.datos?.nombre ?? (c.factura ? `${c.factura}.pdf` : 'Resumen de ventas')} descargar={documento.datos ?? null}
        oculto={marco?.documentoOculto ?? false} alOcultar={(x) => marco?.ocultarDocumento(x)}>
        {documento.datos && <PapelPdf url={documento.datos} titulo={`El resumen de ventas ${c.factura ?? ''}`} />}
        {!documento.datos && previa.datos && <PapelPdf url={previa.datos.url} titulo="Cómo quedará el resumen de ventas" />}
        {!documento.datos && !previa.datos && <p className="s-apoyo">{previa.error ? `No se puede hacer su PDF todavía: ${previa.error}` : c.asientoId ? 'Haciendo el PDF…' : 'Sin asiento no hay PDF.'}</p>}
      </DocumentoFicha>
    </div>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-cierre" data-estado={c.estado}>
      <EncabezadoPagina titulo={titulo} estado={{ texto: est.texto, tono: est.tono }} frase={frase}
        migasExtra={[{ etiqueta: diaMes(c.dia) }]}
        derecha={<NavegaFicha pos={pos} total={enCola.filter((x) => x.id).length} etiqueta="Cierres"
          anterior={anterior?.id ? () => salida.pedirSalir(() => navegar(`${rutaCierre(anterior.id!)}${search}`)) : null}
          siguiente={siguiente?.id ? () => salida.pedirSalir(() => navegar(`${rutaCierre(siguiente.id!)}${search}`)) : null} />}
        principal={principal} secundarios={secundarios} masAcciones={mas} />
      <Ficha datos={datos} documento={doc} documentoOculto={marco?.documentoOculto ?? false} reglaAnchos />
      <BotonPulgar>{principal}</BotonPulgar>
      {salida.aviso}
      {dialogo?.que === 'quitar' && <DialogoMotivo titulo={`Quitar el ${dialogo.p.codigo} de este cierre`} boton="Quitar"
        explicacion="Deja de contar en el cierre (y en su factura y su asiento). El pedido sigue igual en Pedidos." etiqueta="Por qué"
        alCerrar={() => setDialogo(null)} alAceptar={(m) => { setCambios((cs) => ponerCambio(cs, { pedido: dialogo.p.id, accion: 'quitar', motivo: m })); setDialogo(null) }} />}
      {dialogo?.que === 'mover' && <DialogoMover p={dialogo.p} hoy={hoyEnMadrid()} alCerrar={() => setDialogo(null)}
        alAceptar={(d) => { setCambios((cs) => ponerCambio(cs, { pedido: dialogo.p.id, accion: 'mover', dia: d })); setDialogo(null) }} />}
      {dialogo?.que === 'importe' && <DialogoImporte p={dialogo.p} alCerrar={() => setDialogo(null)}
        alAceptar={(x, m) => { setCambios((cs) => ponerCambio(cs, { pedido: dialogo.p.id, accion: 'importe', importe: x, ...(m ? { motivo: m } : {}) })); setDialogo(null) }} />}
      {dialogo?.que === 'ver' && (
        <Dialogo titulo={`Pedido ${dialogo.p.codigo}`} alCerrar={() => setDialogo(null)}
          acciones={<><Link to="/pedidos" className="s-boton s-boton-secundario">Abrir en Pedidos</Link><Boton variante="principal" onClick={() => setDialogo(null)}>Cerrar</Boton></>}>
          <FilaCampos columnas={2}>
            <CampoFicha etiqueta="Día y hora" valor={`${diaMes(dialogo.p.dia)} · ${dialogo.p.hora}`} cifra />
            <CampoFicha etiqueta="Marca" valor={dialogo.p.marca ?? 'Sin marca'} />
            <CampoFicha etiqueta="Estado" valor={NOMBRE_ESTADO_PEDIDO[dialogo.p.estado] ?? dialogo.p.estado} />
            <CampoFicha etiqueta="Total del pedido" valor={eurosExactos(dialogo.p.totalPedido)} cifra />
            {dialogo.p.ajuste && <CampoFicha etiqueta="En la contabilidad" valor={`${etiquetaAjuste(dialogo.p.ajuste)}${dialogo.p.ajuste.motivo ? ` · ${dialogo.p.ajuste.motivo}` : ''}${dialogo.p.ajuste.quien ? ` · ${dialogo.p.ajuste.quien}` : ''}`} ancho={2} />}
          </FilaCampos>
        </Dialogo>
      )}
      {dialogo?.que === 'espera' && <DialogoMotivo titulo="Dejar en espera" boton="Dejar en espera" etiqueta="Por qué, en una frase"
        explicacion="No se valida hasta quitarlo de espera. Ejemplo: «Glovo paga 4,50 € menos de lo que dice el cierre»."
        alCerrar={() => setDialogo(null)} alAceptar={async (m) => {
          try { await ponerEnEspera(c.id!, m, userName); setAviso({ ok: true, texto: `En espera: ${m}` }); setVuelta((v) => v + 1) }
          catch (e) { setAviso({ ok: false, texto: `No se ha dejado en espera: ${e instanceof Error ? e.message : String(e)}` }) }
          setDialogo(null)
        }} />}
    </div>
  )
}

function DialogoMotivo({ titulo, boton, explicacion, etiqueta, alCerrar, alAceptar }: {
  titulo: string; boton: string; explicacion: string; etiqueta: string; alCerrar: () => void; alAceptar: (motivo: string) => void | Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar} explicacion={explicacion}
      acciones={<><Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!motivo.trim()} onClick={() => void alAceptar(motivo.trim())}>{boton}</Boton></>}>
      <Campo etiqueta={etiqueta}>{(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} maxLength={300} />}</Campo>
    </Dialogo>
  )
}

function DialogoMover({ p, hoy, alCerrar, alAceptar }: { p: PedidoCierre; hoy: string; alCerrar: () => void; alAceptar: (dia: string) => void }) {
  const [dia, setDia] = useState('')
  const mal = !dia ? null : dia >= hoy ? 'Solo a un día ya cerrado.' : dia === p.dia && !p.ajuste?.dia ? 'Ya es su día.' : null
  return (
    <Dialogo titulo={`Pasar el ${p.codigo} a otro día`} alCerrar={alCerrar}
      explicacion="Cuenta en el cierre de ese día (mismo local y canal), que se rehace al guardar. El pedido sigue igual en Pedidos."
      acciones={<><Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!dia || !!mal} onClick={() => alAceptar(dia)}>Pasar</Boton></>}>
      <Campo etiqueta="Día" error={mal}>{(x) => <Fecha {...x} valor={dia} alCambiar={setDia} />}</Campo>
    </Dialogo>
  )
}

function DialogoImporte({ p, alCerrar, alAceptar }: { p: PedidoCierre; alCerrar: () => void; alAceptar: (importe: number, motivo: string | null) => void }) {
  const [texto, setTexto] = useState(textoDeNumero(p.total))
  const [motivo, setMotivo] = useState('')
  const n = numeroDeTexto(texto)
  const mal = n === null || n <= 0 ? 'Pon el importe que cuenta (para que no cuente, quítalo del cierre).' : null
  return (
    <Dialogo titulo={`Ajustar el importe del ${p.codigo}`} alCerrar={alCerrar}
      explicacion={`El pedido es de ${eurosExactos(p.totalPedido)}. Cuenta en el cierre con el importe que pongas, y queda «CAMBIADO» con el de antes. El pedido sigue igual en Pedidos.`}
      acciones={<><Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton><Boton variante="principal" disabled={!!mal} onClick={() => alAceptar(n!, motivo.trim() || null)}>Ajustar</Boton></>}>
      <Campo etiqueta="Importe que cuenta" error={texto && mal ? mal : null}>{(x) => <Texto {...x} valor={texto} alCambiar={setTexto} inputMode="decimal" />}</Campo>
      <Campo etiqueta="Por qué" ayuda="Opcional: «La plataforma cobró 1 € menos».">{(x) => <Texto {...x} valor={motivo} alCambiar={setMotivo} maxLength={300} />}</Campo>
    </Dialogo>
  )
}
