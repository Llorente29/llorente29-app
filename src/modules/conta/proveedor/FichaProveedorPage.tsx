// src/modules/conta/proveedor/FichaProveedorPage.tsx
//
// La ficha de proveedor en el estilo nuevo (C01b). Fiel a las maquetas
// aprobadas docs/conta/maquetas/c01b/N4Proveedor (1440) y M4Proveedor (390).
// Es la MISMA pantalla para Cocina y para Contabilidad: una página y una ruta
// (respuesta 1, decisión 7), que monta Cocina › Proveedores y le pasa sus
// piezas («Artículos que le compras», «Migrar artículos») como extensiones.
// La ficha no importa nada de Cocina: una cuenta sin Cocina funciona igual.
//
//   /…/proveedores/:supplierId              → resumen (N4) o portada (M4)
//   /…/proveedores/:supplierId/:apartado    → pestaña de edición o pantalla del móvil
//
// Estados: esqueleto al cargar, error con «Reintentar», sin facturas,
// «Comprobando con la UE…», dirección «por confirmar» con «Es esta / Corregir».

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import '@/modules/conta/estilo'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import { migasProveedores, rutaFichaProveedor, rutaListaProveedores, rutaSubirFacturaProveedor } from '@/config/navegacion'
import { useFichaProveedor } from '@/modules/conta/hooks/useFichaProveedor'
import { FichaContext, useFicha, type ContextoFicha } from '@/modules/conta/proveedor/contexto'
import { cuentasDelResumen } from '@/modules/conta/services/cuentasProveedorService'
import {
  Dialogo, EsqueletoFicha, IconoCamara, IconoTelefono, Migas, PildoraNif, TextoNif,
} from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Vacio } from '@/modules/conta/ui/piezas'
import { BarraPregunta } from '@/modules/conta/marco/BarraPregunta'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import type { ExtensionesProveedor, SeccionDeFicha } from '@/modules/conta/extensiones'
import {
  APARTADOS_MOVIL, NOMBRE_APARTADO, NOMBRE_APARTADO_MOVIL, PESTANAS, apartadoDe, esApartado, etiquetaPago, lineaApartado, type Apartado,
} from '@/modules/conta/lib/resumenFicha'
import { contactoParaLlamar, correoPedirDatos } from '@/modules/conta/lib/textosFicha'
import { diaMes, euros, eurosExactos, iniciales } from '@/modules/conta/lib/formato'
import { PAYMENT_METHOD_LABEL } from '@/modules/conta/types'
import { BloqueAprendido, FraseAprendido } from '@/modules/conta/proveedor/Aprendido'
import { ConQuienHablas } from '@/modules/conta/proveedor/Contactos'
import { AvisoIban, ListaFacturas, TarjetaFacturas } from '@/modules/conta/proveedor/Facturas'
import { Notas } from '@/modules/conta/proveedor/Notas'
import DatosFiscales from '@/modules/conta/proveedor/DatosFiscales'
import Contactos from '@/modules/conta/proveedor/Contactos'
import Pago from '@/modules/conta/proveedor/Pago'
import UnirFichas from '@/modules/conta/proveedor/UnirFichas'
import { deshacerUnion } from '@/modules/conta/services/comprasService'
import Contabilidad from '@/modules/conta/proveedor/Contabilidad'
import Documentos from '@/modules/conta/proveedor/Documentos'
import Historial from '@/modules/conta/proveedor/Historial'

const EJEMPLO_IA = '¿Cuánto le compré en verano?'

export default function FichaProveedorPage({ extensiones = {} }: { extensiones?: ExtensionesProveedor }) {
  const { supplierId = '' } = useParams()
  // Otro proveedor = ficha nueva desde cero (estado, propuestas, VIES).
  return <Ficha key={supplierId} supplierId={supplierId} extensiones={extensiones} />
}

/** Las secciones que otro módulo aporta y que esta cuenta tiene algo que enseñar. */
function useSecciones(accountId: string | null, extensiones: ExtensionesProveedor): SeccionDeFicha[] {
  const [con, setCon] = useState<SeccionDeFicha[]>([])
  useEffect(() => {
    const todas = extensiones.secciones ?? []
    if (!accountId || todas.length === 0) return
    let vivo = true
    Promise.all(todas.map((s) => s.tieneAlgo(accountId).catch(() => false)))
      .then((si) => { if (vivo) setCon(todas.filter((_, i) => si[i])) })
    return () => { vivo = false }
  }, [accountId, extensiones.secciones])
  return con
}

