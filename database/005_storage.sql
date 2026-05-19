-- =============================================================================
-- Storage buckets + policies
-- =============================================================================
-- Apply sau 001-004. Idempotent — re-run safe.
--
-- Lưu ý: Supabase Dashboard cũng có UI tạo bucket, nhưng SQL approach đảm bảo
-- config (file_size_limit, allowed_mime_types) version-controlled cùng repo.
-- =============================================================================

-- safe-receipts: ảnh hóa đơn cho safe_transactions. Owner only.
-- Storage path convention: 'safe-receipts/{transaction_id}/{uuid}.{ext}'
-- → n8n Phase 2 parse được transaction_id từ path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'safe-receipts',
  'safe-receipts',
  false,                                                     -- private bucket
  5242880,                                                   -- 5 MB / file
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies (mirror table-level RLS pattern: owner only).
-- Note: storage.objects RLS sử dụng public.app_role() helper từ 002_functions.sql
-- → MUST apply 002 trước 005.

drop policy if exists "safe-receipts owner read" on storage.objects;
create policy "safe-receipts owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'safe-receipts' and public.app_role() = 'owner');

drop policy if exists "safe-receipts owner write" on storage.objects;
create policy "safe-receipts owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'safe-receipts' and public.app_role() = 'owner');

drop policy if exists "safe-receipts owner delete" on storage.objects;
create policy "safe-receipts owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'safe-receipts' and public.app_role() = 'owner');
