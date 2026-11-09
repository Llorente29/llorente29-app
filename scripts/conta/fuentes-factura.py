#!/usr/bin/env python3
# scripts/conta/fuentes-factura.py
#
# G05 · T4 · Rehace supabase/functions/_shared/fuentes/sumied.ts: las letras del
# modelo de factura «Sumied» (Inter 400, 600 y 700; Space Grotesk 700) como TTF
# fijas, sacadas de las fuentes variables del proyecto (@fontsource-variable) y
# recortadas al latino de una factura en español. Necesita fonttools y brotli
# (pip install fonttools brotli). Uso: python3 scripts/conta/fuentes-factura.py
import base64, io, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NM = os.path.join(RAIZ, 'node_modules', '@fontsource-variable')
UNI = 'U+0020-007E,U+00A0-00FF,U+0152-0153,U+2013-2014,U+2018-201E,U+2022,U+2026,U+20AC,U+2032,U+00B7'

def ttf(src, peso):
    f = TTFont(src, recalcTimestamp=False); f.flavor = None
    inst = instancer.instantiateVariableFont(f, {'wght': peso})
    inst.recalcTimestamp = False; tmp = io.BytesIO(); inst.save(tmp); tmp.seek(0)
    o = subset.Options(); o.unicodes = subset.parse_unicodes(UNI); o.layout_features = ['kern', 'liga']; o.name_IDs = ['*']; o.notdef_outline = True; o.hinting = False
    ft = TTFont(tmp, recalcTimestamp=False); s = subset.Subsetter(o); s.populate(unicodes=o.unicodes); s.subset(ft)
    out = io.BytesIO(); ft.save(out); return out.getvalue()

PARTES = [
    ('INTER_400', 'inter/files/inter-latin-wght-normal.woff2', 400, 'Inter, peso 400'),
    ('INTER_600', 'inter/files/inter-latin-wght-normal.woff2', 600, 'Inter, peso 600'),
    ('INTER_700', 'inter/files/inter-latin-wght-normal.woff2', 700, 'Inter, peso 700'),
    ('SPACE_GROTESK_700', 'space-grotesk/files/space-grotesk-latin-wght-normal.woff2', 700, 'Space Grotesk, peso 700'),
]
L = ['// supabase/functions/_shared/fuentes/sumied.ts', '//',
     '// G05 · T4 · Las letras del modelo de factura «Sumied» (la maqueta aprobada:',
     '// Space Grotesk en los títulos e Inter en el texto), para incrustarlas en el PDF',
     '// con jsPDF. TTF fijas sacadas de las fuentes variables del proyecto',
     '// (@fontsource-variable/inter y space-grotesk) y recortadas al latino de una',
     '// factura en español (más «€», «•», «·», «—» y las comillas). Las dos van con',
     '// la SIL Open Font License 1.1, que deja incrustarlas: Inter © The Inter',
     '// Project Authors; Space Grotesk © The Space Grotesk Project Authors.',
     '// Se hacen otra vez con scripts/conta/fuentes-factura.py.', '']
for nombre, src, peso, txt in PARTES:
    L += [f'/** {txt} (TTF, base64). */', f"export const {nombre} = '{base64.b64encode(ttf(os.path.join(NM, src), peso)).decode()}'", '']
open(os.path.join(RAIZ, 'supabase/functions/_shared/fuentes/sumied.ts'), 'w').write('\n'.join(L))
print('Hecho: supabase/functions/_shared/fuentes/sumied.ts')
