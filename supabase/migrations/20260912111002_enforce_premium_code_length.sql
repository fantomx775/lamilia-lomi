-- Keep the database/RPC boundary aligned with the normalized request contract.
-- This intentionally fails closed if an existing normalized code is invalid.
alter table public.premium_codes
  drop constraint if exists premium_codes_normalized_code_length_check;

alter table public.premium_codes
  add constraint premium_codes_normalized_code_length_check
  check (char_length(normalized_code) between 1 and 128);
