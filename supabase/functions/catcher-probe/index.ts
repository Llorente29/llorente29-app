// DESACTIVADA — era una sonda de diagnóstico temporal (Catcher). Sin uso.
Deno.serve(() => new Response(JSON.stringify({ disabled: true }), { status: 410, headers: { "Content-Type": "application/json" } }));