function Ficha({ supplierId, extensiones }: { supplierId: string; extensiones: ExtensionesProveedor }) {
  const { apartado } = useParams()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { userProfile, authUserId } = useApp()
  const movil = useIsMobile()
  const uso = useFichaProveedor(accountsLoading ? null : activeAccountId, supplierId)
  const secciones = useSecciones(accountsLoading ? null : activeAccountId, extensiones)
  const ap: Apartado = esApartado(apartado) ? apartado : 'resumen'

  const ctx = useMemo<ContextoFicha | null>(() => uso.datos ? {
    ...uso,
    datos: uso.datos,
    actor: { id: authUserId ?? null, name: userProfile?.displayName ?? null },
    movil,
    extensiones,
    rutaApartado: (a: Apartado, campo?: string) =>
      `${a === 'resumen' ? rutaFichaProveedor(supplierId) : rutaFichaProveedor(supplierId, a)}${campo ? `#campo-${campo}` : ''}`,
  } : null, [uso, authUserId, userProfile?.displayName, movil, extensiones, supplierId])

  let cuerpo: ReactNode
  if (apartado !== undefined && !esApartado(apartado)) cuerpo = <Navigate to={rutaFichaProveedor(supplierId)} replace />
  else if (uso.estado === 'cargando' || accountsLoading) cuerpo = <EsqueletoFicha movil={movil} />
  else if (uso.estado === 'error') cuerpo = <ErrorConReintento mensaje={uso.error ?? 'No se pudo abrir la ficha.'} reintentar={uso.reintentar} />
  else if (uso.estado === 'no-existe' || !ctx) {
    cuerpo = (
      <div className="cx-tarjeta">
        <Vacio titulo="Ese proveedor no existe o no es de esta cuenta."
          explicacion="Puede que lo hayan borrado o que estés en otra cuenta."
          accion={<Link className="cx-boton-sec" to={rutaListaProveedores()}>Ver la lista de proveedores</Link>} />
      </div>
    )
  } else {
    cuerpo = (
      <FichaContext.Provider value={ctx}>
        <IrAlCampo />
        {movil
          ? (ap === 'resumen' ? <PortadaMovil secciones={secciones} /> : <PantallaMovil ap={ap} secciones={secciones} />)
          : (ap === 'resumen' ? <Resumen secciones={secciones} /> : <Edicion ap={ap} secciones={secciones} />)}
      </FichaContext.Provider>
    )
  }

  return (
    <div className="cx cx-incrustado">
      {cuerpo}
      {!movil && <BarraPregunta ejemplo={EJEMPLO_IA} />}
    </div>
  )
}

/** Los enlaces de «Falta: …» llevan a `#campo-<campo>`: se baja hasta él y se le da el foco. */
function IrAlCampo() {
  const { hash, pathname } = useLocation()
  useEffect(() => {
    if (!hash.startsWith('#campo-')) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)))
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [hash, pathname])
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// Ordenador (N4)
// ═══════════════════════════════════════════════════════════════════════════

function Cabecera() {
  const { datos, rutaApartado } = useFicha()
  const f = datos.ficha
  const pago = etiquetaPago(f, datos.opciones)
  return (
    <header className="cxp-cabecera">
      <div className="cxp-identidad">
        <span className="cxp-avatar" aria-hidden="true">{iniciales(f.name)}</span>
        <div className="cxp-titulos">
          <Migas migas={migasProveedores().map((m, i, t) => i === t.length - 1 ? { ...m, ruta: rutaListaProveedores() } : m)} />
          <h1 className="cxp-nombre">{f.name}</h1>
          <div className="cxp-pildoras">
            {f.legalName && <span className="cx-chip">{f.legalName}</span>}
            <PildoraNif />
            {pago && <span className="cx-chip">{pago}</span>}
            {f.archivedAt && <span className="cx-chip cx-chip-ambar">Archivado</span>}
          </div>
        </div>
      </div>
      <div className="cxp-acciones">
        <Link className="cx-boton-sec" to={rutaApartado('datos-fiscales')}>Editar</Link>
        <Link className="cx-boton" to={rutaSubirFacturaProveedor(f.id)}>Subir factura</Link>
        <MenuMas />
      </div>
    </header>
  )
}

