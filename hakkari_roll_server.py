import os,re,hmac,hashlib,secrets,sqlite3
from datetime import datetime
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
app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=8*1024*1024

def now(): return datetime.now().strftime('%Y-%m-%d %H:%M:%S')
def db():
 c=sqlite3.connect(DB,timeout=30);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');c.execute('PRAGMA journal_mode=WAL');return c
def phash(p,s=None):
 s=s or secrets.token_hex(16);d=hashlib.pbkdf2_hmac('sha256',p.encode()+PEPPER,bytes.fromhex(s),220000).hex();return s,d
def pok(p,s,d): return hmac.compare_digest(phash(p,s)[1],d)
def token():
 v=request.headers.get('Authorization','');return v[7:].strip() if v.lower().startswith('bearer ') else ''
def me():
 t=token();
 if not t:return None
 c=db();r=c.execute('select u.* from sessions s join users u on u.id=s.user_id where s.token=? and u.active=1',(t,)).fetchone();c.close();return r
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
def save(f,prefix):
 if not f or not f.filename:return None
 ext=f.filename.rsplit('.',1)[-1].lower()
 if ext not in {'jpg','jpeg','png','webp'}:raise ValueError('Sadece JPG, PNG veya WEBP yükleyin.')
 n=f'{prefix}_{secrets.token_hex(10)}.{ext}';f.save(UPLOAD/secure_filename(n));return n
def pub(u,viewer=None):return dict(id=u['id'],username=u['username'],display_name=u['display_name'],bio=u['bio'] or '',profile_photo=u['profile_photo'],role=u['role'],is_me=u['id']==viewer)

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
 if not x.execute('select 1 from users where username=?',(ADMIN_USER,)).fetchone():
  s,d=phash(ADMIN_PASS);x.execute('insert into users(username,password_salt,password_hash,display_name,role,created_at) values(?,?,?,?,"admin",?)',(ADMIN_USER,s,d,'Hakkari Roll Admin',now()))
 c.commit();c.close()

def postjson(c,p,uid):
 u=c.execute('select * from users where id=?',(p['user_id'],)).fetchone();lc=c.execute('select count(*) from likes where post_id=?',(p['id'],)).fetchone()[0];cc=c.execute('select count(*) from comments where post_id=? and deleted=0',(p['id'],)).fetchone()[0];liked=bool(c.execute('select 1 from likes where user_id=? and post_id=?',(uid,p['id'])).fetchone());return dict(id=p['id'],body=p['body'] or '',photo=p['photo'],created_at=p['created_at'],author=pub(u,uid),like_count=lc,comment_count=cc,liked=liked)

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

@app.post('/api/register')
def register():
 d=request.get_json() or {};un=str(d.get('username','')).strip();pw=str(d.get('password',''));dn=str(d.get('display_name','')).strip()
 if not re.fullmatch(r'[A-Za-z0-9_.]{3,30}',un):return jsonify(ok=False,message='Kullanıcı adı geçersiz.'),400
 if len(pw)<6 or len(dn)<2:return jsonify(ok=False,message='Ad ve en az 6 karakter şifre gerekli.'),400
 s,h=phash(pw);c=db()
 try:cur=c.execute('insert into users(username,password_salt,password_hash,display_name,created_at) values(?,?,?,?,?)',(un,s,h,dn,now()));c.commit()
 except sqlite3.IntegrityError:c.close();return jsonify(ok=False,message='Kullanıcı adı kullanılıyor.'),409
 uid=cur.lastrowid;t=secrets.token_urlsafe(36);c.execute('insert into sessions values(?,?,?)',(t,uid,now()));c.commit();u=c.execute('select * from users where id=?',(uid,)).fetchone();c.close();return jsonify(ok=True,token=t,user=pub(u,uid))
@app.post('/api/login')
def login():
 d=request.get_json() or {};c=db();u=c.execute('select * from users where username=? collate nocase',(str(d.get('username','')).strip(),)).fetchone()
 if u is None or not u['active'] or not pok(str(d.get('password','')),u['password_salt'],u['password_hash']):c.close();return jsonify(ok=False,message='Kullanıcı adı veya şifre yanlış.'),401
 t=secrets.token_urlsafe(36);c.execute('insert into sessions values(?,?,?)',(t,u['id'],now()));c.execute('update users set last_login=? where id=?',(now(),u['id']));c.commit();c.close();return jsonify(ok=True,token=t,user=pub(u,u['id']))
@app.post('/api/logout')
@auth
def logout():
 c=db();c.execute('delete from sessions where token=?',(token(),));c.commit();c.close();return jsonify(ok=True)
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
 u=me();c=db();e=c.execute('select 1 from follows where follower_id=? and followed_id=?',(u['id'],uid)).fetchone();c.execute('delete from follows where follower_id=? and followed_id=?',(u['id'],uid)) if e else c.execute('insert into follows values(?,?,?)',(u['id'],uid,now()));c.commit();c.close();return jsonify(ok=True,following=not bool(e))

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
 yr=request.form.get('model_year','').strip();yr=int(yr) if yr.isdigit() else None;c=db();cur=c.execute('insert into vehicles(user_id,brand,model,model_year,engine,fuel,horsepower,plate,plate_visible,photo,note,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)',(u['id'],brand,model,yr,request.form.get('engine',''),request.form.get('fuel',''),request.form.get('horsepower',''),request.form.get('plate','').upper(),1 if request.form.get('plate_visible')=='1' else 0,photo,request.form.get('note','')[:500],now()));c.commit();c.close();return jsonify(ok=True,id=cur.lastrowid,message='Araç eklendi.')
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
 try:photo=save(request.files.get('photo'),f'post_{u["id"]}')
 except ValueError as e:return jsonify(ok=False,message=str(e)),400
 if not body and not photo:return jsonify(ok=False,message='Yazı veya fotoğraf ekleyin.'),400
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
 c.execute('insert into messages(conversation_id,sender_id,body,created_at) values(?,?,?,?)',(cid,u['id'],b[:2000],now()));c.commit();c.close();return jsonify(ok=True)

@app.post('/api/report')
@auth
def report():
 u=me();d=request.get_json() or {};c=db();c.execute('insert into reports(reporter_id,target_type,target_id,reason,created_at) values(?,?,?,?,?)',(u['id'],str(d.get('target_type','')),int(d.get('target_id',0)),str(d.get('reason',''))[:500],now()));c.commit();c.close();return jsonify(ok=True,message='Şikâyet gönderildi.')
@app.get('/api/admin/stats')
@admin
def stats():
 c=db();s=dict(users=c.execute('select count(*) from users').fetchone()[0],vehicles=c.execute('select count(*) from vehicles').fetchone()[0],posts=c.execute('select count(*) from posts where deleted=0').fetchone()[0],messages=c.execute('select count(*) from messages').fetchone()[0],reports=c.execute('select count(*) from reports where status="open"').fetchone()[0]);c.close();return jsonify(ok=True,stats=s)
@app.get('/api/admin/reports')
@admin
def reports():
 c=db();r=[dict(x) for x in c.execute('select r.*,u.username reporter_username from reports r join users u on u.id=r.reporter_id order by r.id desc limit 100').fetchall()];c.close();return jsonify(ok=True,reports=r)
@app.post('/api/admin/reports/<int:rid>/close')
@admin
def closereport(rid):
 c=db();c.execute('update reports set status="closed" where id=?',(rid,));c.commit();c.close();return jsonify(ok=True)

init()
if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT','5000')))
