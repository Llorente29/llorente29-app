// src/modules/multitenancy/components/brands/BrandLogoUploader.tsx
//
// Subidor de LOGO por MARCA. Se monta en la ficha de marca (BrandDetailView).
// El logo de marca es distinto del de la empresa (accounts.logo_url): una marca
// virtual tiene su propia identidad.
//
// Arrastrar/soltar o seleccionar archivo → previsualización inmediata → guardar
// (rasteriza a PNG en cliente vía brandLogoService) → la URL queda en
// brand.logo_url y la consume el ticket de bolsa de impresión. Permite quitarlo.
//
// El path del fichero cuelga de {accountId}/{brandId}/, por eso el componente
// recibe ambos ids.

import { useEffect, useRef, useState } from 'react'
import { getBrandLogoUrl, uploadBrandLogo, deleteBrandLogo } from '@/modules/multitenancy/services/brandLogoService'

interface Props {
  accountId: string
  brandId: string
}

export default function BrandLogoUploader({ accountId, brandId }: Props) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getBrandLogoUrl(brandId)
      .then(url => { if (!cancelled) setLogoUrl(url) })
      .catch(() => { /* sin logo */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [brandId])

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
      const url = await uploadBrandLogo(accountId, brandId, file)
      setLogoUrl(`${url}?t=${Date.now()}`) // cache-bust para ver el cambio al instante
      setFeedback({ kind: 'ok', msg: 'Logo actualizado.' })
    } catch (e) {
      setFeedback({ kind: 'error', msg: e instanceof Error ? e.message : 'No se pudo subir el logo.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!window.confirm('¿Quitar el logo de la marca?')) return
    setBusy(true)
    setFeedback(null)
    try {
      await deleteBrandLogo(brandId)
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
        Logo de la marca
      </h2>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Aparece en el ticket de bolsa que acompaña al pedido. PNG con fondo transparente recomendado.
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
            <img src={logoUrl} alt="Logo de la marca" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
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
