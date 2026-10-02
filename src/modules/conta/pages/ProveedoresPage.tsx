// src/modules/conta/pages/ProveedoresPage.tsx
//
// La lista de proveedores. Autónoma como la ficha: funciona en una cuenta sin
// Cocina; lo que aporte otro módulo (la columna de artículos de Cocina) llega
// por `extensiones` y solo se pinta si la cuenta tiene algo que enseñar.
//
// Cada proveedor enseña su % de ficha completa con la MISMA función que la
// barra de la ficha (calcularCompletitud): la lista y la ficha no pueden
// contar distinto. Y «le debes» con la misma que las cifras de la ficha.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '@/modules/conta/conta.css'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { migasProveedores, rutaFichaProveedor } from '@/config/navegacion'
import { Campo, Dialogo, ErrorConReintento, Hueso, Migas } from '@/modules/conta/components/ui'
import {
  crearProveedor, listarContactosDeLaCuenta, listarFacturasDeLaCuenta, listarProveedores, proveedoresConCertificadoBanco,
} from '@/modules/conta/services/proveedorService'
import { calcularCompletitud } from '@/modules/conta/lib/completitud'
import { calcularCifras } from '@/modules/conta/lib/cifras'
import { euros, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { normalizarNif, tipoEntidadPorNif, validarNifEs } from '@/modules/conta/lib/nif'
import type { ExtensionesProveedor } from '@/modules/conta/extensiones'
import type { FichaProveedor } from '@/modules/conta/types'

interface Fila { ficha: FichaProveedor; pct: number; debe: number | null }

function normaliza(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export default function ProveedoresPage({ extensiones = {} }: { extensiones?: ExtensionesProveedor }) {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const location = useLocation()
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [extra, setExtra] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [busca, setBusca] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const avisoLlegada = (location.state as { aviso?: string } | null)?.aviso ?? null

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let vivo = true
    Promise.all([
      listarProveedores(activeAccountId),
      listarContactosDeLaCuenta(activeAccountId),
      proveedoresConCertificadoBanco(activeAccountId),
      listarFacturasDeLaCuenta(activeAccountId),
    ]).then(([provs, contactos, certs, facturas]) => {
      if (!vivo) return
      const hoy = hoyEnMadrid()
      setFilas(provs.map((ficha) => {
        const suyos = contactos.filter((c) => c.supplierId === ficha.id)
        const pct = calcularCompletitud({ ficha, contactos: suyos, tieneCertificadoBanco: certs.has(ficha.id) }).pct
        const debe = calcularCifras(facturas.filter((x) => x.supplierId === ficha.id), hoy).leDebes
        return { ficha, pct, debe }
      }))
    }).catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.') })
    const col = extensiones.columna
    if (col) col.valores(activeAccountId).then((v) => { if (vivo) setExtra(v) }).catch(() => { if (vivo) setExtra({}) })
    return () => { vivo = false }
  }, [activeAccountId, accountsLoading, vuelta, extensiones.columna])

  const visibles = useMemo(() => {
    if (!filas) return []
    const q = normaliza(busca.trim())
    if (!q) return filas
    return filas.filter(({ ficha: f }) =>
      [f.name, f.legalName, f.taxId, ...f.tags].some((x) => x && normaliza(x).includes(q)))
  }, [filas, busca])

  const columna = extensiones.columna && Object.keys(extra).length > 0 ? extensiones.columna : null

  return (
    <div className="cf cf-lienzo">
      <Migas migas={migasProveedores()} />
      <div className="cf-cabecera">
        <div>
          <h1 className="cf-titulo">Proveedores</h1>
          <p className="cf-nota" style={{ margin: '4px 0 0' }}>Quién te vende, cómo le pagas y cuánto le debes.</p>
        </div>
        <button type="button" className="cf-boton" onClick={() => setNuevo(true)} disabled={!activeAccountId}>Nuevo proveedor</button>
      </div>
      {avisoLlegada && <div className="cf-guardado" role="status">{avisoLlegada}</div>}
      <label htmlFor="buscar-prov" className="cf-nota" style={{ marginBottom: -10 }}>Buscar</label>
      <input id="buscar-prov" className="cf-buscador" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nombre, NIF o etiqueta" />

      {error && <ErrorConReintento mensaje={error} alReintentar={() => { setError(null); setFilas(null); setVuelta((v) => v + 1) }} />}
      {!error && !filas && <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={60} />)}</div>}
      {filas && filas.length === 0 && <div className="cf-tarjeta"><p style={{ margin: 0 }}>Aún no hay proveedores. Pulsa «Nuevo proveedor» para empezar.</p></div>}
      {filas && filas.length > 0 && visibles.length === 0 && <div className="cf-tarjeta"><p style={{ margin: 0 }}>Ningún proveedor coincide con «{busca.trim()}».</p></div>}
      {visibles.length > 0 && (
        <div className="cf-tabla" role="table" aria-label="Proveedores">
          <div className="cf-tabla-fila cf-tabla-cabeza" role="row">
            <span role="columnheader">Proveedor</span>
            <span role="columnheader">NIF</span>
            <span role="columnheader">Ficha</span>
            <span role="columnheader">Le debes</span>
            <span role="columnheader">{columna?.titulo ?? ''}</span>
          </div>
          {visibles.map(({ ficha: f, pct, debe }) => (
            <Link key={f.id} to={rutaFichaProveedor(f.id)} className="cf-tabla-fila" role="row">
              <span role="cell" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{f.name}</span>
                {f.legalName && <span className="cf-nota" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.legalName}</span>}
              </span>
              <span role="cell" style={{ fontVariantNumeric: 'tabular-nums' }}>{f.taxId ?? <span className="cf-nota">Sin NIF</span>}</span>
              <span role="cell" className="cf-mini-pista" aria-label={`Ficha al ${pct} %`}>
                <span className="cf-pista"><div style={{ width: `${pct}%` }} /></span>{pct} %
              </span>
              <span role="cell" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: debe ? 600 : 400 }}>
                {debe === null ? <span className="cf-nota">Sin facturas</span> : euros(debe)}
              </span>
              <span role="cell" className="cf-nota">{columna ? (extra[f.id] ?? 0) : ''}</span>
            </Link>
          ))}
        </div>
      )}
      {filas && <p className="cf-nota" style={{ margin: 0 }}>{filas.length === 1 ? '1 proveedor' : `${filas.length} proveedores`}{busca.trim() ? ` · ${visibles.length} con «${busca.trim()}»` : ''}</p>}
      {nuevo && activeAccountId && <NuevoProveedor accountId={activeAccountId} otros={filas?.map((x) => x.ficha) ?? []} alCerrar={() => setNuevo(false)} />}
    </div>
  )
}

