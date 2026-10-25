// src/modules/conta/ventas/LiquidacionPlataformaPage.tsx
//
// V01 · Entrega 3 · La ficha de una fila de Ventas › Liquidaciones ›
// Plataformas: un periodo, una plataforma y un local (las liquidaciones de
// sus tiendas, sumadas), con la plantilla FICHA.
//
//   · Las cifras: Ventas − Comisión − Otros = Pagan, y lo que llegó al banco.
//   · Comparado con tus cierres del día (más las marcas cedidas, que la
//     plataforma paga pero no son ventas tuyas).
//   · Las diferencias, cada una con su porqué; se resuelven en una frase:
//     «Es un gasto» (con su asiento, validado: 629 contra la 430 de la
//     plataforma; un pedido sin cobrar, su devolución al libro) o «La
//     reclamo». Los cerrados sin confirmar que no cobra (C11b) están aquí y ya
//     no salen en el Libro diario. Lo resuelto se queda a la vista (regla 7).
//   · Cada liquidación: su factura de comisión (de Compras: la comisión y su
//     IVA van como gasto con ella), su asiento y su cobro; «Casar el cobro»
//     con el movimiento del banco del mismo importe, como en Bancos.
// Cada botón dice lo que ha hecho, o por qué no (regla 8).

import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaBancos, rutaCierres, rutaLiquidacionPlataforma, rutaLiquidacionesVentas, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { Boton, Campo, Chip, Dialogo, Texto } from '@/modules/conta/diseno'
import { BloqueFicha, CampoFicha, Ficha, FilaCampos, NavegaFicha } from '@/modules/conta/diseno/plantillas'
import {
  NOMBRE_ESTADO, cifras, deClave, diferencias, estado, filtrar, fraseEstado, pendientes, periodo, pestanaDe, r2, type Diferencia, type GrupoPlataforma,
  type LiquidacionDePlataforma,
} from '@/modules/conta/lib/liquidacionesPlataforma'
import { candidatosCobro, casarCobro, leerPlataformas, resolverDiferencia, type MovimientoCandidato } from '@/modules/conta/services/liquidacionesVentasService'
import { numeroDeTexto, textoDeNumero } from '@/modules/conta/lib/facturasVenta'
import { validar } from '@/modules/conta/services/diarioService'

const euros = (x: number | null) => (x === null ? '—' : eurosExactos(x))
const dma = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

