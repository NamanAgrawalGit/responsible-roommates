alter table public.chores
add column if not exists rotation_order uuid[] default '{}';

alter table public.chores
add column if not exists rotation_index integer default 0;

alter table public.chores
add constraint chores_rotation_index_nonnegative
check (rotation_index >= 0);