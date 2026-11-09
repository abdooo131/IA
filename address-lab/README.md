# Address Tester

Give it any Egyptian address (Arabic, English, Franco or a mix) and it breaks it down into
governorate, city or district, neighbourhood, compound, street, building, floor, apartment,
villa, block, entrance, landmark and phone, then finds the area with a confidence and the reason.

Plain code, no AI and no paid services. Needs Node 22.18 or newer, nothing to install.

```bash
cd address-lab
npm start                      # web page on http://localhost:4300
npm test                       # the rules, checked on sample addresses
npm run bulk -- file.csv --out results.csv
```

## The web page

1. **One address**: type and see the breakdown, the area, how sure it is and why.
2. **Many addresses**: paste a list or choose a file (one address per line, or a CSV such as a
   Shopify export: the address, city, province and area columns are joined). Shows the share
   placed, the count per status, the most common unknown words, the areas found, every row,
   and a CSV download.
3. **Taught names**: words you taught it. Click **Teach** next to an unknown word, pick its
   area, and every address with that word is placed from then on.

## Statuses

| Status | Meaning |
| --- | --- |
| Sure | A clear area name, or two clues that agree |
| Likely | One weaker clue only: a spelling close to a name, a street or a landmark |
| Unsure | Two areas in different districts fit about equally |
| Governorate only | Only Cairo, Giza or Qalyubia was found |
| Outside Greater Cairo | Another governorate |
| Not found | No place name found |

## How it works

1. **Clean**: one form for each Arabic letter family, no diacritics, Arabic digits to Latin,
   Franco digits to letters (ma3adi → maadi), numbers split from names.
2. **Numbered parts**: building, floor, apartment, villa, block, entrance after their marker
   words (عمارة, الدور, شقة, bldg, floor, apt...), and the phone number.
3. **Place names** from `src/places.ts`: exact names first, then names with the same
   consonants (mohandseen = mohandessin), then names one or two letters off.
4. **Street and landmark** around their marker words (شارع, st, بجوار, near, مسجد, mall...).
5. **The area**: every name found is a vote for its place and everything above it. The area
   with the most votes on one family line wins. Two neighbourhoods of one district give the
   district. A shared name (الحي السابع, الياسمين) counts only when the place it belongs to is
   written too. Nothing is guessed: unclear answers say unsure.
6. **Unknown words** that matched nothing, to add to the place list.

## Making it better

Add names to `src/places.ts` (or teach them on the page, saved in `data/learned.json`).
Run your real addresses through **Many addresses** and teach the top unknown words first:
one word often fixes dozens of addresses.

Real customer addresses never go in the repository. Keep them in `address-lab/private/`,
which git ignores.
