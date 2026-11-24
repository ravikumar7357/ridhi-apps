-- =====================================================================================
-- Flowmerce · schema flowmerce · file 11 · sign-in with Supabase Auth (owner decision 24 Nov 2026)
--
-- How people get access
--   1. An owner/admin adds an invite (email + role + stores) in flowmerce.invite.
--   2. The person signs in with Supabase Auth (Google, or an emailed invite / magic link).
--   3. As soon as their email is CONFIRMED, the trigger below turns the invite into a flowmerce.member row.
--   Signing in without an invite creates an auth user that can see nothing (every policy needs membership).
--   An unconfirmed email never gets access, so nobody can claim an invite by typing someone else's address.
-- =====================================================================================

create table flowmerce.invite (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references flowmerce.workspace(id) on delete cascade,
  email            extensions.citext not null,
  display_name     text,
  role             text not null default 'viewer' check (role in ('owner','admin','manager','editor','viewer')),
  title            text,
  can_see_costs    boolean not null default false,
  all_stores       boolean not null default true,
  store_ids        uuid[] not null default '{}',          -- used when all_stores = false
  sections         text[] not null default '{home,shipping,seo,cro,ads}',
  team_codes       text[] not null default '{}',          -- flowmerce.team.code values to join
  invited_by       uuid,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '14 days',
  accepted_at      timestamptz,
  accepted_user_id uuid,
  revoked_at       timestamptz
);
create unique index invite_one_open on flowmerce.invite (workspace_id, email)
  where accepted_at is null and revoked_at is null;

-- Turn every open invite for this confirmed email into membership. Returns how many were accepted.
create or replace function flowmerce.accept_invites(p_user uuid, p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  i flowmerce.invite;
  n integer := 0;
begin
  perform set_config('flowmerce.actor', 'system:invite_accept', true);
  for i in
    select * from flowmerce.invite
    where lower(email::text) = lower(p_email) and accepted_at is null and revoked_at is null and expires_at > now()
    for update
  loop
    insert into flowmerce.member (workspace_id, user_id, display_name, role, title, can_see_costs, all_stores, sections)
    values (i.workspace_id, p_user, coalesce(i.display_name, split_part(p_email, '@', 1)), i.role, i.title,
            i.can_see_costs, i.all_stores, i.sections)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role, title = coalesce(excluded.title, flowmerce.member.title),
          can_see_costs = excluded.can_see_costs, all_stores = excluded.all_stores,
          sections = excluded.sections, is_active = true;

    if not i.all_stores then
      insert into flowmerce.member_store (workspace_id, user_id, store_id)
      select i.workspace_id, p_user, s.id from flowmerce.store s
      where s.workspace_id = i.workspace_id and s.id = any (i.store_ids)
      on conflict do nothing;
    end if;

    insert into flowmerce.team_member (team_id, workspace_id, user_id)
    select t.id, i.workspace_id, p_user from flowmerce.team t
    where t.workspace_id = i.workspace_id and t.code = any (i.team_codes)
    on conflict do nothing;

    update flowmerce.invite set accepted_at = now(), accepted_user_id = p_user where id = i.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- When a Supabase Auth user is created or confirms their email
create or replace function flowmerce.on_auth_user_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    begin
      perform flowmerce.accept_invites(new.id, new.email);
    exception when others then
      -- never block a sign-in because of Flowmerce; the invite stays open and can be retried
      raise warning 'flowmerce.accept_invites failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

create trigger flowmerce_accept_invites
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function flowmerce.on_auth_user_change();

-- When an invite is added for someone who already has a confirmed account
create or replace function flowmerce.on_invite_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  select au.id into u from auth.users au
  where lower(au.email) = lower(new.email::text) and au.email_confirmed_at is not null
  limit 1;
  if u is not null then
    perform flowmerce.accept_invites(u, new.email::text);
  end if;
  return null;
end $$;

create trigger invite_accept_existing after insert on flowmerce.invite
  for each row execute function flowmerce.on_invite_insert();

-- What the signed-in person can open (the app reads this right after login)
create or replace view flowmerce.my_access with (security_invoker = true) as
select m.workspace_id, w.name as workspace_name, m.role, m.title, m.can_see_costs, m.sections,
       s.id as store_id, s.code as store, s.name as store_name
from flowmerce.member m
join flowmerce.workspace w on w.id = m.workspace_id
join flowmerce.store s on s.workspace_id = m.workspace_id
where m.user_id = auth.uid() and m.is_active
  and (m.all_stores or exists (select 1 from flowmerce.member_store ms
                               where ms.workspace_id = m.workspace_id and ms.user_id = m.user_id and ms.store_id = s.id));

-- security + audit
alter table flowmerce.invite enable row level security;
grant select, insert, update, delete on flowmerce.invite to authenticated;
grant all on flowmerce.invite to service_role;
create policy read_own on flowmerce.invite for select to authenticated using (flowmerce.is_admin(workspace_id));
create policy write_admin on flowmerce.invite for all to authenticated
  using (flowmerce.is_admin(workspace_id))
  with check (flowmerce.is_admin(workspace_id)
              and (role <> 'owner' or flowmerce.member_role(workspace_id) = 'owner'));   -- only an owner can invite an owner
create trigger audit_invite after insert or update or delete on flowmerce.invite
  for each row execute function flowmerce.audit_row();

grant select on flowmerce.my_access to authenticated, service_role;
revoke all on flowmerce.my_access from anon;
revoke execute on function flowmerce.accept_invites(uuid, text), flowmerce.on_auth_user_change(), flowmerce.on_invite_insert()
  from public, anon, authenticated;
grant execute on function flowmerce.accept_invites(uuid, text) to service_role;

-- First owner (run once, with the owner's real email):
--   insert into flowmerce.invite (workspace_id, email, display_name, role, can_see_costs)
--   select id, '<owner email>', 'Owner', 'owner', true from flowmerce.workspace where slug = 'ridhi';
