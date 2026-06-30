// src/modules/orders/components/TicketPreviewModal.tsx
//
// Previsualización en pantalla de los 3 tickets (capa 1). Toma un OrderFeedItem,
// genera los documentos con ticketRenderer (modelo puro) y los pinta como
// tickets térmicos de papel (80mm). Sin impresora: es para VER el resultado.
//
// El QR se pinta con la librería qrcode (ya instalada) -> dataURL. En la
// impresora real será el comando ESC/POS nativo (capa de transporte, después).

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
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
}

type Tab = 'bag' | 'kitchen' | 'labels'

export default function TicketPreviewModal({ order, fiscal, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('bag')

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
              onClick={() => setTab(k)}
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
