import os,re,hmac,hashlib,secrets,sqlite3,json,urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from functools import wraps
from flask import Flask,request,jsonify,render_template,send_from_directory
from werkzeug.utils import secure_filename

BASE=Path(__file__).resolve().parent
DB=Path(os.environ.get('HAKKARI_ROLL_DB_PATH',BASE/'hakkari_roll.db'))
UPLOAD=Path(os.environ.get('HAKKARI_ROLL_UPLOAD_DIR',BASE/'uploads'));UPLOAD.mkdir(parents=True,exist_ok=True);DB.parent.mkdir(parents=True,exist_ok=True)
ADMIN_USER=os.environ.get('HAKKARI_ROLL_ADMIN_USERNAME','admin')
ADMIN_PASS=os.environ.get('HAKKARI_ROLL_ADMIN_PASSWORD','Admin123!')
PEPPER=os.environ.get('HAKKARI_ROLL_PEPPER','change-me').encode()
RESEND_API_KEY=os.environ.get('RESEND_API_KEY','').strip()
RESEND_FROM=os.environ.get('RESEND_FROM','Hakkari Roll <noreply@zekyazilim.com>').strip()
app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=35*1024*1024

def now(): return datetime.now().strftime('%Y-%m-%d %H:%M:%S')
def db():
 c=sqlite3.connect(DB,timeout=30);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');c.execute('PRAGMA journal_mode=WAL');return c
def phash(p,s=None):
 s=s or secrets.token_hex(16);d=hashlib.pbkdf2_hmac('sha256',p.encode()+PEPPER,bytes.fromhex(s),220000).hex();return s,d
def pok(p,s,d): return hmac.compare_digest(phash(p,s)[1],d)
def token():
 v=request.headers.get('Authorization','');return v[7:].strip() if v.lower().startswith('bearer ') else ''
def account_ok(r):
 if not r or not r['active'] or not r['approved']:return False
 b=parse_dt(r['ban_until'] or '')
 return not (b and b>datetime.now())
def me():
 t=token();
 if not t:return None
 c=db();r=c.execute('select u.* from sessions s join users u on u.id=s.user_id where s.token=?',(t,)).fetchone();c.close();return r if account_ok(r) else None
def auth(fn):
 @wraps(fn)
 def w(*a,**k):
  if me() is None:return jsonify(ok=False,message='Oturum gerekli.'),401
  return fn(*a,**k)
 return w
def admin(fn):
 @wraps(fn)
 def w(*a,**k):
  u=me()
  if u is None or u['role']!='admin':return jsonify(ok=False,message='Yönetici yetkisi gerekli.'),403
  return fn(*a,**k)
 return w
IMAGE_EXT={'jpg','jpeg','png','webp'}
VIDEO_EXT={'mp4','webm'}
def save(f,prefix,allowed=None):
 if not f or not f.filename:return None
 ext=f.filename.rsplit('.',1)[-1].lower()
 allowed=allowed or IMAGE_EXT
 if ext not in allowed:raise ValueError('Desteklenmeyen dosya türü.')
 n=f'{prefix}_{secrets.token_hex(10)}.{ext}';f.save(UPLOAD/secure_filename(n));return n
def media_type(n):
 if not n:return None
 return 'video' if n.rsplit('.',1)[-1].lower() in VIDEO_EXT else 'image'
def pub(u,viewer=None):return dict(id=u['id'],username=u['username'],display_name=u['display_name'],bio=u['bio'] or '',profile_photo=u['profile_photo'],role=u['role'],vip=bool(u['vip']) if 'vip' in u.keys() else False,is_me=u['id']==viewer)


def ensure_column(c, table, column, sql_type):
 rows=c.execute(f'pragma table_info({table})').fetchall()
 names={r[1] for r in rows}
 if column not in names:c.execute(f'alter table {table} add column {column} {sql_type}')


