-- 1. Create the trigger on the storage.objects table
create trigger on_file_upload
after insert on storage.objects
for each row
execute function private.handle_storage_update();