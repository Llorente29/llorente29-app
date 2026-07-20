// src/modules/orders/components/TicketPreviewModal.tsx
//
// Previsualización en pantalla de los 3 tickets (capa 1). Toma un OrderFeedItem,
// genera los documentos con ticketRenderer (modelo puro) y los pinta como
// tickets térmicos de papel (80mm). Sin impresora: es para VER el resultado.
//
// El QR se pinta con la librería qrcode (ya instalada) -> dataURL. En la
// impresora real será el comando ESC/POS nativo (capa de transporte, después).

import { useEffect, useMemo, useState } from 'react'
import { X, Printer, Loader2, Check, AlertCircle } from 'lucide-react'
import QRCode from 'qrcode'
import type { OrderFeedItem } from '../services/ordersFeedService'
import {
  renderBagTicket, renderKitchenTicket, renderLabels,
  type TicketDoc, type TicketBlock,
} from '../lib/ticketRenderer'

interface Props {
  order: OrderFeedItem
  fiscal?: { legalName?: string; taxId?: string; address?: string }
  onClose: () => void
  /** Reimprime el pedido. docType = solo ese documento. Devuelve el nº de jobs. */
  onReprint?: (saleId: string, docType?: string) => Promise<number>
}

type Tab = 'bag' | 'kitchen' | 'labels'

const TAB_LABEL: Record<Tab, string> = { bag: 'bolsa', kitchen: 'cocina', labels: 'pegatinas' }

export default function TicketPreviewModal({ order, fiscal, onClose, onReprint }: Props) {
  const [tab, setTab] = useState<Tab>('bag')
  const [reprinting, setReprinting] = useState(false)
  const [reprintMsg, setReprintMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Reimprime SOLO el documento de la pestaña activa (bag/kitchen/labels).
  async function handleReprint() {
    if (!onReprint || reprinting) return
    setReprinting(true); setReprintMsg(null)
    try {
      const n = await onReprint(order.sale_id, tab)
      setReprintMsg(n > 0
        ? { ok: true, text: `${TAB_LABEL[tab][0].toUpperCase()}${TAB_LABEL[tab].slice(1)} enviada a impresión (${n} ${n === 1 ? 'copia' : 'copias'}). Sale por la impresora si la estación está encendida.` }
        : { ok: false, text: `Ninguna impresora de este local saca "${TAB_LABEL[tab]}". Configúralo en Ajustes → Impresoras.` })
    } catch (e) {
      setReprintMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo reimprimir.' })
    } finally {
      setReprinting(false)
    }
  }

  const docs = useMemo(() => ({
    bag: [renderBagTicket(order, fiscal)],
    kitchen: [renderKitchenTicket(order)],
    labels: renderLabels(order),
  }), [order, fiscal])

  const current: TicketDoc[] = docs[tab]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,12,18,0.7)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0e1820', borderRadius: 14, maxWidth: 760, width: '100%',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ color: '#fff', fontWeight: 500, fontSize: 15 }}>
            Previsualización de tickets · {order.brand ?? ''}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9fb0c0', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {([['bag', 'Bolsa / cliente'], ['kitchen', 'Cocina'], ['labels', 'Pegatinas']] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setTab(k); setReprintMsg(null) }}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: '1px solid ' + (tab === k ? '#15171A' : 'rgba(255,255,255,0.12)'),
                background: tab === k ? '#15171A' : 'transparent',
                color: tab === k ? '#FFFFFF' : '#cfdae3', fontWeight: 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tickets */}
        <div style={{ overflowY: 'auto', padding: 18, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', background: '#0a1219' }}>
          {current.map((doc, i) => <PaperTicket key={i} doc={doc} />)}
        </div>

        {/* Pie: REIMPRIMIR (saca papel de verdad) */}
        {onReprint && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={handleReprint}
              disabled={reprinting}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px',
                borderRadius: 10, border: 'none', cursor: reprinting ? 'default' : 'pointer',
                background: '#1F9D6B', color: '#fff', fontWeight: 700, fontSize: 14, opacity: reprinting ? 0.7 : 1,
              }}
            >
              {reprinting
                ? <><Loader2 size={16} className="animate-spin" /> Enviando…</>
                : <><Printer size={16} /> Reimprimir {TAB_LABEL[tab]}</>}
            </button>
            {reprintMsg && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
                color: reprintMsg.ok ? '#7EE0B4' : '#F2B8AE',
              }}>
                {reprintMsg.ok ? <Check size={15} /> : <AlertCircle size={15} />} {reprintMsg.text}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Render de un ticket como papel térmico ──────────────────────────────────