def init():
 c=db();x=c.cursor()
 x.execute('create table if not exists users(id integer primary key autoincrement,username text unique collate nocase,password_salt text,password_hash text,display_name text,bio text,profile_photo text,role text default "user",active integer default 1,created_at text,last_login text)')
 x.execute('create table if not exists sessions(token text primary key,user_id integer,created_at text,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists vehicles(id integer primary key autoincrement,user_id integer,brand text,model text,model_year integer,engine text,fuel text,horsepower text,plate text,plate_visible integer default 0,photo text,note text,created_at text,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists posts(id integer primary key autoincrement,user_id integer,body text,photo text,created_at text,deleted integer default 0,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists likes(user_id integer,post_id integer,created_at text,primary key(user_id,post_id),foreign key(user_id) references users(id) on delete cascade,foreign key(post_id) references posts(id) on delete cascade)')
 x.execute('create table if not exists comments(id integer primary key autoincrement,user_id integer,post_id integer,body text,created_at text,deleted integer default 0,foreign key(user_id) references users(id) on delete cascade,foreign key(post_id) references posts(id) on delete cascade)')
 x.execute('create table if not exists follows(follower_id integer,followed_id integer,created_at text,primary key(follower_id,followed_id))')
 x.execute('create table if not exists conversations(id integer primary key autoincrement,user1_id integer,user2_id integer,created_at text,unique(user1_id,user2_id))')
 x.execute('create table if not exists messages(id integer primary key autoincrement,conversation_id integer,sender_id integer,body text,created_at text,read_at text)')
 x.execute('create table if not exists reports(id integer primary key autoincrement,reporter_id integer,target_type text,target_id integer,reason text,status text default "open",created_at text)')
 ensure_column(c,'vehicles','transmission','text')
 ensure_column(c,'vehicles','body_type','text')
 ensure_column(c,'vehicles','color','text')
 ensure_column(c,'vehicles','drivetrain','text')
 ensure_column(c,'vehicles','mods','text')
 x.execute('create table if not exists roll_presence(user_id integer primary key,lat real,lon real,accuracy real,status text,visibility text default "approx",expires_at text,updated_at text,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists roll_offers(id integer primary key autoincrement,sender_id integer,receiver_id integer,offer_type text,message text,meeting_text text,status text default "pending",created_at text,updated_at text,foreign key(sender_id) references users(id) on delete cascade,foreign key(receiver_id) references users(id) on delete cascade)')
 x.execute('create table if not exists notifications(id integer primary key autoincrement,user_id integer,type text,title text,body text,ref_type text,ref_id integer,read_at text,created_at text,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists crews(id integer primary key autoincrement,owner_id integer,name text,description text,created_at text,foreign key(owner_id) references users(id) on delete cascade)')
 x.execute('create table if not exists crew_members(crew_id integer,user_id integer,role text default "member",created_at text,primary key(crew_id,user_id),foreign key(crew_id) references crews(id) on delete cascade,foreign key(user_id) references users(id) on delete cascade)')
 x.execute('create table if not exists events(id integer primary key autoincrement,owner_id integer,title text,description text,event_time text,meeting_text text,created_at text,foreign key(owner_id) references users(id) on delete cascade)')
 x.execute('create table if not exists event_members(event_id integer,user_id integer,status text default "going",created_at text,primary key(event_id,user_id),foreign key(event_id) references events(id) on delete cascade,foreign key(user_id) references users(id) on delete cascade)')
 ensure_column(c,'users','email','text')
 ensure_column(c,'users','approved','integer not null default 1')
 ensure_column(c,'users','vip','integer not null default 0')
 ensure_column(c,'users','ban_until','text')
 ensure_column(c,'users','ban_reason','text')
 ensure_column(c,'users','created_by','integer')
 x.execute('create unique index if not exists idx_users_email_unique on users(email) where email is not null and email<>""')
 x.execute('create table if not exists settings(key text primary key,value text)')
 x.execute('create table if not exists password_resets(id integer primary key autoincrement,user_id integer,code_hash text,expires_at text,used integer default 0,created_at text)')
 x.execute('create table if not exists registration_attempts(id integer primary key autoincrement,ip text,email text,created_at text)')
 x.execute('create table if not exists admin_audit(id integer primary key autoincrement,admin_id integer,action text,target_type text,target_id integer,detail text,created_at text)')
 if not x.execute('select 1 from settings where key="registration_mode"').fetchone():x.execute('insert into settings values("registration_mode","approval")')
 if not x.execute('select 1 from settings where key="daily_ip_registration_limit"').fetchone():x.execute('insert into settings values("daily_ip_registration_limit","3")')
 if not x.execute('select 1 from users where username=?',(ADMIN_USER,)).fetchone():
  s,d=phash(ADMIN_PASS);x.execute('insert into users(username,password_salt,password_hash,display_name,role,created_at) values(?,?,?,?,"admin",?)',(ADMIN_USER,s,d,'Hakkari Roll Admin',now()))
 x.execute('update users set approved=1,active=1 where username=?',(ADMIN_USER,))
 c.commit();c.close()

def notify(c,user_id,ntype,title,body='',ref_type='',ref_id=None):
 c.execute('insert into notifications(user_id,type,title,body,ref_type,ref_id,created_at) values(?,?,?,?,?,?,?)',(user_id,ntype,title,body,ref_type,ref_id,now()))

def parse_dt(v):
 try:return datetime.strptime(v,'%Y-%m-%d %H:%M:%S')
 except:return None

def setting(c,k,d=''):
 r=c.execute('select value from settings where key=?',(k,)).fetchone();return r['value'] if r else d
def set_setting(c,k,v):c.execute('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value',(k,str(v)))
def client_ip():
 x=request.headers.get('X-Forwarded-For','');return (x.split(',')[0].strip() if x else request.remote_addr or 'unknown')[:80]
