-- 在 Supabase SQL Editor 中执行。可重复运行。
begin;
create table if not exists public.memory_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '' check (char_length(nickname) <= 40),
  hometown text not null default '' check (char_length(hometown) <= 80),
  bio text not null default '' check (char_length(bio) <= 500)
);
create table if not exists public.memory_collections (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('memories','topics')),
  data jsonb not null default '[]'::jsonb check (jsonb_typeof(data) = 'array'),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id,kind),
  constraint collection_size check (octet_length(data::text) <= 20971520)
);
alter table public.memory_profiles enable row level security;
alter table public.memory_collections enable row level security;
revoke all on public.memory_profiles, public.memory_collections from anon;
grant select, insert, update, delete on public.memory_profiles, public.memory_collections to authenticated;
drop policy if exists own_profile on public.memory_profiles;
create policy own_profile on public.memory_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists own_collections on public.memory_collections;
create policy own_collections on public.memory_collections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- 版本检查避免两个设备静默覆盖彼此的修改。函数使用调用者权限和 RLS。
create or replace function public.save_memory_collection(p_kind text, p_data jsonb, p_expected_version bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_version bigint;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_kind not in ('memories','topics') or jsonb_typeof(p_data) <> 'array' or p_expected_version < 0 then
    raise exception 'INVALID_COLLECTION';
  end if;
  if p_expected_version = 0 then
    insert into public.memory_collections(user_id,kind,data,version)
    values(auth.uid(),p_kind,p_data,1) on conflict do nothing returning version into next_version;
  else
    update public.memory_collections set data=p_data, version=version+1, updated_at=now()
    where user_id=auth.uid() and kind=p_kind and version=p_expected_version
    returning version into next_version;
  end if;
  if next_version is null then raise exception 'VERSION_CONFLICT'; end if;
  return next_version;
end;
$$;
revoke all on function public.save_memory_collection(text,jsonb,bigint) from public, anon;
grant execute on function public.save_memory_collection(text,jsonb,bigint) to authenticated;
commit;
