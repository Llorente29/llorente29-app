# -*- coding: utf-8 -*-
"""
Folvy F10 — PROTOTIPO de solver exacto para el cuadrante de cocina.
3 personas x 7 dias x 4 plantillas reales. Dos fases:
  FASE 1: reservar dias libres ANTES de repartir (escalonados, rotando por semana)
  FASE 2: asientos por dia (set-cover exacto sobre plantillas) + asignacion
          por busqueda con vuelta atras (backtracking) y objetivo lexicografico:
          (huecos, desvio de contrato, partidos, desequilibrio)
Restricciones duras: tope diario 9,5h, descanso 12h entre jornadas (con estas
plantillas cierre 00:15 -> apertura 12:30 = 12,25h, siempre legal), corte de
partido >= 90 min, tope contrato +10%, max 1 Corrido1 por persona/semana,
descanso semanal garantizado por el dia libre completo reservado.
"""
from itertools import product

# ---- Plantillas reales (minutos desde medianoche; fin>1440 = cruza) ----
TEMPLATES = {
    'M':  (750, 1005),   # Manana        12:30-16:45  4.25h
    'T':  (1185, 1455),  # Tarde/Noche   19:45-00:15  4.50h
    'C1': (885, 1455),   # Corrido1      14:45-00:15  9.50h
    'C2': (1005, 1455),  # Corrido2      16:45-00:15  7.50h
}
DUR = {k: (v[1]-v[0])/60.0 for k, v in TEMPLATES.items()}

def covers(tpl, hour):
    ini, fin = TEMPLATES[tpl]
    return ini < (hour+1)*60 and min(fin, 1440) > hour*60

# ---- Politica ----
MAX_DAY_H   = 9.5
SPLIT_GAP   = 90       # min
CONTRACT    = 40.0
TOL         = 0.10     # +10%
MAX_WEEK_H  = CONTRACT * (1+TOL)
PEAK_HOUR   = 21
PEAK_WD, PEAK_WE = 2, 3   # suelo en el pico: L-V / S-D
PEOPLE = ['Johanny', 'Natacha', 'Pamela']

# ---- Demanda real (required_exact por hora, ya limpia) ----
import math
DEMAND = {
 '03/08': {0:{13:1,14:1,15:1,16:1,20:1,21:1,22:1,23:1},
           1:{13:1,14:1,15:1,16:1,20:1.004,21:1.24,22:1,23:1},
           2:{13:1,14:1,15:1,16:1,20:1.022,21:1.059,22:1,23:1},
           3:{13:1,14:1,15:1,16:1,18:1,20:1.125,21:1.532,22:1,23:1},
           4:{13:1,14:1,15:1,16:1,17:1,18:1,19:1,20:1,21:1.765,22:1.288,23:1},
           5:{13:1,14:1.009,15:1,16:1,17:1,18:1,19:1,20:1,21:1.143,22:1.27,23:1},
           6:{12:1,13:1,14:1.69,15:1,16:1,17:1,18:1,19:1,20:1.043,21:1.21,22:1,23:1}},
 '10/08': {0:{13:1,14:1,15:1,16:1,20:1,21:1,22:1,23:1},
           1:{13:1,14:1,15:1,16:1,20:1,21:1.24,22:1,23:1},
           2:{13:1,14:1,15:1,16:1,20:1.02,21:1.06,22:1,23:1},
           3:{13:1,14:1,15:1,16:1,18:1,20:1.13,21:1.53,22:1,23:1},
           4:{13:1,14:1,15:1,16:1,17:1,18:1,19:1,20:1,21:1.77,22:1.29,23:1},
           5:{13:1,14:1.01,15:1,16:1,17:1,18:1,19:1,20:1,21:1.14,22:1.27,23:1},
           6:{12:1,13:1,14:1.69,15:1,16:1,17:1,18:1,19:1,20:1.04,21:1.21,22:1,23:1}},
}
DAY_TOTAL_PLATOS = {'03/08':[64,71,78,86,124,123,150], '10/08':[61,67,74,82,118,118,136]}

# ---- FASE 1: dias libres reservados, escalonados, rotando por semana ----
def reserve_days_off(week_key, week_idx, closed_days=()):
    open_days = [d for d in range(7) if d not in closed_days]
    lowest = sorted(open_days, key=lambda d: DAY_TOTAL_PLATOS[week_key][d])[:len(PEOPLE)]
    lowest.sort()
    return {PEOPLE[i]: lowest[(i + week_idx) % len(lowest)] for i in range(len(PEOPLE))}

# ---- FASE 2a: asientos por dia (set-cover exacto: enumeracion de multisets) ----
def seats_for_day(day, demand_h, n_avail):
    need = {h: math.ceil(q - 1e-9) for h, q in demand_h.items() if q > 0 and 12 <= h <= 23}
    floor = PEAK_WD if day < 5 else PEAK_WE
    floor = min(floor, n_avail)                      # honesto: no pedir mas gente de la que hay
    need[PEAK_HOUR] = max(need.get(PEAK_HOUR, 0), floor)
    best = None
    for counts in product(range(3), repeat=4):       # 0..2 de cada plantilla
        seats = [t for t, c in zip(TEMPLATES, counts) for _ in range(c)]
        if not (n_avail <= len(seats) <= n_avail*2): continue
        unc = sum(max(0, n - sum(covers(t, h) for t in seats)) for h, n in need.items())
        tot = sum(DUR[t] for t in seats)
        key = (unc, len(seats), tot)                 # cubrir todo > pocos asientos > pocas horas
        if best is None or key < best[0]: best = (key, seats)
    return best[1], best[0][0]

