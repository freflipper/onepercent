-- Additive compatibility for the Emergent editor. No existing rows are rewritten.
-- Apply after 202609280001_core.sql, once reviewed. v1 keeps its existing wire format.
begin;

-- MD5 of pg_proc.prosrc for private.validate_record(text,jsonb,uuid), extracted
-- unchanged from 202609280001_core.sql (UTF-8, LF). Refuse to overwrite a newer
-- or independently changed validator; review that database before proceeding.
do $$
declare baseline_md5 text;
begin
  select md5(p.prosrc) into baseline_md5
  from pg_catalog.pg_proc p
  where p.oid=pg_catalog.to_regprocedure('private.validate_record(text,jsonb,uuid)');
  if baseline_md5 is distinct from '161e61cc0c5f01910b1bec8081b643d9' then
    raise exception 'Database validation differs from the expected core baseline. Review the database before applying the Emergent compatibility migration.' using errcode='55000';
  end if;
end $$;

create function private.validate_emergent_note(d jsonb, owner_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare page jsonb; obj jsonb; point jsonb; coordinate jsonb; key text;
begin
  perform private.require(jsonb_typeof(d)='object' and octet_length(d::text)<=5242880,'This note is too large or invalid.');
  perform private.require(not exists(select 1 from jsonb_object_keys(d) field where field <> all(array['title','subject_id','folder_id','editor_version','pages'])),'Unknown note field.');
  perform private.text_field(d,'title',true,180);
  perform private.reference_field(d,'subject_id','subject',owner_id,true);
  perform private.reference_field(d,'folder_id','folder',owner_id,true);
  perform private.numeric_field(d,'editor_version',2,2);
  perform private.require(jsonb_typeof(d->'pages')='array','Invalid note pages.');
  perform private.require(jsonb_array_length(d->'pages') between 1 and 100,'Notes must contain between 1 and 100 pages.');
  perform private.require((select count(*)=count(distinct p->>'id') from jsonb_array_elements(d->'pages') p),'Page IDs must be unique.');
  for page in select value from jsonb_array_elements(d->'pages') loop
    perform private.require(jsonb_typeof(page)='object','Invalid note page.');
    perform private.require(not exists(select 1 from jsonb_object_keys(page) field where field <> all(array['id','background','spacing','objects','width','height'])),'Unknown page field.');
    perform private.text_field(page,'id',true,100);
    perform private.require(page->>'id' ~ '^[A-Za-z0-9_-]+$','Invalid page ID.');
    perform private.enum_field(page,'background',array['Blank','Ruled','Grid']);
    perform private.numeric_field(page,'spacing',24,36);
    perform private.require(page->>'spacing' in ('24','36'),'Invalid paper spacing.');
    if page ? 'width' then perform private.numeric_field(page,'width',600,600); end if;
    if page ? 'height' then perform private.numeric_field(page,'height',840,840); end if;
    perform private.require(jsonb_typeof(page->'objects')='array','Invalid page objects.');
    perform private.require(jsonb_array_length(page->'objects')<=2000,'Too many objects on this page.');
    perform private.require((select count(*)=count(distinct o->>'id') from jsonb_array_elements(page->'objects') o),'Object IDs must be unique on each page.');
    for obj in select value from jsonb_array_elements(page->'objects') loop
      perform private.require(jsonb_typeof(obj)='object','Invalid note object.');
      perform private.require(not exists(select 1 from jsonb_object_keys(obj) field where field <> all(array['id','type','x','y','text','width','size','color','bold','italic','underline','align','opacity','points'])),'Unknown object field.');
      perform private.text_field(obj,'id',true,100);
      perform private.require(obj->>'id' ~ '^[A-Za-z0-9_-]+$','Invalid object ID.');
      perform private.enum_field(obj,'type',array['text','stroke']);
      perform private.numeric_field(obj,'x',0,600,false);
      perform private.numeric_field(obj,'y',0,840,false);
      perform private.numeric_field(obj,'size',1,100,false);
      perform private.require(jsonb_typeof(obj->'color')='string' and obj->>'color' ~ '^#[0-9A-Fa-f]{6}$','Invalid ink colour.');
      if obj ? 'width' or obj->>'type'='text' then perform private.numeric_field(obj,'width',20,600,false); end if;
      if obj ? 'opacity' then perform private.numeric_field(obj,'opacity',0,1,false); end if;
      if obj ? 'text' or obj->>'type'='text' then
        perform private.require(jsonb_typeof(obj->'text')='string' and char_length(obj->>'text')<=20000,'Invalid note text.');
      end if;
      foreach key in array array['bold','italic','underline'] loop
        if obj ? key then perform private.require(jsonb_typeof(obj->key)='boolean','Invalid text style.'); end if;
      end loop;
      if obj ? 'align' then perform private.enum_field(obj,'align',array['left','center','right']); end if;
      if obj ? 'points' or obj->>'type'='stroke' then
        perform private.require(jsonb_typeof(obj->'points')='array','Invalid stroke points.');
        perform private.require(jsonb_array_length(obj->'points')<=20000 and (obj->>'type'<>'stroke' or jsonb_array_length(obj->'points')>0),'Invalid stroke length.');
        for point in select value from jsonb_array_elements(obj->'points') loop
          perform private.require(jsonb_typeof(point)='array','Invalid stroke point.');
          perform private.require(jsonb_array_length(point) in (2,3),'Invalid stroke point.');
          for coordinate in select value from jsonb_array_elements(point) loop
            perform private.require(jsonb_typeof(coordinate)='number','Invalid stroke coordinate.');
            perform private.require((coordinate#>>'{}')::numeric between -10000 and 10000,'Invalid stroke coordinate.');
          end loop;
          if jsonb_array_length(point)=3 then perform private.require((point->>2)::numeric between 0 and 1,'Invalid stroke pressure.'); end if;
        end loop;
      end if;
    end loop;
  end loop;
  return d;
end $$;

-- Keep the established Monday=1 numbering. Emergent's 0..6 UI is mapped by its facade.
alter table public.profiles drop constraint profiles_visible_days_check;
alter table public.profiles add constraint profiles_visible_days_check
  check (visible_days <@ array[1,2,3,4,5,6,7] and cardinality(visible_days) between 1 and 7);
create function private.profile_days_check() returns trigger language plpgsql set search_path='' as $$
begin
  if cardinality(new.visible_days) <> (select count(distinct day) from unnest(new.visible_days) day) then
    raise exception 'Choose unique visible weekdays.' using errcode='22023';
  end if;
  return new;
end $$;
create trigger profile_days_check before insert or update of visible_days on public.profiles
  for each row execute function private.profile_days_check();

-- The validator below is the original definition, with only the note-v2 branch and day=7
-- addition. Keeping the complete body makes every retained validation reviewable.

create or replace function private.validate_record(k text,d jsonb,owner_id uuid) returns jsonb language plpgsql set search_path='' as $$
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
    if d->>'editor_version'='2' then d:=private.validate_emergent_note(d,owner_id);
    else
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
    end if;
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
  when 'slot' then perform private.reference_field(d,'subject_id','subject',owner_id); perform private.numeric_field(d,'day',1,7); perform private.numeric_field(d,'hour',8,13);
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


-- Generic updates may edit either supported format, but never silently convert an existing note.
create function private.note_format_check() returns trigger language plpgsql set search_path='' as $$
begin
  if old.kind='note' and old.data->>'editor_version' is distinct from new.data->>'editor_version' then
    raise exception 'A notebook cannot change editor format. Create a separate notebook instead.' using errcode='22023';
  end if;
  return new;
end $$;
create trigger note_format_check before update of data on public.records
  for each row execute function private.note_format_check();

revoke all on function private.validate_emergent_note(jsonb,uuid), private.profile_days_check(), private.note_format_check() from public,anon,authenticated;
commit;