/** «···»: Archivar o Recuperar (respuesta 1, decisión 1), y unir con otra ficha (compras). */
function MenuMas() {
  const { datos, guardar, recargar } = useFicha()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [archivar, setArchivar] = useState(false)
  const [unir, setUnir] = useState(false)
  const [union, setUnion] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const [fallo, setFallo] = useState<string | null>(null)
  const f = datos.ficha
  const archivado = !!f.archivedAt
  return (
    <>
      <button type="button" className="cx-boton-sec cx-mas" aria-haspopup="menu" aria-expanded={abierto}
        aria-label="Más acciones" onClick={() => setAbierto((v) => !v)}>···</button>
      {abierto && (
        <div className="cxp-menu" role="menu">
          {archivado ? (
            <button type="button" role="menuitem" onClick={async () => {
              setAbierto(false); setFallo(null)
              try {
                const r = await guardar({ isActive: true, archivedAt: null })
                if (r.errores.length) setFallo(r.errores.map((e) => e.mensaje).join(' '))
                else avisar(`${f.name} recuperado: vuelve a salir en la lista de proveedores.`)
              } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo recuperar.') }
            }}>Recuperar proveedor</button>
          ) : (
            <button type="button" role="menuitem" onClick={() => { setAbierto(false); setArchivar(true) }}>Archivar proveedor</button>
          )}
          {!archivado && <button type="button" role="menuitem" onClick={() => { setAbierto(false); setUnir(true) }}>Unir con otra ficha</button>}
          {union && <button type="button" role="menuitem" onClick={async () => {
            setAbierto(false); setFallo(null)
            try { await deshacerUnion(union); setUnion(null); avisar('Unión deshecha: cada ficha vuelve a tener lo suyo.'); await recargar() }
            catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo deshacer.') }
          }}>Deshacer la unión</button>}
        </div>
      )}
      {unir && (
        <UnirFichas accountId={f.accountId} queda={f.id} nombre={f.name} nif={f.taxId} alCerrar={() => setUnir(false)}
          alUnir={(r) => { setUnir(false); setUnion(r.fusion); avisar(`${r.resumen} Si te has equivocado, «···» › Deshacer la unión.`); void recargar() }} />
      )}
      <div style={{ position: 'absolute', right: 0, top: 52, width: 360, zIndex: 20 }}>
        <Guardado texto={aviso} />
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      </div>
      {archivar && (
        <Dialogo titulo={`¿Archivar ${f.name}?`} alCerrar={() => setArchivar(false)}>
          <p style={{ margin: 0, fontSize: 15 }}>Dejará de salir en la lista de proveedores (sale en «Archivados» y se puede recuperar). No se borra nada: sus facturas, contactos y documentos se quedan.</p>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setArchivar(false)}>Cancelar</button>
            <button type="button" className="cx-boton" onClick={async () => {
              try {
                await guardar({ isActive: false, archivedAt: new Date().toISOString() })
                navigate(rutaListaProveedores(), { state: { aviso: `${f.name} archivado. Ya no sale en la lista; está en «Archivados» y sus facturas siguen ahí.` } })
              } catch (e) { setArchivar(false); setFallo(e instanceof Error ? e.message : 'No se pudo archivar.') }
            }}>Archivar</button>
          </div>
        </Dialogo>
      )}
    </>
  )
}

/** «Ficha al N %», lo que falta (cada cosa, un enlace a su campo) y «Pedírselo por correo». */
function BarraCompleta() {
  const { datos, completitud, rutaApartado } = useFicha()
  const pct = completitud?.pct ?? 0
  const faltan = completitud?.faltan ?? []
  const correo = correoPedirDatos(datos.ficha, datos.contactos, faltan, datos.opciones.empresa?.nombre ?? null)
  const pendientes = datos.propuestas.length
  return (
    <section className="cx-tarjeta cxp-pct" aria-label={`Ficha al ${pct} %`}>
      <div className="cxp-pct-barra">
        <strong>Ficha al {pct} %</strong>
        {datos.ficha.traidaDe && <Chip tono="ambar">Traída de {datos.ficha.traidaDe} · por completar</Chip>}
        <div className="cxp-pista" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Ficha completa">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="cxp-falta">
        {faltan.length === 0 ? 'No falta nada.' : <>Falta:{' '}{faltan.map((x, i) => (
          <span key={x.clave}>
            {i > 0 && (i === faltan.length - 1 ? ' y ' : ', ')}
            <Link to={rutaApartado(apartadoDe(x.destino.pestana), x.destino.campo)}>{x.texto}</Link>
          </span>
        ))}</>}
        {pendientes > 0 && <> · <Link to={rutaApartado('datos-fiscales')}>{pendientes === 1 ? '1 dato por confirmar' : `${pendientes} datos por confirmar`}</Link></>}
      </span>
      {correo && (
        <a className="cx-boton-sec" href={correo.href}
          title={correo.para ? `Abre un borrador para ${correo.para}; lo envías tú.` : 'Abre un borrador sin destinatario: no hay email de ningún contacto suyo.'}>
          Pedírselo por correo
        </a>
      )}
    </section>
  )
}

