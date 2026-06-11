// src/admin/components/IntegrationsSection.tsx
//
// Sección "Integraciones Last.app" dentro de la ficha de cliente (panel admin).
// Herramienta INTERNA de Folvy: el cliente solo aporta datos (su org de Last,
// qué tienda es qué local); Folvy ejecuta. El procedimiento es genérico — el
// mismo para marcas propias, cedidas o un cliente nuevo.
//
// Orquesta los 4 eslabones del onboarding de una integración:
//   1. Alta de integración (org + nombre del secret del token)
//   2. Vincular tiendas Last → locales Folvy
//   3. Importar catálogo (Edge, token desde Vault)
//   4. Sembrar escandallos + recasar ventas
//
// El VALOR del token no se toca aquí: se pone por CLI (supabase secrets set).

import { useCallback, useEffect, useState } from 'react'
import {
  Plug, Loader2, Plus, Download, Sprout, Link2, ShieldAlert, Store, RefreshCw, Tag, EyeOff, ChevronDown,
} from 'lucide-react'
import {
  listIntegrations,
  createIntegration,
  listLocationMaps,
  listFolvyLocations,
  linkLocation,
  getCatalogCount,
  importCatalog,
  seedAndRecast,
  listBrandMaps,
  listFolvyBrands,
  listPendingExternalBrands,
  linkBrand,
  ignoreBrand,
  type LastappIntegration,
  type LastappLocationMap,
  type FolvyLocation,
  type FolvyBrand,
  type ExternalBrandMap,
  type PendingExternalBrand,
  type ImportReport,
} from '@/admin/services/lastappIntegrationService'

type Feedback = { kind: 'ok' | 'error'; msg: string } | null

// Agrupa las marcas pendientes por local Folvy. Las sin local resuelto van al final.
function groupByLocation(items: PendingExternalBrand[]) {
  const groups = new Map<string, { key: string; name: string; items: PendingExternalBrand[] }>()
  for (const it of items) {
    const key = it.folvyLocationId ?? '__none__'
    const name = it.folvyLocationName ?? 'Sin local vinculado'
    if (!groups.has(key)) groups.set(key, { key, name, items: [] })
    groups.get(key)!.items.push(it)
  }
  return Array.from(groups.values())
}

const OWNERSHIP_OPTIONS = [
  { value: 'own', label: 'Propia' },
  { value: 'licensed', label: 'Cedida (licensed)' },
]

