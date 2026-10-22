from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,base64,html,zipfile
root=Path(__file__).resolve().parents[2] / 'docs/screenshots/redesign'
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
sections=[]; md=['# Все экраны CRM · новый дизайн','', 'Реальные скриншоты Chromium, mock API. Телефон 393 × 852 CSS px; десктоп 1440 × 1000 CSS px. Десктоп — полная высота страницы; телефон — реальные экраны с прокруткой и перекрытием, чтобы закреплённые кнопки не скрывали поля на длинном снимке. Каждый редактор и состояние снят отдельно.','']
count=0
for mode,label in [('mobile','Телефон'),('desktop','Десктоп')]:
    entries=json.loads((root/mode/'manifest.json').read_text()); count+=len(entries)
    cards=[];md+=['## '+label,'']
    for item in entries:
        file=root/mode/item['file']; im=Image.open(file).convert('RGB'); im.quantize(colors=96).save(file,optimize=True)
        data=base64.b64encode(file.read_bytes()).decode(); title=html.escape(item['title'])
        cards.append(f'<article data-mode="{mode}" data-title="{title.lower()}"><h2>{Path(item["file"]).stem}. {title}</h2><a href="data:image/png;base64,{data}" download="{mode}-{item["file"]}"><img loading="lazy" alt="{title}" src="data:image/png;base64,{data}"></a></article>')
        md.append(f'- [{Path(item["file"]).stem}. {item["title"]}]({mode}/{item["file"]})')
    sections+=cards
    # numbered contact sheets with the first viewport; full versions remain in gallery
    for offset in range(0,len(entries),9):
        cellw,cellh=400,580
        sheet=Image.new('RGB',(cellw*3,cellh*3),'#e9edf4');draw=ImageDraw.Draw(sheet)
        for idx,item in enumerate(entries[offset:offset+9]):
            x=(idx%3)*cellw;y=(idx//3)*cellh
            title=Path(item['file']).stem+'. '+item['title'];words=title.split();lines=['']
            for word in words:
                if draw.textlength(lines[-1]+' '+word,font=font)>370:lines.append(word)
                else:lines[-1]+=(' ' if lines[-1] else '')+word
            for n,line in enumerate(lines[:3]):draw.text((x+12,y+10+20*n),line,fill='#202735',font=font)
            im=Image.open(root/mode/item['file']).convert('RGB');im=im.crop((0,0,im.width,min(im.height,852 if mode=='mobile' else 1000)));im.thumbnail((376,490));sheet.paste(im,(x+12,y+76))
        sheet.save(root/f'{mode}-sheet-{offset//9+1}.jpg',quality=88,optimize=True)
(root/'README.md').write_text('\n'.join(md)+'\n')
(root/'all-screens.html').write_text('''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Все экраны CRM</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:#202735;font:15px system-ui}header{padding:20px;background:white;position:sticky;top:0;z-index:2;border-bottom:1px solid #ddd}h1{font-size:24px;margin:0 0 8px}p{color:#657082}button,input{font:inherit;padding:12px;border:1px solid #ccd3e0;background:white;border-radius:8px;margin:3px}button.active{background:#3859d6;color:white}main{max-width:1500px;margin:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}article{padding:14px;background:white;border:1px solid #e4e7ec;border-radius:12px;align-self:start}article h2{font-size:16px;min-height:44px}img{display:block;width:100%;height:auto}article[hidden]{display:none}article[data-mode="mobile"] img{max-width:450px;margin:auto}</style><header><h1>PLAYROOM · все экраны</h1><p>COUNT скриншотов. Каждый экран целиком. Нажмите на изображение для сохранения оригинала.</p><button data-filter="mobile" class="active">Телефон</button><button data-filter="desktop">Десктоп</button><input aria-label="Найти экран" placeholder="Найти экран…" type="search"><span id="counter"></span></header><main>'''.replace('COUNT',str(count))+''.join(sections)+'''</main><script>let mode='mobile';const input=document.querySelector('input');function filter(){let n=0;document.querySelectorAll('article').forEach(a=>{a.hidden=a.dataset.mode!==mode||!a.dataset.title.includes(input.value.toLowerCase());if(!a.hidden)n++});document.querySelector('#counter').textContent=n+' экранов'}document.querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.filter;document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));filter()});input.oninput=filter;filter()</script></html>''')
# The tracked gallery uses local image paths; the portable export embeds them.
portable=(root/'all-screens.html').read_text()
import re
images=iter([(mode,item) for mode in ['mobile','desktop'] for item in json.loads((root/mode/'manifest.json').read_text())])
def external(match):
    mode,item=next(images)
    title=html.escape(item['title'])
    return f'<a href="{mode}/{item["file"]}"><img loading="lazy" alt="{title}" src="{mode}/{item["file"]}"></a>'
(root/'gallery.html').write_text(re.sub(r'<a href="data:image/png;base64,[^<]+<img[^>]+></a>',external,portable))
# ZIP is generated for download, excluded from git; contains every original and standalone gallery
with zipfile.ZipFile(root/'all-screens.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob('*'):
        if p.is_file() and p.suffix in ('.png','.json','.html','.md','.jpg'):z.write(p,p.relative_to(root))
print(count,'screens; gallery',round((root/'all-screens.html').stat().st_size/1024/1024,1),'MB')
