// src/modules/printing/components/PrintersSettingsPage.tsx
//
// Pantalla "Impresoras" de un local. Paridad Last: dar de alta / editar / borrar
// impresoras de red (ESC/POS a IP:puerto) SIN SQL ni consola. Todo por RPC de
// sesión (printerService), con guarda admin/manager en el backend.
//
// Reutilizable: se monta dentro de la ficha del local en el admin (F2, modo
// sesión) y dentro de la app en modo Estación (F3, modo token). F4 añade
// "Imprimir prueba" (por impresora) y "Buscar en la red" (autodescubrimiento
// LAN, sólo app nativa; fallback = IP a mano, siempre visible).
//
// Nota de esquema (BBDD es la verdad): la tabla `printer` NO tiene columna de
// "impresora por defecto"; el ruteo de qué imprime cada una se decide por
// doc_types (bolsa/cocina/etiquetas). Por eso aquí no hay un flag "por defecto":
// una impresora que saque un doc_type es la que recibe ese documento.

import { useEffect, useMemo, useState } from 'react'
import { Printer as PrinterIcon, Plus, Loader2, Pencil, Trash2, X, Check, AlertCircle, Ban, Wifi, Zap } from 'lucide-react'
import { Button, Input, Badge } from '../../../components/ui'
import {
  listPrinters, upsertPrinter, deletePrinter, printTest,
  listPrintersByToken, upsertPrinterByToken, deletePrinterByToken, printTestByToken,
  DOC_TYPES, type DocType, type Printer,
} from '../services/printerService'
import { canDiscover, discoverPrinters, type DiscoveredPrinter } from '../discovery'

// Dos modos, misma pantalla:
//  · SESIÓN (admin, F2): accountId + locationId → RPC de sesión (RLS).
//  · TOKEN (estación, F3): token → RPC by-token (cuenta+local salen del device).
interface Props {
  accountId?: string
  locationId?: string
  token?: string
}

const ALL_DOCS: DocType[] = DOC_TYPES.map(d => d.code)

interface FormState {
  editingId: string | null
  name: string
  ip: string
  port: string        // texto en el input; se parsea al guardar
  docTypes: DocType[]
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  editingId: null,
  name: '',
  ip: '',
  port: '9100',
  docTypes: [...ALL_DOCS],
  isActive: true,
}

function docLabel(code: DocType): string {
  return DOC_TYPES.find(d => d.code === code)?.label ?? code
}

