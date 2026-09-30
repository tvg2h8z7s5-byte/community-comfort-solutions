from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import json
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]/'site'
BASE='https://communitycomfortsolutions.org'
class Page(HTMLParser):
 def __init__(self,s):
  super().__init__();self.refs=[];self.ids=set();self.meta={};self.canonical=[];self.titles=0;self.feed(s)
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if 'id' in a:self.ids.add(a['id'])
  for key in ['href','src']:
   if key in a:self.refs.append(a[key])
  if tag=='meta':self.meta[a.get('name',a.get('property'))]=a.get('content')
  if tag=='link' and a.get('rel')=='canonical':self.canonical.append(a['href'])
  if tag=='title':self.titles+=1
pages={p.name:Page(p.read_text()) for p in ROOT.glob('*.html')}
errors=[]
for name,p in pages.items():
 for ref in p.refs:
  u=urlsplit(ref)
  if u.scheme or u.netloc:continue
  target=u.path.lstrip('/') if u.path else name
  if not target:target='index.html'
  if u.path.startswith('/account/'):continue
  if not (ROOT/target).is_file():errors.append(f'{name}: missing {ref}')
  elif u.fragment and target in pages and u.fragment not in pages[target].ids:errors.append(f'{name}: missing anchor {ref}')
 if p.titles!=1 or not p.meta.get('description'):errors.append(f'{name}: title/description missing')
 if name!='404.html':
  expected=BASE+'/'+('' if name=='index.html' else name)
  if p.canonical!=[expected] or p.meta.get('og:url')!=expected:errors.append(f'{name}: metadata URL mismatch')
 else:
  if p.meta.get('robots')!='noindex':errors.append('404 must be noindex')
sitemap=ET.parse(ROOT/'sitemap.xml')
urls={e.text for e in sitemap.findall('.//{*}loc')}
expected={BASE+'/'+('' if n=='index.html' else n) for n in pages if n!='404.html'}
if urls!=expected:errors.append('Sitemap differs from indexable pages')
if 'Sitemap: '+BASE+'/sitemap.xml' not in (ROOT/'robots.txt').read_text():errors.append('robots sitemap missing')
import re
for script in re.findall(r'<script type="application/ld\+json">(.*?)</script>',(ROOT/'index.html').read_text()):json.loads(script)
if errors:raise SystemExit('\n'.join(errors))
print(f'PASS: {len(pages)} pages, internal resources/anchors, sitemap, titles, descriptions, canonicals, Open Graph URLs and structured-data JSON')
