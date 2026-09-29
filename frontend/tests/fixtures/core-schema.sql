-- 1%: owner-scoped records; all writes use transactional, revision-checked RPCs.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Francesco' check (char_length(btrim(name)) between 1 and 100),
  timezone text not null default 'Europe/Rome',
  theme text not null default 'System' check (theme in ('Light','Dark','System')),
  opening_balance bigint not null default 0 check (abs(opening_balance) <= 1000000000000),
  opening_date date not null default (now() at time zone 'Europe/Rome')::date,
  visible_days integer[] not null default array[1,2,3,4,5,6] check (visible_days <@ array[1,2,3,4,5,6] and cardinality(visible_days) between 1 and 6),
  trading_expanded boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('subject','event','reminder','notification','note','folder','grade','homework','test','subscription','transaction','slot','account','cashflow','trade','screenshot','strategy')),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 5242880),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index records_owner_kind on public.records(user_id,kind,updated_at desc);
create index records_links on public.records using gin (data jsonb_path_ops);
create unique index one_subscription_occurrence on public.records(user_id,(data->>'subscription_id'),(data->>'occurrence_date')) where kind='transaction' and data->>'subscription_id' is not null;
create unique index one_timetable_cell on public.records(user_id,(data->>'day'),(data->>'hour')) where kind='slot';
create unique index one_notification_occurrence on public.records(user_id,(data->>'source_id'),(data->>'occurrence')) where kind='notification';
create unique index one_screenshot_object on public.records(user_id,(data->>'path')) where kind='screenshot';

alter table public.profiles enable row level security;
alter table public.records enable row level security;
create policy own_profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy own_record_read on public.records for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.profiles, public.records from anon, authenticated;
grant select on public.profiles,public.records to authenticated;
grant update(name,timezone,theme,opening_balance,opening_date,visible_days,trading_expanded) on public.profiles to authenticated;

create function private.profile_check() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists (select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Choose a valid timezone.'; end if;
  if new.id <> old.id then raise exception 'Profile ownership cannot change.'; end if;
  new.updated_at := now(); return new;
end $$;
create trigger profile_check before update on public.profiles for each row execute function private.profile_check();
create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id) on conflict(id) do nothing; return new; end $$;
create trigger create_profile after insert on auth.users for each row execute function private.create_profile();
insert into public.profiles(id) select id from auth.users on conflict(id) do nothing;

create function private.require(p_ok boolean,p_message text) returns void language plpgsql immutable set search_path='' as $$
begin if p_ok is distinct from true then raise exception '%',p_message using errcode='22023'; end if; end $$;
create function private.text_field(d jsonb,k text,required boolean default true,maximum integer default 200) returns void language plpgsql immutable set search_path='' as $$
begin
  if not required and (not d ? k or d->k='null'::jsonb) then return; end if;
  perform private.require(jsonb_typeof(d->k)='string' and char_length(d->>k)<=maximum and (not required or char_length(btrim(d->>k))>0),'Invalid '||replace(k,'_',' ')||'.');
end $$;
create function private.numeric_field(d jsonb,k text,minimum numeric,maximum numeric,whole boolean default true,optional boolean default false) returns void language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if optional and (not d ? k or d->k='null'::jsonb) then return; end if;
  perform private.require(jsonb_typeof(d->k)='number','Invalid '||replace(k,'_',' ')||'.');
  n:=(d->>k)::numeric;
  perform private.require(n between minimum and maximum and (not whole or n=trunc(n)),'Invalid '||replace(k,'_',' ')||'.');
end $$;
create function private.date_field(d jsonb,k text,optional boolean default false) returns void language plpgsql immutable set search_path='' as $$
declare v text:=d->>k;
begin
  if optional and v is null then return; end if;
  perform private.require(jsonb_typeof(d->k)='string' and v ~ '^\d{4}-\d{2}-\d{2}$' and v::date::text=v,'Invalid '||replace(k,'_',' ')||'.');
end $$;
create function private.instant_field(d jsonb,k text,optional boolean default false) returns void language plpgsql stable set search_path='' as $$
declare v text:=d->>k;
begin
  if optional and v is null then return; end if;
  perform private.require(jsonb_typeof(d->k)='string' and v ~ '^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$' and isfinite(v::timestamptz),'Invalid '||replace(k,'_',' ')||'.');
