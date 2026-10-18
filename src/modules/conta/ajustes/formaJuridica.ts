// src/modules/conta/ajustes/formaJuridica.ts
//
// S01e · El tipo de empresa dicho de UNA empresa. El catálogo (legal_form)
// copia la Orden EHA/451/2008, que habla en plural de todas las del mismo
// tipo («Sociedades de responsabilidad limitada»); en la ficha de una empresa
// se dice en singular. La base no se toca: se traduce al enseñarlo.

const EN_SINGULAR: Readonly<Record<string, string>> = {
  nif_a: 'Sociedad anónima',
  nif_b: 'Sociedad de responsabilidad limitada',
  nif_c: 'Sociedad colectiva',
  nif_d: 'Sociedad comanditaria',
  nif_e: 'Comunidad de bienes, herencia yacente u otra entidad sin personalidad jurídica',
  nif_f: 'Sociedad cooperativa',
  nif_g: 'Asociación',
  nif_h: 'Comunidad de propietarios',
  nif_j: 'Sociedad civil',
  nif_p: 'Corporación local',
  nif_q: 'Organismo público',
  nif_r: 'Congregación o institución religiosa',
  nif_s: 'Órgano de la Administración del Estado o de una comunidad autónoma',
  nif_u: 'Unión temporal de empresas',
  nif_v: 'Otro tipo de entidad',
}

/** «nif_b» → «Sociedad de responsabilidad limitada». Un código que no se conoce sale con el nombre del catálogo. */
export function formaEnSingular(code: string | null | undefined, nombreCatalogo?: string | null): string | null {
  if (code && EN_SINGULAR[code]) return EN_SINGULAR[code]
  return nombreCatalogo ?? null
}