function PaperTicket({ doc }: { doc: TicketDoc }) {
  return (
    <div style={{
      background: '#fff', color: '#1a1a1a', width: doc.widthMm === 58 ? 200 : 260,
      borderRadius: 6, padding: '14px 12px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 11, lineHeight: 1.5, alignSelf: 'flex-start',
    }}>
      {doc.blocks.map((blk, i) => <Block key={i} blk={blk} />)}
    </div>
  )
}

function Block({ blk }: { blk: TicketBlock }) {
  switch (blk.kind) {
    case 'text': {
      const size = blk.size === 3 ? 22 : blk.size === 2 ? 16 : 11
      return (
        <div style={{
          textAlign: blk.align ?? 'left', fontWeight: blk.bold ? 600 : 400,
          fontSize: size, color: blk.muted ? '#666' : '#1a1a1a',
          fontStyle: blk.size === 2 ? 'italic' : 'normal',
        }}>
          {blk.text}
        </div>
      )
    }
    case 'row':
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: blk.bold ? 600 : 400, color: blk.muted ? '#666' : '#1a1a1a' }}>
          <span>{blk.left}</span><span style={{ whiteSpace: 'nowrap' }}>{blk.right}</span>
        </div>
      )
    case 'banner':
      return (
        <div style={{ background: '#111', color: '#fff', textAlign: 'center', fontWeight: 600, padding: '5px 8px', margin: '8px 0', borderRadius: 3, fontSize: blk.text.length <= 6 ? 24 : 13, letterSpacing: blk.text.length <= 6 ? 1 : 0 }}>
          {blk.text}
        </div>
      )
    case 'rule':
      return <div style={{ borderTop: blk.dashed ? '1px dashed #999' : '1px solid #333', margin: '8px 0' }} />
    case 'space':
      return <div style={{ height: (blk.lines ?? 1) * 8 }} />
    case 'qr':
      return <QrBlock data={blk.data} caption={blk.caption} size={blk.size ?? 'lg'} />
    case 'cut':
      return <div style={{ borderTop: '2px dotted #bbb', margin: '10px -12px 0', paddingTop: 4, textAlign: 'center', fontSize: 8, color: '#bbb' }}>✂ corte</div>
    default:
      return null
  }
}

function QrBlock({ data, caption, size }: { data: string; caption?: string; size: 'sm' | 'lg' }) {
  const [url, setUrl] = useState<string | null>(null)
  const px = size === 'lg' ? 96 : 34
  useEffect(() => {
    let on = true
    QRCode.toDataURL(data, { width: px * 2, margin: 0 }).then((u) => { if (on) setUrl(u) }).catch(() => {})
    return () => { on = false }
  }, [data, px])
  // 'lg' (bolsa): QR CENTRADO con el caption DEBAJO. 'sm' (pegatina): pequeño en línea.
  if (size === 'lg') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {url ? <img src={url} width={px} height={px} alt="QR" /> : <div style={{ width: px, height: px, background: '#eee' }} />}
        {caption && <div style={{ fontSize: 10.5, lineHeight: 1.4, textAlign: 'center', fontWeight: 600, maxWidth: 200 }}>{caption}</div>}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      {url ? <img src={url} width={px} height={px} alt="QR" style={{ flexShrink: 0 }} /> : <div style={{ width: px, height: px, background: '#eee', flexShrink: 0 }} />}
      {caption && <div style={{ fontSize: 9, lineHeight: 1.3 }}>{caption}</div>}
    </div>
  )
}
