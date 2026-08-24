-- PATCH MRL 029 (parte 1/2)
-- Novos valores precisam ser confirmados antes de serem usados por outra transacao.

alter type public.travel_interest_status add value if not exists 'waiting';
alter type public.travel_interest_status add value if not exists 'in_progress';
alter type public.travel_interest_status add value if not exists 'completed';
