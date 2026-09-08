// tests/unit/modules/kitchen/fixtures/cartaDeMeraki.ts
//
// LA CARTA DE VERDAD, y una sola copia de ella (regla 31).
//
// Los 33 productos activos de **Meraki Pita** el 06/09/2026, con su precio, su
// IVA, su `computed_cost` y las unidades vendidas en la ventana FIJA
// `[2026-06-08 00:00+02, 2026-09-06 00:00+02)`. Nada inventado ni redondeado a
// mano: sale de la base tal cual, con `account_id` de Foodint (regla 9).
//
// POR QUÉ VIVE AQUÍ Y NO DENTRO DE UNA PRUEBA: la usan la prueba de la regla
// (`cartaYMargen.test.ts`) y la de la captura (`capturaIngenieria.test.tsx`), y
// si cada una tuviera su copia la foto podría acabar enseñando una carta que la
// regla no ha visto nunca. Un fichero, una población, la misma vara a los dos
// lados.

import type { ProductoDeCarta } from '@/modules/kitchen/lib/cartaYMargen'

export const CARTA_DE_MERAKI: ProductoDeCarta[] = [
  { id: '1',  nombre: 'Agua Mineral 50 CL', tipo: 'item', categoria: 'Bebidas', precio: 1.9, ivaPct: 10, coste: 0.35, uds: 21 },
  { id: '2',  nombre: 'Cheesecake de Nutella', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 7.9, ivaPct: 10, coste: 3.158, uds: 21 },
  { id: '3',  nombre: 'Coca-Cola Original Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.5909375, uds: 35 },
  { id: '4',  nombre: 'Coca-Cola Zero Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.7675, uds: 44 },
  { id: '5',  nombre: 'Combo DÚO Mediterráneo (Para 2)', tipo: 'combo', categoria: 'EXPERIENCIAS MERAKÍ (Combos)', precio: 34.9, ivaPct: 10, coste: null, uds: 23 },
  { id: '6',  nombre: 'Crispy Falafel & Greek Dip (3 uds)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 6.5, ivaPct: 10, coste: 1.12224, uds: 142 },
  { id: '7',  nombre: 'Daily Box Esencial', tipo: 'combo', categoria: 'Menús Merakí: Daily Boxes (L-V)', precio: 12.9, ivaPct: 10, coste: null, uds: 0 },
  { id: '8',  nombre: 'Daily Box Premium', tipo: 'combo', categoria: 'Menús Merakí: Daily Boxes (L-V)', precio: 16.9, ivaPct: 10, coste: null, uds: 0 },
  { id: '9',  nombre: 'Fanta Limón Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.6216666666666667, uds: 8 },
  { id: '10', nombre: 'Fanta Naranja Lata', tipo: 'item', categoria: 'Bebidas', precio: 2.6, ivaPct: 10, coste: 0.495, uds: 16 },
  { id: '11', nombre: 'Kebab de Falafel', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 9.9, ivaPct: 10, coste: 1.774405957397009, uds: 23 },
  { id: '12', nombre: 'Kebab de Pollo Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 10.5, ivaPct: 10, coste: 2.2905423210333726, uds: 18 },
  { id: '13', nombre: 'Kebab de Ternera Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 11.1, ivaPct: 10, coste: 2.370335518597933, uds: 22 },
  { id: '14', nombre: 'Kebab Mixto: Pollo y Ternera', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 10.9, ivaPct: 10, coste: 2.332153700416115, uds: 62 },
  { id: '15', nombre: 'MAHOU 5 ESTRELLAS', tipo: 'item', categoria: 'Bebidas', precio: 2.8, ivaPct: 10, coste: 0.5092857142857142, uds: 48 },
  { id: '16', nombre: 'Marquesa de Choco-Avellanas', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 6.9, ivaPct: 10, coste: 2.59875, uds: 0 },
  { id: '17', nombre: 'Marquesa de Dulce de Leche', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 6.9, ivaPct: 10, coste: 2.607083333333333, uds: 0 },
  { id: '18', nombre: 'Menú Individual "Crea tu Experiencia"', tipo: 'combo', categoria: 'EXPERIENCIAS MERAKÍ (Combos)', precio: 19.9, ivaPct: 10, coste: null, uds: 50 },
  { id: '19', nombre: 'Patatas Clásicas Meraki', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 5.5, ivaPct: 10, coste: 0.876096, uds: 149 },
  { id: '20', nombre: 'Pita BOWL Falafel: El Delirio Veggie', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.7, ivaPct: 10, coste: null, uds: 10 },
  { id: '21', nombre: 'Pita BOWL Mixto: La Experiencia Completa', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.8, ivaPct: 10, coste: 2.036168715359134, uds: 170 },
  { id: '22', nombre: 'Pita BOWL Pollo: El Clásico Jugoso', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.7, ivaPct: 10, coste: 1.6701894224298413, uds: 64 },
  { id: '23', nombre: 'Pita BOWL Ternera: Sabor Tradicional', tipo: 'item', categoria: 'GOURMET PITA BOWLS', precio: 14.9, ivaPct: 10, coste: 1.7338257860662047, uds: 15 },
  { id: '24', nombre: 'Plato Mixto Gyros: Carne y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 12.9, ivaPct: 10, coste: 1.7099373737373738, uds: 31 },
  { id: '25', nombre: 'Plato Pollo Gyros: Pollo y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 11.9, ivaPct: 10, coste: 1.678119191919192, uds: 15 },
  { id: '26', nombre: 'Plato Ternera Gyros: Carne y Patatas', tipo: 'item', categoria: 'TRIBUTO AL GYROS (Platos)', precio: 13.1, ivaPct: 10, coste: null, uds: 6 },
  { id: '27', nombre: 'Rollitos de Queso Feta (3 unidades)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 6.3, ivaPct: 10, coste: 1.6940800000000003, uds: 85 },
  { id: '28', nombre: 'Tarta 3 Leches', tipo: 'item', categoria: 'CAPRICHOS DEL OBRADOR (Postres)', precio: 7.9, ivaPct: 10, coste: 3.158, uds: 27 },
  { id: '29', nombre: 'The Beef Legend: Pita de Ternera Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 13.9, ivaPct: 10, coste: 2.2920535638439827, uds: 203 },
  { id: '30', nombre: 'The Golden Chicken: Pita de Pollo Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 12.9, ivaPct: 10, coste: 2.224987639006695, uds: 200 },
  { id: '31', nombre: 'The Green Falafel: Pita Artesana', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 11.9, ivaPct: 10, coste: 1.8795535638439826, uds: 48 },
  { id: '32', nombre: 'The Mixed Master: Pita Mixta Gyros', tipo: 'item', categoria: 'PITAS & ROLLOS ARTESANOS', precio: 13.9, ivaPct: 10, coste: 2.2602353820258005, uds: 433 },
  { id: '33', nombre: 'The Spanakopita Twist (Greek Spiral)', tipo: 'item', categoria: 'EL ARTE DEL PICOTEO (Entrantes)', precio: 9.9, ivaPct: 10, coste: 1.42062, uds: 64 },
]
