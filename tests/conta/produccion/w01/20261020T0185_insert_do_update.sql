insert into public.payment_term (code, name) values ('w01', 'Ejemplo') on conflict (code) do update set name = excluded.name;
