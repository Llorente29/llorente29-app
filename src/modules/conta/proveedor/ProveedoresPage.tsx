// src/modules/conta/proveedor/ProveedoresPage.tsx
//
// La lista de proveedores en el estilo nuevo (C01b, respuesta 1, decisión 1):
// buscar; nombre; tipo de gasto; «Le debes»; última factura; píldora ámbar
// «Ficha incompleta» con lo que falta; y el filtro «Archivados». Autónoma como
// la ficha: lo que aporte otro módulo (Cocina: cuántos artículos le compras)
// llega por `extensiones`.
//
// El % y lo que falta salen de la MISMA función que la barra de la ficha
// (calcularCompletitud), y «Le debes» de la misma que sus cifras, sin las
// facturas repetidas: la lista y la ficha no pueden contar distinto.
// Un umbral ordena, no esconde (regla 7): todos los proveedores salen; los
// archivados, en su filtro.
// Cada fila lleva su «···» (respuesta 2, punto 3): Abrir, Subir factura y
// Archivar/Recuperar sin entrar en la ficha. Archivar pregunta antes, como en
// la ficha; las dos confirman con contenido (regla 8).

import { useEffect, useMemo, useState } from 'react'
import { useMenuFila } from '@/modules/conta/proveedor/useMenuFila'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '@/modules/conta/estilo'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { migasProveedores, rutaFichaProveedor, rutaSubirFacturaProveedor } from '@/config/navegacion'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { NuevoProveedorDialogo } from '@/modules/conta/proveedor/NuevoProveedorDialogo'
import { ErrorConReintento, Guardado, Hueso, Inicial, Vacio } from '@/modules/conta/ui/piezas'
import {
  guardarFicha, listarContactosDeLaCuenta, listarFacturasDeLaCuenta, listarProveedores, listarTiposGasto, proveedoresConCertificadoBanco,
} from '@/modules/conta/services/proveedorService'
import { calcularCompletitud, type Falta } from '@/modules/conta/lib/completitud'
import { calcularCifras } from '@/modules/conta/lib/cifras'
import { detectarRepetidas } from '@/modules/conta/lib/repetidas'
import { certificadoVale } from '@/modules/conta/lib/ibanFactura'
import { diaMesCorto, euros, hoyEnMadrid, iniciales } from '@/modules/conta/lib/formato'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import type { FichaProveedor } from '@/modules/conta/types'

interface Fila {
  ficha: FichaProveedor
  pct: number
  faltan: Falta[]
  debe: number | null
  ultima: { fecha: string | null; numero: string | null } | null
  tipo: string | null
}