function NuevoProveedor({ accountId, otros, alCerrar }: { accountId: string; otros: FichaProveedor[]; alCerrar: () => void }) {
  const { userProfile, authUserId } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [nif, setNif] = useState('')
  const [errores, setErrores] = useState<{ name?: string; nif?: string }>({})
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const nifAlMomento = useMemo(() => {
    if (!nif.trim()) return null
    const r = validarNifEs(nif)
    return r.ok ? null : `${r.motivo} Si es de otro país, déjalo vacío y ponlo luego en su ficha.`
  }, [nif])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const errs: { name?: string; nif?: string } = {}
    if (!name.trim()) errs.name = 'Pon el nombre con el que lo conocéis.'
    if (nifAlMomento) errs.nif = nifAlMomento
    const norm = nif.trim() ? normalizarNif(nif) : null
    const repe = norm ? otros.find((o) => o.taxId && normalizarNif(o.taxId) === norm) : null
    if (repe) errs.nif = `Ese NIF ya lo tiene ${repe.name}.`
    setErrores(errs)
    if (Object.keys(errs).length) return
    setOcupado(true); setFallo(null)
    try {
      const creado = await crearProveedor({
        accountId, name, taxId: norm, taxIdType: norm ? 'nif_es' : null,
        nifComprobado: !!norm, entityKind: norm ? tipoEntidadPorNif(norm) : null,
        createdBy: authUserId ?? null, createdByName: userProfile?.displayName ?? null,
      })
      navigate(rutaFichaProveedor(creado.id, 'datos-fiscales'), { state: { recienCreado: true } })
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo crear.')
      setOcupado(false)
    }
  }

  return (
    <Dialogo titulo="Nuevo proveedor" alCerrar={alCerrar}>
      <form className="cf-form" onSubmit={enviar} noValidate>
        {fallo && <div className="cf-error" role="alert">{fallo}</div>}
        <Campo campo="nuevo-name" etiqueta="Nombre con el que lo conocéis" error={errores.name}>
          {(p) => <input {...p} className="cf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hermanos Ruiz" />}
        </Campo>
        <Campo campo="nuevo-nif" etiqueta="NIF (opcional)" error={errores.nif ?? nifAlMomento} ayuda="Lo comprobamos al momento. El resto se completa en su ficha.">
          {(p) => <input {...p} className="cf-input" value={nif} onChange={(e) => setNif(e.target.value)} autoCapitalize="characters" placeholder="B12345678" />}
        </Campo>
        <div className="cf-pie-form">
          <button type="submit" className="cf-boton" disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear y completar su ficha'}</button>
          <button type="button" className="cf-boton-texto" onClick={alCerrar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  )
}
