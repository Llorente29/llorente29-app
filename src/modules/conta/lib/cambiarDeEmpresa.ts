// src/modules/conta/lib/cambiarDeEmpresa.ts
//
// DM1 (31/10/2026) · El alta no encierra (alta/CambiarDeEmpresa.tsx): cuándo
// lleva «Cambiar de empresa». Con más de una cuenta, o siendo
// superadministrador; con una sola, no hay adónde ir.
export function saleCambiarDeEmpresa(cuentas: number, esPlataforma: boolean): boolean {
  return esPlataforma || cuentas > 1
}
