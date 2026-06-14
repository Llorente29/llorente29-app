// src/admin/components/AccountLogoUploader.tsx
//
// Subidor de LOGO de empresa por cuenta (autoservicio). Reutilizable: se monta
// en el panel superadmin (CuentaDetallePage) y, más adelante, en los ajustes de
// cuenta de cara al cliente (mismo componente, cero retrabajo).
//
// Arrastrar/soltar o seleccionar archivo → previsualización inmediata → guardar
// (rasteriza a PNG en cliente vía accountLogoService) → la URL queda en
// accounts.logo_url y la consume el PDF de pedido. Permite quitar el logo.

import { useEffect, useRef, useState } from 'react'
import { getAccountLogoUrl, uploadAccountLogo, deleteAccountLogo } from '@/modules/multitenancy/services/accountLogoService'

interface Props {
  accountId: string
}

export default function AccountLogoUploader({ accountId }: Props) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAccountLogoUrl(accountId)
      .then(url => { if (!cancelled) setLogoUrl(url) })
      .catch(() => { /* sin logo */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setFeedback({ kind: 'error', msg: 'El logo debe ser una imagen (PNG, JPG o WebP).' })
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setFeedback({ kind: 'error', msg: 'La imagen es demasiado grande (máx. 8 MB).' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const url = await uploadAccountLogo(accountId, file)
      setLogoUrl(`${url}?t=${Date.now()}`) // cache-bust para ver el cambio al instante
      setFeedback({ kind: 'ok', msg: 'Logo actualizado.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo subir el logo.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!window.confirm('¿Quitar el logo de la empresa?')) return
    setBusy(true)
    setFeedback(null)
    try {
      await deleteAccountLogo(accountId)
      setLogoUrl(null)
      setFeedback({ kind: 'ok', msg: 'Logo eliminado.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo quitar el logo.' })
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  return (
    <section className="mb-6">
      <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>
        Logo de la empresa
      </h2>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Aparece en los documentos que genera Folvy (pedidos de compra, etc.). PNG con fondo transparente recomendado.
      </p>

      {feedback && (
        <div className="rounded-lg p-2.5 mb-3 text-sm" style={feedback.kind === 'ok'
          ? { background: '#E3F0E6', border: '1px solid #A8D0B5', color: '#1F6B3B' }
          : { background: '#FDECEC', border: '1px solid #E5A0A0', color: '#A12626' }}>
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center gap-5">
        {/* Previsualización */}
        <div
          className="flex items-center justify-center rounded-lg overflow-hidden"
          style={{
            width: 96, height: 96, flex: 'none',
            border: '1px solid var(--color-border, #e5e5e5)',
            background: 'var(--color-terracota-bg, #FAEFE6)',
          }}
        >
          {loading ? (
            <span className="text-xs" style={{ color: '#9aa29a' }}>…</span>
          ) : logoUrl ? (
            <img src={logoUrl} alt="Logo de la empresa" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <span className="text-xs text-center px-2" style={{ color: '#9aa29a' }}>Sin logo</span>
          )}
        </div>

        {/* Zona de subida */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="flex-1 rounded-lg px-4 py-5 text-center cursor-pointer transition-base"
          style={{
            border: `1.5px dashed ${dragOver ? 'var(--color-terracota, #D67442)' : 'var(--color-border, #ccc)'}`,
            background: dragOver ? 'var(--color-terracota-bg, #FAEFE6)' : 'transparent',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
            {busy ? 'Subiendo…' : 'Arrastra el logo aquí o haz clic para elegir'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary, #999)' }}>
            PNG, JPG o WebP · se ajusta automáticamente
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={busy}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
          />
        </div>

        {/* Quitar */}
        {logoUrl && !loading && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="px-3 py-2 rounded-md text-sm font-medium"
            style={{ background: '#fff', color: '#A12626', border: '1px solid #E5A0A0', opacity: busy ? 0.4 : 1, flex: 'none' }}
          >
            Quitar
          </button>
        )}
      </div>
    </section>
  )
}
