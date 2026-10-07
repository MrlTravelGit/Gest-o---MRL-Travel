-- PATCH 068 - Michael como signatário da contratada, separado das testemunhas.

begin;

alter table public.contract_signature_signers
  add column if not exists signer_role text;

update public.contract_signature_signers
set signer_role = case
  when lower(coalesce(email, '')) = 'mick_felipebh@hotmail.com' then 'contractor_signer'
  when action = 'SIGN_AS_A_WITNESS' then 'witness'
  else 'client_signer'
end
where signer_role is null;

alter table public.contract_signature_signers
  alter column signer_role set default 'client_signer',
  alter column signer_role set not null;

alter table public.contract_signature_signers
  drop constraint if exists contract_signature_signer_role_valid;

alter table public.contract_signature_signers
  add constraint contract_signature_signer_role_valid
  check (signer_role in ('client_signer', 'contractor_signer', 'witness'));

commit;