function normaliza(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** «1 artículo», «2 artículos». */
function cuantos(n: number, plural: string): string {
  return n === 1 ? `1 ${plural.replace(/s$/, '')}` : `${n} ${plural}`
}

/** «falta NIF comprobado y IBAN comprobado», «falta razón social, dirección fiscal y 3 más». */
function textoFalta(faltan: Falta[]): string {
  const t = faltan.map((f) => f.texto)
  if (t.length <= 2) return `falta ${t.join(' y ')}`
  return `falta ${t.slice(0, 2).join(', ')} y ${t.length - 2} más`
}

export default function ProveedoresPage({ extensiones = {} }: { extensiones?: ExtensionesProveedor }) {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const location = useLocation()
  const navigate = useNavigate()
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [extra, setExtra] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [busca, setBusca] = useState('')
  const [archivados, setArchivados] = useState(false)
  const [nuevo, setNuevo] = useState(false)
  const [archivar, setArchivar] = useState<FichaProveedor | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const avisoLlegada = (location.state as { aviso?: string } | null)?.aviso ?? null

  /** Archivar o recuperar desde la fila: sale de esta vista (está en la otra) y lo dice. */
  async function cambiarArchivo(f: FichaProveedor, archivar: boolean) {
    setFallo(null); setHecho(null)
    try {
      await guardarFicha(f.id, archivar ? { isActive: false, archivedAt: new Date().toISOString() } : { isActive: true, archivedAt: null })
      setFilas((xs) => xs?.filter((x) => x.ficha.id !== f.id) ?? xs)
      setHecho(archivar
        ? `${f.name} archivado. Ya no sale en la lista; está en «Archivados» y sus facturas siguen ahí.`
        : `${f.name} recuperado: vuelve a salir en la lista de proveedores.`)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : archivar ? 'No se pudo archivar.' : 'No se pudo recuperar.')
    }
  }

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let vivo = true
    Promise.all([
      listarProveedores(activeAccountId, { archivados }),
      listarContactosDeLaCuenta(activeAccountId),
      proveedoresConCertificadoBanco(activeAccountId),
      listarFacturasDeLaCuenta(activeAccountId),
      listarTiposGasto(activeAccountId, null),
    ]).then(([provs, contactos, certs, facturas, tipos]) => {
      if (!vivo) return
      const hoy = hoyEnMadrid()
      const nombreTipo = new Map(tipos.map((t) => [t.id, t.name]))
      setFilas(provs.map((ficha) => {
        const suyos = contactos.filter((c) => c.supplierId === ficha.id)
        const { pct, faltan } = calcularCompletitud({ ficha, contactos: suyos, tieneCertificadoBanco: certs.has(ficha.id) && certificadoVale(certs.get(ficha.id)!, ficha.ibanChangedAt) })
        const deEl = facturas.filter((x) => x.supplierId === ficha.id)
        const rep = detectarRepetidas(deEl.map((x) => ({ id: x.id, number: x.invoiceNumber, total: x.grandTotal, status: x.status, createdAt: x.createdAt, fecha: x.invoiceDate, noRepetidaConfirmada: x.noRepetidaConfirmada })))
        const buenas = deEl.filter((x) => !rep.has(x.id))
        const debe = calcularCifras(buenas, hoy).leDebes
        const u = buenas.filter((x) => x.invoiceDate).sort((a, b) => (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? ''))[0] ?? null
        return {
          ficha, pct, faltan, debe,
          ultima: u ? { fecha: u.invoiceDate, numero: u.invoiceNumber } : null,
          tipo: ficha.expenseCategoryId ? nombreTipo.get(ficha.expenseCategoryId) ?? null : null,
        }
      }))
    }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.') })
    const col = extensiones.columna
    if (col) col.valores(activeAccountId).then((v) => { if (vivo) setExtra(v) }).catch(() => { if (vivo) setExtra({}) })
    return () => { vivo = false }
  }, [activeAccountId, accountsLoading, vuelta, archivados, extensiones.columna])

  const visibles = useMemo(() => {
    if (!filas) return []
    const q = normaliza(busca.trim())
    if (!q) return filas
    return filas.filter(({ ficha: f, tipo }) =>
      [f.name, f.legalName, f.taxId, tipo, ...f.tags].some((x) => x && normaliza(x).includes(q)))
  }, [filas, busca])

  const columna = extensiones.columna && Object.keys(extra).length > 0 ? extensiones.columna : null
  const cambiarFiltro = (a: boolean) => { if (a !== archivados) { setFilas(null); setArchivados(a) } }

  return (
    <div className="cx cx-incrustado">
      <header className="cxp-cabecera">
        <div className="cxp-titulos">
          <Migas migas={migasProveedores()} />
          <h1 className="cxp-nombre">Proveedores</h1>
          <span className="cx-ayuda" style={{ fontSize: 15 }}>Quién te vende, cómo le pagas y cuánto le debes.</span>
        </div>
        <button type="button" className="cx-boton" onClick={() => setNuevo(true)} disabled={!activeAccountId}>Nuevo proveedor</button>
      </header>
      {avisoLlegada && !hecho && <Guardado texto={avisoLlegada} />}
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}

      <div className="cxp-lista-barra">
        <label htmlFor="buscar-prov" className="cx-oculto">Buscar proveedor</label>
        <input id="buscar-prov" className="cx-input cxp-buscar" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nombre, NIF o tipo de gasto" />
        <div className="cx-tablas-filtros" role="group" aria-label="Qué proveedores ver">
          <button type="button" className="cx-pildora" aria-pressed={!archivados} onClick={() => cambiarFiltro(false)}>En uso</button>
          <button type="button" className="cx-pildora" aria-pressed={archivados} onClick={() => cambiarFiltro(true)}>Archivados</button>
        </div>
      </div>

      {error && <ErrorConReintento mensaje={error} reintentar={() => { setError(null); setFilas(null); setVuelta((v) => v + 1) }} />}
      {!error && !filas && (
        <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando proveedores" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => <Hueso key={i} alto={44} />)}
        </div>
      )}
      {filas && filas.length === 0 && (
        <div className="cx-tarjeta">
          {archivados
            ? <Vacio titulo="No hay proveedores archivados." explicacion="Los que archives desde su ficha salen aquí, y se pueden recuperar." />
            : <Vacio titulo="Aún no hay proveedores." explicacion="Pulsa «Nuevo proveedor» para empezar, o se crean al recibir un albarán de uno nuevo."
                accion={<button type="button" className="cx-boton" onClick={() => setNuevo(true)}>Nuevo proveedor</button>} />}
        </div>
      )}
      {filas && filas.length > 0 && visibles.length === 0 && (
        <div className="cx-tarjeta"><Vacio titulo={`Ningún proveedor coincide con «${busca.trim()}».`} explicacion="Prueba con otra parte del nombre o con su NIF." /></div>
      )}
      {visibles.length > 0 && (
        <section className="cx-tarjeta" style={{ padding: '10px 10px' }} aria-label={archivados ? 'Proveedores archivados' : 'Proveedores'}>
          <div className="cxp-tabla">
            <div className="cxp-tabla-cabeza" aria-hidden="true">
              <span>Proveedor</span><span>Tipo de gasto</span><span style={{ textAlign: 'right' }}>Le debes</span>
              <span style={{ textAlign: 'right' }}>Última factura</span><span>Ficha</span>
            </div>
            {visibles.map(({ ficha: f, pct, faltan, debe, ultima, tipo }) => (
              <div key={f.id} className="cxp-tabla-envoltura">
              <Link to={rutaFichaProveedor(f.id)} className="cxp-tabla-fila">
                <span className="cxp-tabla-nombre">
                  <Inicial texto={iniciales(f.name)} />
                  <span>
                    <span className="cxp-tabla-titulo">{f.name}</span>
                    <span className="cxp-tabla-apoyo">
                      {[f.legalName, f.taxId ?? 'Sin NIF', columna ? cuantos(extra[f.id] ?? 0, columna.titulo.toLowerCase()) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </span>
                <span className="cxp-tabla-apoyo">{tipo ?? 'Sin tipo de gasto'}</span>
                {debe === null
                  ? <span className="cxp-tabla-apoyo" style={{ textAlign: 'right' }}>Sin facturas</span>
                  : <span className={debe ? 'cxp-tabla-cifra' : 'cxp-tabla-cifra-apoyo'}>{euros(debe)}</span>}
                <span className="cxp-tabla-ultima">
                  {ultima ? <><span className="cxp-tabla-cifra-apoyo">{ultima.fecha ? diaMesCorto(ultima.fecha) : '—'}</span>
                    {ultima.numero && <span className="cxp-tabla-apoyo">{ultima.numero}</span>}</> : <span className="cxp-tabla-apoyo">—</span>}
                </span>
                <span className="cxp-tabla-estado">
                  {f.archivedAt ? <span className="cx-chip">Archivado</span>
                    : faltan.length === 0 ? <span className="cx-chip cx-chip-ia">Completa</span>
                    : <>
                        <span className="cx-chip cx-chip-ambar">Ficha incompleta · {pct} %</span>
                        <span className="cxp-incompleta">{textoFalta(faltan)}</span>
                      </>}
                </span>
              </Link>
              <MenuFila ficha={f} alArchivar={() => setArchivar(f)} alRecuperar={() => void cambiarArchivo(f, false)} />
              </div>
            ))}
          </div>
        </section>
      )}
      {filas && filas.length > 0 && (
        <p className="cx-ayuda" style={{ margin: 0 }}>
          {filas.length === 1 ? '1 proveedor' : `${filas.length} proveedores`}{archivados ? ' archivados' : ''}
          {busca.trim() ? ` · ${visibles.length} con «${busca.trim()}»` : ''}
        </p>
      )}
      {archivar && (
        <Dialogo titulo={`¿Archivar ${archivar.name}?`} alCerrar={() => setArchivar(null)}>
          <p style={{ margin: 0, fontSize: 15 }}>Dejará de salir en la lista de proveedores (sale en «Archivados» y se puede recuperar). No se borra nada: sus facturas, contactos y documentos se quedan.</p>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setArchivar(null)}>Cancelar</button>
            <button type="button" className="cx-boton" onClick={() => { const f = archivar; setArchivar(null); void cambiarArchivo(f, true) }}>Archivar</button>
          </div>
        </Dialogo>
      )}
      {nuevo && activeAccountId && (
        <NuevoProveedorDialogo accountId={activeAccountId} otros={filas?.map((x) => x.ficha) ?? []} alCerrar={() => setNuevo(false)}
          alCrear={(p) => navigate(rutaFichaProveedor(p.id, 'datos-fiscales'))} />
      )}
      {/* C06b: sin la barra «Pregunta o pide algo» (solo diría «Muy pronto»); vuelve cuando conteste. */}
    </div>
  )
}