end $$;
create function private.enum_field(d jsonb,k text,options text[]) returns void language plpgsql immutable set search_path='' as $$
begin perform private.require(d->>k=any(options),'Invalid '||replace(k,'_',' ')||'.'); end $$;
create function private.reference_field(d jsonb,k text,expected_kind text,owner_id uuid,optional boolean default false) returns void language plpgsql stable set search_path='' as $$
begin
  if optional and d->>k is null then return; end if;
  perform private.require(exists(select 1 from public.records where id=(d->>k)::uuid and user_id=owner_id and kind=expected_kind),'The linked '||expected_kind||' is not available.');
end $$;

create function private.is_occurrence(d jsonb,requested date) returns boolean language plpgsql immutable set search_path='' as $$
declare anchor date:=(d->>'next_date')::date; distance integer; months integer; target date; desired integer;
begin
  if requested < anchor then return false; end if;
  if requested=anchor then return true; end if;
  if d->>'frequency'='Weekly' then return (requested-anchor)%7=0; end if;
  months:=case d->>'frequency' when 'Monthly' then 1 when 'Quarterly' then 3 when 'Yearly' then 12 else 0 end;
  if months=0 then return false; end if;
  distance:=(extract(year from requested)::integer-extract(year from anchor)::integer)*12+extract(month from requested)::integer-extract(month from anchor)::integer;
  if distance%months<>0 then return false; end if;
  desired:=least(coalesce((d->>'anchor_day')::integer,extract(day from anchor)::integer),extract(day from date_trunc('month',requested)+interval '1 month - 1 day')::integer);
  target:=date_trunc('month',requested)::date+desired-1;
  return requested=target;
end $$;

-- Match the native conversion: reject DST gaps and choose the first repeated wall-clock time.
create function private.local_to_utc(wall timestamp,tz text) returns timestamptz language plpgsql stable set search_path='' as $$
declare hour_offset integer; seed timestamptz; candidate timestamptz; result timestamptz; utc_offset interval;
begin
  foreach hour_offset in array array[-36,-12,0,12,36] loop
    seed:=(wall at time zone 'UTC')+make_interval(hours=>hour_offset);
    utc_offset:=(seed at time zone tz)-(seed at time zone 'UTC');
    candidate:=(wall-utc_offset) at time zone 'UTC';
    if candidate at time zone tz=wall and (result is null or candidate<result) then result:=candidate; end if;
  end loop;
  perform private.require(result is not null,'This time does not exist because the clocks change. Choose another time.');
  return result;
end $$;