export default function PrintersSettingsPage({ accountId, locationId, token }: Props) {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [notice, setNotice] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // Autodescubrimiento LAN (sólo app nativa).
  const [discovering, setDiscovering] = useState(false)
  const [found, setFound] = useState<DiscoveredPrinter[] | null>(null)
  const showDiscover = canDiscover()

  async function load() {
    setLoading(true)
    try {
      const rows = token
        ? await listPrintersByToken(token)
        : await listPrinters(locationId ?? '')
      setPrinters(rows)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando impresoras')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [locationId, token])

  const isEditing = form.editingId !== null
  const portNum = useMemo(() => {
    const n = parseInt(form.port, 10)
    return Number.isFinite(n) && n > 0 ? n : 9100
  }, [form.port])

  const canSave =
    form.name.trim().length > 0 &&
    form.ip.trim().length > 0 &&
    form.docTypes.length > 0 &&
    !saving

  function resetForm() { setForm(EMPTY_FORM) }

  function startEdit(p: Printer) {
    setError(null)
    setForm({
      editingId: p.id,
      name: p.name,
      ip: p.ip ?? '',
      port: String(p.port || 9100),
      docTypes: p.docTypes.length > 0 ? p.docTypes : [...ALL_DOCS],
      isActive: p.isActive,
    })
  }

  function toggleDoc(code: DocType) {
    setForm(f => {
      const has = f.docTypes.includes(code)
      // No dejar la impresora sin ningún documento.
      if (has && f.docTypes.length === 1) return f
      return {
        ...f,
        docTypes: has ? f.docTypes.filter(c => c !== code) : [...f.docTypes, code],
      }
    })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (token) {
        await upsertPrinterByToken(token, {
          id: form.editingId,
          name: form.name,
          ip: form.ip,
          port: portNum,
          docTypes: form.docTypes,
          isActive: form.isActive,
        })
      } else {
        await upsertPrinter({
          id: form.editingId,
          accountId: accountId ?? '',
          locationId: locationId ?? '',
          name: form.name,
          ip: form.ip,
          port: portNum,
          docTypes: form.docTypes,
          isActive: form.isActive,
        })
      }
      resetForm()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la impresora')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(p: Printer) {
    if (!confirm(`¿Eliminar la impresora "${p.name}"? Esta acción es definitiva.`)) return
    setSaving(true)
    setError(null)
    try {
      if (token) await deletePrinterByToken(token, p.id)
      else await deletePrinter(p.id)
      if (form.editingId === p.id) resetForm()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la impresora')
    } finally {
      setSaving(false)
    }
  }

  // Imprimir prueba: encola un ticket PRUEBA a esa impresora. Lo imprime el
  // worker de la Estación al reclamar la cola (requiere la tablet encendida).
  async function handleTest(p: Printer) {
    setTestingId(p.id)
    setError(null)
    setNotice(null)
    try {
      if (token) await printTestByToken(token, p.id)
      else await printTest(p.id)
      setNotice(`Prueba enviada a "${p.name}". Saldrá papel si la estación (tablet) está encendida.`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar la prueba')
    } finally {
      setTestingId(null)
    }
  }

  // Autodescubrimiento: escanea la red y ofrece las IPs encontradas para el form.
  async function handleDiscover() {
    setDiscovering(true)
    setError(null)
    setNotice(null)
    try {
      const list = await discoverPrinters()
      setFound(list)
      if (list.length === 0) setNotice('No se encontró ninguna impresora en la red. Escribe la IP a mano.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo buscar en la red')
    } finally {
      setDiscovering(false)
    }
  }

  function pickDiscovered(d: DiscoveredPrinter) {
    setForm(f => ({ ...f, ip: d.ip, port: String(d.port || 9100) }))
    setFound(null)
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <PrinterIcon size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Impresoras de este local</h2>
        {saving && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-4">
        <p className="text-xs text-text-secondary">
          Impresoras térmicas de red (ESC/POS). Indica su <strong>IP</strong> y qué documentos
          saca cada una. La tablet vinculada a este local imprimirá en ellas automáticamente.
        </p>

        {error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
            <AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-success-bg text-success border border-success/20 text-xs">
            <Check size={13} className="mt-0.5 shrink-0" /> {notice}
          </div>
        )}

        {/* Formulario alta / edición */}
        <div className="p-3 rounded-lg bg-page border border-border-default space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-primary">
              {isEditing ? 'Editar impresora' : 'Nueva impresora'}
            </span>
            {isEditing && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
              >
                <X size={13} /> Cancelar
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-medium text-text-secondary">Nombre</label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Cocina pase, Mostrador…"
              />
            </div>
            <div className="w-[150px]">
              <label className="text-xs font-medium text-text-secondary">IP</label>
              <Input
                value={form.ip}
                onChange={e => setForm(f => ({ ...f, ip: e.target.value }))}
                placeholder="192.168.1.86"
                inputMode="decimal"
              />
            </div>
            <div className="w-[90px]">
              <label className="text-xs font-medium text-text-secondary">Puerto</label>
              <Input
                value={form.port}
                onChange={e => setForm(f => ({ ...f, port: e.target.value.replace(/[^0-9]/g, '') }))}
                placeholder="9100"
                inputMode="numeric"
              />
            </div>
          </div>

          {/* Autodescubrimiento LAN (sólo app nativa; en web se escribe la IP a mano) */}
          {showDiscover && (
            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => void handleDiscover()} disabled={discovering}>
                {discovering
                  ? <><Loader2 size={14} className="animate-spin" /> Buscando en la red…</>
                  : <><Wifi size={14} /> Buscar impresoras en la red</>}
              </Button>
              {found && found.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {found.map(d => (
                    <button
                      key={`${d.ip}:${d.port}`}
                      type="button"
                      onClick={() => pickDiscovered(d)}
                      className="px-3 py-1 rounded-full text-xs font-medium ring-1 ring-accent/40 bg-accent-bg text-accent hover:bg-accent hover:text-text-on-accent transition-colors"
                      title="Usar esta IP"
                    >
                      {d.ip}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-text-tertiary inline-flex items-start gap-1.5">
            <Wifi size={12} className="mt-0.5 shrink-0" />
            Reserva una <strong>IP fija</strong> para la impresora en tu router (reserva DHCP por su MAC):
            así no cambia al reiniciar el router y la impresión no se rompe.
          </p>

          <div>
            <label className="text-xs font-medium text-text-secondary">Qué imprime</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {DOC_TYPES.map(d => {
                const on = form.docTypes.includes(d.code)
                return (
                  <button
                    key={d.code}
                    type="button"
                    onClick={() => toggleDoc(d.code)}
                    className={`px-3 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
                      on
                        ? 'bg-accent text-text-on-accent ring-transparent'
                        : 'bg-card text-text-secondary ring-border-default hover:text-text-primary'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="accent-accent"
              />
              <span className="text-sm text-text-primary">Activa</span>
            </label>
            <Button onClick={() => void handleSave()} disabled={!canSave}>
              {isEditing ? <><Check size={16} /> Guardar cambios</> : <><Plus size={16} /> Añadir impresora</>}
            </Button>
          </div>
        </div>

        {/* Listado */}
        {loading ? (
          <div className="flex items-center gap-2 text-text-secondary py-4">
            <Loader2 className="animate-spin" size={18} /> Cargando…
          </div>
        ) : printers.length === 0 ? (
          <p className="text-sm text-text-secondary py-2">Aún no hay impresoras en este local.</p>
        ) : (
          <ul className="space-y-2">
            {printers.map(p => (
              <li
                key={p.id}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${
                  p.isActive ? 'border-border-default bg-card' : 'border-border-default bg-page opacity-60'
                }`}
              >
                <PrinterIcon size={20} className="text-text-secondary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary truncate">{p.name}</span>
                    {!p.isActive && <Badge color="red">Inactiva</Badge>}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">
                    {p.ip ? `${p.ip}:${p.port}` : 'Sin IP'}
                    {p.docTypes.length > 0 && (
                      <> · {p.docTypes.map(docLabel).join(' · ')}</>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleTest(p)}
                  disabled={testingId === p.id || !p.isActive}
                  title={p.isActive ? 'Imprimir un ticket de prueba' : 'Activa la impresora para probarla'}
                >
                  {testingId === p.id
                    ? <><Loader2 size={14} className="animate-spin" /> Enviando…</>
                    : <><Zap size={14} /> Prueba</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                  <Pencil size={14} /> Editar
                </Button>
                <button
                  onClick={() => void handleDelete(p)}
                  className="p-2 rounded-md hover:bg-danger-bg text-text-secondary hover:text-danger"
                  title="Eliminar impresora"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-text-tertiary inline-flex items-start gap-1.5">
          <Ban size={12} className="mt-0.5 shrink-0" />
          Sólo impresoras de red (ESC/POS). {showDiscover
            ? 'Usa "Buscar impresoras en la red" o escribe la IP a mano.'
            : 'Escribe la IP a mano (la búsqueda automática está disponible en la tablet).'}
        </p>
      </div>
    </div>
  )
}
