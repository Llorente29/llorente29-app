// src/shell/soloSumied.ts
//
// ¿El Shell enseña solo Sumied? Sí con una marca de solo contabilidad, en una
// cuenta dada de alta solo con contabilidad (accounts.product_brand, C06) y,
// desde el G05 (08/11/2026), cuando la cuenta abierta es un acceso que da el
// despacho (user_profiles.advisor_account_id): la gestoría lleva el Sumied del
// cliente, nunca su cocina, sus pedidos, su tablet, su reparto ni su carta,
// aunque el cliente sea de Folvy. Pura (tests/unit/shell/soloSumied.test.ts).

export function soloSumiedEnElShell(p: { marcaSolo: boolean; productBrand: string | null | undefined; enClienteDelDespacho: boolean }): boolean {
  return p.marcaSolo || !!p.productBrand || p.enClienteDelDespacho
}