export default function LiquidacionPlataformaPage() {
  const { clave = '' } = useParams()
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const { search } = useLocation()
  const query = new URLSearchParams(search)
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [resolver, setResolver] = useState<{ d: Diferencia; tipo: 'gasto' | 'reclamacion' } | null>(null)
  const [cobro, setCobro] = useState<LiquidacionDePlataforma | null>(null)
  const [validando, setValidando] = useState<string | null>(null)
  const k = deClave(decodeURIComponent(clave))
  // La fila se lee con las de su mismo periodo (y las de la lista, para ‹ ›).
  const datos = useLeer(accountId && activa && k ? () => leerPlataformas(activa.id, k.desde, k.hasta) : null, `${accountId}:${activa?.id}:${clave}:${vuelta}`)
  const g = datos.datos?.find((x) => x.clave === decodeURIComponent(clave)) ?? null

  const volver = `${rutaLiquidacionesVentas()}${search}`
  if (!k) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-apoyo">Esta dirección no es de ninguna liquidación. <Link to={volver}>Volver a Liquidaciones</Link></p></div>
  if (datos.error) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p></div>
  if (!datos.datos) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-apoyo" aria-busy="true">Leyendo la liquidación…</p></div>
  if (!g) return <div className="s-pagina"><EncabezadoPagina titulo="Liquidación" /><p className="s-apoyo">Esta liquidación ya no está (puede que se haya asignado su local y ahora salga en otra fila). <Link to={volver}>Volver a Liquidaciones</Link></p></div>

  const c = cifras(g)
  const e = NOMBRE_ESTADO[estado(g)]
  const difs = diferencias(g)
  const pend = pendientes(g)
  const tuyas = r2(g.cierres.total + g.cedidas.total)
  const sinCasar = g.liquidaciones.filter((l) => !l.referencia && l.cobrado === null && (l.neto ?? 0) > 0)
  // ‹ › entre las de la lista, con sus filtros (las de este periodo; la lista entera vive en la página de la lista).
  const enCola = filtrar(datos.datos, pestanaDe(query.get('estado')), query.get('q') ?? '')
  const pos = enCola.findIndex((x) => x.clave === g.clave)

  const principal = pend.length
    ? <Boton variante="principal" onClick={() => setResolver({ d: pend[0], tipo: 'reclamacion' })} disabled={pend[0].tipo === 'local'}
        title={pend[0].tipo === 'local' ? 'Primero, el local de sus tiendas' : undefined}>Resolver la diferencia</Boton>
    : sinCasar.length
      ? <Boton variante="principal" onClick={() => setCobro(sinCasar[0])}>Casar el cobro</Boton>
      : undefined

  const datosFicha = (
    <>
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role={aviso.ok ? 'status' : 'alert'} data-prueba="resultado-liquidacion">{aviso.texto}</p>}

      <BloqueFicha titulo="Lo que liquida">
        <FilaCampos columnas={3}>
          <CampoFicha etiqueta="Ventas" valor={euros(c.ventas)} cifra />
          <CampoFicha etiqueta="Comisión" valor={euros(c.comision)} cifra />
          <CampoFicha etiqueta="Otros" valor={euros(c.otros)} cifra />
          <CampoFicha etiqueta="Pagan" valor={euros(c.pagan)} cifra />
          <CampoFicha etiqueta="Banco" valor={c.banco === null ? 'Aún no ha llegado' : euros(c.banco)} cifra={c.banco !== null} />
          <CampoFicha etiqueta="Su factura de comisión" valor={c.faltanFacturas ? `Falta${c.faltanFacturas > 1 ? `n ${c.faltanFacturas}` : ''}` : 'Está'} tono={c.faltanFacturas ? 'revisar' : 'normal'} />
        </FilaCampos>
        <p className="s-apoyo">Otros es lo demás que se queda la plataforma (promociones, anuncios, cargos…): Ventas − Comisión − Otros = Pagan. La comisión y su IVA van como gasto con su factura, en Compras y gastos.</p>
      </BloqueFicha>

      <BloqueFicha titulo="Comparado con tus cierres">
        {g.localId ? (
          <>
            <FilaCampos columnas={3}>
              <CampoFicha etiqueta={`Tus cierres (${g.cierres.dias} ${g.cierres.dias === 1 ? 'día' : 'días'})`} valor={eurosExactos(g.cierres.total)} cifra />
              <CampoFicha etiqueta={`Marcas cedidas (${g.cedidas.pedidos} pedidos)`} valor={eurosExactos(g.cedidas.total)} cifra />
              <CampoFicha etiqueta="La liquidación" valor={eurosExactos(c.ventas)} cifra />
            </FilaCampos>
            <p className="s-apoyo">
              Tus cierres y las cedidas suman {eurosExactos(tuyas)}{Math.abs(Math.round((tuyas - c.ventas) * 100)) <= Math.max(1, g.liquidaciones.length) ? ': igual que la liquidación.' : `: ${eurosExactos(Math.abs(r2(tuyas - c.ventas)))} ${tuyas > c.ventas ? 'más' : 'menos'} que la liquidación.`}
              {' '}Las cedidas no son ventas tuyas: la plataforma las paga y se liquidan con su socio.
              {g.cierres.porValidar ? <> {g.cierres.porValidar} {g.cierres.porValidar === 1 ? 'cierre está' : 'cierres están'} por validar en <Link to={rutaCierres()}>Cierres del día</Link>.</> : null}
            </p>
          </>
        ) : <p className="s-apoyo">No sé de qué local son sus tiendas, así que no se pueden comparar con tus cierres. Asígnales su local en Contactos › Plataformas › Sus tiendas.</p>}
      </BloqueFicha>

      <BloqueFicha titulo={pend.length ? `Diferencias (${pend.length} por resolver)` : 'Diferencias'}>
        {difs.length === 0 && <p className="s-apoyo">Ninguna: cuadran las ventas y el cobro, y no hay pedidos sin cobrar.</p>}
        {difs.length > 0 && (
          <ul className="cxv-lista-simple" aria-label="Diferencias">
            {difs.map((d, i) => (
              <li key={`${d.tipo}:${d.saleId ?? i}`} data-diferencia={d.tipo} data-resuelta={d.resuelta ? 'si' : 'no'}>
                <span>{d.texto}</span>{' '}
                {d.resuelta
                  ? <span className="s-tarjeta-apoyo"><Chip tono={d.resuelta.tipo === 'gasto' ? 'neutro' : 'duda'}>{d.resuelta.tipo === 'gasto' ? 'Gasto' : 'Reclamada'}</Chip> «{d.resuelta.frase}»{d.resuelta.quien ? ` · ${d.resuelta.quien}` : ''}{d.resuelta.asientoId ? <> · <Link to={rutaAsiento(d.resuelta.asientoId)}>su asiento</Link></> : null}</span>
                  : d.tipo === 'local' ? null : (
                    <span className="cxv-acciones">
                      <Boton variante="secundario" onClick={() => setResolver({ d, tipo: 'gasto' })} disabled={d.importe <= 0}
                        title={d.importe <= 0 ? 'Lo que paga de más no es un gasto' : undefined}>Es un gasto</Boton>{' '}
                      <Boton variante="secundario" onClick={() => setResolver({ d, tipo: 'reclamacion' })}>La reclamo</Boton>
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
        {g.sinConfirmar.length > 0 && <p className="s-apoyo">Los pedidos cerrados sin confirmar que la liquidación no cobra están aquí, no en el Libro diario.</p>}
      </BloqueFicha>

      <BloqueFicha titulo={g.liquidaciones.length === 1 ? 'La liquidación' : `Sus ${g.liquidaciones.length} liquidaciones`}>
        <table className="cxv-tabla" aria-label="Liquidaciones">
          <thead><tr><th>Tienda</th><th>Fecha</th><th className="s-cifra">Ventas</th><th className="s-cifra">Pagan</th><th className="s-cifra">Banco</th><th>Su factura</th><th>Asiento</th></tr></thead>
          <tbody>
            {g.liquidaciones.map((l) => (
              <tr key={l.id} data-liquidacion={l.id}>
                <td>{l.tienda ?? g.canal}{l.ref ? <span className="s-tarjeta-apoyo"> {l.ref}</span> : null}{l.referencia ? <> <Chip tono="neutro" titulo="De antes del corte: sirve para contrastar y casar su cobro; no lleva factura ni asiento.">De referencia</Chip></> : null}{l.porAclarar ? <span className="s-tarjeta-apoyo" data-tono="duda"> {l.porAclarar}</span> : null}</td>
                <td className="s-cifra">{dma(l.fecha)}</td>
                <td className="s-cifra">{eurosExactos(l.ventas)}</td>
                <td className="s-cifra">{euros(l.neto)}</td>
                <td className="s-cifra">
                  {l.cobrado !== null ? <>{eurosExactos(l.cobrado)}<span className="s-tarjeta-apoyo"> {dma(l.cobradoEl)}{l.casadaEnBanco ? '' : ' (a mano)'}</span></>
                    : (l.neto ?? 0) > 0 && !l.referencia ? <Boton variante="enlace" onClick={() => setCobro(l)}>Casar el cobro</Boton> : '—'}
                </td>
                <td>{l.factura ? <Link to={rutaRevisarFactura(l.factura.id)}>{l.factura.numero ?? 'Sin número'}</Link> : (l.aFacturar ?? 0) > 0 && !l.referencia ? <Chip tono="duda">Falta ({eurosExactos(l.aFacturar ?? 0)})</Chip> : '—'}</td>
                <td>
                  {l.asiento ? <Link to={rutaAsiento(l.asiento.id)}>{l.asiento.numero ? `Nº ${l.asiento.numero.toLocaleString('es-ES')}` : 'Propuesto'}</Link> : '—'}
                  {l.asiento && l.asiento.estado === 'propuesto' && (
                    <> <Boton variante="enlace" disabled={validando === l.asiento.id} onClick={async () => {
                      const id = l.asiento!.id
                      setValidando(id)
                      try { const v = await validar(id, userName); setAviso({ ok: true, texto: `Validado el asiento de la liquidación${l.tienda ? ` de ${l.tienda}` : ''}: nº ${v.numero.toLocaleString('es-ES')}. Entra en el traspaso del mes.` }); setVuelta((x) => x + 1) }
                      catch (x) { setAviso({ ok: false, texto: `No se ha validado: ${x instanceof Error ? x.message : String(x)}` }) }
                      setValidando(null)
                    }}>{validando === l.asiento.id ? 'Validando…' : 'Validar'}</Boton></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="s-apoyo">El cobro se casa con su movimiento del banco, como en <Link to={rutaBancos()}>Bancos</Link>: hace el asiento del banco contra la 430 de {g.canal}.</p>
      </BloqueFicha>
    </>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-liquidacion-plataforma" data-estado={estado(g)}>
      <EncabezadoPagina titulo={`${g.canal} · ${g.local ?? 'sin local'}`} estado={{ texto: e.texto, tono: e.tono }} frase={fraseEstado(g)}
        migasExtra={[{ etiqueta: periodo(g.desde, g.hasta) }]}
        derecha={<NavegaFicha pos={pos} total={enCola.length} etiqueta="Liquidaciones"
          anterior={pos > 0 ? () => navegar(`${rutaLiquidacionPlataforma(enCola[pos - 1].clave)}${search}`) : null}
          siguiente={pos >= 0 && pos < enCola.length - 1 ? () => navegar(`${rutaLiquidacionPlataforma(enCola[pos + 1].clave)}${search}`) : null} />}
        principal={principal} />
      <Ficha datos={datosFicha} />
      {principal && <BotonPulgar>{principal}</BotonPulgar>}
      {resolver && accountId && activa && (
        <DialogoResolver g={g} d={resolver.d} tipoInicial={resolver.tipo} alCerrar={() => setResolver(null)}
          alHacer={async (tipo, importe, frase) => {
            try {
              const t = await resolverDiferencia(accountId, activa.id, g, { tipo, importe, frase, pedido: resolver.d.saleId ? { saleId: resolver.d.saleId, dia: g.sinConfirmar.find((p) => p.saleId === resolver.d.saleId)?.dia ?? g.desde } : null }, userName)
              setAviso({ ok: true, texto: t }); setResolver(null); setVuelta((v) => v + 1)
            } catch (x) { return x instanceof Error ? x.message : String(x) }
            return null
          }} />
      )}
      {cobro && accountId && activa && (
        <DialogoCobro accountId={accountId} companyId={activa.id} l={cobro} hasta={g.hasta} alCerrar={() => setCobro(null)}
          alCasar={async (m) => {
            try { const t = await casarCobro(accountId, activa.id, g, cobro.id, m); setAviso({ ok: true, texto: t }); setCobro(null); setVuelta((v) => v + 1) }
            catch (x) { return x instanceof Error ? x.message : String(x) }
            return null
          }} />
      )}
    </div>
  )
}

function DialogoResolver({ g, d, tipoInicial, alCerrar, alHacer }: {
  g: GrupoPlataforma; d: Diferencia; tipoInicial: 'gasto' | 'reclamacion'; alCerrar: () => void
  alHacer: (tipo: 'gasto' | 'reclamacion', importe: number, frase: string) => Promise<string | null>
}) {
  const [tipo, setTipo] = useState<'gasto' | 'reclamacion'>(d.importe > 0 ? tipoInicial : 'reclamacion')
  const [texto, setTexto] = useState(textoDeNumero(Math.abs(d.importe)))
  const [frase, setFrase] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const n = numeroDeTexto(texto)
  const importe = n === null ? null : d.importe < 0 ? -n : n
  const mal = n === null || n <= 0 ? 'Pon el importe de la diferencia.' : null
  const explicacion = tipo === 'gasto'
    ? d.saleId
      ? 'No se va a cobrar: su devolución se propone al libro (708 y su IVA contra la 430 de la plataforma), como en Lo que deja el cierre del día, y el pedido sale del aviso.'
      : `No se va a cobrar: se hace y se valida su asiento, a otros servicios (629) contra la 430 de ${g.canal}.`
    : `Se la reclamas a ${g.canal}. Queda apuntada con tu frase; no hace asiento.`
  return (
    <Dialogo titulo={tipo === 'gasto' ? 'Es un gasto' : 'La reclamo'} alCerrar={alCerrar} explicacion={<>{d.texto} {explicacion}</>}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!frase.trim() || !!mal || ocupado} onClick={async () => {
          setOcupado(true); setFallo(await alHacer(tipo, importe!, frase.trim())); setOcupado(false)
        }}>{ocupado ? 'Apuntando…' : tipo === 'gasto' ? 'Apuntar el gasto' : 'Apuntar la reclamación'}</Boton>
      </>}>
      <div className="cxv-acciones" role="radiogroup" aria-label="Cómo se resuelve">
        <label><input type="radio" name="tipo" checked={tipo === 'gasto'} disabled={d.importe <= 0} onChange={() => setTipo('gasto')} /> Es un gasto</label>{' '}
        <label><input type="radio" name="tipo" checked={tipo === 'reclamacion'} onChange={() => setTipo('reclamacion')} /> La reclamo</label>
      </div>
      {!d.saleId && <Campo etiqueta="Importe" error={texto && mal ? mal : null}>{(x) => <Texto {...x} valor={texto} alCambiar={setTexto} inputMode="decimal" />}</Campo>}
      <Campo etiqueta="Por qué, en una frase" ayuda="Ejemplo: «Glovo no paga los pedidos que el cliente no recogió».">{(x) => <Texto {...x} valor={frase} alCambiar={setFrase} maxLength={300} />}</Campo>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha apuntado: {fallo}</p>}
    </Dialogo>
  )
}

function DialogoCobro({ accountId, companyId, l, hasta, alCerrar, alCasar }: {
  accountId: string; companyId: string; l: LiquidacionDePlataforma; hasta: string; alCerrar: () => void; alCasar: (m: MovimientoCandidato) => Promise<string | null>
}) {
  const cand = useLeer(() => candidatosCobro(accountId, companyId, l.neto ?? 0, hasta), `${l.id}:${l.neto}:${hasta}`)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const xs = cand.datos ?? []
  return (
    <Dialogo titulo={`Casar el cobro${l.tienda ? ` de ${l.tienda}` : ''}`} alCerrar={alCerrar}
      explicacion={`Los movimientos del banco de ${eurosExactos(l.neto ?? 0)} desde el ${dma(hasta)} y sin casar. Al casarlo se hace su asiento del banco contra la 430 de la plataforma.`}
      acciones={<Boton variante="secundario" onClick={alCerrar}>Cerrar</Boton>}>
      {cand.error && <p className="s-aviso-lista" data-tono="falta" role="alert">{cand.error}</p>}
      {!cand.datos && !cand.error && <p className="s-apoyo" aria-busy="true">Buscando en el banco…</p>}
      {cand.datos && xs.length === 0 && <p className="s-apoyo">Ningún movimiento de ese importe en esos días: aún no ha llegado, o llegó por otro importe (mira Bancos › Movimientos).</p>}
      {xs.length > 0 && (
        <ul className="cxv-lista-simple" aria-label="Movimientos que pueden ser su cobro">
          {xs.map((m) => (
            <li key={m.id}>
              <span className="s-cifra">{dma(m.fecha)} · {eurosExactos(m.importe)}</span> · {m.concepto}{m.banco ? ` · ${m.banco}` : ''}{' '}
              <Boton variante="secundario" disabled={!!ocupado} onClick={async () => { setOcupado(m.id); setFallo(await alCasar(m)); setOcupado(null) }}>{ocupado === m.id ? 'Casando…' : 'Casar'}</Boton>
            </li>
          ))}
        </ul>
      )}
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha casado: {fallo}</p>}
    </Dialogo>
  )
}
