// src/modules/conta/terceros/FichaTerceroPage.tsx
//
// C03 · La ficha de un tercero con papel de cliente, plataforma o socio de
// marca. Fiel a las maquetas docs/conta/maquetas/c03/N9Cliente (plataforma) y
// N10Socio (socio de marca); el cliente normal, la misma ficha con sus estados
// vacíos («Las facturas llegan con Facturación»).
//
//   /conta/clientes-y-proveedores/:partyId              → resumen o portada (móvil)
//   /conta/clientes-y-proveedores/:partyId/:apartado    → pestaña o pantalla del móvil
//
// Un tercero que solo es proveedor no viene aquí: abre su ficha del C01b.
// Cada acción dice lo que ha pasado, con contenido (regla 8 de CLAUDE.md).

import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { migasFichaTercero, rutaFichaProveedor, rutaFichaTercero, rutaTerceros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo, EsqueletoFicha, Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, Guardado, Vacio } from '@/modules/conta/ui/piezas'
import { useFichaTercero } from '@/modules/conta/terceros/useFichaTercero'
import {
  NOMBRE_APARTADO_TERCERO, TerceroContexto, apartadosDe, calculosDelMes, esApartadoTercero, papelesDe, useAprendido, useTercero,
  type ApartadoTercero, type ContextoTercero,
} from '@/modules/conta/terceros/contextoTercero'
import { Aprendido, ComoSeCalcula, ConQuienHablas, LiquidacionesAnteriores, SusCuentas, TarjetaLiquidaciones } from '@/modules/conta/terceros/piezasTercero'
import { NuevaFactura, PrepararLiquidacion, SubirLiquidacion } from '@/modules/conta/terceros/dialogosTercero'
import {
  CobroTercero, ContabilidadTercero, ContactosTercero, DatosFiscalesTercero, DocumentosTercero, HistorialTercero, LiquidacionesTercero,
} from '@/modules/conta/terceros/ApartadosTercero'
import { accionPrincipal, franjaArchivado, ordenarPapeles, type Papel } from '@/modules/conta/lib/terceros'
import { cifrasPlataforma } from '@/modules/conta/lib/liquidaciones'
import { liquidarMes, textoImporte } from '@/modules/conta/lib/liquidacionSocio'
import { diaMes, euros, eurosExactos, hoyEnMadrid, iniciales } from '@/modules/conta/lib/formato'
import { anadirPapel, archivarTercero } from '@/modules/conta/services/tercerosService'

const CADA: Record<string, string> = { weekly: 'Liquida cada semana', fortnightly: 'Liquida cada 15 días', monthly: 'Liquida cada mes' }

/** La lista de las migas: la de su papel principal. */
function listaDe(papeles: readonly Papel[]): { etiqueta: string; filtro: string } {
  if (papeles.includes('platform')) return { etiqueta: 'Plataformas', filtro: 'plataformas' }
  if (papeles.includes('brand_partner')) return { etiqueta: 'Socios de marca', filtro: 'socios' }
  return { etiqueta: 'Clientes', filtro: 'clientes' }
}

const pct = (n: number | null | undefined) => (n == null ? null : `${String(n).replace('.', ',')} %`)
const conSigno = (n: number) => (n < 0 ? `−${euros(-n)}` : euros(n))

export default function FichaTerceroPage() {
  const { partyId = '' } = useParams()
  return <Ficha key={partyId} partyId={partyId} />
}