create function private.validate_record(k text,d jsonb,owner_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare key text; tz text; today date; page jsonb; obj jsonb; sub jsonb;
begin
  perform private.require(jsonb_typeof(d)='object','Invalid record.');
  perform private.require(octet_length(d::text)<=case when k='note' then 5242880 else 100000 end,'This record is too large.');
  select timezone,(now() at time zone timezone)::date into tz,today from public.profiles where id=owner_id;
  perform private.require(tz is not null,'Sign in to continue.');
  foreach key in array array['note','description','entry_rules','exit_rules','risk_rules'] loop perform private.text_field(d,key,false,20000); end loop;
  foreach key in array array['category','provider','location'] loop perform private.text_field(d,key,false,300); end loop;
  if d ? 'color' then perform private.require(d->>'color' ~ '^#[0-9A-Fa-f]{6}$','Choose a valid colour.'); end if;
  if d ? 'archived' then perform private.require(jsonb_typeof(d->'archived')='boolean','Invalid archive state.'); end if;
  if k in ('event','homework','test','subscription') then
    perform private.numeric_field(d,'reminder_minutes',0,525600,true,true);
    d:=jsonb_set(d,'{alert_time}',coalesce(nullif(d->'alert_time','null'::jsonb),'"08:00"'::jsonb));
    perform private.require(d->>'alert_time' ~ '^([01]\d|2[0-3]):[0-5]\d$','Use 24-hour HH:mm format.');
  end if;
  if k in ('reminder','homework','test') then
    if d->>'status' in ('Completed','Done') then d:=jsonb_set(d,'{completed_at}',coalesce(nullif(d->'completed_at','null'::jsonb),to_jsonb(now()))); perform private.instant_field(d,'completed_at');
    else d:=jsonb_set(d,'{completed_at}','null'); end if;
  end if;
  case k
  when 'subject','folder' then perform private.text_field(d,'name');
  when 'event' then
    perform private.text_field(d,'title'); perform private.date_field(d,'date');
    perform private.require(jsonb_typeof(d->'all_day')='boolean','Choose whether the event lasts all day.');
    if (d->>'all_day')::boolean then d:=d||'{"start_at":null,"end_at":null}';
    else perform private.instant_field(d,'start_at'); perform private.instant_field(d,'end_at');
      perform private.require((d->>'end_at')::timestamptz>(d->>'start_at')::timestamptz,'End time must be after start time.');
      perform private.require(((d->>'start_at')::timestamptz at time zone tz)::date=(d->>'date')::date,'The event date must match its start time.');
    end if;
  when 'reminder' then perform private.text_field(d,'title'); perform private.instant_field(d,'due_at'); perform private.enum_field(d,'status',array['Pending','Completed']);
  when 'notification' then
    perform private.text_field(d,'title'); perform private.text_field(d,'occurrence',true,300); perform private.instant_field(d,'due_at'); perform private.instant_field(d,'read_at',true);
    perform private.numeric_field(d,'source_version',1,9007199254740991); perform private.enum_field(d,'source_kind',array['event','reminder','homework','test','subscription']);
    perform private.reference_field(d,'source_id',d->>'source_kind',owner_id);
  when 'note' then
    perform private.text_field(d,'title'); perform private.reference_field(d,'subject_id','subject',owner_id,true); perform private.reference_field(d,'folder_id','folder',owner_id,true); perform private.numeric_field(d,'editor_version',1,1);
    perform private.require(jsonb_typeof(d->'pages')='array' and jsonb_array_length(d->'pages') between 1 and 100,'Notes must contain between 1 and 100 pages.');
    perform private.require((select count(*)=count(distinct p->>'id') from jsonb_array_elements(d->'pages') p),'Page IDs must be unique.');
    for page in select value from jsonb_array_elements(d->'pages') loop
      perform private.text_field(page,'id'); perform private.enum_field(page,'background',array['Blank','Ruled','Grid']);
      perform private.require(page->>'spacing' in ('24','32') and page->>'width'='794' and page->>'height'='1123','Invalid page dimensions.');
      perform private.require(jsonb_typeof(page->'objects')='array' and jsonb_array_length(page->'objects')<=5000,'Too many objects on this page.');
      for obj in select value from jsonb_array_elements(page->'objects') loop
        perform private.require(lower(obj->>'type') in ('textbox','path','line','rect'),'This object type is not supported.');
      end loop;
    end loop;
  when 'grade' then perform private.reference_field(d,'subject_id','subject',owner_id); perform private.numeric_field(d,'value',0,10,false); perform private.date_field(d,'date'); perform private.enum_field(d,'type',array['Written','Oral']);
  when 'homework','test' then
    perform private.text_field(d,'title'); perform private.reference_field(d,'subject_id','subject',owner_id); perform private.date_field(d,'date');
    if d->>'time' is not null then perform private.require(d->>'time' ~ '^([01]\d|2[0-3]):[0-5]\d$','Use 24-hour HH:mm format.'); end if;
    perform private.enum_field(d,'status',case when k='homework' then array['To do','Done'] else array['Scheduled','Completed'] end);
    if k='test' then perform private.enum_field(d,'type',array['Written','Oral']); end if;
  when 'subscription' then
    perform private.text_field(d,'name'); perform private.numeric_field(d,'amount_cents',1,1000000000000); perform private.enum_field(d,'frequency',array['Weekly','Monthly','Quarterly','Yearly']); perform private.date_field(d,'next_date');
    d:=jsonb_set(d,'{anchor_day}',coalesce(nullif(d->'anchor_day','null'),to_jsonb(extract(day from (d->>'next_date')::date)::integer)));
    perform private.numeric_field(d,'anchor_day',1,31); perform private.enum_field(d,'status',array['Active','Paused','Cancelled']);
  when 'transaction' then
    perform private.enum_field(d,'type',array['Income','Expense']); perform private.numeric_field(d,'amount_cents',1,1000000000000); perform private.date_field(d,'date'); perform private.enum_field(d,'status',array['Planned','Recorded','Cancelled']);
    perform private.reference_field(d,'subscription_id','subscription',owner_id,true);
    if d->>'subscription_id' is not null then
      perform private.date_field(d,'occurrence_date'); perform private.require(d->>'type'='Expense','Subscription payments must be expenses.');
    else perform private.require(d->>'occurrence_date' is null,'An occurrence needs a subscription.'); end if;
    if d->>'status'='Recorded' then
      perform private.require((d->>'date')::date<=today,'Future transactions must remain Planned.');
      d:=jsonb_set(d,'{recorded_at}',coalesce(nullif(d->'recorded_at','null'),to_jsonb(now()))); perform private.instant_field(d,'recorded_at');
    else d:=jsonb_set(d,'{recorded_at}','null'); end if;
  when 'slot' then perform private.reference_field(d,'subject_id','subject',owner_id); perform private.numeric_field(d,'day',1,6); perform private.numeric_field(d,'hour',8,13);
  when 'account' then
    perform private.text_field(d,'name'); perform private.enum_field(d,'type',array['Personal','Evaluation','Funded']); perform private.require(d->>'currency' ~ '^[A-Z]{3}$','Use a three-letter currency code.'); perform private.numeric_field(d,'opening_cents',-1000000000000,1000000000000); perform private.date_field(d,'opening_date');
  when 'cashflow' then
    perform private.reference_field(d,'account_id','account',owner_id); perform private.enum_field(d,'type',array['Deposit','Withdrawal']); perform private.numeric_field(d,'amount_cents',1,1000000000000); perform private.date_field(d,'date'); perform private.require((d->>'date')::date<=today,'Cashflows cannot be recorded in the future.');
  when 'trade' then
    perform private.reference_field(d,'account_id','account',owner_id); perform private.reference_field(d,'strategy_id','strategy',owner_id,true); perform private.text_field(d,'instrument',true,40); perform private.enum_field(d,'direction',array['Long','Short']); perform private.enum_field(d,'status',array['Open','Closed']); perform private.instant_field(d,'opened_at');
    d:=jsonb_set(d,'{commission_cents}',coalesce(d->'commission_cents','0')); d:=jsonb_set(d,'{swap_cents}',coalesce(d->'swap_cents','0'));
    perform private.numeric_field(d,'commission_cents',0,1000000000000); perform private.numeric_field(d,'swap_cents',-1000000000000,1000000000000); perform private.numeric_field(d,'risk_cents',0,1000000000000,true,true);
    foreach key in array array['entry_price','exit_price','stop_loss','take_profit','quantity'] loop perform private.numeric_field(d,key,0,1000000000000,false,true); end loop;
    if d->>'status'='Closed' then perform private.instant_field(d,'closed_at'); perform private.numeric_field(d,'gross_cents',-1000000000000,1000000000000); perform private.require((d->>'closed_at')::timestamptz>=(d->>'opened_at')::timestamptz,'Closing time cannot be before opening time.');
    else d:=d||'{"closed_at":null,"gross_cents":null}'; end if;
  when 'screenshot' then
    perform private.text_field(d,'title'); perform private.date_field(d,'date'); perform private.reference_field(d,'trade_id','trade',owner_id,true); perform private.text_field(d,'path',true,300); perform private.enum_field(d,'mime',array['image/png','image/jpeg','image/webp']); perform private.numeric_field(d,'size',1,10485760);
    perform private.require(split_part(d->>'path','/',1)=owner_id::text,'The image belongs to a different account.');
    perform private.require(exists(select 1 from storage.objects where bucket_id='screenshots' and name=d->>'path' and metadata->>'mimetype'=d->>'mime' and (metadata->>'size')::bigint=(d->>'size')::bigint),'Upload a valid image before saving.');
  when 'strategy' then
    perform private.text_field(d,'name'); perform private.require(jsonb_typeof(d->'checklist')='array' and jsonb_array_length(d->'checklist')<=100,'Use up to 100 checklist items.');
    perform private.require(not exists(select 1 from jsonb_array_elements(d->'checklist') item where jsonb_typeof(item)<>'string' or char_length(item#>>'{}')>1000),'Invalid checklist item.');
  else raise exception 'Unknown record type.';
  end case;
  if k in ('homework','test') then perform private.local_to_utc(((d->>'date')||' '||coalesce(d->>'time',d->>'alert_time'))::timestamp,tz); end if;
  if k='event' and (d->>'all_day')::boolean then perform private.local_to_utc(((d->>'date')||' '||(d->>'alert_time'))::timestamp,tz); end if;
  if k='subscription' then perform private.local_to_utc(((d->>'next_date')||' '||(d->>'alert_time'))::timestamp,tz); end if;
  return d;
end $$;

-- Recurring/existing local deadlines move to the first valid minute after a DST gap.
-- User-entered initial deadlines above remain strict, as do explicit UTC event/trade timestamps.
create function private.deadline_to_utc(wall timestamp,tz text) returns timestamptz language plpgsql stable set search_path='' as $$
declare minutes integer;
begin
  for minutes in 0..180 loop
    begin return private.local_to_utc(wall+make_interval(mins=>minutes),tz);
    exception when sqlstate '22023' then null; end;
  end loop;
  raise exception 'This deadline falls in a timezone transition. Choose another alert time.' using errcode='22023';
end $$;

create function private.lock_owner() returns uuid language plpgsql set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'Sign in to continue.' using errcode='42501'; end if;
  -- Serialise only this owner's mutations, including reference checks and folder batches.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0)); return uid;
end $$;
create function public.save_record(p_kind text,p_data jsonb,p_id uuid default null,p_expected_version bigint default null) returns public.records language plpgsql security definer set search_path='' as $$
declare uid uuid; old public.records; saved public.records; normalized jsonb;
begin
  uid:=private.lock_owner();
  if p_id is not null then
    select * into old from public.records where id=p_id and user_id=uid for update;
    if not found then raise exception 'Record not found.' using errcode='42501'; end if;
    if old.version is distinct from p_expected_version then raise exception 'This record changed on another device. Refresh before saving.' using errcode='40001'; end if;
    perform private.require(old.kind=p_kind,'Record type cannot change.');
  end if;
  if p_kind='notification' then
    perform private.require(p_id is not null and (p_data-'read_at')=(old.data-'read_at'),'Notifications can only be created by reconciliation.');
  end if;
  if p_kind='transaction' and p_data->>'subscription_id' is not null then
    perform private.require(p_id is not null and old.data->>'subscription_id'=p_data->>'subscription_id' and old.data->>'occurrence_date'=p_data->>'occurrence_date','Use Mark as paid for subscription payments.');
  end if;
  if p_kind='transaction' and p_id is not null and old.data->>'subscription_id' is not null then
    perform private.require(old.data->>'subscription_id'=p_data->>'subscription_id' and old.data->>'occurrence_date'=p_data->>'occurrence_date','Keep the subscription occurrence linked.');
  end if;
  if p_kind='account' and p_id is not null and old.data->>'currency' is distinct from p_data->>'currency' then
    perform private.require(not exists(select 1 from public.records where user_id=uid and kind in ('trade','cashflow') and data->>'account_id'=p_id::text),'Currency cannot change after account activity.');
  end if;
  normalized:=private.validate_record(p_kind,p_data,uid);
  if p_id is null then insert into public.records(user_id,kind,data) values(uid,p_kind,normalized) returning * into saved;
  else update public.records set data=normalized,version=version+1,updated_at=now() where id=p_id returning * into saved; end if;
  -- Future notifications for an edited source are invalid until native reconciliation.
  delete from public.records where user_id=uid and kind='notification' and data->>'source_id'=saved.id::text and (data->>'due_at')::timestamptz>now() and (data->>'source_version')::bigint<>saved.version;
  return saved;
end $$;

create function public.move_notes(p_ids uuid[],p_folder_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
  uid:=private.lock_owner(); perform private.require(cardinality(p_ids) between 1 and 1000,'Select between 1 and 1,000 notes.');
  if p_folder_id is not null then perform private.reference_field(jsonb_build_object('folder_id',p_folder_id),'folder_id','folder',uid); end if;
  perform private.require((select count(*) from public.records where id=any(p_ids) and user_id=uid and kind='note')=(select count(distinct id) from unnest(p_ids) id),'One or more notes are not available.');
  update public.records set data=jsonb_set(data,'{folder_id}',coalesce(to_jsonb(p_folder_id),'null')),version=version+1,updated_at=now() where id=any(p_ids) and user_id=uid and kind='note';
end $$;
create function public.delete_record(p_id uuid,p_expected_version bigint) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; old public.records; link text;
begin
  uid:=private.lock_owner(); select * into old from public.records where id=p_id and user_id=uid for update;
  if not found then raise exception 'Record not found.' using errcode='42501'; end if;
  if old.version is distinct from p_expected_version then raise exception 'This record changed on another device. Refresh before deleting.' using errcode='40001'; end if;
  if old.kind in ('subject','account','strategy','subscription') then
    link:=case old.kind when 'subject' then 'subject_id' when 'account' then 'account_id' when 'strategy' then 'strategy_id' else 'subscription_id' end;
    perform private.require(not exists(select 1 from public.records where user_id=uid and data->>link=p_id::text and kind<>'notification'),'This item has history. Archive it instead.');
  end if;
  if old.kind='folder' then update public.records set data=jsonb_set(data,'{folder_id}','null'),version=version+1,updated_at=now() where user_id=uid and kind='note' and data->>'folder_id'=p_id::text; end if;
  if old.kind='trade' then update public.records set data=jsonb_set(data,'{trade_id}','null'),version=version+1,updated_at=now() where user_id=uid and kind='screenshot' and data->>'trade_id'=p_id::text; end if;
  delete from public.records where user_id=uid and kind='notification' and data->>'source_id'=p_id::text;
  delete from public.records where id=p_id and user_id=uid;
end $$;

create function public.pay_subscription(p_id uuid,p_date date) returns public.records language plpgsql security definer set search_path='' as $$
declare uid uuid; sub public.records; payment public.records; d jsonb; today date;
begin
  uid:=private.lock_owner(); select * into sub from public.records where id=p_id and user_id=uid and kind='subscription' for update;
  if not found then raise exception 'Subscription not found.' using errcode='42501'; end if;
  select * into payment from public.records where user_id=uid and kind='transaction' and data->>'subscription_id'=p_id::text and data->>'occurrence_date'=p_date::text for update;
  if found and payment.data->>'status'='Recorded' then return payment; end if;
  select (now() at time zone timezone)::date into today from public.profiles where id=uid;
  perform private.require(p_date is not null and p_date<=today,'A future renewal cannot be marked as paid.');
  if payment.id is null then
    perform private.require(sub.data->>'status'='Active' and not coalesce((sub.data->>'archived')::boolean,false),'Reactivate this subscription before recording a new payment.');
    perform private.require(private.is_occurrence(sub.data,p_date),'Choose an actual subscription renewal date.');
    d:=jsonb_build_object('type','Expense','amount_cents',sub.data->'amount_cents','date',p_date,'category',coalesce(sub.data->>'category','Subscriptions'),'description',sub.data->>'name','status','Recorded','subscription_id',p_id,'occurrence_date',p_date,'recorded_at',now());
    d:=private.validate_record('transaction',d,uid);
    insert into public.records(user_id,kind,data) values(uid,'transaction',d) returning * into payment;
  else
    d:=private.validate_record('transaction',payment.data||jsonb_build_object('status','Recorded','recorded_at',now()),uid);
    update public.records set data=d,version=version+1,updated_at=now() where id=payment.id returning * into payment;
  end if;
  delete from public.records where user_id=uid and kind='notification' and data->>'source_id'=p_id::text and data->>'occurrence'=p_date::text and (data->>'due_at')::timestamptz>now();
  return payment;
end $$;

create function public.sync_notifications(p_items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; item jsonb; source public.records; expected timestamptz; tz text; occurrence date; normalized jsonb; seen text[]:=array[]::text[];
begin
  uid:=private.lock_owner(); select timezone into tz from public.profiles where id=uid;
  perform private.require(jsonb_typeof(p_items)='array' and jsonb_array_length(p_items)<=2048,'More than 2,048 reminders are pending in this period. Reduce the number of active reminders before synchronising.');
  for item in select value from jsonb_array_elements(p_items) loop
    normalized:=private.validate_record('notification',item,uid);
    select * into source from public.records where id=(item->>'source_id')::uuid and user_id=uid;
    perform private.require(source.version=(item->>'source_version')::bigint,'Refresh changed reminders before scheduling.');
    if source.kind='reminder' then
      perform private.require(source.data->>'status'='Pending','This reminder is complete.'); expected:=(source.data->>'due_at')::timestamptz;
    else
      perform private.require(source.data->>'reminder_minutes' is not null,'This item has no reminder.');
      if source.kind='event' then
        expected:=case when (source.data->>'all_day')::boolean then private.deadline_to_utc(((source.data->>'date')||' '||(source.data->>'alert_time'))::timestamp,tz) else (source.data->>'start_at')::timestamptz end;
      elsif source.kind in ('homework','test') then
        perform private.require(source.data->>'status' in ('To do','Scheduled'),'This item is complete.');
        expected:=private.deadline_to_utc(((source.data->>'date')||' '||coalesce(source.data->>'time',source.data->>'alert_time'))::timestamp,tz);
      else
        perform private.require(source.data->>'status'='Active' and not coalesce((source.data->>'archived')::boolean,false),'This subscription is inactive.');
        occurrence:=(item->>'occurrence')::date; perform private.require(private.is_occurrence(source.data,occurrence),'Invalid renewal date.');
        perform private.require(not exists(select 1 from public.records where user_id=uid and kind='transaction' and data->>'subscription_id'=source.id::text and data->>'occurrence_date'=occurrence::text and data->>'status'='Recorded'),'This renewal is already paid.');
        expected:=private.deadline_to_utc((occurrence::text||' '||(source.data->>'alert_time'))::timestamp,tz);
      end if;
      expected:=expected-make_interval(mins=>(source.data->>'reminder_minutes')::integer);
    end if;
    perform private.require((item->>'due_at')::timestamptz=expected,'The reminder time does not match its source.');
    if source.kind<>'subscription' then perform private.require((item->>'occurrence')::timestamptz=expected,'Invalid reminder occurrence.'); end if;
    -- Canonicalise equivalent timestamps before deduplication, so offsets cannot create duplicate occurrences.
    normalized:=normalized||jsonb_build_object('title',coalesce(source.data->>'title',source.data->>'name'),'read_at',null,'due_at',to_char(expected at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'occurrence',case when source.kind='subscription' then occurrence::text else to_char(expected at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
    insert into public.records(user_id,kind,data) values(uid,'notification',normalized)
      on conflict(user_id,(data->>'source_id'),(data->>'occurrence')) where kind='notification'
      do update set data=excluded.data||jsonb_build_object('read_at',records.data->'read_at'),version=records.version+1,updated_at=now();
    seen:=array_append(seen,(normalized->>'source_id')||'/'||(normalized->>'occurrence'));
  end loop;
  delete from public.records where user_id=uid and kind='notification' and (data->>'due_at')::timestamptz>now() and not ((data->>'source_id')||'/'||(data->>'occurrence')=any(seen));
end $$;

-- Objects are written only by the authenticated validation Edge Function. Direct uploads and replacements are denied.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('screenshots','screenshots',false,10485760,array['image/png','image/jpeg','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy screenshot_owner_read on storage.objects for select to authenticated using(bucket_id='screenshots' and split_part(name,'/',1)=(select auth.uid())::text);
create policy screenshot_owner_delete on storage.objects for delete to authenticated using(bucket_id='screenshots' and split_part(name,'/',1)=(select auth.uid())::text and not exists(select 1 from public.records where user_id=(select auth.uid()) and kind='screenshot' and data->>'path'=name));

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.save_record(text,jsonb,uuid,bigint),public.delete_record(uuid,bigint),public.move_notes(uuid[],uuid),public.pay_subscription(uuid,date),public.sync_notifications(jsonb) from public,anon;
grant execute on function public.save_record(text,jsonb,uuid,bigint),public.delete_record(uuid,bigint),public.move_notes(uuid[],uuid),public.pay_subscription(uuid,date),public.sync_notifications(jsonb) to authenticated;
