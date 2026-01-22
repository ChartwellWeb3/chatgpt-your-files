select name, bucket_id, path_tokens
from storage.objects
order by created_at desc
limit 5;