function Cifras() {
  const { datos, cifras, repetidas } = useFicha()
  const c = cifras
  const ultima = datos.facturas.find((f) => !repetidas.has(f.id)) ?? null
  const forma = datos.ficha.paymentMethod ? PAYMENT_METHOD_LABEL[datos.ficha.paymentMethod].toLowerCase() : null
  if (!c?.hayFacturas && !ultima) {
    return (
      <section className="cx-tarjeta" aria-label="Cifras">
        <Vacio titulo="Aún no hay facturas suyas."
          explicacion="Con la primera factura aprobada verás lo que le has comprado este año, lo que le debes, el próximo pago y la última factura." />
      </section>
    )
  }
  const pendientes = datos.facturas.filter((f) => f.status === 'aprobada' && !repetidas.has(f.id)).length
  return (
    <div className="cxp-cifras">
      <Cifra et="Le has comprado este año" valor={c?.compradoEsteAnio != null ? euros(c.compradoEsteAnio) : null}
        pie={c?.facturasEsteAnio ? (c.facturasEsteAnio === 1 ? '1 factura' : `${c.facturasEsteAnio} facturas`) : 'Ninguna este año'} />
      <Cifra et="Le debes" valor={c?.leDebes != null ? euros(c.leDebes) : null}
        pie={pendientes ? (pendientes === 1 ? '1 factura por pagar' : `${pendientes} facturas por pagar`) : 'Nada pendiente'} ambar={!!c?.leDebes} />
      <Cifra et="Próximo pago" valor={c?.proximoPago ? diaMes(c.proximoPago.fecha) : null}
        pie={c?.proximoPago ? `${eurosExactos(c.proximoPago.importe)}${forma ? ` por ${forma}` : ''}` : c?.leDebes ? 'Sin vencimiento puesto' : 'Nada que pagar'} />
      <Cifra et="Última factura" valor={ultima?.invoiceDate ? diaMes(ultima.invoiceDate) : null}
        pie={ultima ? (ultima.invoiceNumber ?? ultima.code ?? 'Sin número') : '—'} />
    </div>
  )
}

function Cifra({ et, valor, pie, ambar }: { et: string; valor: string | null; pie: string; ambar?: boolean }) {
  return (
    <div className="cx-tarjeta cxp-cifra">
      <span className="cxp-cifra-et">{et}</span>
      <span className="cxp-cifra-valor">{valor ?? '—'}</span>
      <span className={`cxp-cifra-pie${ambar ? ' cxp-cifra-pie-ambar' : ''}`}>{pie}</span>
    </div>
  )
}

/** Lo que otro módulo pone debajo (Cocina: «Artículos que le compras»). */
function Secciones({ secciones }: { secciones: SeccionDeFicha[] }) {
  const { datos, recargar } = useFicha()
  if (secciones.length === 0) return null
  return (
    <>
      {secciones.map((s) => (
        <div key={s.id}>
          {s.render({ accountId: datos.ficha.accountId, supplierId: datos.ficha.id, supplierName: datos.ficha.name, alCambiar: () => { void recargar() } })}
        </div>
      ))}
    </>
  )
}

function Resumen({ secciones }: { secciones: SeccionDeFicha[] }) {
  return (
    <>
      <Cabecera />
      <AvisoIban />
      <BarraCompleta />
      <Cifras />
      <div className="cxp-columnas">
        <div className="cxp-col-ancha"><TarjetaFacturas /></div>
        <div className="cxp-col-estrecha">
          <BloqueAprendido />
          <ConQuienHablas />
          <Notas />
        </div>
      </div>
      <Secciones secciones={secciones} />
    </>
  )
}

