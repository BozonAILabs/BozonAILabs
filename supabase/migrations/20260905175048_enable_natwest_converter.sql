-- Enable the first, deliberately narrow product scope. The legacy column name is
-- an operational bank allowlist, not certification of every bank statement format.
-- Auth and server credentials are still required. Do not overwrite operator settings.
update public.converter_settings
set enabled = true, validated_banks = array['NatWest']
where id and not enabled and cardinality(validated_banks) = 0;
