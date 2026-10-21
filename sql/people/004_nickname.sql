-- 外号: people.nickname, the one phrase a reader recognises a blogger by
-- ("Claude Code 之父", "龙虾作者"). Shown after the name in the 动态 stream,
-- so a reader who does not know the name still knows who is talking. Short
-- by rule (at most 16 characters) so it stays on the name's line.
-- Re-running is safe.

alter table public.people
  add column if not exists nickname text
    check (char_length(btrim(nickname)) between 1 and 16);

-- updated_at dates the person page in the sitemap. The nickname is not on that
-- page, so (like the photo) changing it must not make the page look edited.
create or replace function public.people_touch_updated_at() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'avatar_url' - 'nickname' - 'updated_at') is distinct from (to_jsonb(old) - 'avatar_url' - 'nickname' - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;
