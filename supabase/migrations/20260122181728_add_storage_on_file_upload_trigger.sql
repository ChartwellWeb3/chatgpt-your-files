DROP TRIGGER IF EXISTS on_file_upload ON storage.objects;

CREATE TRIGGER on_file_upload
AFTER INSERT ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION private.handle_storage_update();
