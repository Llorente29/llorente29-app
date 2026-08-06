// supabase/functions/_shared/hubriseAllergens.ts
//
// MAPEO DE ALÉRGENOS Folvy -> objeto `nutrition` de HubRise (T2d).
// ============================================================================
// Folvy guarda los 14 alérgenos EU (Rgto 1169/2011) con estado por plato en
// recipe_item_allergen: contains | may_contain | free | unknown, y con fuente
// manual | inherited | ai_enrich. HubRise expone un objeto `nutrition` en cada
// Product/Option con, entre otros, `allergens` (lista de PRESENCIA) y campos de
// texto (`legal_name`, `ingredients`). Este helper traduce aplicando 3 reglas
// decididas con el CEO (05-06/08/2026):
//
//   a) may_contain NO cabe en la lista de presencia de HubRise -> va a texto
//      ("Puede contener: …") en `legal_name`.
//   b) semántica de HubRise: `allergens` omitido/null = "no se informa";
//      `[]` = afirmación "no contiene NINGUNO". Por seguridad NUNCA emitimos []
//      sin conocimiento positivo: si todo es unknown (o no hay dato) -> se OMITE.
//      Publicamos la UNIÓN de fuentes (manual+inherited+ai_enrich): omitir un
//      alérgeno real es peor que sobre-declararlo.
//   c) HubRise no tiene "gluten"/"nuts" genéricos (parte en 6 cereales y 7
//      frutos de cáscara). Como Folvy solo sabe "gluten"/"nuts" sin subtipo,
//      se usan los tags de producto `allergen_gluten` / `allergen_nuts`, que
//      HubRise EXPANDE a todos sus subtipos (su vía nativa para "sé que lleva
//      gluten pero no qué cereal"). Los otros 12 códigos mapean 1:1.
//
// Usado por hubrise-catalog-publish (inyecta el resultado en cada product).
// ============================================================================

export interface AllergenRow {
  allergen_code: string; // código EU de Folvy
  state: string;         // contains | may_contain | free | unknown
}

export interface HubriseNutritionResult {
  /** objeto `nutrition` listo para el product, o null si no hay nada que declarar */
  nutrition: Record<string, unknown> | null;
  /** tags de producto (allergen_gluten / allergen_nuts); [] si no aplica */
  tags: string[];
}

// 12 códigos EU que mapean 1:1 a un código granular único de HubRise.
const DIRECT: Record<string, string> = {
  celery: "celery",
  crustaceans: "crustaceans",
  eggs: "eggs",
  fish: "fish",
  lupin: "lupin",
  milk: "milk",
  molluscs: "molluscs",
  mustard: "mustard",
  peanuts: "peanuts",
  sesame: "sesame_seeds",
  soy: "soybeans",
  sulphites: "sulphur_dioxide_sulphites",
};

// Genéricos EU -> tag de producto de HubRise (expande a todos los subtipos).
const TAG: Record<string, string> = {
  gluten: "allergen_gluten",
  nuts: "allergen_nuts",
};

// Etiqueta de cara al consumidor para el texto "Puede contener: …".
const LABEL_ES: Record<string, string> = {
  celery: "apio",
  crustaceans: "crustáceos",
  eggs: "huevo",
  fish: "pescado",
  gluten: "gluten",
  lupin: "altramuces",
  milk: "leche",
  molluscs: "moluscos",
  mustard: "mostaza",
  nuts: "frutos de cáscara",
  peanuts: "cacahuetes",
  sesame: "sésamo",
  soy: "soja",
  sulphites: "sulfitos",
};

export function buildNutrition(rows: AllergenRow[]): HubriseNutritionResult {
  const contains = new Set<string>();
  const mayContain = new Set<string>();
  let anyKnown = false;   // >=1 determinación distinta de 'unknown'
  let anyUnknown = false;

  for (const r of rows) {
    switch (r.state) {
      case "contains":
        contains.add(r.allergen_code);
        anyKnown = true;
        break;
      case "may_contain":
        mayContain.add(r.allergen_code);
        anyKnown = true;
        break;
      case "free":
        anyKnown = true; // confirma ausencia
        break;
      default:
        anyUnknown = true; // 'unknown' u otro estado desconocido
        break;
    }
  }

  // Presencia: códigos directos a la lista; gluten/nuts a tags.
  const directCodes: string[] = [];
  const tags: string[] = [];
  for (const code of contains) {
    if (DIRECT[code]) {
      directCodes.push(DIRECT[code]);
    } else if (TAG[code]) {
      if (!tags.includes(TAG[code])) tags.push(TAG[code]);
    }
    // (un código fuera de los 14 EU se ignora)
  }

  // Regla b: cuándo va `allergens`, y con qué valor.
  let allergens: string[] | null;
  if (contains.size > 0) {
    // Hay presencia real. Si SOLO era gluten/nuts (van por tag), NO ponemos []
    // (sería "ninguno"): omitimos la lista; la presencia la declaran los tags.
    allergens = directCodes.length > 0 ? directCodes.sort() : null;
  } else if (anyKnown && !anyUnknown) {
    allergens = []; // conocimiento positivo y cero incógnitas -> confirmado limpio
  } else {
    allergens = null; // algo unknown, o sin dato -> no informado
  }

  // Regla a: may_contain -> texto en legal_name.
  const mc = Array.from(mayContain).map((c) => LABEL_ES[c] ?? c).sort();
  const mayContainText = mc.length ? `Puede contener: ${mc.join(", ")}.` : null;

  const nutrition: Record<string, unknown> = {};
  if (allergens !== null) nutrition.allergens = allergens;
  if (mayContainText) nutrition.legal_name = mayContainText;

  return {
    nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
    tags,
  };
}