function Ficha({ partyId }: { partyId: string }) {
  const { apartado } = useParams()
  const { accountId, cargando } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const location = useLocation()
  const uso = useFichaTercero(cargando ? null : accountId, activa?.id ?? null, partyId)
  const avisoDeLlegada = (location.state as { aviso?: string } | null)?.aviso ?? null
  const [aviso, setAviso] = useState<string | null>(avisoDeLlegada)
  const ap: ApartadoTercero = esApartadoTercero(apartado) ? apartado : 'ficha'
  const hoy = hoyEnMadrid()
  const { recargar } = uso

  const ctx = useMemo<ContextoTercero | null>(() => uso.estado === 'lista' && accountId ? {
    ficha: uso.ficha, mesSocio: uso.mesSocio, accountId, companyId: activa?.id ?? null, hoy, movil, recargar,
    rutaApartado: (a: ApartadoTercero) => (a === 'ficha' ? rutaFichaTercero(partyId) : rutaFichaTercero(partyId, a)),
    avisar: setAviso,
  } : null, [uso, accountId, activa?.id, hoy, movil, recargar, partyId])

  let cuerpo: ReactNode
  if (apartado !== undefined && !esApartadoTercero(apartado)) cuerpo = <Navigate to={rutaFichaTercero(partyId)} replace />
  else if (uso.estado === 'cargando' || cargando) cuerpo = <EsqueletoFicha movil={movil} />
  else if (uso.estado === 'error') cuerpo = <ErrorConReintento mensaje={uso.error} reintentar={recargar} />
  else if (uso.estado === 'no-existe' || !ctx) {
    cuerpo = (
      <div className="cx-tarjeta">
        <Vacio titulo="Ese tercero no existe o no es de esta cuenta."
          explicacion="Puede que estés en otra cuenta."
          accion={<Link className="cx-boton-sec" to={rutaTerceros()}>Ver clientes y proveedores</Link>} />
      </div>
    )
  } else if (!apartadosDe(ctx.ficha.papeles.map((p) => p.role)).includes(ap)) {
    cuerpo = <Navigate to={rutaFichaTercero(partyId)} replace />
  } else {
    cuerpo = (
      <TerceroContexto.Provider value={ctx}>
        {movil
          ? (ap === 'ficha' ? <PortadaMovil aviso={aviso} /> : <PantallaMovil ap={ap} aviso={aviso} />)
          : (ap === 'ficha' ? <Resumen aviso={aviso} /> : <Edicion ap={ap} aviso={aviso} />)}
      </TerceroContexto.Provider>
    )
  }
  return <div className="cxt-ficha">{cuerpo}</div>
}

// ═══════════════════════════════════════════════════════════════════════════
// Lo común: la acción principal, el menú «···» y la franja de archivado
// ═══════════════════════════════════════════════════════════════════════════

type Ventana = 'subir_liquidacion' | 'preparar_liquidacion' | 'nueva_factura' | null

function useAccion() {
  const { ficha, mesSocio } = useTercero()
  const papeles = ficha.papeles.map((p) => p.role)
  return accionPrincipal(papeles, mesSocio?.mes.nombre ?? 'este mes')
}

function VentanaAccion({ ventana, cerrar }: { ventana: Ventana; cerrar: () => void }) {
  if (ventana === 'subir_liquidacion') return <SubirLiquidacion alCerrar={cerrar} />
  if (ventana === 'preparar_liquidacion') return <PrepararLiquidacion alCerrar={cerrar} />
  if (ventana === 'nueva_factura') return <NuevaFactura alCerrar={cerrar} />
  return null
}

function FranjaArchivado() {
  const { ficha, recargar, avisar } = useTercero()
  const [fallo, setFallo] = useState<string | null>(null)
  const franja = franjaArchivado(ficha.tercero)
  if (!franja) return null
  return (
    <div className="cx-aviso cxt-franja" role="status">
      <span><strong>{franja}.</strong> No sale en las listas; sus cuentas, liquidaciones e histórico siguen aquí.</span>
      <button type="button" className="cx-boton-sec" onClick={async () => {
        setFallo(null)
        try { await archivarTercero(ficha.tercero.id, false); avisar(`${ficha.tercero.nombre} recuperado: vuelve a salir en la lista.`); recargar() }
        catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo recuperar.') }
      }}>Recuperar</button>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )
}

const PAPELES_QUE_SE_ANADEN: { papel: 'customer' | 'platform' | 'brand_partner'; texto: string }[] = [
  { papel: 'customer', texto: 'Añadir papel de cliente' },
  { papel: 'platform', texto: 'Es también plataforma de reparto' },
  { papel: 'brand_partner', texto: 'Es también socio de marca' },
]

