alter table public.chores
add column if not exists rotation_order uuid[] default '{}';

alter table public.chores
add column if not exists rotation_index integer default 0;

-- Only add the constraint if it is not already there, so this file can be
-- rerun without a "constraint already exists" error.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chores_rotation_index_nonnegative'
      and conrelid = 'public.chores'::regclass
  ) then
    alter table public.chores
      add constraint chores_rotation_index_nonnegative
      check (rotation_index >= 0);
  end if;
end;
$$;