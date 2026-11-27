-- FIX (16 Nov): the lists' ready text was kept UNCOMPRESSED — on the small server the biggest lists then meant ~25 MB of disk
-- reading at once (ten lists 16 s). Kept compressed with lz4 now (~8× less to read, unpacks at memory speed). Same as in
-- sync_engine.sql. Paste into ERP data → Run. The last line shows how big the ready text is on disk now.
alter table core.rt_cache alter column txt set storage extended;
alter table core.rt_cache alter column txt set compression lz4;
-- every ready text written again, so it is stored compressed (a copy of the same text is a new value)
update core.rt_cache set txt = txt || '' where txt is not null;
analyze core.rt_cache;
select 'PASS' as result, count(*) as lists, round(sum(octet_length(txt)) / 1e6, 1) as text_mb,
       round(sum(pg_column_size(txt)) / 1e6, 1) as on_disk_mb, max(pg_column_compression(txt)) as compression
from core.rt_cache;
