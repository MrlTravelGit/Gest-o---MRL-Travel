begin;

alter table public.client_contracts
  add column if not exists include_courtesy_ticket boolean not null default false;

update public.client_contracts
set contract_data = contract_data || jsonb_build_object('include_courtesy_ticket', include_courtesy_ticket)
where not contract_data ? 'include_courtesy_ticket';

commit;