const PANTALLA: Partial<Record<Apartado, () => ReactNode>> = {
  'datos-fiscales': () => <DatosFiscales />,
  contactos: () => <Contactos />,
  pago: () => <Pago />,
  contabilidad: () => <Contabilidad />,
  documentos: () => <Documentos />,
  historial: () => <Historial />,
}

function Edicion({ ap, secciones }: { ap: Apartado; secciones: SeccionDeFicha[] }) {
  const { datos, rutaApartado } = useFicha()
  if (ap === 'facturas') {
    return (
      <>
        <Cabecera />
        <Link className="cxp-volver" to={rutaApartado('resumen')}>‹ Volver a la ficha</Link>
        <section className="cx-tarjeta" aria-label="Todas sus facturas"><ListaFacturas facturas={datos.facturas} /></section>
      </>
    )
  }
  if (ap === 'articulos') {
    return (
      <>
        <Cabecera />
        <Link className="cxp-volver" to={rutaApartado('resumen')}>‹ Volver a la ficha</Link>
        <Secciones secciones={secciones} />
      </>
    )
  }
  const contenido = PANTALLA[ap]
  return (
    <>
      <Cabecera />
      <BarraCompleta />
      <div className="cxp-edicion">
        <nav aria-label="Apartados de la ficha" className="cx-pestanas">
          <Link className="cx-pestana" to={rutaApartado('resumen')}>‹ Ficha</Link>
          {PESTANAS.map((p) => (
            <Link key={p} className="cx-pestana" aria-current={p === ap ? 'page' : undefined} to={rutaApartado(p)}>{NOMBRE_APARTADO[p]}</Link>
          ))}
        </nav>
        <section className="cx-tarjeta" aria-label={NOMBRE_APARTADO[ap]}>
          <div className="cxp-edicion-cuerpo">{contenido ? contenido() : null}</div>
        </section>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Móvil (M4)
// ═══════════════════════════════════════════════════════════════════════════

/** C02 §5b: su cuenta y la de sus facturas para la línea «Contabilidad». Si no se puede leer, la línea sigue como antes. */
function useCuentasDelResumen(accountId: string | null, companyId: string | null, supplierId: string, gastoId: string | null) {
  const [c, setC] = useState<{ suCuenta: string | null; facturas: string | null } | null>(null)
  useEffect(() => {
    if (!accountId || !companyId) return
    let vivo = true
    cuentasDelResumen(accountId, companyId, supplierId, gastoId).then((r) => { if (vivo) setC(r) }).catch(() => { if (vivo) setC(null) })
    return () => { vivo = false }
  }, [accountId, companyId, supplierId, gastoId])
  return c
}

function PortadaMovil({ secciones }: { secciones: SeccionDeFicha[] }) {
  const { datos, completitud, cifras, repetidas, rutaApartado } = useFicha()
  const f = datos.ficha
  const llamar = contactoParaLlamar(datos.contactos)
  const tipo = datos.tiposGasto.find((t) => t.id === f.expenseCategoryId) ?? null
  const ultima = datos.facturas.find((x) => !repetidas.has(x.id)) ?? null
  const pago = etiquetaPago(f, datos.opciones)
  const cuentas = useCuentasDelResumen(datos.conta ? f.accountId : null, datos.opciones.empresa?.id ?? null, f.id, f.expenseCategoryId)
  const base = { ficha: f, contactos: datos.contactos, faltan: completitud?.faltan ?? [], tipoGasto: tipo, ultimaFactura: ultima, numDocumentos: datos.documentos.length, opciones: datos.opciones, cuentas }
  const apartados = APARTADOS_MOVIL.filter((a) => a !== 'articulos' || secciones.length > 0)

  return (
    <>
      <div className="cxm-arriba">
        <Link className="cx-boton-sec cx-atras" to={rutaListaProveedores()} aria-label="Volver a proveedores">‹</Link>
        <span className="cxm-arriba-texto">Proveedores</span>
        <span className="cx-chip cx-chip-ia">Ficha al {completitud?.pct ?? 0} %</span>
      </div>
      <div className="cxm-identidad">
        <span className="cxp-avatar" aria-hidden="true">{iniciales(f.name)}</span>
        <div style={{ minWidth: 0 }}>
          <h1 className="cxm-nombre">{f.name}</h1>
          <div className="cxm-sub"><TextoNif />{pago ? ` · ${pago}` : ''}</div>
        </div>
      </div>
      <div className="cxm-botones">
        {llamar?.phone
          ? <a className="cx-boton-sec" href={`tel:${llamar.phone.replace(/[^\d+]/g, '')}`} aria-label={`Llamar a ${llamar.name}`}><IconoTelefono />Llamar a pedidos</a>
          : <Link className="cx-boton-sec" to={`${rutaApartado('contactos')}?nuevo=orders`}><IconoTelefono />Añadir a pedidos</Link>}
        <Link className="cx-boton" to={rutaSubirFacturaProveedor(f.id, true)}><IconoCamara />Foto de factura</Link>
      </div>
      <AvisoIban />
      {datos.propuestas.length > 0 && (
        <Link className="cx-aviso" to={rutaApartado('datos-fiscales')} style={{ textDecoration: 'none' }}>
          {datos.propuestas.length === 1 ? 'Hay 1 dato por confirmar' : `Hay ${datos.propuestas.length} datos por confirmar`}
        </Link>
      )}
      <div className="cxm-cifras">
        <div className="cx-tarjeta cxp-cifra">
          <span className="cxp-cifra-et">Le debes</span>
          {cifras?.leDebes != null
            ? <><span className="cxp-cifra-valor">{eurosExactos(cifras.leDebes)}</span>
                <span className={`cxp-cifra-pie${cifras.proximoPago ? ' cxp-cifra-pie-ambar' : ''}`}>{cifras.proximoPago ? `vence el ${diaMes(cifras.proximoPago.fecha)}` : cifras.leDebes ? 'sin vencimiento puesto' : 'nada pendiente'}</span></>
            : <span className="cxp-cifra-pie">Aún no hay facturas suyas</span>}
        </div>
        <div className="cx-tarjeta cxp-cifra">
          <span className="cxp-cifra-et">Este año</span>
          {cifras?.compradoEsteAnio != null
            ? <><span className="cxp-cifra-valor">{eurosExactos(cifras.compradoEsteAnio)}</span>
                <span className="cxp-cifra-pie">{cifras.facturasEsteAnio === 1 ? '1 factura' : `${cifras.facturasEsteAnio} facturas`}</span></>
            : <span className="cxp-cifra-pie">Aún no hay facturas suyas</span>}
        </div>
      </div>
      <FraseAprendido />
      <nav className="cx-lista" aria-label="Apartados de la ficha">
        {apartados.map((a) => {
          const l = a === 'articulos' ? { detalle: 'Lo que le compras y a qué precio', falta: false } : lineaApartado(a, base)
          return (
            <Link key={a} className="cx-lista-fila cxm-apartado" to={rutaApartado(a)}>
              <span className="cx-lista-fila-texto">
                <span className="cx-lista-fila-titulo">{NOMBRE_APARTADO_MOVIL[a] ?? NOMBRE_APARTADO[a]}</span>
                <span className={`cx-lista-fila-apoyo${l.falta ? ' cxm-apartado-falta' : ''}`}>{l.detalle}</span>
              </span>
              <span className="cx-flecha" aria-hidden="true">›</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

function PantallaMovil({ ap, secciones }: { ap: Apartado; secciones: SeccionDeFicha[] }) {
  const { datos, rutaApartado } = useFicha()
  let contenido: ReactNode
  if (ap === 'facturas') contenido = <section className="cx-tarjeta"><ListaFacturas facturas={datos.facturas} /></section>
  else if (ap === 'articulos') contenido = <Secciones secciones={secciones} />
  else if (ap === 'contactos') contenido = <><Contactos /><Notas /></>
  else {
    const p = PANTALLA[ap]
    contenido = <section className="cx-tarjeta">{p ? p() : null}</section>
  }
  return (
    <>
      <div className="cxm-arriba">
        <Link className="cx-boton-sec cx-atras" to={rutaApartado('resumen')} aria-label={`Volver a la ficha de ${datos.ficha.name}`}>‹</Link>
        <span className="cxm-arriba-texto">{datos.ficha.name}</span>
      </div>
      <h1 className="cxm-nombre">{NOMBRE_APARTADO_MOVIL[ap] ?? NOMBRE_APARTADO[ap]}</h1>
      {contenido}
    </>
  )
}
