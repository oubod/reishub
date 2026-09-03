drop policy if exists "users upload own active ai sources" on storage.objects;
create policy "users upload own active ai sources"
on storage.objects for insert to authenticated
with check (
  bucket_id='mauritania-ai-inputs'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists (
    select 1 from public.mauritania_ai_jobs job
    where job.user_id=(select auth.uid())
      and job.input_path=storage.objects.name
      and job.status='uploading'
  )
);
