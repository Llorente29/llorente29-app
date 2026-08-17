// src/modules/kitchen/components/HubriseBrandCatalogPanel.tsx
//
// PANEL "CATÁLOGOS DE MARCA" — encargo Carabanchel, 17/08.
//
// POR QUÉ EXISTE. El ensayo de hubrise-catalog-create iba a hacerse pegando
// JavaScript en la consola del navegador. Se cambió por esto, y la razón de
// fondo importa más que la comodidad: la consola no es una superficie de
// producto. Pedirle a alguien que ejecute JS a mano para operar su propio
// sistema es el mismo problema que este módulo entero viene a quitar — que la
// operación se haga desde fuera de Folvy.
//
// COMPONENTE COMPARTIDO a propósito: hoy se monta en /_admin/hubrise, pero la
// ejecución de producción tendrá que hacerse desde una sesión de la cuenta
// cliente (ver abajo), así que está escrito para montarse también en el shell
// de cliente sin tocar una línea. Una implementación, no dos.
//
// LAS DOS SESIONES. Ningún usuario pertenece a más de una cuenta, y
// hubrise-catalog-create autoriza leyendo la marca con el cliente del USUARIO
// (RLS). Consecuencia: el ensayo de laboratorio y la ejecución de producción
// son dos sesiones distintas, y el panel lo dice en pantalla en vez de dejar
// que se descubra con un 403.
//
// LA TRAMPA DE LOS NOMBRES, resuelta por construcción y por interfaz:
//   · Por construcción — los selectores solo listan lo que la RLS de esta
//     sesión permite, así que es IMPOSIBLE que aparezca la marca de la otra
//     cuenta. No hay dedo que pueda equivocarse.
//   · Por interfaz — aun así, cada opción lleva su cuenta y los últimos 6 del
//     UUID. Hay dos "Bendito Burrito" (…131f11 en el laboratorio, …2a0170 en
//     Foodint) y dos "Foodint Carabanchel". Un selector que solo enseñe el
//     nombre es esa trampa convertida en botón.
//
// El aviso de producción vive AQUÍ, no en un documento: quien pulsa lo ve.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, ShieldAlert, Play } from 'lucide-react'
import {
  listOwnBrandsForCatalog,
  listHubriseLocations,
  createBrandCatalog,
  type CatalogBrandOption,
  type CatalogLocationOption,
} from '@/modules/kitchen/services/hubriseCatalogCreateService'

/** Últimos 6 del UUID — lo que distingue dos filas que se llaman igual. */
function tail6(id: string): string {
  return id.slice(-6)
}