/** «···» de una fila: Abrir, Subir factura, Archivar o Recuperar. */
function MenuFila({ ficha: f, alArchivar, alRecuperar }: { ficha: FichaProveedor; alArchivar: () => void; alRecuperar: () => void }) {
  // S01e: debajo de su fila sin taparla (o encima si no cabe), y se cierra al salir.
  const { abierto, arriba, caja, alternar, cerrar, alSalir, alEntrar } = useMenuFila()
  const setAbierto = (v: boolean) => { if (!v) cerrar() }
  return (
    <div className="cxp-tabla-mas" ref={caja} onMouseLeave={alSalir} onMouseEnter={alEntrar}>
      <button type="button" className="cx-boton-sec cx-mas" aria-haspopup="menu" aria-expanded={abierto}
        aria-label={`Más acciones de ${f.name}`} onClick={alternar}>···</button>
      {abierto && (
        <div className={arriba ? 'cxp-menu cxp-menu-arriba' : 'cxp-menu'} role="menu" aria-label={`Acciones de ${f.name}`}>
          <Link role="menuitem" to={rutaFichaProveedor(f.id)}>Abrir</Link>
          {!f.archivedAt && <Link role="menuitem" to={rutaSubirFacturaProveedor(f.id)}>Subir una factura</Link>}
          {f.archivedAt
            ? <button type="button" role="menuitem" onClick={() => { setAbierto(false); alRecuperar() }}>Recuperar proveedor</button>
            : <button type="button" role="menuitem" onClick={() => { setAbierto(false); alArchivar() }}>Archivar proveedor</button>}
        </div>
      )}
    </div>
  )
}
