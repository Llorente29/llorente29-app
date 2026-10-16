#!/usr/bin/env python3
"""scripts/e2e/medir_esperas.py — cuánto espera y cuánto dura cada e2e de staging.

W02, paso 1a (16/10). Lee de la API de GitHub las ejecuciones de
e2e-staging-conta.yml y, de cada una, el tiempo de cada paso del job:

  cola GitHub   desde que se crea el run hasta que arranca el job
                (el grupo de concurrency: misma rama y mismo frente)
  preparación   checkout, psql, npm ci, build y navegador (antes del cerrojo)
  cerrojo       el paso «Cerrojo · esperar…» (antes del W02: lo que espera a
                otra e2e) o «Carril · esperar…» (después: lo que espera a que
                acabe una migración de staging)
  pruebas       el paso «Pruebas (ordenador y móvil)»

Con trozos (W02, 1c), las de cada run son las del trozo más largo: corren a la vez.

Es la vara del antes y del después (regla 31): el mismo script, las mismas
columnas, a los dos lados del cambio.

Uso:  GH_TOKEN=… python3 scripts/e2e/medir_esperas.py [--desde 2026-10-13T19:45:00Z] [--dir /tmp/e2e]
Solo lee. Guarda en --dir lo descargado para no volver a pedirlo.
"""
import argparse, json, os, re, statistics, urllib.request
from datetime import datetime, timedelta

REPO = 'https://api.github.com/repos/Llorente29/llorente29-app'
PREP = ('Set up job', 'Run actions/checkout', 'Guarda 1', 'Frente', 'Instalar psql',
        'Run actions/setup-node', 'Dependencias', 'Build', 'Navegador', 'Trozo ·', 'Carril · clonar')


def api(url):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                                               'Accept': 'application/vnd.github+json'})
    return json.load(urllib.request.urlopen(req))


def t(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None


def minutos(a, b):
    return (t(b) - t(a)).total_seconds() / 60 if a and b else None


def frente(rama):
    # La misma tabla que el paso «Frente» del workflow.
    for patron, f in ((r'conta/d\d', 'A'), (r'conta/b\d', 'B'), (r'conta/(c06|f\d)', 'C'), (r'conta/m\d', 'D')):
        if re.match(patron, rama):
            return f
    return '-'


def filas(dir_, paginas):
    runs = []
    for p in range(1, paginas + 1):
        runs += api(f'{REPO}/actions/workflows/e2e-staging-conta.yml/runs?per_page=100&page={p}')['workflow_runs']
    os.makedirs(dir_, exist_ok=True)
    for r in runs:
        if r['status'] != 'completed':
            continue
        f = os.path.join(dir_, f"{r['id']}.json")
        if not os.path.exists(f):
            json.dump(api(f"{REPO}/actions/runs/{r['id']}/jobs"), open(f, 'w'))
        jobs = json.load(open(f))['jobs']
        if not jobs:
            continue
        # Desde el W02 (1c) un run tiene varios jobs: «plan», N «trozo i/N» y
        # «entera». Las pruebas corren en los trozos A LA VEZ: la espera, la
        # preparación y las pruebas del run son las del trozo más largo; la cola,
        # hasta que arranca el primero; el total, hasta que acaba el último job.
        # Con un solo job (antes del W02), el de siempre: la misma vara.
        trozos = [j for j in jobs if j['name'].startswith('trozo ')] or [jobs[0]]
        if not all(j['started_at'] for j in trozos):
            continue

        def paso(j, prefijo):
            for s in j['steps']:
                if s['name'].startswith(prefijo) and s['conclusion'] != 'skipped' and s['completed_at']:
                    return minutos(s['started_at'], s['completed_at'])
            return None

        def maximo(xs):
            xs = [x for x in xs if x is not None]
            return max(xs) if xs else None

        espera = lambda j: paso(j, 'Cerrojo · esperar') if paso(j, 'Cerrojo · esperar') is not None else paso(j, 'Carril · esperar')
        yield dict(id=r['id'], frente=frente(r['head_branch']), rama=r['head_branch'], creado=r['created_at'],
                   que='entera' if '· entera ·' in r.get('display_title', '') else ('push' if r['event'] == 'push' else 'parcial'),
                   resultado=r['conclusion'], trozos=len(trozos) if trozos[0]['name'].startswith('trozo ') else 1,
                   cola=minutos(r['created_at'], min(j['started_at'] for j in trozos)),
                   prep=maximo(sum(x for x in (paso(j, p) for p in PREP) if x) for j in trozos),
                   cerrojo=maximo(espera(j) for j in trozos),
                   pruebas=maximo(paso(j, 'Pruebas') for j in trozos),
                   total=minutos(r['created_at'], max(j['completed_at'] for j in jobs if j['completed_at'])))


def resumen(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return '—'
    return f'n={len(xs)} · mediana {statistics.median(xs):.1f} · p90 {xs[int(0.9 * (len(xs) - 1))]:.1f} · máx {xs[-1]:.1f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--desde', default='2026-10-13T19:45:00Z', help='desde cuándo (UTC). Por defecto, desde que hay cerrojo')
    ap.add_argument('--dir', default='/tmp/e2e-esperas')
    ap.add_argument('--paginas', type=int, default=3)
    ap.add_argument('--hasta', default='9999', help='hasta cuándo (UTC), para medir un tramo cerrado')
    ap.add_argument('--rama', default='', help='solo las de esta rama (o prefijo)')
    a = ap.parse_args()
    fs = [f for f in filas(a.dir, a.paginas)
          if a.desde <= f['creado'] < a.hasta and f['cerrojo'] is not None and f['pruebas'] and f['rama'].startswith(a.rama)]
    madrid = lambda s: (t(s) + timedelta(hours=2)).strftime('%d/%m %H:%M')  # CEST hasta el 25/10
    for fr in 'ABCD':
        print(f'\n### Frente {fr}\n')
        print('| run | cuándo (Madrid) | qué | resultado | cola GitHub | cerrojo | preparación | pruebas | total |')
        print('|---|---|---|---|---:|---:|---:|---:|---:|')
        for f in [f for f in fs if f['frente'] == fr][:6]:
            print(f"| {f['id']} | {madrid(f['creado'])} | {f['que']} | {f['resultado']} | {f['cola']:.1f} | {f['cerrojo']:.1f} | {f['prep']:.1f} | {f['pruebas']:.1f} | {f['total']:.1f} |")
    print('\n### Por tipo (minutos)\n')
    for que in ('entera', 'push', 'parcial'):
        g = [f for f in fs if f['que'] == que]
        print(f'- {que}: cerrojo {resumen(f["cerrojo"] for f in g)} | pruebas {resumen(f["pruebas"] for f in g)} | total {resumen(f["total"] for f in g)}')
    suma = lambda k: sum(f[k] or 0 for f in fs)
    esperan = [f for f in fs if f['cerrojo'] > 1]
    print(f"\n{len(fs)} e2e desde {a.desde}: cerrojo {suma('cerrojo'):.0f} min · cola GitHub {suma('cola'):.0f} min · "
          f"preparación {suma('prep'):.0f} min · pruebas {suma('pruebas'):.0f} min. "
          f"Esperaron más de 1 min al cerrojo {len(esperan)}; media de esa espera {statistics.mean(f['cerrojo'] for f in esperan):.1f} min.")


if __name__ == '__main__':
    main()
