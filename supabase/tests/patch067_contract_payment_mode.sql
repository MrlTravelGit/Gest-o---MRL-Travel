begin;
select plan(3);

select has_column('public', 'client_contracts', 'payment_mode', 'modalidade de parcelamento é persistida');
select col_default_is('public', 'client_contracts', 'payment_mode', '''calculated''::text', 'contratos legados usam parcela calculada');
select col_not_null('public', 'client_contracts', 'payment_mode', 'modalidade é obrigatória');

select * from finish();
rollback;
