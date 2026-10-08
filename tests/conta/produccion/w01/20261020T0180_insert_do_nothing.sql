-- Ejemplo W01: valores de serie con on conflict do nothing (añadir) y do update (reescribe).
insert into public.payment_term (code, name) values ('w01', 'Ejemplo') on conflict (code) do nothing;