def send_email(to,subject,html):
 if not RESEND_API_KEY:return False,'RESEND_API_KEY ayarlı değil.'
 data=json.dumps({'from':RESEND_FROM,'to':[to],'subject':subject,'html':html}).encode()
 req=urllib.request.Request('https://api.resend.com/emails',data=data,headers={'Authorization':f'Bearer {RESEND_API_KEY}','Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=15) as r:return 200<=r.status<300,''
 except Exception as e:return False,str(e)
def randpass():
 a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';return ''.join(secrets.choice(a) for _ in range(12))
def audit(c,aid,act,typ='',tid=None,detail=''):c.execute('insert into admin_audit(admin_id,action,target_type,target_id,detail,created_at) values(?,?,?,?,?,?)',(aid,act,typ,tid,detail,now()))

def postjson(c,p,uid):
 u=c.execute('select * from users where id=?',(p['user_id'],)).fetchone();lc=c.execute('select count(*) from likes where post_id=?',(p['id'],)).fetchone()[0];cc=c.execute('select count(*) from comments where post_id=? and deleted=0',(p['id'],)).fetchone()[0];liked=bool(c.execute('select 1 from likes where user_id=? and post_id=?',(uid,p['id'])).fetchone());return dict(id=p['id'],body=p['body'] or '',photo=p['photo'],media_type=media_type(p['photo']),created_at=p['created_at'],author=pub(u,uid),like_count=lc,comment_count=cc,liked=liked)

@app.get('/')
def home():return render_template('index.html')
@app.get('/manifest.json')
def manifest():return send_from_directory('static','manifest.json',mimetype='application/manifest+json')
@app.get('/service-worker.js')
def sw():return send_from_directory('static','service-worker.js')
@app.get('/uploads/<path:n>')
def uploads(n):return send_from_directory(UPLOAD,n)
@app.get('/health')
def health():return jsonify(ok=True,service='Hakkari Roll')

@app.get('/api/auth/config')
def authconfig():
 c=db();m=setting(c,'registration_mode','approval');c.close();return jsonify(ok=True,registration_mode=m)
@app.post('/api/register')
def register():
 d=request.get_json() or {};un=str(d.get('username','')).strip();pw=str(d.get('password',''));dn=str(d.get('display_name','')).strip();email=str(d.get('email','')).strip().lower()
 if not re.fullmatch(r'[A-Za-z0-9_.]{3,30}',un):return jsonify(ok=False,message='Kullanıcı adı geçersiz.'),400
 if len(pw)<8 or len(dn)<2:return jsonify(ok=False,message='Ad ve en az 8 karakter şifre gerekli.'),400
 if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email):return jsonify(ok=False,message='Geçerli e-posta gerekli.'),400
 c=db();mode=setting(c,'registration_mode','approval')
 if mode=='closed':c.close();return jsonify(ok=False,message='Yeni kayıtlar kapalı.'),403
 lim=int(setting(c,'daily_ip_registration_limit','3') or 3);since=(datetime.now()-timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S');ip=client_ip()
 if c.execute('select count(*) from registration_attempts where ip=? and created_at>=?',(ip,since)).fetchone()[0]>=lim:c.close();return jsonify(ok=False,message='Bu ağdan günlük kayıt limiti doldu.'),429
 if c.execute('select 1 from users where username=? collate nocase',(un,)).fetchone():c.close();return jsonify(ok=False,message='Kullanıcı adı kullanılıyor.'),409
 if c.execute('select 1 from users where email=? collate nocase',(email,)).fetchone():c.close();return jsonify(ok=False,message='Bu e-posta ile zaten hesap var.'),409
 salt,h=phash(pw);approved=1 if mode=='open' else 0;cur=c.execute('insert into users(username,password_salt,password_hash,display_name,email,active,approved,created_at) values(?,?,?,?,?,1,?,?)',(un,salt,h,dn,email,approved,now()));c.execute('insert into registration_attempts(ip,email,created_at) values(?,?,?)',(ip,email,now()));c.commit();uid=cur.lastrowid
 if approved:
  t=secrets.token_urlsafe(36);c.execute('insert into sessions values(?,?,?)',(t,uid,now()));c.commit();u=c.execute('select * from users where id=?',(uid,)).fetchone();c.close();return jsonify(ok=True,approved=True,token=t,user=pub(u,uid),message='Hesap oluşturuldu.')
 c.close();return jsonify(ok=True,approved=False,message='Başvurun alındı. Admin onayından sonra giriş yapabilirsin.')
@app.post('/api/login')
def login():
 d=request.get_json() or {};c=db();u=c.execute('select * from users where username=? collate nocase',(str(d.get('username','')).strip(),)).fetchone()
 if u is None or not pok(str(d.get('password','')),u['password_salt'],u['password_hash']):c.close();return jsonify(ok=False,message='Kullanıcı adı veya şifre yanlış.'),401
 if not u['approved']:c.close();return jsonify(ok=False,message='Hesabın admin onayı bekliyor.'),403
 if not u['active']:c.close();return jsonify(ok=False,message='Hesabın devre dışı.'),403
 b=parse_dt(u['ban_until'] or '')
 if b and b>datetime.now():c.close();return jsonify(ok=False,message=f'Hesabın {u["ban_until"]} tarihine kadar banlı. '+(u['ban_reason'] or '')),403
 t=secrets.token_urlsafe(36);c.execute('insert into sessions values(?,?,?)',(t,u['id'],now()));c.execute('update users set last_login=? where id=?',(now(),u['id']));c.commit();c.close();return jsonify(ok=True,token=t,user=pub(u,u['id']))
@app.post('/api/logout')
@auth
def logout():
 c=db();c.execute('delete from sessions where token=?',(token(),));c.commit();c.close();return jsonify(ok=True)
@app.post('/api/password-reset/request')
def reset_request():
 d=request.get_json() or {};email=str(d.get('email','')).strip().lower();c=db();u=c.execute('select * from users where email=? collate nocase',(email,)).fetchone()
 if not u:c.close();return jsonify(ok=True,message='E-posta kayıtlıysa kod gönderildi.')
 code=f'{secrets.randbelow(1000000):06d}';ch=hashlib.sha256((code+PEPPER.decode(errors='ignore')).encode()).hexdigest();exp=(datetime.now()+timedelta(minutes=15)).strftime('%Y-%m-%d %H:%M:%S');c.execute('update password_resets set used=1 where user_id=? and used=0',(u['id'],));c.execute('insert into password_resets(user_id,code_hash,expires_at,created_at) values(?,?,?,?)',(u['id'],ch,exp,now()));c.commit();c.close();ok,err=send_email(email,'Hakkari Roll şifre yenileme',f'<h2>Hakkari Roll</h2><p>Kodun:</p><h1>{code}</h1><p>15 dakika geçerlidir.</p>')
 if not ok:return jsonify(ok=False,message='E-posta gönderilemedi: '+err),500
 return jsonify(ok=True,message='6 haneli kod e-postana gönderildi.')
@app.post('/api/password-reset/confirm')
def reset_confirm():
 d=request.get_json() or {};email=str(d.get('email','')).strip().lower();code=str(d.get('code','')).strip();pw=str(d.get('new_password',''))
 if len(pw)<8:return jsonify(ok=False,message='Yeni şifre en az 8 karakter.'),400
 c=db();u=c.execute('select * from users where email=? collate nocase',(email,)).fetchone();r=c.execute('select * from password_resets where user_id=? and used=0 order by id desc limit 1',(u['id'],)).fetchone() if u else None
 if not r or (parse_dt(r['expires_at']) and parse_dt(r['expires_at'])<datetime.now()):c.close();return jsonify(ok=False,message='Kod geçersiz veya süresi doldu.'),400
 ch=hashlib.sha256((code+PEPPER.decode(errors='ignore')).encode()).hexdigest()
 if not hmac.compare_digest(ch,r['code_hash']):c.close();return jsonify(ok=False,message='Kod yanlış.'),400
 salt,h=phash(pw);c.execute('update users set password_salt=?,password_hash=? where id=?',(salt,h,u['id']));c.execute('update password_resets set used=1 where id=?',(r['id'],));c.execute('delete from sessions where user_id=?',(u['id'],));c.commit();c.close();return jsonify(ok=True,message='Şifren yenilendi.')
@app.get('/api/me')
@auth
def getme():u=me();return jsonify(ok=True,user=pub(u,u['id']))
@app.put('/api/me')
@auth
def editme():
 u=me();d=request.get_json() or {};dn=str(d.get('display_name',u['display_name'])).strip();bio=str(d.get('bio',u['bio'] or ''))[:500];c=db();c.execute('update users set display_name=?,bio=? where id=?',(dn,bio,u['id']));c.commit();r=c.execute('select * from users where id=?',(u['id'],)).fetchone();c.close();return jsonify(ok=True,user=pub(r,r['id']))
@app.post('/api/me/photo')
@auth
def mephoto():
 u=me()
 try:n=save(request.files.get('photo'),f'profile_{u["id"]}')
 except ValueError as e:return jsonify(ok=False,message=str(e)),400
 c=db();c.execute('update users set profile_photo=? where id=?',(n,u['id']));c.commit();c.close();return jsonify(ok=True,profile_photo=n)

@app.get('/api/users')
@auth
def users():
 u=me();q=str(request.args.get('q',''));c=db();rows=c.execute('select * from users where active=1 and (username like ? or display_name like ?) order by id desc limit 80',(f'%{q}%',f'%{q}%')).fetchall();out=[]
 for r in rows:
  x=pub(r,u['id']);x['following']=bool(c.execute('select 1 from follows where follower_id=? and followed_id=?',(u['id'],r['id'])).fetchone());out.append(x)
 c.close();return jsonify(ok=True,users=out)
@app.get('/api/users/<int:uid>')
@auth
def profile(uid):
 u=me();c=db();r=c.execute('select * from users where id=? and active=1',(uid,)).fetchone()
 if not r:c.close();return jsonify(ok=False,message='Kullanıcı bulunamadı.'),404
 p=pub(r,u['id']);p['following']=bool(c.execute('select 1 from follows where follower_id=? and followed_id=?',(u['id'],uid)).fetchone());p['follower_count']=c.execute('select count(*) from follows where followed_id=?',(uid,)).fetchone()[0];p['following_count']=c.execute('select count(*) from follows where follower_id=?',(uid,)).fetchone()[0];vs=[dict(x) for x in c.execute('select * from vehicles where user_id=? order by id desc',(uid,)).fetchall()];ps=[postjson(c,x,u['id']) for x in c.execute('select * from posts where user_id=? and deleted=0 order by id desc limit 30',(uid,)).fetchall()];c.close();return jsonify(ok=True,user=p,vehicles=vs,posts=ps)
@app.post('/api/users/<int:uid>/follow')
@auth
def follow(uid):
 u=me();c=db();e=c.execute('select 1 from follows where follower_id=? and followed_id=?',(u['id'],uid)).fetchone();
 if e:c.execute('delete from follows where follower_id=? and followed_id=?',(u['id'],uid))
 else:
  c.execute('insert into follows values(?,?,?)',(u['id'],uid,now()));notify(c,uid,'follow','Yeni takipçi',f'@{u["username"]} seni takip etmeye başladı.','user',u['id'])
 c.commit();c.close();return jsonify(ok=True,following=not bool(e))

@app.get('/api/vehicles')
@auth
def vehicles():
 u=me();q=str(request.args.get('q',''));c=db();rows=c.execute('select v.*,u.username,u.display_name from vehicles v join users u on u.id=v.user_id where v.brand like ? or v.model like ? or u.username like ? order by v.id desc limit 100',(f'%{q}%',f'%{q}%',f'%{q}%')).fetchall();out=[]
 for r in rows:
  d=dict(r)
  if not d['plate_visible'] and d['user_id']!=u['id'] and u['role']!='admin':d['plate']=None
  out.append(d)
 c.close();return jsonify(ok=True,vehicles=out)
@app.post('/api/vehicles')
@auth
def addvehicle():
 u=me();brand=request.form.get('brand','').strip();model=request.form.get('model','').strip()
 if not brand or not model:return jsonify(ok=False,message='Marka ve model gerekli.'),400
 try:photo=save(request.files.get('photo'),f'vehicle_{u["id"]}')
 except ValueError as e:return jsonify(ok=False,message=str(e)),400
 yr=request.form.get('model_year','').strip();yr=int(yr) if yr.isdigit() else None;c=db();cur=c.execute('insert into vehicles(user_id,brand,model,model_year,engine,fuel,horsepower,plate,plate_visible,photo,note,created_at,transmission,body_type,color,drivetrain,mods) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(u['id'],brand,model,yr,request.form.get('engine',''),request.form.get('fuel',''),request.form.get('horsepower',''),request.form.get('plate','').upper(),1 if request.form.get('plate_visible')=='1' else 0,photo,request.form.get('note','')[:500],now(),request.form.get('transmission',''),request.form.get('body_type',''),request.form.get('color',''),request.form.get('drivetrain',''),request.form.get('mods','')[:500]));c.commit();c.close();return jsonify(ok=True,id=cur.lastrowid,message='Araç eklendi.')
@app.delete('/api/vehicles/<int:vid>')
@auth
def delvehicle(vid):
 u=me();c=db();r=c.execute('select * from vehicles where id=?',(vid,)).fetchone()
 if not r or (r['user_id']!=u['id'] and u['role']!='admin'):c.close();return jsonify(ok=False,message='Yetkisiz.'),403
 c.execute('delete from vehicles where id=?',(vid,));c.commit();c.close();return jsonify(ok=True)

@app.get('/api/feed')
@auth
def feed():
 u=me();c=db();ps=[postjson(c,x,u['id']) for x in c.execute('select * from posts where deleted=0 order by id desc limit 80').fetchall()];c.close();return jsonify(ok=True,posts=ps)
@app.post('/api/posts')
@auth
def addpost():
 u=me();body=request.form.get('body','').strip()
 try:photo=save(request.files.get('photo'),f'post_{u["id"]}',IMAGE_EXT|VIDEO_EXT)
 except ValueError as e:return jsonify(ok=False,message=str(e)),400
 if not body and not photo:return jsonify(ok=False,message='Yazı, fotoğraf veya video ekleyin.'),400
 c=db();cur=c.execute('insert into posts(user_id,body,photo,created_at) values(?,?,?,?)',(u['id'],body[:3000],photo,now()));c.commit();c.close();return jsonify(ok=True,id=cur.lastrowid,message='Paylaşıldı.')
@app.delete('/api/posts/<int:pid>')
@auth
def delpost(pid):
 u=me();c=db();p=c.execute('select * from posts where id=?',(pid,)).fetchone()
 if not p or (p['user_id']!=u['id'] and u['role']!='admin'):c.close();return jsonify(ok=False,message='Yetkisiz.'),403
 c.execute('update posts set deleted=1 where id=?',(pid,));c.commit();c.close();return jsonify(ok=True)
@app.post('/api/posts/<int:pid>/like')
@auth
def like(pid):
 u=me();c=db();e=c.execute('select 1 from likes where user_id=? and post_id=?',(u['id'],pid)).fetchone();c.execute('delete from likes where user_id=? and post_id=?',(u['id'],pid)) if e else c.execute('insert into likes values(?,?,?)',(u['id'],pid,now()));c.commit();cnt=c.execute('select count(*) from likes where post_id=?',(pid,)).fetchone()[0];c.close();return jsonify(ok=True,liked=not bool(e),like_count=cnt)
@app.get('/api/posts/<int:pid>/comments')
@auth
def getcomments(pid):
 c=db();r=[dict(x) for x in c.execute('select c.*,u.display_name,u.username from comments c join users u on u.id=c.user_id where c.post_id=? and c.deleted=0 order by c.id',(pid,)).fetchall()];c.close();return jsonify(ok=True,comments=r)
@app.post('/api/posts/<int:pid>/comments')
@auth
def addcomment(pid):
 u=me();b=str((request.get_json() or {}).get('body','')).strip()
 if not b:return jsonify(ok=False,message='Yorum boş olamaz.'),400
 c=db();c.execute('insert into comments(user_id,post_id,body,created_at) values(?,?,?,?)',(u['id'],pid,b[:1000],now()));c.commit();c.close();return jsonify(ok=True)

def pair(a,b):return (a,b) if a<b else (b,a)
@app.post('/api/conversations/with/<int:uid>')
@auth
def convwith(uid):
 u=me();a,b=pair(u['id'],uid);c=db();r=c.execute('select id from conversations where user1_id=? and user2_id=?',(a,b)).fetchone()
 if r:cid=r['id']
 else:cur=c.execute('insert into conversations(user1_id,user2_id,created_at) values(?,?,?)',(a,b,now()));c.commit();cid=cur.lastrowid
 c.close();return jsonify(ok=True,conversation_id=cid)
@app.get('/api/conversations')
@auth
def convs():
 u=me();c=db();out=[]
 for r in c.execute('select * from conversations where user1_id=? or user2_id=? order by id desc',(u['id'],u['id'])).fetchall():
  oid=r['user2_id'] if r['user1_id']==u['id'] else r['user1_id'];o=c.execute('select * from users where id=?',(oid,)).fetchone();last=c.execute('select * from messages where conversation_id=? order by id desc limit 1',(r['id'],)).fetchone();un=c.execute('select count(*) from messages where conversation_id=? and sender_id<>? and read_at is null',(r['id'],u['id'])).fetchone()[0];out.append(dict(id=r['id'],other=pub(o,u['id']),last_message=dict(last) if last else None,unread=un))
 c.close();return jsonify(ok=True,conversations=out)
@app.get('/api/conversations/<int:cid>/messages')
@auth
def msgs(cid):
 u=me();c=db();cv=c.execute('select * from conversations where id=?',(cid,)).fetchone()
 if not cv or u['id'] not in (cv['user1_id'],cv['user2_id']):c.close();return jsonify(ok=False,message='Sohbet yok.'),404
 c.execute('update messages set read_at=? where conversation_id=? and sender_id<>? and read_at is null',(now(),cid,u['id']));c.commit();r=[dict(x) for x in c.execute('select * from messages where conversation_id=? order by id limit 300',(cid,)).fetchall()];c.close();return jsonify(ok=True,messages=r)
@app.post('/api/conversations/<int:cid>/messages')
@auth
def sendmsg(cid):
 u=me();b=str((request.get_json() or {}).get('body','')).strip()
 if not b:return jsonify(ok=False,message='Mesaj boş.'),400
 c=db();cv=c.execute('select * from conversations where id=?',(cid,)).fetchone()
 if not cv or u['id'] not in (cv['user1_id'],cv['user2_id']):c.close();return jsonify(ok=False,message='Sohbet yok.'),404
 c.execute('insert into messages(conversation_id,sender_id,body,created_at) values(?,?,?,?)',(cid,u['id'],b[:2000],now()));oid=cv['user2_id'] if cv['user1_id']==u['id'] else cv['user1_id'];notify(c,oid,'message','Yeni mesaj',f'@{u["username"]}: {b[:80]}','conversation',cid);c.commit();c.close();return jsonify(ok=True)


# ---------------- ROLL AKTİF / CANLI HARİTA ----------------
@app.post('/api/roll/activate')
@auth
def roll_activate():
 u=me();d=request.get_json() or {}
 try:lat=float(d.get('lat'));lon=float(d.get('lon'));accuracy=float(d.get('accuracy') or 0)
 except:return jsonify(ok=False,message='Konum alınamadı.'),400
 mins=int(d.get('minutes',60));mins=max(15,min(mins,360))
 status=str(d.get('status','Piyasadayım'))[:40]
 visibility=str(d.get('visibility','approx'))
 if visibility not in ('approx','exact'):visibility='approx'
 exp=(datetime.now()+timedelta(minutes=mins)).strftime('%Y-%m-%d %H:%M:%S')
 c=db();c.execute('insert into roll_presence(user_id,lat,lon,accuracy,status,visibility,expires_at,updated_at) values(?,?,?,?,?,?,?,?) on conflict(user_id) do update set lat=excluded.lat,lon=excluded.lon,accuracy=excluded.accuracy,status=excluded.status,visibility=excluded.visibility,expires_at=excluded.expires_at,updated_at=excluded.updated_at',(u['id'],lat,lon,accuracy,status,visibility,exp,now()));c.commit();c.close();return jsonify(ok=True,expires_at=exp,message='Roll Aktif açıldı.')

@app.post('/api/roll/update')
@auth
def roll_update():
 u=me();d=request.get_json() or {}
 try:lat=float(d.get('lat'));lon=float(d.get('lon'));accuracy=float(d.get('accuracy') or 0)
 except:return jsonify(ok=False,message='Konum geçersiz.'),400
 c=db();r=c.execute('select * from roll_presence where user_id=?',(u['id'],)).fetchone()
 if not r or (parse_dt(r['expires_at']) and parse_dt(r['expires_at'])<datetime.now()):c.close();return jsonify(ok=False,message='Roll Aktif kapalı.'),400
 c.execute('update roll_presence set lat=?,lon=?,accuracy=?,updated_at=? where user_id=?',(lat,lon,accuracy,now(),u['id']));c.commit();c.close();return jsonify(ok=True)

@app.post('/api/roll/deactivate')
@auth
def roll_deactivate():
 u=me();c=db();c.execute('delete from roll_presence where user_id=?',(u['id'],));c.commit();c.close();return jsonify(ok=True,message='Roll Aktif kapatıldı.')

@app.get('/api/roll/active')
@auth
def roll_active():
 u=me();c=db();rows=c.execute('select rp.*,u.username,u.display_name,u.profile_photo from roll_presence rp join users u on u.id=rp.user_id where u.active=1').fetchall();out=[]
 for r in rows:
  ex=parse_dt(r['expires_at'])
  if ex and ex<datetime.now():c.execute('delete from roll_presence where user_id=?',(r['user_id'],));continue
  lat=float(r['lat']);lon=float(r['lon'])
  if r['visibility']=='approx' and r['user_id']!=u['id']:
   lat=round(lat,3);lon=round(lon,3)
  v=c.execute('select * from vehicles where user_id=? order by id desc limit 1',(r['user_id'],)).fetchone()
  out.append(dict(user_id=r['user_id'],username=r['username'],display_name=r['display_name'],profile_photo=r['profile_photo'],lat=lat,lon=lon,status=r['status'],expires_at=r['expires_at'],vehicle=dict(v) if v else None))
 c.commit();c.close();return jsonify(ok=True,active=out,count=len(out))

# ---------------- ROLL / PİYASA TEKLİFLERİ ----------------
@app.post('/api/offers')
@auth
def offer_create():
 u=me();d=request.get_json() or {}
 try:rid=int(d.get('receiver_id'))
 except:return jsonify(ok=False,message='Kullanıcı seçilmedi.'),400
 typ=str(d.get('offer_type','roll'))
 if typ not in ('roll','piyasa'):return jsonify(ok=False,message='Teklif türü geçersiz.'),400
 if rid==u['id']:return jsonify(ok=False,message='Kendinize teklif gönderemezsiniz.'),400
 msg=str(d.get('message',''))[:300];meet=str(d.get('meeting_text',''))[:200]
 c=db();r=c.execute('select * from users where id=? and active=1',(rid,)).fetchone()
 if not r:c.close();return jsonify(ok=False,message='Kullanıcı bulunamadı.'),404
 cur=c.execute('insert into roll_offers(sender_id,receiver_id,offer_type,message,meeting_text,created_at,updated_at) values(?,?,?,?,?,?,?)',(u['id'],rid,typ,msg,meet,now(),now()))
 title='🔥 Roll teklifi' if typ=='roll' else '🚘 Piyasa teklifi'
 notify(c,rid,'offer',title,f'@{u["username"]} sana teklif gönderdi.','offer',cur.lastrowid)
 c.commit();c.close();return jsonify(ok=True,message='Teklif gönderildi.')

@app.get('/api/offers')
@auth
def offers_list():
 u=me();c=db();rows=c.execute('select o.*,su.username sender_username,su.display_name sender_name,ru.username receiver_username,ru.display_name receiver_name from roll_offers o join users su on su.id=o.sender_id join users ru on ru.id=o.receiver_id where o.sender_id=? or o.receiver_id=? order by o.id desc limit 100',(u['id'],u['id'])).fetchall();c.close();return jsonify(ok=True,offers=[dict(r) for r in rows])

@app.post('/api/offers/<int:oid>/respond')
@auth
def offer_respond(oid):
 u=me();d=request.get_json() or {};st=str(d.get('status',''))
 if st not in ('accepted','rejected'):return jsonify(ok=False,message='Durum geçersiz.'),400
 c=db();o=c.execute('select * from roll_offers where id=?',(oid,)).fetchone()
 if not o or o['receiver_id']!=u['id']:c.close();return jsonify(ok=False,message='Teklif bulunamadı.'),404
 c.execute('update roll_offers set status=?,updated_at=? where id=?',(st,now(),oid));notify(c,o['sender_id'],'offer_result','Teklif sonucu',f'@{u["username"]} teklifini {"kabul etti" if st=="accepted" else "reddetti"}.','offer',oid);c.commit();c.close();return jsonify(ok=True)

# ---------------- BİLDİRİMLER ----------------
@app.get('/api/notifications')
@auth
def notifications_list():
 u=me();c=db();rows=c.execute('select * from notifications where user_id=? order by id desc limit 100',(u['id'],)).fetchall();un=c.execute('select count(*) from notifications where user_id=? and read_at is null',(u['id'],)).fetchone()[0];c.close();return jsonify(ok=True,notifications=[dict(r) for r in rows],unread=un)

@app.post('/api/notifications/read-all')
@auth
def notifications_read():
 u=me();c=db();c.execute('update notifications set read_at=? where user_id=? and read_at is null',(now(),u['id']));c.commit();c.close();return jsonify(ok=True)

# ---------------- ETKİNLİKLER ----------------
@app.get('/api/events')
@auth
def events_list():
 u=me();c=db();rows=c.execute('select e.*,u.username,u.display_name,(select count(*) from event_members em where em.event_id=e.id and em.status="going") going_count from events e join users u on u.id=e.owner_id order by e.id desc limit 50').fetchall();out=[]
 for r in rows:
  d=dict(r);d['going']=bool(c.execute('select 1 from event_members where event_id=? and user_id=? and status="going"',(r['id'],u['id'])).fetchone());out.append(d)
 c.close();return jsonify(ok=True,events=out)

@app.post('/api/events')
@auth
def event_create():
 u=me();d=request.get_json() or {};title=str(d.get('title','')).strip()
 if not title:return jsonify(ok=False,message='Başlık gerekli.'),400
 if not str(d.get('event_time','')).strip():return jsonify(ok=False,message='Tarih/saat gerekli.'),400
 c=db();cur=c.execute('insert into events(owner_id,title,description,event_time,meeting_text,created_at) values(?,?,?,?,?,?)',(u['id'],title[:120],str(d.get('description',''))[:800],str(d.get('event_time',''))[:50],str(d.get('meeting_text',''))[:200],now()));c.execute('insert or ignore into event_members(event_id,user_id,status,created_at) values(?,?,"going",?)',(cur.lastrowid,u['id'],now()));c.commit();c.close();return jsonify(ok=True,message='Etkinlik oluşturuldu.')

@app.post('/api/events/<int:eid>/toggle')
@auth
def event_toggle(eid):
 u=me();c=db();e=c.execute('select 1 from event_members where event_id=? and user_id=?',(eid,u['id'])).fetchone()
 if e:c.execute('delete from event_members where event_id=? and user_id=?',(eid,u['id']));going=False
 else:c.execute('insert into event_members(event_id,user_id,status,created_at) values(?,?,"going",?)',(eid,u['id'],now()));going=True
 c.commit();c.close();return jsonify(ok=True,going=going)

@app.delete('/api/events/<int:eid>')
@auth
def event_delete(eid):
 u=me();c=db();e=c.execute('select * from events where id=?',(eid,)).fetchone()
 if not e or (e['owner_id']!=u['id'] and u['role']!='admin'):c.close();return jsonify(ok=False,message='Yetkisiz.'),403
 c.execute('delete from event_members where event_id=?',(eid,));c.execute('delete from events where id=?',(eid,));c.commit();c.close();return jsonify(ok=True)

# ---------------- EKİPLER ----------------
@app.get('/api/crews')
@auth
def crews_list():
 u=me();c=db();rows=c.execute('select cr.*,u.username,(select count(*) from crew_members cm where cm.crew_id=cr.id) member_count from crews cr join users u on u.id=cr.owner_id order by cr.id desc limit 50').fetchall();out=[]
 for r in rows:
  d=dict(r);d['member']=bool(c.execute('select 1 from crew_members where crew_id=? and user_id=?',(r['id'],u['id'])).fetchone());out.append(d)
 c.close();return jsonify(ok=True,crews=out)

@app.post('/api/crews')
@auth
def crew_create():
 u=me();d=request.get_json() or {};name=str(d.get('name','')).strip()
 if not name:return jsonify(ok=False,message='Ekip adı gerekli.'),400
 c=db();cur=c.execute('insert into crews(owner_id,name,description,created_at) values(?,?,?,?)',(u['id'],name[:80],str(d.get('description',''))[:500],now()));c.execute('insert into crew_members(crew_id,user_id,role,created_at) values(?,?,"owner",?)',(cur.lastrowid,u['id'],now()));c.commit();c.close();return jsonify(ok=True,message='Ekip oluşturuldu.')

@app.post('/api/crews/<int:cid>/toggle')
@auth
def crew_toggle(cid):
 u=me();c=db();cr=c.execute('select * from crews where id=?',(cid,)).fetchone()
 if not cr:c.close();return jsonify(ok=False,message='Ekip bulunamadı.'),404
 e=c.execute('select * from crew_members where crew_id=? and user_id=?',(cid,u['id'])).fetchone()
 if e and e['role']=='owner':c.close();return jsonify(ok=False,message='Ekip sahibi ekipten ayrılamaz.'),400
 if e:c.execute('delete from crew_members where crew_id=? and user_id=?',(cid,u['id']));member=False
 else:c.execute('insert into crew_members(crew_id,user_id,created_at) values(?,?,?)',(cid,u['id'],now()));member=True
 c.commit();c.close();return jsonify(ok=True,member=member)

@app.post('/api/report')
@auth
def report():
 u=me();d=request.get_json() or {};typ=str(d.get('target_type',''));tid=int(d.get('target_id',0) or 0);reason=str(d.get('reason','')).strip()
 if typ not in ('user','post','comment','vehicle') or tid<=0 or not reason:return jsonify(ok=False,message='Şikâyet bilgileri eksik.'),400
 c=db();c.execute('insert into reports(reporter_id,target_type,target_id,reason,created_at) values(?,?,?,?,?)',(u['id'],typ,tid,reason[:800],now()));c.commit();c.close();return jsonify(ok=True,message='Şikâyet admine gönderildi.')
@app.get('/api/admin/stats')
@admin
def stats():
 c=db();s=dict(users=c.execute('select count(*) from users where approved=1').fetchone()[0],pending=c.execute('select count(*) from users where approved=0').fetchone()[0],vip=c.execute('select count(*) from users where vip=1').fetchone()[0],banned=c.execute('select count(*) from users where ban_until>?',(now(),)).fetchone()[0],vehicles=c.execute('select count(*) from vehicles').fetchone()[0],posts=c.execute('select count(*) from posts where deleted=0').fetchone()[0],messages=c.execute('select count(*) from messages').fetchone()[0],reports=c.execute('select count(*) from reports where status="open"').fetchone()[0],roll_active=c.execute('select count(*) from roll_presence where expires_at>?',(now(),)).fetchone()[0],events=c.execute('select count(*) from events').fetchone()[0],crews=c.execute('select count(*) from crews').fetchone()[0]);c.close();return jsonify(ok=True,stats=s)
@app.get('/api/admin/users')
@admin
def adminusers():
 c=db();out=[]
 for r in c.execute('select * from users order by approved asc,vip desc,id desc limit 500').fetchall():
  d=dict(r);d.pop('password_salt',None);d.pop('password_hash',None);b=parse_dt(r['ban_until'] or '');d['banned']=bool(b and b>datetime.now());d['vehicle_count']=c.execute('select count(*) from vehicles where user_id=?',(r['id'],)).fetchone()[0];d['post_count']=c.execute('select count(*) from posts where user_id=? and deleted=0',(r['id'],)).fetchone()[0];out.append(d)
 c.close();return jsonify(ok=True,users=out)
@app.post('/api/admin/users')
@admin
def admincreate():
 a=me();d=request.get_json() or {};un=str(d.get('username','')).strip();dn=str(d.get('display_name','')).strip();email=str(d.get('email','')).strip().lower();pw=str(d.get('password','')).strip() or randpass();role='admin' if d.get('role')=='admin' else 'user';vip=1 if d.get('vip') else 0
 if not re.fullmatch(r'[A-Za-z0-9_.]{3,30}',un) or len(dn)<2:return jsonify(ok=False,message='Ad/kullanıcı adı geçersiz.'),400
 c=db();
 if c.execute('select 1 from users where username=? collate nocase',(un,)).fetchone():c.close();return jsonify(ok=False,message='Kullanıcı adı kullanılıyor.'),409
 salt,h=phash(pw);cur=c.execute('insert into users(username,password_salt,password_hash,display_name,email,role,active,approved,vip,created_by,created_at) values(?,?,?,?,?,?,1,1,?,?,?)',(un,salt,h,dn,email,role,vip,a['id'],now()));audit(c,a['id'],'Hesap oluşturuldu','user',cur.lastrowid,un);c.commit();c.close();return jsonify(ok=True,username=un,password=pw,message='Hesap oluşturuldu.')
@app.post('/api/admin/users/<int:uid>/approve')
@admin
def adminapprove(uid):
 a=me();c=db();u=c.execute('select * from users where id=?',(uid,)).fetchone();c.execute('update users set approved=1,active=1 where id=?',(uid,));audit(c,a['id'],'Hesap onaylandı','user',uid,u['username'] if u else '');c.commit();c.close();return jsonify(ok=True,message='Hesap onaylandı.')
@app.post('/api/admin/users/<int:uid>/vip')
@admin
def adminvip(uid):
 a=me();c=db();u=c.execute('select * from users where id=?',(uid,)).fetchone();nv=0 if u and u['vip'] else 1;c.execute('update users set vip=? where id=?',(nv,uid));audit(c,a['id'],'VIP değiştirildi','user',uid,str(nv));c.commit();c.close();return jsonify(ok=True,vip=bool(nv),message='VIP güncellendi.')
@app.post('/api/admin/users/<int:uid>/ban')
@admin
def adminban(uid):
 a=me();d=request.get_json() or {};mins=int(d.get('minutes',0) or 0);reason=str(d.get('reason',''))[:500]
 if uid==a['id'] or mins<=0:return jsonify(ok=False,message='Ban bilgisi geçersiz.'),400
 until=(datetime.now()+timedelta(minutes=min(mins,525600))).strftime('%Y-%m-%d %H:%M:%S');c=db();c.execute('update users set ban_until=?,ban_reason=? where id=?',(until,reason,uid));c.execute('delete from sessions where user_id=?',(uid,));c.execute('delete from roll_presence where user_id=?',(uid,));audit(c,a['id'],'Hesap banlandı','user',uid,until+' '+reason);c.commit();c.close();return jsonify(ok=True,ban_until=until,message='Hesap banlandı.')
@app.post('/api/admin/users/<int:uid>/unban')
@admin
def adminunban(uid):
 a=me();c=db();c.execute('update users set ban_until=null,ban_reason=null where id=?',(uid,));audit(c,a['id'],'Ban kaldırıldı','user',uid,'');c.commit();c.close();return jsonify(ok=True,message='Ban kaldırıldı.')
@app.post('/api/admin/users/<int:uid>/toggle-active')
@admin
def admintoggle(uid):
 a=me();c=db();u=c.execute('select * from users where id=?',(uid,)).fetchone();nv=0 if u and u['active'] else 1;c.execute('update users set active=? where id=?',(nv,uid));c.execute('delete from sessions where user_id=?',(uid,)) if not nv else None;audit(c,a['id'],'Aktif/Pasif','user',uid,str(nv));c.commit();c.close();return jsonify(ok=True,active=bool(nv))
@app.post('/api/admin/users/<int:uid>/reset-password')
@admin
def adminreset(uid):
 a=me();d=request.get_json() or {};pw=str(d.get('password','')).strip() or randpass();salt,h=phash(pw);c=db();c.execute('update users set password_salt=?,password_hash=? where id=?',(salt,h,uid));c.execute('delete from sessions where user_id=?',(uid,));audit(c,a['id'],'Şifre sıfırlandı','user',uid,'');c.commit();c.close();return jsonify(ok=True,password=pw,message='Şifre sıfırlandı.')
@app.delete('/api/admin/users/<int:uid>')
@admin
def admindelete(uid):
 a=me();
 if uid==a['id']:return jsonify(ok=False,message='Kendi hesabını silemezsin.'),400
 c=db();u=c.execute('select * from users where id=?',(uid,)).fetchone();audit(c,a['id'],'Hesap silindi','user',uid,u['username'] if u else '');c.execute('delete from users where id=?',(uid,));c.commit();c.close();return jsonify(ok=True,message='Hesap silindi.')
@app.get('/api/admin/reports')
@admin
def reports():
 c=db();r=[dict(x) for x in c.execute('select r.*,u.username reporter_username from reports r join users u on u.id=r.reporter_id order by r.id desc limit 300').fetchall()];c.close();return jsonify(ok=True,reports=r)
@app.post('/api/admin/reports/<int:rid>/close')
@admin
def closereport(rid):c=db();c.execute('update reports set status="closed" where id=?',(rid,));c.commit();c.close();return jsonify(ok=True)
@app.delete('/api/admin/content/<typ>/<int:tid>')
@admin
def delcontent(typ,tid):
 c=db();
 if typ=='post':c.execute('update posts set deleted=1 where id=?',(tid,))
 elif typ=='comment':c.execute('update comments set deleted=1 where id=?',(tid,))
 elif typ=='vehicle':c.execute('delete from vehicles where id=?',(tid,))
 else:c.close();return jsonify(ok=False,message='Tür geçersiz.'),400
 c.commit();c.close();return jsonify(ok=True)
@app.get('/api/admin/settings')
@admin
def adsettings():c=db();d={r['key']:r['value'] for r in c.execute('select * from settings').fetchall()};c.close();return jsonify(ok=True,settings=d)
@app.put('/api/admin/settings')
@admin
def adsettingsput():
 d=request.get_json() or {};mode=str(d.get('registration_mode','approval'));lim=max(1,min(int(d.get('daily_ip_registration_limit',3)),20))
 if mode not in ('open','approval','closed'):return jsonify(ok=False,message='Kayıt modu geçersiz.'),400
 c=db();set_setting(c,'registration_mode',mode);set_setting(c,'daily_ip_registration_limit',lim);c.commit();c.close();return jsonify(ok=True,message='Ayarlar kaydedildi.')
@app.get('/api/admin/audit')
@admin
def adaudit():c=db();r=[dict(x) for x in c.execute('select a.*,u.username admin_username from admin_audit a left join users u on u.id=a.admin_id order by a.id desc limit 300').fetchall()];c.close();return jsonify(ok=True,logs=r)

init()
if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT','5000')))
