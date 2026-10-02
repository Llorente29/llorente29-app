// src/modules/conta/pages/FichaProveedorPage.tsx
//
// La ficha de proveedor (C01). Pantalla AUTÓNOMA: no depende de Cocina ni de
// ningún otro módulo (respuesta 1 de Julio). Quien la monta le pasa sus
// extensiones; la dirección y las migas salen de src/config/navegacion.ts.
//
//   /…/proveedores/:supplierId              → Resumen (ordenador) o portada (móvil)
//   /…/proveedores/:supplierId/:apartado    → pestaña (ordenador) o pantalla (móvil)
//
// Fiel a las maquetas aprobadas: docs/conta/maquetas/Proveedor.dc.html (1440)
// y ProveedorMovil.dc.html (390). Estados: cargando (esqueleto), error con
// «Reintentar», sin facturas, «Guardado», «Comprobando con la UE…».

import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import '@/modules/conta/conta.css'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useIsMobile } from '@/shell/useIsMobile'
import { migasFichaProveedor, rutaFichaProveedor, rutaListaProveedores, rutaSubirFacturaProveedor } from '@/config/navegacion'
import { useFichaProveedor } from '@/modules/conta/hooks/useFichaProveedor'
import { FichaContext, useFicha, type ContextoFicha } from '@/modules/conta/components/FichaContexto'
import { Comprobado, ErrorConReintento, EsqueletoFicha, Migas } from '@/modules/conta/components/ui'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import {
  APARTADOS_MOVIL, NOMBRE_APARTADO, PESTANAS, apartadoDe, esApartado, etiquetaPago, lineaApartado, type Apartado,
} from '@/modules/conta/lib/resumenFicha'
import { contactoParaLlamar } from '@/modules/conta/lib/textosFicha'
import { diaMes, euros, iniciales } from '@/modules/conta/lib/formato'
import Resumen from '@/modules/conta/apartados/Resumen'
import DatosFiscales from '@/modules/conta/apartados/DatosFiscales'
import Contactos from '@/modules/conta/apartados/Contactos'
import Pago from '@/modules/conta/apartados/Pago'
import Contabilidad from '@/modules/conta/apartados/Contabilidad'
import Documentos from '@/modules/conta/apartados/Documentos'
import Historial from '@/modules/conta/apartados/Historial'
import Facturas from '@/modules/conta/apartados/Facturas'

const PANTALLA: Record<Apartado, () => ReactNode> = {
  resumen: () => <Resumen />,
  'datos-fiscales': () => <DatosFiscales />,
  contactos: () => <Contactos />,
  pago: () => <Pago />,
  contabilidad: () => <Contabilidad />,
  documentos: () => <Documentos />,
  historial: () => <Historial />,
  facturas: () => <Facturas />,
}

export default function FichaProveedorPage({ extensiones = {} }: { extensiones?: ExtensionesProveedor }) {
  const { supplierId = '' } = useParams()
  // Otro proveedor = ficha nueva desde cero (estado, propuestas, VIES).
  return <Ficha key={supplierId} supplierId={supplierId} extensiones={extensiones} />
}

function Ficha({ supplierId, extensiones }: { supplierId: string; extensiones: ExtensionesProveedor }) {
  const { apartado } = useParams()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { userProfile, authUserId } = useApp()
  const movil = useIsMobile()
  const uso = useFichaProveedor(accountsLoading ? null : activeAccountId, supplierId)
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

  const clase = 'cf cf-lienzo'

  if (uso.estado === 'cargando' || accountsLoading) return <div className={clase}><EsqueletoFicha movil={movil} /></div>
  if (uso.estado === 'error') {
    return <div className={clase} style={movil ? { padding: 16 } : undefined}><ErrorConReintento mensaje={uso.error ?? 'No se pudo abrir la ficha.'} alReintentar={uso.reintentar} /></div>
  }
  if (uso.estado === 'no-existe' || !ctx) {
    return (
      <div className={clase} style={movil ? { padding: 16 } : undefined}>
        <div className="cf-error" role="alert">
          <span>Ese proveedor no existe o no es de esta cuenta.</span>
          <Link className="cf-boton-sec cf-boton-peq" to={rutaListaProveedores()}>Ver la lista de proveedores</Link>
        </div>
      </div>
    )
  }

  return (
    <FichaContext.Provider value={ctx}>
      <div className={clase}>
        <IrAlCampo />
        {movil ? (ap === 'resumen' ? <PortadaMovil /> : <PantallaMovil ap={ap} />) : <Escritorio ap={ap} />}
      </div>
    </FichaContext.Provider>
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
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [hash, pathname])
  return null
}

