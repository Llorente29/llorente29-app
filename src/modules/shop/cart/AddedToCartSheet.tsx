// src/modules/shop/cart/AddedToCartSheet.tsx
//
// Mini-panel que aparece tras añadir un plato al carrito. Da al cliente el
// momento de decisión (patrón Glovo/Uber/Otter multimarca): seguir en la
// marca, ver otras marcas, o ir a pagar. Sube el ticket medio.
//
// ANCLA recomendaciones: hay un hueco para una fila de sugerencias ("¿No se te
// olvida una bebida?"), que se alimentará del dato REAL de "lo más pedido" de
// la marca o de su categoría de bebidas/postres. No se muestran recomendaciones
// inventadas: el hueco queda vacío hasta tener ese dato.

const C = {
  surface: '#FFFFFF', ink: '#1A1714', inkDim: '#7A726A', line: '#ECE5DA',
  accent: '#FF5436', green: '#1FA85B', greenBg: '#E3F6EC', overlay: 'rgba(26,23,20,.45)',
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

export interface AddedInfo {
  name: string
  itemsCount: number
  total: number
}

interface Props {
  info: AddedInfo
  onKeepInBrand: () => void   // seguir en esta marca
  onOtherBrands: () => void   // volver al Hub
  onCheckout: () => void      // ir a pagar
  onClose: () => void
}

export default function AddedToCartSheet({ info, onKeepInBrand, onOtherBrands, onCheckout, onClose }: Props) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.check}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div style={S.title}>Añadido a tu pedido</div>
        <div style={S.sub}>{info.name}</div>

        <div style={S.cartLine}>
          <span>{info.itemsCount} {info.itemsCount === 1 ? 'artículo' : 'artículos'} en tu pedido</span>
          <strong>{eur(info.total)}</strong>
        </div>

        {/* ANCLA recomendaciones: fila de sugerencias reales (lo más pedido /
            bebidas-postres de la marca). Vacío hasta tener el dato. */}

        <button style={S.payBtn} onClick={onCheckout}>Ir a pagar · {eur(info.total)}</button>
        <button style={S.browseBtn} onClick={onOtherBrands}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M3 2v7a3 3 0 0 0 6 0V2" /><path d="M6 2v20" /><path d="M18 2v20" /><path d="M18 8c2 0 3-1 3-4 0-2-1-2-3-2" /></svg>
          Ver otras marcas y completar tu pedido
        </button>
        <button style={S.ghostBtn} onClick={onKeepInBrand}>Seguir en esta marca</button>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: C.overlay, zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
  sheet: { width: 'min(440px, 100vw)', background: C.surface, borderRadius: '20px 20px 0 0', padding: '24px 24px 28px', boxShadow: '0 -10px 40px rgba(0,0,0,.2)', animation: 'none' },
  check: { width: 48, height: 48, borderRadius: '50%', background: C.greenBg, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 900, margin: '0 auto 12px' },
  title: { fontSize: 19, fontWeight: 900, letterSpacing: '-.02em', textAlign: 'center', marginBottom: 3 },
  sub: { fontSize: 14, color: C.inkDim, textAlign: 'center', marginBottom: 16 },
  cartLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FBF7F0', border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', fontSize: 14, marginBottom: 18 },
  payBtn: { width: '100%', background: C.accent, color: '#fff', border: 'none', borderRadius: 14, padding: '15px', fontWeight: 900, fontSize: 16, cursor: 'pointer', marginBottom: 10 },
  browseBtn: { width: '100%', background: '#FFF1EC', color: C.accent, border: `1.5px solid ${C.accent}`, borderRadius: 14, padding: '13px', fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryBtn: { width: '100%', background: '#fff', color: C.ink, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: '13px', fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 8 },
  ghostBtn: { width: '100%', background: 'none', color: C.inkDim, border: 'none', padding: '8px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
}
