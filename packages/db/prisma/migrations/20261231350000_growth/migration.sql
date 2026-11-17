-- Review step 4 (growth): lists push search, filters, sorting and paging into the database.

-- Orders list: newest first without a status or merchant to start from.
CREATE INDEX "orders_placed_at_idx" ON "orders"("placed_at");

-- Typed search as the web and the API fold it (foldSearch in packages/shared/src/list-view.ts):
-- compatibility decomposition (NFKD) and lower case, Arabic marks (U+064B to U+0670 and
-- U+065F) removed, alef forms to bare alef, alef maqsura to yaa, taa marbuta to haa. A word of
-- the search (never containing a space) is found when it is inside the folded text.
CREATE OR REPLACE FUNCTION sn_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(
    regexp_replace(
      lower(normalize(coalesce(t, ''), NFKD)),
      '[' || chr(1611) || '-' || chr(1648) || chr(1631) || ']',
      '',
      'g'
    ),
    chr(1571) || chr(1573) || chr(1570) || chr(1609) || chr(1577),
    chr(1575) || chr(1575) || chr(1575) || chr(1610) || chr(1607)
  )
$$;