/** «NIF comprobado» en verde, «Comprobando con la UE…», o nada si no hay NIF. */
function EstadoNif({ claro = false }: { claro?: boolean }) {
  const { datos: { ficha: f }, comprobandoVies } = useFicha()
  if (!f.taxId) return null
  if (f.taxIdType === 'vat_eu' && (comprobandoVies || f.taxIdCheckStatus === 'pending')) {
    return <span className={claro ? undefined : 'cf-pendiente'}>Comprobando con la UE…</span>
  }
  if (f.taxIdCheckStatus === 'valid' && f.taxIdVerifiedAt) return claro ? <span>NIF comprobado</span> : <Comprobado>NIF comprobado</Comprobado>
  if (f.taxIdCheckStatus === 'invalid') return <span className={claro ? undefined : 'cf-pendiente'}>NIF no válido</span>
  if (f.taxIdType === 'foreign') return null
  return <span className={claro ? undefined : 'cf-pendiente'}>NIF sin comprobar</span>
}

// ═══════════════════════════════════════════════════════════════════════════
// Ordenador
// ═══════════════════════════════════════════════════════════════════════════

function Escritorio({ ap }: { ap: Apartado }) {
  const { datos, completitud, rutaApartado } = useFicha()
  const f = datos.ficha
  const tipo = datos.tiposGasto.find((t) => t.id === f.expenseCategoryId)
  const pago = etiquetaPago(f)
  const pct = completitud?.pct ?? 0
  const faltan = completitud?.faltan ?? []
  const pendientes = datos.propuestas.length

  return (
    <>
      <Migas migas={migasFichaProveedor(f.name)} />

      <div className="cf-cabecera">
        <div className="cf-identidad">
          <div className="cf-iniciales" aria-hidden="true">{iniciales(f.name)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <h1 className="cf-titulo">{f.name}</h1>
            <div className="cf-subtitulo">
              {f.legalName && <span>{f.legalName}</span>}
              {f.legalName && f.taxId && <span aria-hidden="true">·</span>}
              {f.taxId && <span>{f.taxId}</span>}
              <EstadoNif />
            </div>
            <div className="cf-etiquetas">
              {tipo && <span className="cf-etiqueta">{tipo.name}</span>}
              {pago && <span className="cf-etiqueta">{pago}</span>}
              {f.tags.map((t) => <span key={t} className="cf-etiqueta">{t}</span>)}
              {f.isActive && !f.archivedAt
                ? <span className="cf-etiqueta-activo">Activo</span>
                : <span className="cf-etiqueta-inactivo">Archivado</span>}
            </div>
          </div>
        </div>
        <div className="cf-acciones">
          <Link className="cf-boton-sec" to={rutaApartado('datos-fiscales')}>Editar ficha</Link>
          <Link className="cf-boton" to={rutaSubirFacturaProveedor(f.id)}>Subir factura</Link>
        </div>
      </div>

      <div className="cf-barra" aria-label={`Ficha al ${pct} %`}>
        <div className="cf-barra-pct">
          <strong>Ficha al {pct} %</strong>
          <div className="cf-pista" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Ficha completa">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="cf-falta">
          {faltan.length === 0 ? 'No falta nada.' : (
            <>Falta:{' '}{faltan.map((x, i) => (
              <span key={x.clave}>
                {i > 0 && ' · '}
                <Link to={rutaApartado(apartadoDe(x.destino.pestana), x.destino.campo)}>{x.texto}</Link>
              </span>
            ))}</>
          )}
        </div>
        {pendientes > 0 && (
          <Link className="cf-nota" to={rutaApartado('datos-fiscales')}>
            {pendientes === 1 ? 'Hay 1 dato leído por confirmar' : `Hay ${pendientes} datos leídos por confirmar`}
          </Link>
        )}
      </div>

      <div role="tablist" aria-label="Apartados de la ficha" className="cf-pestanas">
        {PESTANAS.map((p) => (
          <Link key={p} role="tab" aria-selected={p === ap} className="cf-pestana" to={rutaApartado(p)}>{NOMBRE_APARTADO[p]}</Link>
        ))}
      </div>

      <div role="tabpanel" aria-label={NOMBRE_APARTADO[ap]} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PANTALLA[ap]()}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Móvil (390 px)
// ═══════════════════════════════════════════════════════════════════════════

function IconoAtras() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}

function PortadaMovil() {
  const { datos, completitud, cifras, rutaApartado } = useFicha()
  const f = datos.ficha
  const llamar = contactoParaLlamar(datos.contactos)
  const tipo = datos.tiposGasto.find((t) => t.id === f.expenseCategoryId) ?? null
  const ultima = datos.facturas[0] ?? null
  const base = { ficha: f, contactos: datos.contactos, faltan: completitud?.faltan ?? [], tipoGasto: tipo, ultimaFactura: ultima, numDocumentos: datos.documentos.length }

  return (
    <>
      <div className="cfm-cabecera">
        <div className="cfm-arriba">
          <Link className="cfm-volver" to={rutaListaProveedores()} aria-label="Volver a proveedores"><IconoAtras /></Link>
          <span className="cfm-pct">Ficha al {completitud?.pct ?? 0} %</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 className="cfm-titulo">{f.name}</h1>
          {f.taxId && <span className="cfm-sub">{f.taxId} · <EstadoNif claro /></span>}
        </div>
        <div className="cfm-botones">
          {llamar?.phone
            ? <a className="cfm-llamar" href={`tel:${llamar.phone.replace(/[^\d+]/g, '')}`} aria-label={`Llamar a ${llamar.name}`}><IconoTelefono />Llamar</a>
            : <Link className="cfm-llamar" to={`${rutaApartado('contactos')}?nuevo=orders`} aria-disabled="true"><IconoTelefono />Llamar</Link>}
          <Link className="cfm-foto" to={rutaSubirFacturaProveedor(f.id, true)}><IconoCamara />Foto factura</Link>
        </div>
      </div>

      <div className="cfm-cuerpo">
        {datos.propuestas.length > 0 && (
          <Link className="cf-aviso" to={rutaApartado('datos-fiscales')}>
            {datos.propuestas.length === 1 ? 'Hay 1 dato leído por confirmar' : `Hay ${datos.propuestas.length} datos leídos por confirmar`}
          </Link>
        )}
        <div className="cfm-cifras">
          <div className="cfm-cifra">
            <span className="cfm-cifra-et cf-debe">Le debes</span>
            {cifras?.leDebes !== null && cifras?.leDebes !== undefined
              ? <><span className="cfm-cifra-valor">{euros(cifras.leDebes)}</span>
                  <span className="cfm-cifra-pie">{cifras.proximoPago ? `vence el ${diaMes(cifras.proximoPago.fecha)}` : cifras.leDebes ? 'sin vencimiento puesto' : 'nada pendiente'}</span></>
              : <span className="cfm-cifra-pie">Aún no hay facturas suyas</span>}
          </div>
          <div className="cfm-cifra">
            <span className="cfm-cifra-et">Este año</span>
            {cifras?.compradoEsteAnio !== null && cifras?.compradoEsteAnio !== undefined
              ? <><span className="cfm-cifra-valor">{euros(cifras.compradoEsteAnio)}</span>
                  <span className="cfm-cifra-pie">{cifras.facturasEsteAnio === 1 ? '1 factura' : `${cifras.facturasEsteAnio} facturas`}</span></>
              : <span className="cfm-cifra-pie">Aún no hay facturas suyas</span>}
          </div>
        </div>
        <nav className="cfm-lista" aria-label="Apartados de la ficha">
          {APARTADOS_MOVIL.map((a) => {
            const l = lineaApartado(a, base)
            return (
              <Link key={a} className="cfm-apartado" to={rutaApartado(a)}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="cfm-apartado-nombre">{NOMBRE_APARTADO[a]}</span>
                  <span className={`cfm-apartado-detalle${l.falta ? ' cf-falta-m' : ''}`}>{l.detalle}</span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A94A0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}

function PantallaMovil({ ap }: { ap: Apartado }) {
  const { datos, rutaApartado } = useFicha()
  return (
    <>
      <div className="cfm-cabecera" style={{ paddingBottom: 18 }}>
        <div className="cfm-arriba">
          <Link className="cfm-volver" to={rutaApartado('resumen')} aria-label={`Volver a la ficha de ${datos.ficha.name}`}><IconoAtras /></Link>
          <span className="cfm-pct">{datos.ficha.name}</span>
        </div>
        <h1 className="cfm-titulo" style={{ fontSize: 24 }}>{NOMBRE_APARTADO[ap]}</h1>
      </div>
      <div className="cfm-pantalla">{PANTALLA[ap]()}</div>
    </>
  )
}

function IconoTelefono() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
}

function IconoCamara() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
}
