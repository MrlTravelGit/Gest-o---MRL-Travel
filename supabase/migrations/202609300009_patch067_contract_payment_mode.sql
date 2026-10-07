begin;

alter table public.client_contracts
  add column if not exists payment_mode text not null default 'calculated';

do $$ begin
  alter table public.client_contracts
    add constraint client_contracts_payment_mode_valid
    check (payment_mode in ('calculated', 'up_to_12_with_fees'));
exception when duplicate_object then null; end $$;

-- Contratos anteriores continuam explicitamente no modelo de parcela fixa.
update public.client_contracts
set contract_data = contract_data || jsonb_build_object('forma_parcelamento', payment_mode)
where not contract_data ? 'forma_parcelamento';

commit;