export default function HubriseBrandCatalogPanel() {
  const [brands, setBrands] = useState<CatalogBrandOption[]>([])
  const [locations, setLocations] = useState<CatalogLocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [brandId, setBrandId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [dryRun, setDryRun] = useState(true)          // marcada por defecto
  const [confirming, setConfirming] = useState(false)

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listOwnBrandsForCatalog(), listHubriseLocations()])
      .then(([bs, ls]) => {
        if (cancelled) return
        setBrands(bs)
        setLocations(ls)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selectedLocation = useMemo(
    () => locations.find((l) => l.locationId === locationId) ?? null,
    [locations, locationId],
  )
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId],
  )

  // Las cuentas visibles en esta sesión. Si sale más de una, algo ha cambiado
  // en el modelo de permisos y conviene verlo.
  const sessionAccounts = useMemo(() => {
    const s = new Set<string>()
    for (const b of brands) s.add(b.accountName)
    for (const l of locations) s.add(l.accountName)
    return [...s].sort()
  }, [brands, locations])

  // Escribir de verdad sobre un cliente real exige confirmación explícita.
  const isRealWrite = !dryRun && !!selectedLocation?.isProduction
  const canRun = !!brandId && !!locationId && !running

  // Cruzar cuentas es imposible por RLS, pero si alguna vez dejara de serlo,
  // que no pase en silencio.
  const accountMismatch =
    !!selectedBrand && !!selectedLocation && selectedBrand.accountId !== selectedLocation.accountId

  async function run() {
    setRunning(true)
    setRunError(null)
    setResult(null)
    setConfirming(false)
    try {
      const r = await createBrandCatalog({ brandId, locationId, dryRun })
      setResult(r.data)
      if (!r.ok) setRunError(r.error ?? 'La llamada no devolvió ok:true.')
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  function handleClick() {
    if (isRealWrite) { setConfirming(true); return }
    void run()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-tinta-45 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando marcas y locales…
      </div>
    )
  }

  return (
    <section className="border border-linea-fuerte rounded-lg p-4 bg-card">
      <h2 className="font-display text-[17px] font-semibold text-tinta tracking-[-0.02em]">
        Catálogos de marca
      </h2>
      <p className="text-[12.5px] text-tinta-45 mt-1 max-w-3xl">
        Crea (o reutiliza) el catálogo HubRise de una marca en un local. No publica la carta:
        eso es un paso aparte, cuando los bridges de ese local apunten a este catálogo.
      </p>

      {/* Qué cuenta gobierna esta sesión. Sale siempre, no solo cuando falla. */}
      <p className="text-[11px] text-tinta-45 mt-2">
        Sesión sobre {sessionAccounts.length === 1 ? 'la cuenta' : 'las cuentas'}{' '}
        <strong className="text-tinta">{sessionAccounts.join(', ') || '—'}</strong>. Solo se puede operar
        sobre lo suyo: la función autoriza leyendo la marca con tu sesión, así que una marca de otra
        cuenta daría 403. El ensayo de laboratorio y la ejecución en un cliente real son dos sesiones
        distintas.
      </p>

      {loadError && (
        <div className="mt-3 p-2.5 rounded-lg bg-danger-bg text-danger border border-danger/20 text-xs">
          {loadError}
        </div>
      )}

      {brands.length === 0 && (
        <div className="mt-3 p-2.5 rounded-lg bg-lavado border border-linea-fuerte text-[12px] text-tinta-70">
          Esta sesión no ve ninguna marca propia gobernada por Folvy. Solo se listan marcas con
          <code className="mx-1">ownership_type = 'own'</code> y <code className="mx-1">catalog_source = 'folvy'</code>:
          las cedidas y las que manda el TPV no van a HubRise.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <label className="block">
          <span className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45">Marca</span>
          <select
            value={brandId}
            onChange={(e) => { setBrandId(e.target.value); setResult(null); setRunError(null) }}
            disabled={running}
            className="mt-1 w-full px-2.5 py-1.5 text-[13px] rounded-lg bg-card border border-linea-fuerte text-tinta focus:outline-none focus:ring-2 focus:ring-tinta/15 disabled:opacity-50"
          >
            <option value="">Elige marca…</option>
            {brands.map((b) => (
              // cuenta + últimos 6 del UUID: hay dos "Bendito Burrito".
              <option key={b.id} value={b.id}>
                {b.name} — {b.accountName} · …{tail6(b.id)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45">Local</span>
          <select
            value={locationId}
            onChange={(e) => { setLocationId(e.target.value); setResult(null); setRunError(null); setConfirming(false) }}
            disabled={running}
            className="mt-1 w-full px-2.5 py-1.5 text-[13px] rounded-lg bg-card border border-linea-fuerte text-tinta focus:outline-none focus:ring-2 focus:ring-tinta/15 disabled:opacity-50"
          >
            <option value="">Elige local…</option>
            {locations.map((l) => (
              // cuenta + últimos 6 del UUID: hay dos "Foodint Carabanchel".
              <option key={l.locationId} value={l.locationId}>
                {l.locationName} — {l.accountName} · …{tail6(l.locationId)} · {l.externalLocationId}
                {l.isProduction ? ' · PRODUCCIÓN' : ' · laboratorio'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 mt-3 text-[13px] text-tinta cursor-pointer">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => { setDryRun(e.target.checked); setConfirming(false) }}
          disabled={running}
          className="w-4 h-4 accent-tinta"
        />
        Solo comprobar (dry run) — lee y no escribe nada
      </label>

      {accountMismatch && (
        <div className="mt-3 p-2.5 rounded-lg bg-danger-bg text-danger border border-danger/20 text-[12px] flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          La marca y el local son de cuentas distintas ({selectedBrand?.accountName} vs {selectedLocation?.accountName}).
          Esto no debería poder pasar; no ejecutes y avísalo.
        </div>
      )}

      {/* El aviso de producción vive en la pantalla, no en la documentación. */}
      {selectedLocation?.isProduction && (
        <div className={`mt-3 p-2.5 rounded-lg border text-[12px] flex gap-2 ${
          dryRun ? 'bg-lavado border-linea-fuerte text-tinta-70' : 'bg-danger-bg border-danger/20 text-danger'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>{selectedLocation.locationName}</strong> ({selectedLocation.externalLocationId}) es un local
            de <strong>producción</strong>, de un cliente real.
            {selectedLocation.isAlcala && ' Alcalá lleva recibiendo pedidos reales desde el 06/08 y tiene 9 catálogos vivos.'}
            {dryRun
              ? ' Con «solo comprobar» marcado no se escribe nada.'
              : ' Vas a ESCRIBIR sobre él.'}
          </span>
        </div>
      )}

      {confirming ? (
        <div className="mt-3 p-3 rounded-lg border border-danger/30 bg-danger-bg">
          <p className="text-[13px] text-danger font-semibold">
            Vas a crear un catálogo real en {selectedLocation?.locationName} ({selectedLocation?.externalLocationId}),
            cuenta {selectedLocation?.accountName}, para la marca {selectedBrand?.name} (…{selectedBrand ? tail6(selectedBrand.id) : ''}).
          </p>
          <p className="text-[12px] text-tinta-70 mt-1">
            Esto llama a HubRise y escribe en <code>brand_hubrise_catalog</code>. No publica carta.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={() => void run()}
              className="px-3 py-1.5 text-[13px] rounded-lg font-semibold bg-danger text-white hover:opacity-90">
              Sí, crear en producción
            </button>
            <button type="button" onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-[13px] rounded-lg text-tinta-70 hover:bg-lavado">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={!canRun}
          className={`mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium transition-colors ${
            !canRun
              ? 'bg-lavado text-tinta-25 border border-border-default cursor-not-allowed'
              : isRealWrite
                ? 'bg-danger text-white hover:opacity-90'
                : 'bg-tinta text-white hover:bg-accent-hover'
          }`}
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {dryRun ? 'Comprobar' : isRealWrite ? 'Crear en PRODUCCIÓN' : 'Crear catálogo'}
        </button>
      )}

      {runError && (
        <div className="mt-3 p-2.5 rounded-lg bg-danger-bg text-danger border border-danger/20 text-xs">{runError}</div>
      )}

      {/* Respuesta ÍNTEGRA. No se resume: scope_summary (de_local / de_cuenta /
          desconocido) es justo el dato que se ha venido a mirar. */}
      {result !== null && (
        <div className="mt-3">
          <div className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-tinta-45 mb-1">
            Respuesta de hubrise-catalog-create
          </div>
          <pre className="text-[11px] font-mono bg-lavado border border-linea-fuerte rounded-lg p-3 overflow-x-auto whitespace-pre text-tinta">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </section>
  )
}
