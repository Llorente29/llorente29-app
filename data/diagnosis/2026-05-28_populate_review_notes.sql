BEGIN;

-- ============================================================
-- S2-A (v2 camelCase) — Poblar review_notes de los 34 dishes
-- Fuente: data/diagnosis/2026-05-28_needs_review_v1.csv
-- Claves jsonb en camelCase (coherencia con dominio del front).
-- Idempotente. Match por id+account+needs_review.
-- ============================================================

-- Rollitos de Queso Feta (3 unidades)  (-55.65%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 0.5778, "costReference": 1.3029, "referenceSource": "tspoon", "deltaEur": -0.7251, "deltaPct": -55.65, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 55.7% frente a tspoon. Escandallo muy probablemente incompleto (falta ingrediente o sub-receta)."}'::jsonb
  WHERE id = 'db287790-1f7f-47bf-8212-8998bf21a7f3' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Garlic Smash  (-33.03%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6128, "costReference": 2.4083, "referenceSource": "tspoon", "deltaEur": -0.7955, "deltaPct": -33.03, "sampleCount": 4, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 33.0% frente a tspoon. Escandallo muy probablemente incompleto (falta ingrediente o sub-receta)."}'::jsonb
  WHERE id = '146ddfc5-1e9e-43a3-9c36-7cbbcad037a1' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Korean SBB  (-21.42%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6128, "costReference": 2.0524, "referenceSource": "tspoon", "deltaEur": -0.4396, "deltaPct": -21.42, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 21.4% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '3687f3a0-9eac-46df-86ae-1f7b992a59c8' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Kebab de Ternera Gyros 🌯  (-20.52%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0176, "costReference": 2.5384, "referenceSource": "tspoon", "deltaEur": -0.5208, "deltaPct": -20.52, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 20.5% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '93af54ff-75be-453a-b83f-89521e6a42bc' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Kebab de Ternera  (-20.52%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0176, "costReference": 2.5384, "referenceSource": "tspoon", "deltaEur": -0.5208, "deltaPct": -20.52, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 20.5% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = 'f46ae2a9-8f48-477b-971a-57bff696e400' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Falafel con salsa de yogur (3 unidades)  (-20.05%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.2611, "costReference": 1.5775, "referenceSource": "tspoon", "deltaEur": -0.3163, "deltaPct": -20.05, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 20.1% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = 'b6f4fbac-3f79-49d6-875e-b74d014e9123' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Burrito Bendito de Tinga de Pollo  (-19.49%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.6033, "costReference": 3.2334, "referenceSource": "tspoon", "deltaEur": -0.6301, "deltaPct": -19.49, "sampleCount": 2, "locations": ["Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 19.5% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '22168790-dd48-4fae-9b5d-97457958bde3' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Crispy Falafel & Greek Dip (3 uds) 🌿  (-19.23%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.2611, "costReference": 1.5615, "referenceSource": "tspoon", "deltaEur": -0.3003, "deltaPct": -19.23, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 19.2% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '28ca979b-7e15-41fe-88e3-c14a1b9169bd' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita BOWL de Falafel  (-18.15%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6032, "costReference": 1.9586, "referenceSource": "tspoon", "deltaEur": -0.3554, "deltaPct": -18.15, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 18.1% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '82b3efda-6920-42f8-9a9f-6194d075a4ab' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita BOWL Ternera: Sabor Tradicional 🥗  (-18.14%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.9102, "costReference": 2.3336, "referenceSource": "tspoon", "deltaEur": -0.4234, "deltaPct": -18.14, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 18.1% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '11129044-02bb-4471-9082-af7d7b309134' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Burrito Colosal de Cochinita  (-17.73%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.8432, "costReference": 3.4558, "referenceSource": "tspoon", "deltaEur": -0.6126, "deltaPct": -17.73, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 17.7% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '7e29c597-2983-493c-8a55-be25c96260f9' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Burrito Tremendo de Birria de Ternera  (-16.25%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 3.2641, "costReference": 3.8973, "referenceSource": "tspoon", "deltaEur": -0.6332, "deltaPct": -16.25, "sampleCount": 2, "locations": ["Alcalá", "Pza Castilla"], "summary": "Folvy infravalora un 16.2% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '2e7b5c56-8b70-4b31-8e14-ef4daccf1993' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita de Falafel  (-15.23%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.7512, "costReference": 2.0659, "referenceSource": "tspoon", "deltaEur": -0.3147, "deltaPct": -15.23, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 15.2% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '252e6d70-463b-41f0-9b73-fbf1ecfda45a' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Kebab Mixto: Pollo y Ternera 🌯  (-15.06%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.999, "costReference": 2.3535, "referenceSource": "tspoon", "deltaEur": -0.3545, "deltaPct": -15.06, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 15.1% frente a tspoon. Escandallo probablemente incompleto o sub-receta no modelada."}'::jsonb
  WHERE id = '127b184e-05ef-4826-b014-dd15ad55ac1a' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- The Green Falafel: Pita Artesana 🌿  (-14.9%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.7512, "costReference": 2.0577, "referenceSource": "tspoon", "deltaEur": -0.3065, "deltaPct": -14.9, "sampleCount": 2, "locations": ["Alcalá", "Carabanchel"], "summary": "Folvy infravalora un 14.9% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = 'c9ae9cbf-8669-44aa-8d31-abd407576d3b' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Burrito Monumental Vegetal  (-11.52%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.662, "costReference": 1.8783, "referenceSource": "tspoon", "deltaEur": -0.2164, "deltaPct": -11.52, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 11.5% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = '26c637a5-3c34-4f89-a0a3-5461484c4f68' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita Mixta (Pollo y Ternera)  (-10.68%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0427, "costReference": 2.2868, "referenceSource": "tspoon", "deltaEur": -0.2441, "deltaPct": -10.68, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 10.7% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = 'b062758b-2910-43ec-a0bc-ce02198e659c' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita BOWL Mixto  (-9.05%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.8764, "costReference": 2.0632, "referenceSource": "tspoon", "deltaEur": -0.1868, "deltaPct": -9.05, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 9.1% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = 'a08cb424-0840-43c8-a3ed-1e7a88d1f8eb' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Kebab de Pollo Gyros 🌯  (-8.68%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.9804, "costReference": 2.1687, "referenceSource": "tspoon", "deltaEur": -0.1883, "deltaPct": -8.68, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 8.7% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = '28938f09-5a41-427c-9c00-ff8f0a6b232c' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Kebab de Falafel 🌿  (-8.42%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.744, "costReference": 1.9044, "referenceSource": "tspoon", "deltaEur": -0.1604, "deltaPct": -8.42, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 8.4% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = '9407860f-a8a7-4363-80c1-344c9df82957' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Korean Crispy Chicken BBQ  (-8.4%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6128, "costReference": 1.7606, "referenceSource": "tspoon", "deltaEur": -0.1478, "deltaPct": -8.4, "sampleCount": 2, "locations": ["Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 8.4% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = '5b089f9a-09ec-49d6-b1c7-df4f5cec33c8' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Korean  (-8.4%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6128, "costReference": 1.7606, "referenceSource": "tspoon", "deltaEur": -0.1478, "deltaPct": -8.4, "sampleCount": 2, "locations": ["Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 8.4% frente a tspoon. Posible gramaje bajo o merma no contabilizada."}'::jsonb
  WHERE id = '6f07d1cf-cb0f-4573-8856-7bd9eab94fd1' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- The Beef Legend: Pita de Ternera Gyros 🌯  (-7.67%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0582, "costReference": 2.2292, "referenceSource": "tspoon", "deltaEur": -0.171, "deltaPct": -7.67, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 7.7% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '33dbe44c-d497-447e-a931-fa36451677a1' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita BOWL Pollo: El Clásico Jugoso 🥗  (-7.4%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.8792, "costReference": 2.0294, "referenceSource": "tspoon", "deltaEur": -0.1502, "deltaPct": -7.4, "sampleCount": 2, "locations": ["Alcalá", "Carabanchel"], "summary": "Folvy infravalora un 7.4% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '05740417-da88-4ef0-9050-f81cc9d0850c' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Budapest SBB  (-6.15%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.1364, "costReference": 2.2764, "referenceSource": "tspoon", "deltaEur": -0.1401, "deltaPct": -6.15, "sampleCount": 1, "locations": ["Pza Castilla"], "summary": "Folvy infravalora un 6.2% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '84933e73-66f5-45b1-b384-ffc787a36e1a' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- The Mixed Master: Pita Mixta Gyros 🌯  (-5.76%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0427, "costReference": 2.1675, "referenceSource": "tspoon", "deltaEur": -0.1248, "deltaPct": -5.76, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 5.8% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '4e1dff66-7624-4d19-a116-084e3e4b1313' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita de Pollo  (-4.95%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0272, "costReference": 2.1328, "referenceSource": "tspoon", "deltaEur": -0.1056, "deltaPct": -4.95, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 4.9% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '5720b5e2-1ec3-4d95-b9d8-1f1f60c57c7e' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Budapest  (-4.85%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.1364, "costReference": 2.2452, "referenceSource": "tspoon", "deltaEur": -0.1089, "deltaPct": -4.85, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 4.8% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '9be3406b-d062-46da-b171-6d351e048bdb' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- The Golden Chicken: Pita de Pollo Gyros 🌯  (-3.73%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.0272, "costReference": 2.1058, "referenceSource": "tspoon", "deltaEur": -0.0786, "deltaPct": -3.73, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 3.7% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '9b874aab-2818-4099-bb89-2499250b3dfe' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Pita BOWL Mixto: La Experiencia Completa 🥗  (-3.46%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.8764, "costReference": 1.9438, "referenceSource": "tspoon", "deltaEur": -0.0673, "deltaPct": -3.46, "sampleCount": 3, "locations": ["Alcalá", "Pza Castilla", "Carabanchel"], "summary": "Folvy infravalora un 3.5% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = 'c1d84126-f751-47fe-9f16-d34acef11daf' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Scandal Burger Bacon Original  (-2.08%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.6561, "costReference": 1.6913, "referenceSource": "tspoon", "deltaEur": -0.0352, "deltaPct": -2.08, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 2.1% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = 'ce73a984-ec5c-40e1-9b51-1e2cb9d98f3e' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Doble Burger La Scandal  (-1.62%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.1695, "costReference": 2.2053, "referenceSource": "tspoon", "deltaEur": -0.0358, "deltaPct": -1.62, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 1.6% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = 'ed4bc41d-2b16-4108-9c73-e6c63e81c3cd' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- La Scandal Burger de Pollo  (-1.25%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 1.8321, "costReference": 1.8554, "referenceSource": "tspoon", "deltaEur": -0.0232, "deltaPct": -1.25, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 1.3% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = '72f10b80-bc23-4e08-971f-39a01471a096' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

-- Doble Scandal Cheese Lover  (-0.76%)
UPDATE recipe_item SET review_notes = '{"source": "diagnosis_v1", "kind": "cost_suspect", "diagnosedAt": "2026-05-28", "costFolvy": 2.6532, "costReference": 2.6735, "referenceSource": "tspoon", "deltaEur": -0.0203, "deltaPct": -0.76, "sampleCount": 1, "locations": ["Carabanchel"], "summary": "Folvy infravalora un 0.8% frente a tspoon. Diferencia pequeña; revisar gramajes finos."}'::jsonb
  WHERE id = 'b6ad1eaa-c7a7-4546-bc7d-f13c10ce33c9' AND account_id = '00000000-0000-0000-0000-000000000001' AND needs_review = true;

COMMIT;