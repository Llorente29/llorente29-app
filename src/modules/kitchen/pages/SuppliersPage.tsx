// src/modules/kitchen/pages/SuppliersPage.tsx
//
// Pantalla "Proveedores" de Folvy Kitchen. Patrón LISTA + DETALLE por estado,
// igual que KitchenRecipesPage (las páginas kitchen no usan react-router params).
//   selectedId === null → vista LISTA (búsqueda + tabla).
//   selectedId !== null → vista DETALLE: identidad editable + artículos que le compras.
//
// Estructura (Proveedores v1, fórmula de mercado + nuestra mejora):
//  · Identidad (lo que es): nombre, CIF, dirección, teléfono, email, registro
//    sanitario (RGSEAA, España-native, futura bisagra con APPCC), web/notas.
//  · Artículos que le compras (la relación, vía SupplierItemsSection).
//  · NO van aquí (diferido al módulo de pedidos): condiciones comerciales
//    (forma de pago, pedido mín/máx, días de entrega). Se declaran como diana,
//    no se construyen vacías.
//
// Modo ayuda: estado de ficha incompleta (sin CIF), ayuda inline del registro
// sanitario, y estado vacío didáctico en la zona de artículos (en su sección).
// Alta = solo nombre + CIF opcional (crear y completar luego, como el mercado).

import { useEffect, useMemo, useState } from 'react'
import { Plus, Truck, Search, X, Check, Loader2, Pencil, Archive, AlertTriangle, Info, ChevronRight } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  listLinksBySupplier,
} from '@/modules/kitchen/services/purchaseFormatService'
import SupplierItemsSection from '@/modules/kitchen/components/SupplierItemsSection'
import type { Supplier } from '@/types/kitchen'

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function matchesTokens(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = normalize(query).split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return true
  const haystack = fields.filter((f): f is string => !!f).map((f) => normalize(f)).join(' ')
  return tokens.every((tok) => haystack.includes(tok))
}

