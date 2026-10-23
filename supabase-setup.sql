-- VELMONT: запустите этот файл один раз в Supabase (SQL Editor → New query → вставить → Run)

-- 1. Таблица, где хранятся товары, настройки и заказы
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- Закрываем таблицу от доступа из браузера: сайт обращается к ней только с сервера
alter table public.kv enable row level security;

-- 2. Публичное хранилище для фото и видео
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = true;