# ---- FASE 2b: asignacion exacta por backtracking ----
def person_day_options(seats):
    """Particiones de los asientos del dia entre 1 o 2 por persona (legales)."""
    opts = {}
    n = len(seats)
    for mask in range(1, 1 << n):
        chosen = [seats[i] for i in range(n) if mask >> i & 1]
        if len(chosen) > 2: continue
        if sum(DUR[t] for t in chosen) > MAX_DAY_H + 1e-9: continue
        if len(chosen) == 2:
            (a, b) = sorted((TEMPLATES[chosen[0]], TEMPLATES[chosen[1]]))
            if a[1] > b[0] or b[0] - a[1] < SPLIT_GAP: continue   # solape o corte corto
        opts[mask] = chosen
    return opts

def assignments_for_day(seats, avail):
    """Todas las formas de repartir TODOS los asientos entre los disponibles."""
    opts = person_day_options(seats)
    full = (1 << len(seats)) - 1
    out = []
    def rec(i, used, acc):
        if i == len(avail):
            if used == full: out.append(dict(acc))
            return
        p = avail[i]
        rec(i+1, used, acc)                                   # p libra turnos hoy? no: debe currar si hay asiento
        for mask, chosen in opts.items():
            if used & mask: continue
            acc[p] = chosen; rec(i+1, used | mask, acc); del acc[p]
    rec(0, 0, {})
    # sin duplicados por asientos identicos
    seen, uniq = set(), []
    for a in out:
        key = tuple(sorted((p, tuple(sorted(v))) for p, v in a.items()))
        if key not in seen: seen.add(key); uniq.append(a)
    return uniq

def solve_week(week_key, week_idx=0, closed_days=()):
    off = reserve_days_off(week_key, week_idx, closed_days)
    day_data = []
    total_unc = 0
    for d in range(7):
        if d in closed_days:
            day_data.append(None); continue
        avail = [p for p in PEOPLE if off[p] != d]
        seats, unc = seats_for_day(d, DEMAND[week_key][d], len(avail))
        total_unc += unc
        day_data.append((seats, avail, assignments_for_day(seats, avail)))
    best = {'obj': None, 'plan': None}
    hours = {p: 0.0 for p in PEOPLE}; c1 = {p: 0 for p in PEOPLE}; splits = [0]
    plan = []
    def rec(d):
        if d == 7:
            dev = sum(abs(hours[p] - CONTRACT) for p in PEOPLE)
            spread = max(hours.values()) - min(hours.values())
            obj = (round(dev, 2), splits[0], round(spread, 2))
            if best['obj'] is None or obj < best['obj']:
                best['obj'] = obj; best['plan'] = [dict(x) for x in plan] + []
                best['hours'] = dict(hours); best['c1'] = dict(c1); best['splits'] = splits[0]
            return
        if day_data[d] is None:
            plan.append({}); rec(d+1); plan.pop(); return
        seats, avail, assigns = day_data[d]
        for a in assigns:
            ok = True; touched = []
            for p, chosen in a.items():
                h = sum(DUR[t] for t in chosen); nc1 = chosen.count('C1')
                if hours[p] + h > MAX_WEEK_H + 1e-9 or c1[p] + nc1 > 1: ok = False; break
                hours[p] += h; c1[p] += nc1; touched.append((p, h, nc1))
            if ok:
                ns = sum(1 for v in a.values() if len(v) == 2)
                splits[0] += ns; plan.append(a); rec(d+1); plan.pop(); splits[0] -= ns
            for p, h, nc1 in touched: hours[p] -= h; c1[p] -= nc1
    rec(0)
    return off, best, total_unc

def report(week_key, week_idx=0, closed_days=()):
    off, best, unc = solve_week(week_key, week_idx, closed_days)
    print(f"\n=== Semana {week_key} (rotacion #{week_idx}) ===")
    print("Dias libres reservados:", {p: 'LMXJVSD'[d] for p, d in off.items()},
          "| demanda sin cubrir en asientos:", unc)
    if best['plan'] is None: print("SIN SOLUCION"); return
    names = 'Lun Mar Mie Jue Vie Sab Dom'.split()
    for p in PEOPLE:
        row = []
        for d in range(7):
            a = best['plan'][d]
            row.append('+'.join(a[p]) if p in a and a[p] else ('off' if off[p] == d else '--'))
        print(f"  {p:<9}", ' '.join(f'{c:>6}' for c in row), f"| {best['hours'][p]:.2f} h · C1={best['c1'][p]}")
    tot = sum(best['hours'].values())
    print(f"  TOTAL {tot:.2f} h · partidos={best['splits']} · desvio={best['obj'][0]} · spread={best['obj'][2]}")

import time
t0 = time.time()
report('03/08', week_idx=0)   # la semana real publicada (vara de medir)
report('10/08', week_idx=1)   # la semana que viene, rotando descansos
print(f"\n[tiempo total: {time.time()-t0:.2f}s]")
