"""Writes the SOPs into apps/web/messages (shown in the app at /help) and docs/sop/*.md.
Run: python3 scripts/sop/build.py"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from content import AR, EN

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ORDER = ['store_staff', 'rider', 'merchant', 'finance', 'admin']
UI = {
  'en': {'title': 'Help and SOPs', 'intro': 'How we work: the steps for your role, written for the screens you use.',
         'menu': 'Help', 'others': 'Other roles', 'back': 'Back', 'mine': 'Your role',
         'day': 'Your day', 'escalation': 'Who tells whom', 'steps': 'Steps', 'check': 'Check it went right',
         'problems': 'If something is wrong', 'tasks': 'Tasks'},
  'ar': {'title': 'المساعدة وطرق الشغل', 'intro': 'إزاي بنشتغل: خطوات دورك على الشاشات اللي بتستخدمها.',
         'menu': 'المساعدة', 'others': 'أدوار تانية', 'back': 'رجوع', 'mine': 'دورك',
         'day': 'يومك', 'escalation': 'مين يبلغ مين', 'steps': 'الخطوات', 'check': 'اتأكد إنها مشيت صح',
         'problems': 'لو فيه مشكلة', 'tasks': 'المهام'},
}

def check(a, b, path='sop'):
  assert type(a) is type(b), path
  if isinstance(a, dict):
    assert a.keys() == b.keys(), path
    for k in a: check(a[k], b[k], f'{path}.{k}')
  elif isinstance(a, list):
    assert len(a) == len(b), f'{path} has {len(a)} items in English and {len(b)} in Arabic'
    for i, (x, y) in enumerate(zip(a, b)): check(x, y, f'{path}[{i}]')

check(EN, AR)
for lang, content in (('en', EN), ('ar', AR)):
  p = os.path.join(ROOT, 'apps/web/messages', f'{lang}.json')
  data = json.load(open(p, encoding='utf-8'))
  data['sop'] = {**UI[lang], 'roles': {r: content[r] for r in ORDER}}
  with open(p, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')

os.makedirs(os.path.join(ROOT, 'docs/sop'), exist_ok=True)
for r in ORDER:
  out = [f'# SOP: {EN[r]["title"]}', '', f'_{EN[r]["who"]}_', '',
         'Also inside the app: settings menu (top of every screen), Help.', '']
  for lang, content, ui in (('English', EN, UI['en']), ('العربية', AR, UI['ar'])):
    c = content[r]
    out += [f'## {lang}', '']
    if lang != 'English': out += [f'### {c["title"]}', '', c['who'], '']
    out += [f'### {ui["day"]}', ''] + [f'- {x}' for x in c['day']] + ['']
    out += [f'### {ui["escalation"]}', ''] + [f'- {x}' for x in c['escalation']] + ['']
    for s in c['sections']:
      out += [f'### {s["title"]}', '']
      out += [f'{i}. {step}' for i, step in enumerate(s['steps'], 1)] + ['']
      out += [f'**{ui["check"]}**', ''] + [f'- {x}' for x in s['check']] + ['']
      out += [f'**{ui["problems"]}**', ''] + [f'- {x}' for x in s['problems']] + ['']
  with open(os.path.join(ROOT, 'docs/sop', f'{r}.md'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out).rstrip() + '\n')
index = ['# Standard operating procedures', '',
         'One guide per role, in English and Arabic. The same text is shown in the app: every user opens it from the settings menu, Help.',
         'Edit `scripts/sop/content.py`, then run `python3 scripts/sop/build.py` to update the app and these files.', '']
index += [f'- [{EN[r]["title"]}]({r}.md): {EN[r]["who"]}' for r in ORDER]
open(os.path.join(ROOT, 'docs/sop/README.md'), 'w', encoding='utf-8').write('\n'.join(index) + '\n')
# Keep the files in the repo's formatting.
import subprocess
subprocess.run(['npx', 'prettier', '--write', 'apps/web/messages', 'docs/sop'], cwd=ROOT, check=True,
               stdout=subprocess.DEVNULL)
print('SOPs written for', ', '.join(ORDER))