export default function SuppliersPage() {
  const { userProfile, authUserId } = useApp()
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const actorId = authUserId ?? null
  const actorName = userProfile?.displayName ?? null

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setSuppliers([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    listSuppliers(activeAccountId)
      .then(async (rows) => {
        if (cancelled) return
        setSuppliers(rows)
        // Conteo de "artículos que le compras" por proveedor (en paralelo).
        // Deuda menor declarada: N llamadas; trivial para una cuenta normal.
        const counts: Record<string, number> = {}
        await Promise.all(
          rows.map(async (s) => {
            try {
              const links = await listLinksBySupplier(s.id)
              counts[s.id] = links.length
            } catch {
              counts[s.id] = 0
            }
          }),
        )
        if (!cancelled) setLinkCounts(counts)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando proveedores.')
        setSuppliers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAccountId, accountsLoading, reloadTick])

  const filtered = useMemo(
    () => suppliers.filter((s) => matchesTokens(search, s.name, s.taxId)),
    [suppliers, search],
  )

  function handleCreated(created: Supplier) {
    setCreateOpen(false)
    setReloadTick((t) => t + 1)
    setSelectedId(created.id)
  }

  // ── Vista DETALLE ──
  if (selectedId) {
    return (
      <SupplierDetail
        supplierId={selectedId}
        onBack={() => {
          setSelectedId(null)
          setReloadTick((t) => t + 1)
        }}
      />
    )
  }

  // ── Vista LISTA ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-medium text-text-primary">Proveedores</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Tus proveedores y los artículos que le compras a cada uno
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!activeAccountId}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
        >
          <Plus size={16} />
          Nuevo proveedor
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o CIF…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border-default rounded-md bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {loading && (
        <div className="p-8 text-center text-sm text-text-secondary">Cargando proveedores…</div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && suppliers.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <Truck size={32} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary">
            Aún no hay proveedores. Pulsa "Nuevo proveedor" para empezar, o se crean al añadir un
            proveedor a un ingrediente.
          </p>
        </div>
      )}

      {!loading && !error && suppliers.length > 0 && filtered.length === 0 && (
        <div className="p-8 rounded-md bg-card border border-border-default text-center">
          <p className="text-sm text-text-secondary">Ningún proveedor coincide con «{search.trim()}».</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="rounded-md bg-card border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-page text-left">
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Proveedor</th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">CIF</th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide text-right">Artículos</th>
                  <th className="p-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Estado</th>
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const count = linkCounts[s.id] ?? 0
                  const incomplete = !s.taxId || s.taxId.trim() === ''
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className="border-b border-border-default last:border-0 hover:bg-accent-bg cursor-pointer transition-base"
                    >
                      <td className="p-3 font-medium text-text-primary">{s.name}</td>
                      <td className="p-3 text-text-secondary font-mono">{s.taxId || '—'}</td>
                      <td className="p-3 text-right tabular-nums text-text-secondary">{count}</td>
                      <td className="p-3">
                        {incomplete ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                            <AlertTriangle className="w-3 h-3" />
                            Ficha incompleta
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-success-bg text-success">
                            <Check className="w-3 h-3" />
                            Completa
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right text-text-secondary">
                        <ChevronRight className="w-4 h-4 inline-block" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-text-secondary border-t border-border-default bg-page">
            {suppliers.length} proveedor{suppliers.length === 1 ? '' : 'es'}
          </div>
        </div>
      )}

      {createOpen && activeAccountId && (
        <SupplierCreateModal
          accountId={activeAccountId}
          actorId={actorId}
          actorName={actorName}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: identidad editable (con RGSEAA + ayuda) + artículos que le compras.
// ─────────────────────────────────────────────────────────────────────
interface SupplierDetailProps {
  supplierId: string
  onBack: () => void
}

function SupplierDetail({ supplierId, onBack }: SupplierDetailProps) {
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Campos de edición.
  const [name, setName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [healthRegistryNo, setHealthRegistryNo] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getSupplierById(supplierId)
      .then((s) => {
        if (cancelled) return
        if (!s) {
          setError('Este proveedor ya no existe.')
          setSupplier(null)
        } else {
          setSupplier(s)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el proveedor.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [supplierId])

  async function refresh() {
    try {
      const s = await getSupplierById(supplierId)
      if (s) setSupplier(s)
    } catch (err: unknown) {
      console.error('SupplierDetail: refresco falló', err)
    }
  }

  function openEdit() {
    if (!supplier) return
    setName(supplier.name)
    setTaxId(supplier.taxId ?? '')
    setAddress(supplier.address ?? '')
    setPhone(supplier.phone ?? '')
    setEmail(supplier.email ?? '')
    setHealthRegistryNo(supplier.healthRegistryNo ?? '')
    setNotes(supplier.notes ?? '')
    setFormError(null)
    setEditing(true)
  }

  async function save() {
    if (!supplier) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setFormError('El nombre es obligatorio.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await updateSupplier(supplier.id, {
        name: trimmed,
        taxId: taxId.trim() === '' ? null : taxId.trim(),
        address: address.trim() === '' ? null : address.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        email: email.trim() === '' ? null : email.trim(),
        healthRegistryNo: healthRegistryNo.trim() === '' ? null : healthRegistryNo.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      })
      setEditing(false)
      await refresh()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!supplier) return
    const ok = window.confirm(`¿Archivar "${supplier.name}"? Dejará de aparecer en el listado.`)
    if (!ok) return
    setArchiving(true)
    try {
      await updateSupplier(supplier.id, { isActive: false, archivedAt: new Date().toISOString() })
      onBack()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'No se pudo archivar.')
      setArchiving(false)
    }
  }

  const incomplete = supplier && (!supplier.taxId || supplier.taxId.trim() === '')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
        >
          <Truck size={16} />
          Proveedores
        </button>
      </div>

      {loading && <div className="p-8 text-center text-sm text-text-secondary">Cargando proveedor…</div>}

      {!loading && error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {!loading && !error && supplier && (
        <>
          <div className="rounded-lg border border-border-default bg-card">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
              <h2 className="text-lg font-display font-medium text-text-primary">{supplier.name}</h2>
              {!editing && (
                <button
                  type="button"
                  onClick={openEdit}
                  className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-base"
                >
                  <Pencil size={14} />
                  Editar
                </button>
              )}
            </div>

            {/* Aviso de ficha incompleta (modo ayuda, no bloquea) */}
            {!editing && incomplete && (
              <div className="mx-4 mt-3 p-2.5 rounded-md bg-warning-bg/50 border border-warning/20 text-xs text-text-secondary flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-warning" />
                <span>Falta el CIF. Complétalo para evitar proveedores duplicados y poder validarlo más adelante.</span>
              </div>
            )}

            {!editing ? (
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Field label="CIF" value={supplier.taxId} mono />
                <Field label="Teléfono" value={supplier.phone} />
                <Field label="Email" value={supplier.email} />
                <Field label="Dirección" value={supplier.address} />
                <Field label="Registro sanitario" value={supplier.healthRegistryNo} mono />
                <Field label="Notas" value={supplier.notes} />
              </div>
            ) : (
              <div className="px-4 py-3 space-y-3">
                <EditRow label="Nombre" value={name} onChange={setName} disabled={saving} />
                <EditRow label="CIF" value={taxId} onChange={setTaxId} disabled={saving} placeholder="B12345678" />
                <EditRow label="Teléfono" value={phone} onChange={setPhone} disabled={saving} />
                <EditRow label="Email" value={email} onChange={setEmail} disabled={saving} />
                <EditRow label="Dirección" value={address} onChange={setAddress} disabled={saving} />
                <div>
                  <EditRow
                    label="Registro sanitario (RGSEAA)"
                    value={healthRegistryNo}
                    onChange={setHealthRegistryNo}
                    disabled={saving}
                    placeholder="Ej: 10.00000/M"
                  />
                  <p className="text-[11px] text-text-secondary mt-1 flex items-start gap-1">
                    <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>Lo encuentras en sus facturas o albaranes. Sirve para el control de proveedores del APPCC.</span>
                  </p>
                </div>
                <EditRow label="Notas" value={notes} onChange={setNotes} disabled={saving} />

                {formError && (
                  <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{formError}</div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
                  >
                    <X size={14} />
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                    {saving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <SupplierItemsSection supplier={supplier} />

          <div className="pt-2">
            <button
              type="button"
              onClick={handleArchive}
              disabled={archiving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50"
            >
              <Archive size={14} />
              {archiving ? 'Archivando…' : 'Archivar proveedor'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className={`text-text-primary ${mono ? 'font-mono' : ''}`}>{value && value.trim() !== '' ? value : '—'}</div>
    </div>
  )
}

function EditRow({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal "Nuevo proveedor": nombre + CIF opcional (crear y completar luego).
// ─────────────────────────────────────────────────────────────────────
interface SupplierCreateModalProps {
  accountId: string
  actorId: string | null
  actorName: string | null
  onClose: () => void
  onCreated: (created: Supplier) => void
}

function SupplierCreateModal({ accountId, actorId, actorName, onClose, onCreated }: SupplierCreateModalProps) {
  const [name, setName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [healthRegistryNo, setHealthRegistryNo] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('El nombre es obligatorio.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await createSupplier({
        accountId,
        name: trimmed,
        taxId: taxId.trim() === '' ? null : taxId.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        email: email.trim() === '' ? null : email.trim(),
        address: address.trim() === '' ? null : address.trim(),
        healthRegistryNo: healthRegistryNo.trim() === '' ? null : healthRegistryNo.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
        createdBy: actorId,
        createdByName: actorName,
      })
      onCreated(created)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el proveedor.')
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="supplier-create-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) onClose()
      }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 id="supplier-create-title" className="text-base font-medium text-text-primary">Nuevo proveedor</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={submitting} className="text-text-secondary hover:text-text-primary transition-base disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder="Ej: Makro"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">CIF (opcional)</label>
            <input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              disabled={submitting}
              placeholder="B12345678"
              className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          {!showMore ? (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base disabled:opacity-50"
            >
              <Plus size={16} />
              Añadir el resto de datos ahora
            </button>
          ) : (
            <div className="space-y-3 pt-1 border-t border-border-default">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Teléfono</label>
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={submitting}
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Email</label>
                <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting}
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Dirección</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} disabled={submitting}
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Registro sanitario (RGSEAA)</label>
                <input type="text" value={healthRegistryNo} onChange={(e) => setHealthRegistryNo(e.target.value)} disabled={submitting} placeholder="Ej: 10.00000/M"
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
                <p className="text-[11px] text-text-secondary mt-1 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>Lo encuentras en sus facturas o albaranes. Sirve para el control de proveedores del APPCC.</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Notas</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting}
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
              </div>
            </div>
          )}

          <p className="text-[11px] text-text-secondary">
            Puedes crear el proveedor solo con el nombre y completar el resto luego.
          </p>

          {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button type="button" onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={submitting} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}
