// src/modules/shop/checkout/couponText.ts
//
// Textos compartidos de cupones (checkout + "Mis bonos" de Mi cuenta). Fuente ÚNICA
// para no duplicar literales: el mismo valor de promo ("10%" / "4 €") y los mismos
// mensajes de por qué un cupón no aplica.

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

// Tipo estructural mínimo: lo cumplen CouponResult (checkout) y AccountCouponAvailable
// (Mis bonos) sin casts.
type PromoLike = { discountType?: 'percent' | 'fixed' | null; discountValue?: number | null }

// Valor escueto de la promo ("10%" / "4 €"), para el titular grande de la tarjeta.
// Cae a "10%" solo si faltara el tipo/valor (no debería con la migración T2100).
export function promoValue(c: PromoLike | null | undefined): string {
  if (c?.discountType === 'percent' && c.discountValue != null) return `${String(c.discountValue).replace('.', ',')}%`
  if (c?.discountType === 'fixed' && c.discountValue != null) return eur(c.discountValue)
  return '10%'
}

// Mensaje amable por el que un cupón no se aplicó (no expone el motivo de margen).
// 'needs_consent' es el equivalente de 'needs_contact' para un comensal ya logueado
// (tiene email; lo que le falta es el consentimiento del Club).
export function couponReasonMsg(reason: string): string {
  switch (reason) {
    case 'min':           return 'Tu pedido no llega al mínimo para este cupón.'
    case 'not_first':     return 'Este cupón es solo para el primer pedido.'
    case 'exhausted':     return 'Este cupón ya no está disponible.'
    case 'per_customer':  return 'Ya has usado este cupón.'
    case 'needs_contact': return 'Deja tu email y únete al club para usar este cupón.'
    case 'needs_consent': return 'Únete al Club (activa las ofertas por email) para usar este cupón.'
    default:              return 'Cupón no válido.'
  }
}