function MenuMas() {
  const { ficha, recargar, avisar, rutaApartado } = useTercero()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [archivar, setArchivar] = useState(false)
  const [nota, setNota] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const t = ficha.tercero
  const tiene = new Set(ficha.papeles.map((p) => p.role))
  return (
    <>
      <button type="button" className="cx-boton-sec cx-mas" aria-haspopup="menu" aria-expanded={abierto}
        aria-label="Más acciones" onClick={() => setAbierto((v) => !v)}>···</button>
      {abierto && (
        <div className="cxp-menu" role="menu">
          {t.supplierId && <Link role="menuitem" to={rutaFichaProveedor(t.supplierId)}>Abrir su ficha de proveedor</Link>}
          {PAPELES_QUE_SE_ANADEN.filter((p) => !tiene.has(p.papel)).map((p) => (
            <button key={p.papel} type="button" role="menuitem" onClick={async () => {
              setAbierto(false); setFallo(null)
              try {
                const r = await anadirPapel(t.id, p.papel)
                avisar(p.papel === 'platform'
                  ? `${t.nombre} es ahora también plataforma. Dime su canal de venta en «Cobro» para enlazar sus liquidaciones${r.liquidaciones_enlazadas ? ` (ya van ${r.liquidaciones_enlazadas})` : ''}.`
                  : `${t.nombre} tiene ahora también el papel de ${p.papel === 'customer' ? 'cliente' : 'socio de marca'}: un solo tercero, con todos sus papeles.`)
                recargar()
                if (p.papel !== 'customer') navigate(rutaApartado('cobro'))
              } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo añadir.') }
            }}>{p.texto}</button>
          ))}
          {t.archivadoEn
            ? <button type="button" role="menuitem" onClick={async () => {
                setAbierto(false); setFallo(null)
                try { await archivarTercero(t.id, false); avisar(`${t.nombre} recuperado: vuelve a salir en la lista.`); recargar() }
                catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo recuperar.') }
              }}>Recuperar</button>
            : <button type="button" role="menuitem" onClick={() => { setAbierto(false); setArchivar(true) }}>Archivar</button>}
        </div>
      )}
      {fallo && <div className="cx-error cxt-fallo-menu" role="alert">{fallo}</div>}
      {archivar && (
        <Dialogo titulo={`¿Archivar ${t.nombre}?`} alCerrar={() => setArchivar(false)}>
          <p style={{ margin: 0, fontSize: 15 }}>Deja de salir en las listas (lo verás en «Archivados» y se recupera con un clic). No se borra nada: sus cuentas, liquidaciones y su histórico se quedan.</p>
          <div className="cx-campo">
            <label htmlFor="archivar-nota">Por qué (opcional)</label>
            <input id="archivar-nota" className="cx-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ya no trabajamos con ellos" />
          </div>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setArchivar(false)}>Cancelar</button>
            <button type="button" className="cx-boton" onClick={async () => {
              try {
                await archivarTercero(t.id, true, nota.trim() || null)
                navigate(rutaTerceros(), { state: { aviso: `${t.nombre} archivado. Ya no sale en las listas; está en «Archivados» con sus cuentas y su histórico.` } })
              } catch (e) { setArchivar(false); setFallo(e instanceof Error ? e.message : 'No se pudo archivar.') }
            }}>Archivar</button>
          </div>
        </Dialogo>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Ordenador (N9 / N10)
// ═══════════════════════════════════════════════════════════════════════════

function Pildoras() {
  const { ficha } = useTercero()
  const { rolPlataforma, rolSocio } = papelesDe(ficha)
  const papeles = ordenarPapeles(ficha.papeles.map((p) => p.role))
  const texto: Record<Papel, string> = {
    platform: 'Plataforma de reparto',
    brand_partner: 'Socio de marca · cesión',
    customer: rolSocio ? 'Cliente · liquidación mensual' : 'Cliente',
    supplier: rolPlataforma ? 'También proveedor · comisiones' : rolSocio ? 'Proveedor de mercancía' : 'También proveedor',
  }
  const nifOk = ficha.proveedor?.taxIdCheckStatus === 'valid'
  return (
    <div className="cxp-pildoras">
      {papeles.map((p, i) => <span key={p} className={`cx-chip ${i === 0 ? (p === 'platform' ? 'cx-chip-ambar' : 'cx-chip-azul') : ''}`}>{texto[p]}</span>)}
      {ficha.proveedor?.legalName && <span className="cx-chip">{ficha.proveedor.legalName}</span>}
      {ficha.tercero.nif
        ? <span className={`cx-chip${nifOk ? ' cx-chip-ia' : ''}`}>{ficha.tercero.nif}{nifOk ? ' ✓ comprobado' : ''}</span>
        : <span className="cx-chip cx-chip-ambar">Sin NIF</span>}
      {rolPlataforma?.settlementEvery && <span className="cx-chip">{CADA[rolPlataforma.settlementEvery]}</span>}
      {ficha.tercero.archivadoEn && <span className="cx-chip cx-chip-ambar">Archivado</span>}
    </div>
  )
}

function Cabecera() {
  const { ficha, rutaApartado } = useTercero()
  const accion = useAccion()
  const [ventana, setVentana] = useState<Ventana>(null)
  const papeles = ficha.papeles.map((p) => p.role)
  return (
    <header className="cxp-cabecera">
      <div className="cxp-identidad">
        <span className="cxp-avatar" aria-hidden="true">{iniciales(ficha.tercero.nombre)}</span>
        <div className="cxp-titulos">
          <Migas migas={migasFichaTercero(ficha.tercero.nombre, listaDe(papeles)).slice(0, 2)} />
          <h1 className="cxp-nombre">{ficha.tercero.nombre}</h1>
          <Pildoras />
        </div>
      </div>
      <div className="cxp-acciones">
        <Link className="cx-boton-sec" to={rutaApartado('datos-fiscales')}>Editar</Link>
        {accion.id && <button type="button" className="cx-boton" onClick={() => setVentana(accion.id)}>{accion.texto}</button>}
        <MenuMas />
      </div>
      <VentanaAccion ventana={ventana} cerrar={() => setVentana(null)} />
    </header>
  )
}

function Pestanas({ ap }: { ap: ApartadoTercero }) {
  const { ficha, rutaApartado } = useTercero()
  return (
    <nav aria-label="Apartados de la ficha" className="cx-pestanas cxt-pestanas">
      {apartadosDe(ficha.papeles.map((p) => p.role)).map((p) => (
        <Link key={p} className="cx-pestana" aria-current={p === ap ? 'page' : undefined} to={rutaApartado(p)}>{NOMBRE_APARTADO_TERCERO[p]}</Link>
      ))}
    </nav>
  )
}

function Cifra({ et, valor, pie, tono }: { et: string; valor: string | null; pie: ReactNode; tono?: 'ambar' | 'verde' }) {
  return (
    <div className="cx-tarjeta cxp-cifra">
      <span className="cxp-cifra-et">{et}</span>
      <span className="cxp-cifra-valor">{valor ?? '—'}</span>
      <span className={`cxp-cifra-pie${tono === 'ambar' ? ' cxp-cifra-pie-ambar' : tono === 'verde' ? ' cxt-verde' : ''}`}>{pie}</span>
    </div>
  )
}

function CifrasPlataforma() {
  const { ficha, hoy } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const c = cifrasPlataforma(ficha.liquidaciones, hoy)
  const cuentaComision = ficha.cuentas.find((x) => x.papel === 'proveedor')
  if (!c.hayLiquidaciones) {
    return (
      <section className="cx-tarjeta" aria-label="Cifras">
        <Vacio titulo="Aún no hay liquidaciones suyas."
          explicacion="Con la primera verás lo que te debe, lo que te ha vendido este año, las comisiones y si cada cobro cuadró con el banco." />
      </section>
    )
  }
  const u = c.ultima
  return (
    <div className="cxp-cifras">
      <Cifra et="Te debe" valor={eurosExactos(c.teDebe.total)} tono={c.teDebe.total ? 'ambar' : undefined}
        pie={c.teDebe.frase ?? (c.teDebe.sinNeto ? `${c.teDebe.sinNeto} sin neto en el fichero` : 'Nada pendiente')} />
      <Cifra et="Te ha vendido este año" valor={euros(c.vendidoEsteAnio)}
        pie={c.pedidosEsteAnio ? `${c.pedidosEsteAnio.toLocaleString('es-ES')} pedidos` : 'El fichero no trae los pedidos'} />
      <Cifra et="Comisiones este año" valor={c.comisionesEsteAnio ? conSigno(-c.comisionesEsteAnio) : null}
        pie={<>{c.pctMedio != null ? `${pct(c.pctMedio)} de media` : rolPlataforma?.commissionPct != null ? `${pct(rolPlataforma.commissionPct)} pactada` : 'El fichero no trae comisiones'}{cuentaComision ? ` · van a ${cuentaComision.code}` : ''}</>} />
      <Cifra et="Última liquidación" valor={u?.periodo ?? null} tono={u?.estado.tono === 'verde' ? 'verde' : u?.estado.tono === 'ambar' ? 'ambar' : undefined}
        pie={u ? `${u.liq.neto != null ? `${eurosExactos(u.liq.neto)} · ` : ''}${u.estado.explica}` : '—'} />
    </div>
  )
}

function CifrasSocio() {
  const { ficha, mesSocio } = useTercero()
  const { rolSocio } = papelesDe(ficha)
  if (!mesSocio) return null
  const m = liquidarMes(calculosDelMes(mesSocio.porLocal))
  const albaranes = mesSocio.porLocal.reduce((s, l) => s + l.albaranes, 0)
  const nAport = mesSocio.porLocal.reduce((s, l) => s + l.aportaciones_n, 0)
  const cuentaProv = ficha.cuentas.find((x) => x.papel === 'proveedor')
  const KIND: Record<string, string> = { marketing: 'marketing', packaging: 'packaging', other: 'otras' }
  const tipos = (rolSocio?.contributionKinds ?? []).map((k) => KIND[k] ?? k)
  const ultimoDia = Number(mesSocio.mes.hasta.slice(8, 10))
  return (
    <div className="cxp-cifras">
      <Cifra et="Le has comprado este mes" valor={euros(m.compras)}
        pie={`${albaranes === 1 ? '1 albarán' : `${albaranes} albaranes`}${cuentaProv ? ` · ${cuentaProv.code}` : ''}`} />
      <Cifra et="Aportaciones del socio" valor={m.aportaciones ? conSigno(-m.aportaciones) : euros(0)}
        pie={nAport ? `${tipos.length ? tipos.join(' y ') : `${nAport} apuntadas`} · según contrato` : 'Ninguna apuntada este mes'} />
      <Cifra et="Comisión pactada" valor={m.pct != null ? `+${pct(m.pct)} de ${euros(m.baseVentas)}` : ficha.acuerdos.length ? 'Por marca' : null}
        pie={ficha.acuerdos.length ? `ventas de sus marcas · ${euros(m.comision)}` : 'Ninguna marca enlazada'} />
      <Cifra et={`Liquidación de ${mesSocio.mes.nombre}`} valor={euros(Math.abs(m.importe))} tono={m.faltan.length ? 'ambar' : undefined}
        pie={m.faltan.length ? 'falta una fuente: no se cierra' : `${m.sentido} · se cierra el ${ultimoDia}`} />
    </div>
  )
}

function Resumen({ aviso }: { aviso: string | null }) {
  const { ficha } = useTercero()
  const { plataforma, socio, cliente } = papelesDe(ficha)
  return (
    <>
      <Cabecera />
      <Guardado texto={aviso} />
      <FranjaArchivado />
      <Pestanas ap="ficha" />
      {plataforma && <CifrasPlataforma />}
      {!plataforma && socio && <CifrasSocio />}
      <div className="cxp-columnas">
        <div className="cxp-col-ancha">
          {plataforma && <TarjetaLiquidaciones />}
          {!plataforma && socio && <ComoSeCalcula />}
          {!plataforma && !socio && cliente && <FacturasVacias />}
        </div>
        <div className="cxp-col-estrecha">
          {plataforma && <Aprendido />}
          {!plataforma && socio && <LiquidacionesAnteriores />}
          {(plataforma || !socio) && <ConQuienHablas />}
          <SusCuentas />
        </div>
      </div>
    </>
  )
}

/** Cliente normal: aún no hay facturas emitidas (decisión 3, opción b). */
function FacturasVacias() {
  const [ventana, setVentana] = useState<Ventana>(null)
  return (
    <section className="cx-tarjeta" aria-label="Facturas">
      <h2 className="cx-tarjeta-titulo">Facturas</h2>
      <Vacio titulo="Las facturas llegan con Facturación."
        explicacion="Folvy aún no emite facturas (encargo F01, con su numeración y Verifactu). Mientras, su ficha guarda los datos fiscales, el cobro y su cuenta para cuando llegue."
        accion={<button type="button" className="cx-boton-sec" onClick={() => setVentana('nueva_factura')}>Pedir factura</button>} />
      <VentanaAccion ventana={ventana} cerrar={() => setVentana(null)} />
    </section>
  )
}

const PANTALLA: Record<Exclude<ApartadoTercero, 'ficha'>, () => ReactNode> = {
  'datos-fiscales': () => <DatosFiscalesTercero />,
  contactos: () => <ContactosTercero />,
  cobro: () => <CobroTercero />,
  liquidaciones: () => <LiquidacionesTercero />,
  contabilidad: () => <ContabilidadTercero />,
  documentos: () => <DocumentosTercero />,
  historial: () => <HistorialTercero />,
}

function Edicion({ ap, aviso }: { ap: Exclude<ApartadoTercero, 'ficha'>; aviso: string | null }) {
  return (
    <>
      <Cabecera />
      <Guardado texto={aviso} />
      <FranjaArchivado />
      <Pestanas ap={ap} />
      <section className="cx-tarjeta" aria-label={NOMBRE_APARTADO_TERCERO[ap]}>
        <div className="cxp-edicion-cuerpo">{PANTALLA[ap]()}</div>
      </section>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Móvil (como M4)
// ═══════════════════════════════════════════════════════════════════════════

function lineaMovil(a: Exclude<ApartadoTercero, 'ficha'>, f: ContextoTercero['ficha']): string {
  const { rolPlataforma } = papelesDe(f)
  switch (a) {
    case 'datos-fiscales': return f.tercero.nif ? `${f.tercero.nif}${f.fiscal?.operationScope === 'eu' ? ' · UE' : ''}` : 'Sin NIF'
    case 'contactos': return f.contactos.length ? f.contactos.map((c) => c.name).slice(0, 2).join(', ') : 'Nadie todavía'
    case 'cobro': return rolPlataforma?.settlementEvery ? CADA[rolPlataforma.settlementEvery] : f.fiscal?.paymentTermsDays != null ? `A ${f.fiscal.paymentTermsDays} días` : 'Sin plazo puesto'
    case 'liquidaciones': return f.liquidaciones.length ? `${f.liquidaciones.length} de la plataforma` : f.liquidacionesSocio.length ? `${f.liquidacionesSocio.length} del socio` : 'Ninguna todavía'
    case 'contabilidad': {
      const c = f.cuentas.find((x) => x.papel === 'cliente') ?? f.cuentas.find((x) => x.papel === 'pago')
      return c ? `${c.code} · ${c.name}` : f.planActivo ? 'Sin cuenta de cliente' : 'Plan contable sin activar'
    }
    case 'documentos': return 'Contratos y certificados'
    case 'historial': return 'Lo que ha cambiado y quién'
  }
}

function PortadaMovil({ aviso }: { aviso: string | null }) {
  const { ficha, hoy, mesSocio, rutaApartado } = useTercero()
  const { plataforma, socio } = papelesDe(ficha)
  const accion = useAccion()
  const aprendido = useAprendido()
  const [ventana, setVentana] = useState<Ventana>(null)
  const papeles = ordenarPapeles(ficha.papeles.map((p) => p.role))
  const lista = listaDe(papeles)
  const c = plataforma ? cifrasPlataforma(ficha.liquidaciones, hoy) : null
  const m = !plataforma && socio && mesSocio ? liquidarMes(calculosDelMes(mesSocio.porLocal)) : null
  const NOMBRE: Record<Papel, string> = { platform: 'Plataforma', brand_partner: 'Socio de marca', customer: 'Cliente', supplier: 'Proveedor' }

  return (
    <>
      <div className="cxm-arriba">
        <Link className="cx-boton-sec cx-atras" to={rutaTerceros(lista.filtro)} aria-label={`Volver a ${lista.etiqueta}`}>‹</Link>
        <span className="cxm-arriba-texto">{lista.etiqueta}</span>
      </div>
      <div className="cxm-identidad">
        <span className="cxp-avatar" aria-hidden="true">{iniciales(ficha.tercero.nombre)}</span>
        <div style={{ minWidth: 0 }}>
          <h1 className="cxm-nombre">{ficha.tercero.nombre}</h1>
          <div className="cxm-sub">{papeles.map((p) => NOMBRE[p]).join(' · ')}{ficha.tercero.nif ? ` · ${ficha.tercero.nif}` : ''}</div>
        </div>
      </div>
      <Guardado texto={aviso} />
      <FranjaArchivado />
      {accion.id && <button type="button" className="cx-boton cxt-accion-movil" onClick={() => setVentana(accion.id)}>{accion.texto}</button>}
      <VentanaAccion ventana={ventana} cerrar={() => setVentana(null)} />
      {c && (
        <div className="cxm-cifras">
          <div className="cx-tarjeta cxp-cifra">
            <span className="cxp-cifra-et">Te debe</span>
            <span className="cxp-cifra-valor">{eurosExactos(c.teDebe.total)}</span>
            <span className={`cxp-cifra-pie${c.teDebe.total ? ' cxp-cifra-pie-ambar' : ''}`}>{c.teDebe.partes[0]?.fecha ? `llega el ${diaMes(c.teDebe.partes[0].fecha)}` : c.hayLiquidaciones ? 'nada pendiente' : 'aún sin liquidaciones'}</span>
          </div>
          <div className="cx-tarjeta cxp-cifra">
            <span className="cxp-cifra-et">Este año</span>
            <span className="cxp-cifra-valor">{euros(c.vendidoEsteAnio)}</span>
            <span className="cxp-cifra-pie">{c.comisionesEsteAnio ? `${conSigno(-c.comisionesEsteAnio)} de comisiones` : 'vendido por la plataforma'}</span>
          </div>
        </div>
      )}
      {m && mesSocio && (
        <div className="cxm-cifras">
          <div className="cx-tarjeta cxp-cifra">
            <span className="cxp-cifra-et">{`Liquidación de ${mesSocio.mes.nombre}`}</span>
            <span className="cxp-cifra-valor">{euros(Math.abs(m.importe))}</span>
            <span className={`cxp-cifra-pie${m.faltan.length ? ' cxp-cifra-pie-ambar' : ''}`}>{m.faltan.length ? 'falta una fuente' : m.sentido}</span>
          </div>
          <div className="cx-tarjeta cxp-cifra">
            <span className="cxp-cifra-et">Compras del mes</span>
            <span className="cxp-cifra-valor">{euros(m.compras)}</span>
            <span className="cxp-cifra-pie">{mesSocio.porLocal.filter((l) => l.compras).length} locales</span>
          </div>
        </div>
      )}
      {m && <div className="cx-tarjeta">{textoImporte(m)}: {m.lineas.map((l) => `${l.texto.replace(/^[−+] /, '')} ${eurosExactos(Math.abs(l.importe))}`).join(' · ')}</div>}
      {!c && !m && (
        <div className="cx-tarjeta"><Vacio titulo="Las facturas llegan con Facturación." explicacion="Mientras, su ficha guarda sus datos fiscales, su cobro y su cuenta." /></div>
      )}
      {aprendido[0] && (
        <p className="cxt-frase-ia"><span className="cx-chip cx-chip-ia">IA</span> {aprendido[0].texto}: {aprendido[0].porque}.</p>
      )}
      <nav className="cx-lista" aria-label="Apartados de la ficha">
        {apartadosDe(ficha.papeles.map((p) => p.role)).filter((a): a is Exclude<ApartadoTercero, 'ficha'> => a !== 'ficha').map((a) => (
          <Link key={a} className="cx-lista-fila cxm-apartado" to={rutaApartado(a)}>
            <span className="cx-lista-fila-texto">
              <span className="cx-lista-fila-titulo">{NOMBRE_APARTADO_TERCERO[a]}</span>
              <span className="cx-lista-fila-apoyo">{lineaMovil(a, ficha)}</span>
            </span>
            <span className="cx-flecha" aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

function PantallaMovil({ ap, aviso }: { ap: ApartadoTercero; aviso: string | null }) {
  const { ficha, rutaApartado } = useTercero()
  const { plataforma, socio } = papelesDe(ficha)
  let contenido: ReactNode
  if (ap === 'ficha') contenido = null
  else if (ap === 'liquidaciones' && plataforma) contenido = <TarjetaLiquidaciones todas />
  else if (ap === 'liquidaciones' && socio) contenido = <><ComoSeCalcula /><LiquidacionesTercero /></>
  else if (ap === 'contabilidad') contenido = <SusCuentas completa />
  else contenido = <section className="cx-tarjeta">{PANTALLA[ap]()}</section>
  return (
    <>
      <div className="cxm-arriba">
        <Link className="cx-boton-sec cx-atras" to={rutaApartado('ficha')} aria-label={`Volver a la ficha de ${ficha.tercero.nombre}`}>‹</Link>
        <span className="cxm-arriba-texto">{ficha.tercero.nombre}</span>
      </div>
      <h1 className="cxm-nombre">{ap === 'ficha' ? ficha.tercero.nombre : NOMBRE_APARTADO_TERCERO[ap]}</h1>
      <Guardado texto={aviso} />
      {contenido}
    </>
  )
}