export default function IntegrationsSection({ accountId }: { accountId: string }) {
  const [integrations, setIntegrations] = useState<LastappIntegration[]>([])
  const [catalogCounts, setCatalogCounts] = useState<Record<string, number>>({})
  const [maps, setMaps] = useState<LastappLocationMap[]>([])
  const [locations, setLocations] = useState<FolvyLocation[]>([])
  const [brandMaps, setBrandMaps] = useState<ExternalBrandMap[]>([])
  const [brands, setBrands] = useState<FolvyBrand[]>([])
  const [pendingBrands, setPendingBrands] = useState<PendingExternalBrand[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // clave de la acción en curso
  const [openLocation, setOpenLocation] = useState<string | null>(null) // acordeón: cocina abierta

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ints, mp, locs, bmaps, fbrands, pend] = await Promise.all([
        listIntegrations(accountId),
        listLocationMaps(accountId),
        listFolvyLocations(accountId),
        listBrandMaps(accountId),
        listFolvyBrands(accountId),
        listPendingExternalBrands(accountId),
      ])
      setIntegrations(ints)
      setMaps(mp)
      setLocations(locs)
      setBrandMaps(bmaps)
      setBrands(fbrands)
      setPendingBrands(pend)
      // Conteo de catálogo por org (en paralelo).
      const counts: Record<string, number> = {}
      await Promise.all(
        ints.map(async i => {
          try { counts[i.lastappOrganizationId] = await getCatalogCount(accountId, i.lastappOrganizationId) }
          catch { counts[i.lastappOrganizationId] = -1 }
        }),
      )
      setCatalogCounts(counts)
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'Error cargando integraciones.' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void reload() }, [reload])

  const locName = (id: string) => locations.find(l => l.id === id)?.name ?? id
  const brandName = (id: string) => brands.find(b => b.id === id)?.name ?? id

  async function handleImport(int: LastappIntegration, dryRun: boolean) {
    setBusy(`import:${int.id}:${dryRun}`); setFeedback(null); setReport(null)
    const res = await importCatalog({
      accountId, lastappOrganizationId: int.lastappOrganizationId, dryRun,
    })
    if (!res.ok) {
      setFeedback({ kind: 'error', msg: res.error })
    } else {
      setReport(res.summary)
      const unresolved = res.summary.brands_unresolved?.length ?? 0
      setFeedback({
        kind: unresolved > 0 ? 'error' : 'ok',
        msg: dryRun
          ? (unresolved > 0
              ? `Simulación: ${unresolved} marca(s) de Last NO existen en Folvy → su catálogo no entraría. Créalas antes de importar (ver detalle abajo).`
              : 'Simulación correcta: todas las marcas resuelven. Puedes importar de verdad.')
          : (unresolved > 0
              ? `Importado parcial: ${unresolved} marca(s) sin resolver quedaron fuera. Crea esas marcas y reimporta.`
              : 'Catálogo importado. Ahora pulsa "Sembrar escandallos y recasar".'),
      })
      if (!dryRun) await reload()
    }
    setBusy(null)
  }

  async function handleSeedRecast(int: LastappIntegration) {
    setBusy(`seed:${int.id}`); setFeedback(null)
    try {
      await seedAndRecast(accountId)
      setFeedback({ kind: 'ok', msg: 'Escandallos sembrados y ventas recasadas. Revisa el casado en Folvy Sales.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo sembrar/recasar.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-base font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
        Integraciones Last.app
      </h2>
      <p className="text-xs text-text-secondary mb-3">
        Herramienta interna de Folvy. El cliente solo aporta los datos; Folvy ejecuta el alta, vincula sus
        tiendas a los locales, importa el catálogo y casa las ventas. Mismo proceso para marcas propias, cedidas
        o un cliente nuevo.
      </p>

      {feedback && (
        <div className={`rounded-lg p-3 mb-3 text-sm border ${feedback.kind === 'ok'
          ? 'bg-success-bg text-success border-success/20'
          : 'bg-danger-bg text-danger border-danger/20'}`}>
          {feedback.msg}
        </div>
      )}

      {report && (
        <div className="rounded-lg p-3 mb-3 text-sm border border-border-default bg-card space-y-2">
          <div className="flex items-center gap-2 text-text-secondary">
            <span className="font-medium text-text-primary">Resumen del import</span>
            {report.dry_run && <span className="text-[10px] px-1.5 py-0.5 rounded border bg-page text-text-tertiary border-border-default">simulación</span>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary text-xs">
            <span>Productos: <b className="text-text-primary tabular-nums">{report.products ?? 0}</b></span>
            <span>Combos: <b className="text-text-primary tabular-nums">{report.combos ?? 0}</b></span>
            <span>Categorías: <b className="text-text-primary tabular-nums">{report.categories ?? 0}</b></span>
            <span>Grupos modif.: <b className="text-text-primary tabular-nums">{report.modifier_groups ?? 0}</b></span>
          </div>
          {(report.brands_in_use?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-tertiary">Marcas resueltas: </span>
              {report.brands_in_use!.join(', ')}
            </div>
          )}
          {(report.brands_unresolved?.length ?? 0) > 0 && (
            <div className="text-xs">
              <span className="text-danger font-medium">Marcas sin resolver (faltan en Folvy): </span>
              <span className="text-text-primary">{report.brands_unresolved!.join(', ')}</span>
              <p className="text-[11px] text-text-tertiary mt-1">
                Crea estas marcas en la cuenta (con un nombre que normalice igual) y vuelve a importar. Su catálogo no entra hasta que existan.
              </p>
            </div>
          )}
          {(report.warnings?.length ?? 0) > 0 && (
            <div className="text-[11px] text-text-tertiary">
              Avisos: {report.warnings!.slice(0, 5).join(' · ')}{report.warnings!.length > 5 ? '…' : ''}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm p-4">
          <Loader2 size={15} className="animate-spin" /> Cargando integraciones…
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Integraciones existentes ── */}
          {integrations.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm border border-dashed border-border-default rounded-lg">
              <Plug size={26} className="mx-auto mb-2 text-text-tertiary" />
              Este cliente no tiene ninguna integración Last.app. Da de alta la primera abajo.
            </div>
          ) : (
            integrations.map(int => {
              const count = catalogCounts[int.lastappOrganizationId]
              const importing = busy === `import:${int.id}:false`
              const simulating = busy === `import:${int.id}:true`
              const seeding = busy === `seed:${int.id}`
              return (
                <div key={int.id} className="border border-border-default rounded-lg bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">{int.organizationName ?? '(sin nombre)'}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${int.ownershipType === 'own'
                          ? 'bg-accent-bg text-accent border-accent/20'
                          : 'bg-page text-text-secondary border-border-default'}`}>
                          {int.ownershipType === 'own' ? 'Propia' : 'Cedida'}
                        </span>
                        {!int.isActive && <span className="text-[10px] text-text-tertiary">inactiva</span>}
                      </div>
                      <div className="text-[11px] text-text-tertiary font-mono mt-0.5 break-all">
                        org {int.lastappOrganizationId}
                      </div>
                      <div className="text-[11px] text-text-tertiary mt-0.5 inline-flex items-center gap-1">
                        <ShieldAlert size={11} /> token en secret <code className="font-mono">{int.tokenSecretName}</code>
                        {' '}— configúralo por CLI si aún no lo está
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-display font-medium text-text-primary tabular-nums">
                        {count === undefined ? '—' : count < 0 ? '?' : count}
                      </div>
                      <div className="text-[11px] text-text-secondary">productos en catálogo</div>
                    </div>
                  </div>

                  {/* Pasos 3 y 4 */}
                  <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border-default">
                    <button type="button" onClick={() => handleImport(int, false)} disabled={!!busy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                      {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Importar catálogo
                    </button>
                    <button type="button" onClick={() => handleImport(int, true)} disabled={!!busy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-page disabled:opacity-50 transition-base">
                      {simulating ? <Loader2 size={14} className="animate-spin" /> : null} Simular
                    </button>
                    <button type="button" onClick={() => handleSeedRecast(int)} disabled={!!busy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-page disabled:opacity-50 transition-base">
                      {seeding ? <Loader2 size={14} className="animate-spin" /> : <Sprout size={14} />} Sembrar escandallos y recasar
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* ── Alta de integración ── */}
          <NewIntegrationForm
            accountId={accountId}
            busy={!!busy}
            onCreated={() => { setFeedback({ kind: 'ok', msg: 'Integración dada de alta. Recuerda configurar el secret del token por CLI.' }); void reload() }}
            onError={(m) => setFeedback({ kind: 'error', msg: m })}
          />

          {/* ── Tiendas Last → locales ── */}
          <div className="border border-border-default rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Store size={15} className="text-accent" />
              <span className="text-sm font-medium text-text-primary">Tiendas Last vinculadas a locales</span>
            </div>
            {maps.length === 0 ? (
              <p className="text-xs text-text-tertiary">Aún no hay tiendas Last vinculadas a locales de este cliente.</p>
            ) : (
              <div className="border border-border-default rounded-md overflow-hidden">
                {maps.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm border-t border-border-default first:border-t-0">
                    <Link2 size={14} className="text-text-tertiary shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="text-text-primary">{m.lastappLocationName ?? '(tienda Last)'}</span>
                      <span className="block text-[11px] text-text-tertiary font-mono break-all">{m.lastappLocationId}</span>
                    </span>
                    <span className="text-text-tertiary">→</span>
                    <span className="text-text-primary">{locName(m.locationId)}</span>
                  </div>
                ))}
              </div>
            )}
            <LinkLocationForm
              accountId={accountId}
              locations={locations}
              busy={!!busy}
              onLinked={() => { setFeedback({ kind: 'ok', msg: 'Tienda vinculada. Sus ventas futuras se atribuirán; las ya entradas se casan al sembrar+recasar.' }); void reload() }}
              onError={(m) => setFeedback({ kind: 'error', msg: m })}
            />
          </div>

          {/* ── Marcas externas → marcas Folvy ── */}
          <div className="border border-border-default rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Tag size={15} className="text-accent" />
              <span className="text-sm font-medium text-text-primary">Marcas vinculadas</span>
            </div>
            <p className="text-[11px] text-text-tertiary">
              Cada marca de Last (propia o cedida) se vincula a una marca de Folvy. A partir de ahí, las ventas de esa
              marca se atribuyen de forma determinista por su id — no por nombre. Vincula una vez; vale para siempre.
            </p>

            {/* Ya vinculadas */}
            {brandMaps.length > 0 && (
              <div className="border border-border-default rounded-md overflow-hidden">
                {brandMaps.map(bm => (
                  <div key={bm.id} className="flex items-center gap-3 px-3 py-2 text-sm border-t border-border-default first:border-t-0">
                    <Tag size={14} className="text-text-tertiary shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] text-text-tertiary font-mono break-all">{bm.externalBrandId}</span>
                    </span>
                    <span className="text-text-tertiary">→</span>
                    <span className="text-text-primary">{brandName(bm.brandId)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Pendientes de vincular — ACORDEÓN POR COCINA (una abierta a la vez) */}
            {pendingBrands.length === 0 ? (
              <p className="text-[11px] text-text-tertiary">No hay marcas pendientes de vincular.</p>
            ) : (
              <div className="space-y-2">
                <span className="text-[11px] font-medium text-text-secondary">
                  Pendientes de vincular ({pendingBrands.length}) — entra en cada cocina:
                </span>
                {groupByLocation(pendingBrands).map(grp => {
                  const isOpen = openLocation === grp.key
                  return (
                    <div key={grp.key} className="border border-border-default rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenLocation(isOpen ? null : grp.key)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-card hover:bg-page transition-base text-left"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Store size={15} className="text-accent shrink-0" />
                          <span className="text-sm font-medium text-text-primary truncate">{grp.name}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-text-tertiary">
                            {grp.items.length} {grp.items.length === 1 ? 'marca pendiente' : 'marcas pendientes'}
                          </span>
                          <ChevronDown
                            size={15}
                            className={`text-text-tertiary transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="p-3 space-y-2 border-t border-border-default bg-page/40">
                          {grp.items.map(pb => (
                            <PendingBrandRow
                              key={`${pb.source}:${pb.externalLocationId}:${pb.externalBrandId}`}
                              accountId={accountId}
                              pending={pb}
                              brands={brands}
                              busy={!!busy}
                              onLinked={() => { setFeedback({ kind: 'ok', msg: 'Marca vinculada. Sus ventas se atribuirán al recasar.' }); void reload() }}
                              onIgnored={() => { setFeedback({ kind: 'ok', msg: 'Marca marcada como no vinculada. Puedes revertirlo más tarde.' }); void reload() }}
                              onError={(m) => setFeedback({ kind: 'error', msg: m })}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <button type="button" onClick={() => void reload()} disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            <RefreshCw size={13} /> Actualizar
          </button>
        </div>
      )}
    </section>
  )
}

// ── Form: alta de integración ──
function NewIntegrationForm({
  accountId, busy, onCreated, onError,
}: {
  accountId: string
  busy: boolean
  onCreated: () => void
  onError: (m: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [name, setName] = useState('')
  const [secretName, setSecretName] = useState('')
  const [ownership, setOwnership] = useState('own')
  const [saving, setSaving] = useState(false)

  const canSave = orgId.trim() !== '' && secretName.trim() !== '' && !saving && !busy

  async function submit() {
    setSaving(true)
    try {
      await createIntegration({
        accountId,
        lastappOrganizationId: orgId.trim(),
        organizationName: name.trim() || null,
        tokenSecretName: secretName.trim(),
        ownershipType: ownership,
      })
      setOrgId(''); setName(''); setSecretName(''); setOwnership('own'); setOpen(false)
      onCreated()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo dar de alta la integración.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border-default text-text-secondary hover:bg-page disabled:opacity-50 transition-base">
        <Plus size={15} /> Dar de alta integración Last.app
      </button>
    )
  }

  return (
    <div className="border border-border-default rounded-lg bg-card p-4 space-y-3">
      <span className="text-sm font-medium text-text-primary">Nueva integración Last.app</span>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-text-secondary">Organization ID de Last (uuid)</span>
          <input type="text" value={orgId} onChange={e => setOrgId(e.target.value)}
            placeholder="b7bc4753-…" autoComplete="off"
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary font-mono" />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-secondary">Nombre (referencia)</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Cloudtown"
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-secondary">Nombre del secret del token</span>
          <input type="text" value={secretName} onChange={e => setSecretName(e.target.value)}
            placeholder="LASTAPP_TOKEN_CLOUDTOWN" autoComplete="off"
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary font-mono" />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-secondary">Tipo</span>
          <select value={ownership} onChange={e => setOwnership(e.target.value)}
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
            {OWNERSHIP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-text-tertiary inline-flex items-center gap-1">
        <ShieldAlert size={11} /> Esto solo guarda el NOMBRE del secret. Pon el valor del token por CLI:
        {' '}<code className="font-mono">supabase secrets set {secretName.trim() || '<NOMBRE>'}=&lt;token&gt;</code>
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)}
          className="px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page transition-base">Cancelar</button>
        <button type="button" onClick={submit} disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Dar de alta
        </button>
      </div>
    </div>
  )
}

// ── Form: vincular tienda Last → local ──
function LinkLocationForm({
  accountId, locations, busy, onLinked, onError,
}: {
  accountId: string
  locations: FolvyLocation[]
  busy: boolean
  onLinked: () => void
  onError: (m: string) => void
}) {
  const [lastId, setLastId] = useState('')
  const [lastName, setLastName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = lastId.trim() !== '' && locationId !== '' && !saving && !busy

  async function submit() {
    setSaving(true)
    try {
      await linkLocation({
        accountId,
        lastappLocationId: lastId.trim(),
        lastappLocationName: lastName.trim() || null,
        locationId,
      })
      setLastId(''); setLastName(''); setLocationId('')
      onLinked()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo vincular la tienda.')
    } finally {
      setSaving(false)
    }
  }

  if (locations.length === 0) {
    return <p className="text-[11px] text-text-tertiary">Este cliente no tiene locales activos a los que vincular tiendas.</p>
  }

  return (
    <div className="flex items-end gap-2 flex-wrap pt-1">
      <label className="block flex-1 min-w-[200px]">
        <span className="text-[11px] text-text-secondary">Location ID de la tienda Last (uuid)</span>
        <input type="text" value={lastId} onChange={e => setLastId(e.target.value)}
          placeholder="cd084436-…" autoComplete="off"
          className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary font-mono" />
      </label>
      <label className="block min-w-[140px]">
        <span className="text-[11px] text-text-secondary">Nombre (opcional)</span>
        <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
          placeholder="CTB Alcalá"
          className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary" />
      </label>
      <label className="block min-w-[160px]">
        <span className="text-[11px] text-text-secondary">Local Folvy</span>
        <select value={locationId} onChange={e => setLocationId(e.target.value)}
          className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-page text-text-primary">
          <option value="">— Elige local —</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={submit} disabled={!canSave}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Vincular
      </button>
    </div>
  )
}

// ── Fila: marca externa pendiente → marca Folvy ──
// Muestra el nombre reconocible de la marca (pista de catálogo para propias,
// pista de productos para cedidas) y un desplegable de marcas de Folvy.
// El cliente NO teclea ids: elige con el nombre delante, dentro del contexto de
// su cocina. Si no la reconoce o no es suya, puede IGNORARLA (no adivinar).
function PendingBrandRow({
  accountId, pending, brands, busy, onLinked, onIgnored, onError,
}: {
  accountId: string
  pending: PendingExternalBrand
  brands: FolvyBrand[]
  busy: boolean
  onLinked: () => void
  onIgnored: () => void
  onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [ignoring, setIgnoring] = useState(false)

  // Sugerencia: marca de Folvy cuyo nombre coincide (normalizado) con la pista de
  // catálogo. "Milanesa House" ≠ "Milanesa Haus" → la sugerencia es precisa, no las
  // confunde. Si no hay pista o no coincide ninguna, no sugiere (el cliente elige).
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const suggested = pending.pistaCatalogo
    ? brands.find(b => norm(b.name) === norm(pending.pistaCatalogo!)) ?? null
    : null

  const [brandId, setBrandId] = useState(suggested?.id ?? '')

  const canSave = brandId !== '' && !saving && !ignoring && !busy
  const tienePistaCatalogo = !!pending.pistaCatalogo
  const titulo = pending.pistaCatalogo ?? 'Marca sin nombre (cedida)'

  async function submit() {
    setSaving(true)
    try {
      await linkBrand({
        accountId,
        source: pending.source,
        externalLocationId: pending.externalLocationId,
        externalBrandId: pending.externalBrandId,
        brandId,
      })
      onLinked()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo vincular la marca.')
    } finally {
      setSaving(false)
    }
  }

  async function ignore() {
    setIgnoring(true)
    try {
      await ignoreBrand({
        accountId,
        source: pending.source,
        externalLocationId: pending.externalLocationId,
        externalBrandId: pending.externalBrandId,
      })
      onIgnored()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo ignorar la marca.')
    } finally {
      setIgnoring(false)
    }
  }

  return (
    <div className="border border-border-default rounded-md bg-page p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium text-text-primary">{titulo}</span>
        <span className="text-[11px] text-text-tertiary tabular-nums">{pending.ventas} ventas</span>
      </div>
      {pending.pistaProductos && (
        <p className="text-[11px] text-text-tertiary">
          {!tienePistaCatalogo && <span className="text-text-secondary">Productos: </span>}
          {pending.pistaProductos}
        </p>
      )}
      <div className="text-[10px] text-text-tertiary font-mono break-all">id {pending.externalBrandId}</div>
      <div className="flex items-end gap-2 flex-wrap pt-1">
        <label className="block flex-1 min-w-[160px]">
          <span className="text-[11px] text-text-secondary">
            Vincular a marca de Folvy
            {suggested && <span className="text-accent"> · sugerida: {suggested.name}</span>}
          </span>
          <select value={brandId} onChange={e => setBrandId(e.target.value)}
            className="mt-0.5 w-full px-3 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary">
            <option value="">— Elige marca —</option>
            {brands.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{suggested?.id === b.id ? '  (sugerida)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={submit} disabled={!canSave}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />} Vincular
        </button>
        <button type="button" onClick={ignore} disabled={saving || ignoring || busy}
          title="No vincular esta marca (sacarla de pendientes; reversible)"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-border-default text-text-secondary hover:bg-card disabled:opacity-50 transition-base">
          {ignoring ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />} Ignorar
        </button>
      </div>
    </div>
  )
}
