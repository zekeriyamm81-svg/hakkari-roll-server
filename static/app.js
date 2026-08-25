let token=localStorage.getItem("hr_token")||sessionStorage.getItem("hr_token")||"";
let me=JSON.parse(localStorage.getItem("hr_user")||sessionStorage.getItem("hr_user")||"null");
let activeConversation=null,messageTimer=null,rollWatchId=null,rollMap=null,rollMarkers=null,vehicleCatalog={};
const $=id=>document.getElementById(id);
async function api(path,opts={}){
  const headers=opts.headers||{};
  if(token) headers.Authorization=`Bearer ${token}`;
  const res=await fetch(path,{...opts,headers});
  let data={};
  try{data=await res.json()}catch(e){}
  if(!res.ok){
    if(res.status===403 && data.code==="EMAIL_VERIFICATION_REQUIRED"){
      openVerifyModal(data.message);
    }
    throw new Error(data.message||`Hata ${res.status}`);
  }
  return data;
}
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),3000)}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function img(name,cls="avatar"){return name?`<img class="${cls}" src="/uploads/${encodeURIComponent(name)}">`:`<div class="${cls}"></div>`}

// ==================== UYGULAMA İÇİ DİYALOG SİSTEMİ ====================
// Tarayıcının prompt/alert/confirm pencereleri yerine Hakkari Roll tasarımı.
let appDialogResolve=null, appDialogConfig=null;

function appDialog(cfg={}){
  return new Promise(resolve=>{
    appDialogResolve=resolve;
    appDialogConfig={
      title:cfg.title||"İşlem",
      message:cfg.message||"",
      fields:Array.isArray(cfg.fields)?cfg.fields:[],
      confirmText:cfg.confirmText||"DEVAM",
      cancelText:cfg.cancelText||"VAZGEÇ",
      danger:!!cfg.danger,
      allowCancel:cfg.allowCancel!==false
    };

    $("appDialogTitle").textContent=appDialogConfig.title;

    const msg=$("appDialogMessage");
    msg.textContent=appDialogConfig.message;
    msg.classList.toggle("hidden",!appDialogConfig.message);

    const fields=$("appDialogFields");
    fields.innerHTML="";

    appDialogConfig.fields.forEach((f,index)=>{
      const label=document.createElement("label");
      label.className="app-dialog-field";
      const cap=document.createElement("span");
      cap.textContent=f.label||f.name||`Alan ${index+1}`;
      label.appendChild(cap);

      let el;
      if(f.type==="textarea"){
        el=document.createElement("textarea");
      }else if(f.type==="select"){
        el=document.createElement("select");
        (f.options||[]).forEach(o=>{
          const op=document.createElement("option");
          if(typeof o==="object"){op.value=String(o.value);op.textContent=String(o.label)}
          else{op.value=String(o);op.textContent=String(o)}
          el.appendChild(op);
        });
      }else{
        el=document.createElement("input");
        el.type=f.type||"text";
      }

      el.id=`appDialogField_${index}`;
      el.dataset.dialogName=f.name||`field_${index}`;
      if(f.placeholder)el.placeholder=f.placeholder;
      if(f.value!==undefined && f.value!==null)el.value=String(f.value);
      if(f.min!==undefined)el.min=f.min;
      if(f.max!==undefined)el.max=f.max;
      if(f.maxLength!==undefined)el.maxLength=f.maxLength;
      if(f.inputmode)el.inputMode=f.inputmode;
      if(f.autocomplete)el.autocomplete=f.autocomplete;
      if(f.required)el.dataset.required="1";
      label.appendChild(el);
      fields.appendChild(label);
    });

    const confirmBtn=$("appDialogConfirm");
    confirmBtn.textContent=appDialogConfig.confirmText;
    confirmBtn.className=appDialogConfig.danger?"danger":"cta";

    $("appDialogCancel").textContent=appDialogConfig.cancelText;
    $("appDialogCancel").classList.toggle("hidden",!appDialogConfig.allowCancel);
    $("appDialogX").classList.toggle("hidden",!appDialogConfig.allowCancel);

    $("appDialog").classList.remove("hidden");
    document.body.classList.add("dialog-open");

    setTimeout(()=>{
      const first=$("appDialogFields").querySelector("input,textarea,select");
      first?.focus();
    },50);
  });
}

function submitAppDialog(){
  const out={};
  const els=[...$("appDialogFields").querySelectorAll("input,textarea,select")];
  for(const el of els){
    const value=el.value.trim();
    if(el.dataset.required==="1" && !value){
      el.classList.add("field-error");
      el.focus();
      toast("Lütfen gerekli alanı doldur.");
      return;
    }
    el.classList.remove("field-error");
    out[el.dataset.dialogName]=value;
  }
  closeAppDialog(out);
}
function cancelAppDialog(){closeAppDialog(null)}
function closeAppDialog(result){
  $("appDialog").classList.add("hidden");
  document.body.classList.remove("dialog-open");
  const resolve=appDialogResolve;
  appDialogResolve=null;appDialogConfig=null;
  if(resolve)resolve(result);
}
async function appConfirm(title,message,confirmText="ONAYLA"){
  const r=await appDialog({title,message,confirmText,cancelText:"VAZGEÇ",danger:true});
  return r!==null;
}
async function appNotice(title,message,buttonText="TAMAM"){
  await appDialog({title,message,confirmText:buttonText,allowCancel:false});
}
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && !$("appDialog")?.classList.contains("hidden") && appDialogConfig?.allowCancel)cancelAppDialog();
  if(e.key==="Enter" && !$("appDialog")?.classList.contains("hidden")){
    const tag=document.activeElement?.tagName;
    if(tag!=="TEXTAREA")submitAppDialog();
  }
});

function hideAuth(){["loginBox","registerBox","resetBox"].forEach(x=>$(x)?.classList.add("hidden"))}
function showRegister(){hideAuth();$("registerBox").classList.remove("hidden")}function showLogin(){hideAuth();$("loginBox").classList.remove("hidden")}function showReset(){hideAuth();$("resetBox").classList.remove("hidden")}
async function register(){
  try{
    const d=await api("/api/register",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        display_name:$("regName").value,
        username:$("regUser").value,
        password:$("regPass").value
      })
    });
    toast(d.message);
    finishAuth(d);
  }catch(e){
    toast(e.message);
  }
}
async function login(){try{const d=await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("loginUser").value,password:$("loginPass").value})});finishAuth(d)}catch(e){toast(e.message)}}
function finishAuth(d){token=d.token;me=d.user;[localStorage,sessionStorage].forEach(s=>{s.removeItem("hr_token");s.removeItem("hr_user")});const st=$("rememberMe")?.checked?localStorage:sessionStorage;st.setItem("hr_token",token);st.setItem("hr_user",JSON.stringify(me));showApp()}
async function logout(){try{await api("/api/logout",{method:"POST"})}catch(e){}stopRollWatch();token="";me=null;[localStorage,sessionStorage].forEach(s=>{s.removeItem("hr_token");s.removeItem("hr_user")});clearInterval(messageTimer);$("appView").classList.add("hidden");$("authView").classList.remove("hidden");showLogin()}
async function requestReset(){try{const d=await api("/api/password-reset/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("resetEmail").value})});toast(d.message);$("resetConfirmArea").classList.remove("hidden")}catch(e){toast(e.message)}}
async function confirmReset(){try{const d=await api("/api/password-reset/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("resetEmail").value,code:$("resetCode").value,new_password:$("resetNewPass").value})});toast(d.message);setTimeout(showLogin,800)}catch(e){toast(e.message)}}

function usernameHtml(u){const cls=(u?.role==="admin"||u?.vip)?"username-special":"";return `<span class="${cls}">@${esc(u?.username||"")}</span>`}
function vip(u){return u?.vip?`<span class="vip-badge">★ VIP</span>`:""}
function previewMedia(input,boxId,nameId){const f=input.files?.[0],box=$(boxId);if(!f){box.innerHTML="";return}$(nameId).textContent=f.name;const url=URL.createObjectURL(f);box.innerHTML=f.type.startsWith("video/")?`<video src="${url}" controls muted></video>`:`<img src="${url}">`}

function openVerifyModal(message=""){
  if($("verifyText"))$("verifyText").textContent=message||"Bu işlemi yapmak için önce e-posta adresini doğrulaman gerekiyor.";
  $("verifyModal")?.classList.remove("hidden");
}
function closeVerifyModal(){$("verifyModal")?.classList.add("hidden")}
function backToVerifyEmail(){$("verifyCodeStep")?.classList.add("hidden");$("verifyEmailStep")?.classList.remove("hidden")}
async function requestEmailVerification(){
  try{
    const d=await api("/api/email-verification/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("verifyEmail").value})});
    toast(d.message);
    if(d.already_verified){me.email_verified=true;closeVerifyModal();return}
    $("verifyEmailStep").classList.add("hidden");$("verifyCodeStep").classList.remove("hidden");
  }catch(e){toast(e.message)}
}
async function confirmEmailVerification(){
  try{
    const d=await api("/api/email-verification/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:$("verifyCode").value})});
    toast(d.message);me=d.user||me;me.email_verified=true;
    const store=localStorage.getItem("hr_token")?localStorage:sessionStorage;
    store.setItem("hr_user",JSON.stringify(me));
    closeVerifyModal();$("verifyCode").value="";
  }catch(e){toast(e.message)}
}

function buildNav(){const items=[["Ana Sayfa","homePage",loadFeed],["Harita","mapPage",loadRollMap],["Garaj","carsPage",loadVehicles],["Piyasa","peoplePage",loadPeople],["Teklifler","offersPage",loadOffers],["Etkinlik","eventsPage",loadEvents],["Ekipler","crewsPage",loadCrews],["Mesajlar","messagesPage",loadConversations],["Profilim","profilePage",()=>openProfile(me.id)]];if(me.role==="admin")items.push(["Yönetim","adminPage",loadAdmin]);$("nav").innerHTML="";items.forEach(([name,page,fn])=>{const b=document.createElement("button");b.textContent=name;b.onclick=()=>{showPage(page);fn?.()};$("nav").appendChild(b)})}
function showPage(id){document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden")}
async function showApp(){$("authView").classList.add("hidden");$("appView").classList.remove("hidden");buildNav();showPage("homePage");await loadVehicleCatalog();loadFeed();loadRollCount();loadNotifications();setInterval(loadRollCount,15000);setInterval(loadNotifications,20000)}
async function loadVehicleCatalog(){try{vehicleCatalog=await (await fetch("/static/vehicle_catalog.json")).json();fillBrands()}catch(e){}}
function fillBrands(){const s=$("carBrand");if(!s)return;s.innerHTML=Object.keys(vehicleCatalog).map(x=>`<option>${esc(x)}</option>`).join("");catalogBrandChanged()}
function catalogBrandChanged(){const b=$("carBrand").value;const models=Object.keys(vehicleCatalog[b]||{});$("carModel").innerHTML=models.map(x=>`<option>${esc(x)}</option>`).join("");catalogModelChanged()}
function catalogModelChanged(){const x=vehicleCatalog[$("carBrand").value]?.[$("carModel").value]||{};$("carYear").innerHTML=(x.years||[]).slice().reverse().map(y=>`<option>${y}</option>`).join("");$("carEngine").innerHTML=(x.engines||[]).map(([e,f])=>`<option data-fuel="${esc(f)}">${esc(e)}</option>`).join("");catalogEngineChanged()}
function catalogEngineChanged(){const o=$("carEngine").selectedOptions[0];if(o?.dataset.fuel)$("carFuel").value=o.dataset.fuel}
async function createPost(){const fd=new FormData();fd.append("body",$("postBody").value);if($("postPhoto").files[0])fd.append("photo",$("postPhoto").files[0]);try{const d=await api("/api/posts",{method:"POST",body:fd});toast(d.message);$("postBody").value="";$("postPhoto").value="";loadFeed()}catch(e){toast(e.message)}}
async function loadFeed(){try{const d=await api("/api/feed");$("feed").innerHTML=d.posts.length?d.posts.map(postHtml).join(""):`<div class="panel meta">Henüz paylaşım yok.</div>`}catch(e){toast(e.message)}}
function postHtml(p){return `<article class="post ${p.author.vip?"vip-card":""}"><div class="post-head" onclick="openProfile(${p.author.id})">${img(p.author.profile_photo)}<div><div class="name">${esc(p.author.display_name)} ${vip(p.author)}</div><div class="user">@${esc(p.author.username)} • ${esc(p.created_at)}</div></div></div>${p.body?`<div class="post-body">${esc(p.body)}</div>`:""}${p.photo?(p.media_type==="video"?`<video class="media-video" src="/uploads/${encodeURIComponent(p.photo)}" controls playsinline></video>`:`<img class="post-photo" src="/uploads/${encodeURIComponent(p.photo)}">`):""}<div class="post-actions"><button class="${p.liked?"liked":""}" onclick="toggleLike(${p.id})">♥ ${p.like_count}</button><button onclick="toggleComments(${p.id})">💬 ${p.comment_count}</button><button onclick="reportItem('post',${p.id})">ŞİKÂYET</button>${p.author.is_me||me.role==="admin"?`<button class="danger" onclick="deletePost(${p.id})">SİL</button>`:""}</div><div id="comments-${p.id}" class="comment-box hidden"></div></article>`}
async function toggleLike(id){try{await api(`/api/posts/${id}/like`,{method:"POST"});loadFeed()}catch(e){toast(e.message)}}async function deletePost(id){if(!(await appConfirm("Paylaşımı Sil","Bu paylaşım kalıcı olarak silinecek. Devam edilsin mi?","SİL")))return;try{await api(`/api/posts/${id}`,{method:"DELETE"});loadFeed()}catch(e){toast(e.message)}}
async function toggleComments(id){const box=$(`comments-${id}`);if(!box.classList.contains("hidden")){box.classList.add("hidden");return}try{const d=await api(`/api/posts/${id}/comments`);box.innerHTML=d.comments.map(c=>`<div class="comment"><b>${esc(c.display_name)}</b> ${esc(c.body)}</div>`).join("")+`<div class="row"><input id="commentInput-${id}" placeholder="Yorum yaz..."><button onclick="addComment(${id})">GÖNDER</button></div>`;box.classList.remove("hidden")}catch(e){toast(e.message)}}async function addComment(id){const body=$(`commentInput-${id}`).value;try{await api(`/api/posts/${id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});boxRefreshComments(id)}catch(e){toast(e.message)}}async function boxRefreshComments(id){const box=$(`comments-${id}`);box.classList.add("hidden");toggleComments(id)}
async function reportItem(type,id){const r=await appDialog({title:"Şikâyet Gönder",message:"Şikâyet nedenini kısaca açıkla. Admin ekibi inceleyecek.",confirmText:"ŞİKÂYETİ GÖNDER",fields:[{name:"reason",label:"Şikâyet sebebi",type:"textarea",placeholder:"Neden şikâyet ediyorsun?",required:true,maxLength:500}]});if(!r)return;try{const d=await api("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target_type:type,target_id:id,reason:r.reason})});toast(d.message)}catch(e){toast(e.message)}}
function toggleCarForm(){$("carForm").classList.toggle("hidden")}
async function createVehicle(){const fd=new FormData();[["brand","carBrand"],["model","carModel"],["model_year","carYear"],["engine","carEngine"],["fuel","carFuel"],["horsepower","carHp"],["plate","carPlate"],["note","carNote"],["transmission","carTransmission"],["body_type","carBody"],["color","carColor"],["drivetrain","carDrive"],["mods","carMods"]].forEach(([k,id])=>fd.append(k,$(id).value));fd.append("plate_visible",$("carPlateVisible").checked?"1":"0");if($("carPhoto").files[0])fd.append("photo",$("carPhoto").files[0]);try{const d=await api("/api/vehicles",{method:"POST",body:fd});toast(d.message);$("carForm").classList.add("hidden");loadVehicles()}catch(e){toast(e.message)}}
async function loadVehicles(){const q=$("carSearch")?.value||"";try{const d=await api(`/api/vehicles?q=${encodeURIComponent(q)}`);$("vehicles").innerHTML=d.vehicles.map(v=>`<div class="car">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}">`:""}<div class="car-title">${esc(v.brand)} ${esc(v.model)}</div><div class="meta">@${esc(v.username)} • ${esc(v.display_name)}</div><div><span class="badge">${esc(v.model_year||"-")}</span><span class="badge">${esc(v.engine||"-")}</span><span class="badge">${esc(v.fuel||"-")}</span>${v.transmission?`<span class="badge">${esc(v.transmission)}</span>`:""}${v.drivetrain?`<span class="badge">${esc(v.drivetrain)}</span>`:""}</div><div class="meta" style="margin-top:7px">Plaka: ${esc(v.plate||"Gizli")} ${v.color?`• ${esc(v.color)}`:""}</div>${v.mods?`<div class="meta">⚙ ${esc(v.mods)}</div>`:""}<div class="person-actions" style="margin-top:9px"><button onclick="openProfile(${v.user_id})">PROFİL</button><button class="cta mini" onclick="sendOffer(${v.user_id},'roll')">🔥 ROLL</button>${v.user_id===me.id||me.role==="admin"?`<button class="danger" onclick="deleteVehicle(${v.id})">SİL</button>`:""}</div></div>`).join("")}catch(e){toast(e.message)}}async function deleteVehicle(id){if(!(await appConfirm("Aracı Sil","Araç profili ve bu araca ait bilgiler silinecek.","ARACI SİL")))return;try{await api(`/api/vehicles/${id}`,{method:"DELETE"});loadVehicles()}catch(e){toast(e.message)}}
async function loadPeople(){const q=$("peopleSearch")?.value||"";try{const d=await api(`/api/users?q=${encodeURIComponent(q)}`);$("people").innerHTML=d.users.map(u=>`<div class="person"><div class="person-head">${img(u.profile_photo)}<div><div class="name">${esc(u.display_name)}</div><div class="user">@${esc(u.username)}</div></div></div><div class="person-actions">${u.id!==me.id?`<button onclick="toggleFollow(${u.id})">${u.following?"TAKİPTEN ÇIK":"TAKİP ET"}</button><button class="cta mini" onclick="sendOffer(${u.id},'roll')">🔥 ROLL</button><button onclick="sendOffer(${u.id},'piyasa')">🚘 PİYASA</button><button onclick="startChat(${u.id})">MESAJ</button>`:""}<button onclick="openProfile(${u.id})">PROFİL</button></div></div>`).join("")}catch(e){toast(e.message)}}async function toggleFollow(id){try{await api(`/api/users/${id}/follow`,{method:"POST"});loadPeople()}catch(e){toast(e.message)}}
function openRollPanel(){$("rollModal").classList.remove("hidden")}function closeRollPanel(){$("rollModal").classList.add("hidden")}
async function activateRoll(){if(!navigator.geolocation){toast("Konum desteklenmiyor.");return}navigator.geolocation.getCurrentPosition(async pos=>{try{const d=await api("/api/roll/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy,minutes:+$("rollMinutes").value,status:$("rollStatus").value,visibility:$("rollVisibility").value})});toast(d.message);closeRollPanel();startRollWatch();loadRollCount()}catch(e){toast(e.message)}},()=>toast("Konum izni verilmedi."),{enableHighAccuracy:true,timeout:15000})}
function startRollWatch(){stopRollWatch();if(!navigator.geolocation)return;rollWatchId=navigator.geolocation.watchPosition(pos=>api("/api/roll/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy})}).catch(()=>{}),()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:15000})}
function stopRollWatch(){if(rollWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(rollWatchId);rollWatchId=null}}
async function deactivateRoll(){try{const d=await api("/api/roll/deactivate",{method:"POST"});stopRollWatch();toast(d.message);closeRollPanel();loadRollCount()}catch(e){toast(e.message)}}
async function loadRollCount(){try{const d=await api("/api/roll/active");$("liveCount").textContent=`● ${d.count} ROLL AKTİF`;$("rollToggleBtn").textContent=d.active.some(x=>x.user_id===me.id)?"🟢 ROLL AKTİF":"🟢 ROLL AKTİF ET"}catch(e){}}
async function loadRollMap(){try{const d=await api("/api/roll/active");if(!rollMap){rollMap=L.map("rollMap").setView([37.574,43.740],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(rollMap);rollMarkers=L.layerGroup().addTo(rollMap)}rollMarkers.clearLayers();d.active.forEach(x=>{const car=x.vehicle?`${x.vehicle.brand} ${x.vehicle.model}`:"Araç eklenmemiş";L.marker([x.lat,x.lon],{icon:L.divIcon({className:"",html:`<div class="roll-car-icon live">🚗</div>`,iconSize:[42,42],iconAnchor:[21,21]})}).addTo(rollMarkers).bindPopup(`<b>${esc(x.display_name)}</b><br>@${esc(x.username)}<br>${esc(car)}<br><span class="status-live">${esc(x.status)}</span>`)});$("activeRollList").innerHTML=d.active.map(x=>`<div class="person roll-user-card"><div class="person-head">${img(x.profile_photo)}<div><div class="name">${esc(x.display_name)}</div><div class="meta">${esc(x.vehicle?x.vehicle.brand+" "+x.vehicle.model:"Araç yok")} • <span class="status-live">${esc(x.status)}</span></div></div></div>${x.user_id!==me.id?`<div class="person-actions"><button class="cta mini" onclick="sendOffer(${x.user_id},'roll')">🔥 ROLL</button><button onclick="sendOffer(${x.user_id},'piyasa')">🚘 PİYASA</button></div>`:""}</div>`).join("");setTimeout(()=>rollMap.invalidateSize(),100)}catch(e){toast(e.message)}}
async function sendOffer(uid,type){const r=await appDialog({title:type==="roll"?"🔥 Roll Teklifi":"🚘 Piyasa Teklifi",message:"Teklif detaylarını yaz. İki alan da isteğe bağlı.",confirmText:"TEKLİFİ GÖNDER",fields:[{name:"meeting_text",label:type==="roll"?"Buluşma notu":"Yer / saat",type:"text",placeholder:type==="roll"?"Örn: 21:30 merkez":"Örn: 22:00 buluşma noktası",maxLength:250},{name:"message",label:"Mesaj",type:"textarea",placeholder:"Kısa bir mesaj yaz...",maxLength:500}]});if(!r)return;try{const d=await api("/api/offers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({receiver_id:uid,offer_type:type,meeting_text:r.meeting_text,message:r.message})});toast(d.message);loadNotifications()}catch(e){toast(e.message)}}
async function loadOffers(){try{const d=await api("/api/offers");$("offers").innerHTML=d.offers.length?d.offers.map(o=>`<div class="offer-card ${o.status}"><div class="offer-type">${o.offer_type==="roll"?"🔥 ROLL TEKLİFİ":"🚘 PİYASA TEKLİFİ"}</div><div class="name">${o.sender_id===me.id?`Sen → ${esc(o.receiver_name)}`:`${esc(o.sender_name)} → Sen`}</div>${o.message?`<p>${esc(o.message)}</p>`:""}${o.meeting_text?`<div class="meta">📍 ${esc(o.meeting_text)}</div>`:""}<div class="meta">Durum: ${esc(o.status)} • ${esc(o.created_at)}</div>${o.receiver_id===me.id&&o.status==="pending"?`<div class="person-actions"><button class="cta mini" onclick="respondOffer(${o.id},'accepted')">KABUL ET</button><button onclick="respondOffer(${o.id},'rejected')">REDDET</button></div>`:""}</div>`).join(""):`<div class="panel meta">Teklif yok.</div>`}catch(e){toast(e.message)}}async function respondOffer(id,status){try{await api(`/api/offers/${id}/respond`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});loadOffers();loadNotifications()}catch(e){toast(e.message)}}
async function loadNotifications(){try{const d=await api("/api/notifications");$("notifCount").textContent=d.unread?d.unread:"";$("notifications").innerHTML=d.notifications.map(n=>`<div class="notification ${n.read_at?"":"unread"}"><b>${esc(n.title)}</b><div>${esc(n.body||"")}</div><div class="meta">${esc(n.created_at)}</div></div>`).join("")||`<div class="meta">Bildirim yok.</div>`}catch(e){}}
async function openNotifications(){$("notificationsDrawer").classList.remove("hidden");await loadNotifications();try{await api("/api/notifications/read-all",{method:"POST"});$("notifCount").textContent=""}catch(e){}}function closeNotifications(){$("notificationsDrawer").classList.add("hidden")}
function toggleEventForm(){
  const f=$("eventForm");
  f.classList.toggle("hidden");
  if(!f.classList.contains("hidden"))setTimeout(()=>$("eventTitle")?.focus(),50);
}
async function createEvent(){
  toast("Etkinlik yayınlanıyor...");
  const title=$("eventTitle").value.trim();
  const event_time=$("eventTime").value;
  const meeting_text=$("eventMeeting").value.trim();
  const description=$("eventDesc").value.trim();
  if(!title){toast("Etkinlik adını yaz.");$("eventTitle").focus();return false}
  if(!event_time){toast("Tarih ve saat seç.");$("eventTime").focus();return false}

  const btn=$("eventPublishBtn");
  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent="YAYINLANIYOR..."}

  try{
    const d=await api("/api/events",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,event_time,meeting_text,description})
    });
    toast(d.message||"Etkinlik yayınlandı.");
    $("eventTitle").value="";
    $("eventTime").value="";
    $("eventMeeting").value="";
    $("eventDesc").value="";
    $("eventForm").classList.add("hidden");
    await loadEvents();
  }catch(e){
    toast(e.message||"Etkinlik yayınlanamadı.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=oldText||"ETKİNLİĞİ YAYINLA"}
  }
  return false;
}
async function loadEvents(){try{const d=await api("/api/events");$("events").innerHTML=d.events.map(e=>`<div class="event-card"><div class="name">${esc(e.title)}</div><div class="meta">@${esc(e.username)} • ${esc(e.event_time||"")}</div><p>${esc(e.description||"")}</p><div class="meta">📍 ${esc(e.meeting_text||"-")} • ${e.going_count} kişi</div><button class="${e.going?"cta":""}" onclick="toggleEvent(${e.id})">${e.going?"KATILIYORUM ✓":"KATIL"}</button>${e.owner_id===me.id||me.role==="admin"?`<button class="danger" onclick="deleteEvent(${e.id})">SİL</button>`:""}</div>`).join("")||`<div class="panel meta">Etkinlik yok.</div>`}catch(e){toast(e.message)}}async function toggleEvent(id){try{await api(`/api/events/${id}/toggle`,{method:"POST"});loadEvents()}catch(e){toast(e.message)}}async function deleteEvent(id){if(!(await appConfirm("Etkinliği Sil","Bu etkinlik ve katılım bilgileri kaldırılacak.","ETKİNLİĞİ SİL")))return;try{await api(`/api/events/${id}`,{method:"DELETE"});loadEvents()}catch(e){toast(e.message)}}
function createCrew(){$("crewName").value="";$("crewDescription").value="";$("crewCreateModal").classList.remove("hidden")}function closeCrewCreate(){$("crewCreateModal").classList.add("hidden")}async function saveCrewCreate(){const name=$("crewName").value.trim(),description=$("crewDescription").value.trim();if(!name){toast("Ekip adı gerekli.");return}try{const d=await api("/api/crews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,description})});toast(d.message);closeCrewCreate();loadCrews()}catch(e){toast(e.message)}}async function loadCrews(){try{const d=await api("/api/crews");$("crews").innerHTML=d.crews.map(c=>`<div class="crew-card"><div class="name">👥 ${esc(c.name)}</div><div class="meta">Kurucu @${esc(c.username)} • ${c.member_count} üye</div><p>${esc(c.description||"")}</p><button class="${c.member?"cta":""}" onclick="toggleCrew(${c.id})">${c.member?"EKİPTESİN ✓":"EKİBE KATIL"}</button></div>`).join("")||`<div class="panel meta">Henüz ekip yok.</div>`}catch(e){toast(e.message)}}async function toggleCrew(id){try{const d=await api(`/api/crews/${id}/toggle`,{method:"POST"});toast(d.message||"Güncellendi.");loadCrews()}catch(e){toast(e.message)}}
async function openProfile(id){showPage("profilePage");try{const d=await api(`/api/users/${id}`),u=d.user;$("profileBox").innerHTML=`<div class="profile-card"><div class="profile-head">${img(u.profile_photo,"avatar big")}<div><h2>${esc(u.display_name)}</h2><div class="user">@${esc(u.username)}</div><p>${esc(u.bio||"")}</p><div class="meta">${u.follower_count} takipçi • ${u.following_count} takip</div></div></div><div class="person-actions">${u.id!==me.id?`<button onclick="toggleFollowProfile(${u.id})">${u.following?"TAKİPTEN ÇIK":"TAKİP ET"}</button><button class="cta mini" onclick="sendOffer(${u.id},'roll')">🔥 ROLL TEKLİFİ</button><button onclick="sendOffer(${u.id},'piyasa')">🚘 PİYASA TEKLİFİ</button><button onclick="startChat(${u.id})">MESAJ</button>`:`<button onclick="editProfile()">PROFİLİ DÜZENLE</button><button onclick="changeProfilePhoto()">FOTOĞRAF</button>`}</div><h3>Garaj</h3><div class="car-grid">${d.vehicles.map(v=>`<div class="car">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}">`:""}<div class="car-title">${esc(v.brand)} ${esc(v.model)}</div><div class="meta">${esc(v.model_year||"-")} • ${esc(v.engine||"-")} • ${esc(v.fuel||"-")}</div><div class="meta">Plaka: ${v.plate_visible||u.is_me||me.role==="admin"?esc(v.plate||"-"):"Gizli"}</div></div>`).join("")||`<div class="meta">Araç yok.</div>`}</div><h3>Paylaşımlar</h3><div class="stack">${d.posts.map(postHtml).join("")||`<div class="meta">Paylaşım yok.</div>`}</div></div>`}catch(e){toast(e.message)}}async function toggleFollowProfile(id){try{await api(`/api/users/${id}/follow`,{method:"POST"});openProfile(id)}catch(e){toast(e.message)}}function editProfile(){$("editDisplayName").value=me.display_name||"";$("editBio").value=me.bio||"";$("profileEditModal").classList.remove("hidden")}function closeProfileEdit(){$("profileEditModal").classList.add("hidden")}async function saveProfileEdit(){const display_name=$("editDisplayName").value.trim(),bio=$("editBio").value.trim();if(!display_name){toast("Görünen ad gerekli.");return}try{const d=await api("/api/me",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name,bio})});me=d.user;localStorage.setItem("hr_user",JSON.stringify(me));closeProfileEdit();openProfile(me.id);toast("Profil güncellendi.")}catch(e){toast(e.message)}}async function changeProfilePhoto(){const input=document.createElement("input");input.type="file";input.accept="image/*";input.onchange=async()=>{const fd=new FormData();fd.append("photo",input.files[0]);try{const d=await api("/api/me/photo",{method:"POST",body:fd});me.profile_photo=d.profile_photo;localStorage.setItem("hr_user",JSON.stringify(me));openProfile(me.id)}catch(e){toast(e.message)}};input.click()}
async function startChat(uid){try{const d=await api(`/api/conversations/with/${uid}`,{method:"POST"});showPage("messagesPage");await loadConversations();openConversation(d.conversation_id)}catch(e){toast(e.message)}}async function loadConversations(){try{const d=await api("/api/conversations");$("conversations").innerHTML=d.conversations.map(c=>`<div class="conversation" onclick="openConversation(${c.id},'${esc(c.other.display_name)}')"><b>${esc(c.other.display_name)}</b><div class="user">@${esc(c.other.username)}</div><div class="meta">${esc(c.last_message?.body||"Yeni sohbet")}</div></div>`).join("")||`<div class="meta">Sohbet yok.</div>`}catch(e){toast(e.message)}}async function openConversation(id,title="Sohbet"){activeConversation=id;$("chatTitle").textContent=title;await loadMessages();clearInterval(messageTimer);messageTimer=setInterval(loadMessages,1800)}async function loadMessages(){if(!activeConversation)return;try{const d=await api(`/api/conversations/${activeConversation}/messages`);$("chatMessages").innerHTML=d.messages.map(m=>`<div class="bubble ${m.sender_id===me.id?"me":""}">${esc(m.body)}<div class="bubble-time">${esc(m.created_at)}</div></div>`).join("");$("chatMessages").scrollTop=$("chatMessages").scrollHeight}catch(e){}}async function sendMessage(){if(!activeConversation)return;const body=$("chatInput").value.trim();if(!body)return;try{await api(`/api/conversations/${activeConversation}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});$("chatInput").value="";loadMessages();loadConversations()}catch(e){toast(e.message)}}
let adminUsersCache=[];function adminTab(id){document.querySelectorAll(".adminbox").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden");if(id==="adminWeeklyBox")loadWeeklyPickers()}async function loadAdmin(){try{const [s,u,r,st,a]=await Promise.all([api("/api/admin/stats"),api("/api/admin/users"),api("/api/admin/reports"),api("/api/admin/settings"),api("/api/admin/audit")]);$("adminStats").innerHTML=Object.entries(s.stats).map(([k,v])=>`<div class="stat"><strong>${v}</strong>${esc(k)}</div>`).join("");adminUsersCache=u.users;renderAdminUsers();$("adminReports").innerHTML=r.reports.map(x=>`<div class="panel"><b>${esc(x.target_type)} #${x.target_id}</b><div class="meta">@${esc(x.reporter_username)} • ${esc(x.status)}</div><p>${esc(x.reason||"")}</p><div class="admin-actions">${x.status==="open"?`<button onclick="adminCloseReport(${x.id})">KAPAT</button>`:""}${["post","comment","vehicle"].includes(x.target_type)?`<button class="danger" onclick="adminDeleteContent('${x.target_type}',${x.target_id})">İÇERİĞİ SİL</button>`:""}${x.target_type==="user"?`<button onclick="adminBan(${x.target_id})">BANLA</button><button class="danger" onclick="adminDeleteUser(${x.target_id})">HESABI SİL</button>`:""}</div></div>`).join("");$("regMode").value=st.settings.registration_mode||"approval";$("regLimit").value=st.settings.daily_ip_registration_limit||3;$("adminAudit").innerHTML=a.logs.map(x=>`<div class="panel"><b>${esc(x.action)}</b><div class="meta">@${esc(x.admin_username||"sistem")} • ${esc(x.created_at||"")}</div></div>`).join("")}catch(e){toast(e.message)}}function renderAdminUsers(){const q=($("adminUserSearch")?.value||"").toLowerCase();$("adminUsers").innerHTML=adminUsersCache.filter(u=>`${u.username} ${u.display_name} ${u.email||""}`.toLowerCase().includes(q)).map(u=>`<div class="panel admin-user ${u.vip?"vip-card":""}"><div><div class="name">${esc(u.display_name)} @${esc(u.username)} ${u.vip?`<span class="vip-badge">★ VIP</span>`:""} ${!u.approved?`<span class="pending-badge">ONAY</span>`:""} ${u.banned?`<span class="ban-badge">BANLI</span>`:""}</div><div class="meta">${esc(u.email||"E-posta yok")} • ${u.role} • ${u.active?"Aktif":"Pasif"}</div></div><div class="admin-actions">${!u.approved?`<button class="cta" onclick="adminApprove(${u.id})">ONAYLA</button>`:""}<button onclick="adminVip(${u.id})">${u.vip?"VIP KALDIR":"VIP YAP"}</button><button onclick="adminBan(${u.id})">BANLA</button>${u.banned?`<button onclick="adminUnban(${u.id})">BAN KALDIR</button>`:""}<button onclick="adminResetPassword(${u.id})">ŞİFRE</button><button onclick="adminToggleActive(${u.id})">${u.active?"PASİF":"AKTİF"}</button>${u.role!=="admin"?`<button class="danger" onclick="adminDeleteUser(${u.id})">SİL</button>`:""}</div></div>`).join("")}async function adminCreateUser(){try{const d=await api("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name:$("acuName").value,username:$("acuUser").value,email:$("acuEmail").value,password:$("acuPass").value,role:$("acuRole").value,vip:$("acuVip").checked})});await appNotice("Hesap Oluşturuldu",`Kullanıcı: ${d.username}
Şifre: ${d.password}`,"TAMAM");loadAdmin()}catch(e){toast(e.message)}}async function adminApprove(id){await api(`/api/admin/users/${id}/approve`,{method:"POST"});loadAdmin()}async function adminVip(id){await api(`/api/admin/users/${id}/vip`,{method:"POST"});loadAdmin()}async function adminBan(id){const r=await appDialog({title:"Kullanıcıyı Banla",message:"Ban süresini ve sebebini seç.",confirmText:"BANLA",danger:true,fields:[{name:"minutes",label:"Ban süresi",type:"select",value:"1440",options:[{value:"60",label:"1 saat"},{value:"1440",label:"1 gün"},{value:"10080",label:"7 gün"},{value:"43200",label:"30 gün"},{value:"5256000",label:"Uzun süre / kalıcı"}]},{name:"reason",label:"Sebep",type:"textarea",placeholder:"Ban sebebi...",maxLength:500}]});if(!r)return;await api(`/api/admin/users/${id}/ban`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({minutes:+r.minutes,reason:r.reason||""})});toast("Kullanıcı banlandı.");loadAdmin()}async function adminUnban(id){await api(`/api/admin/users/${id}/unban`,{method:"POST"});loadAdmin()}async function adminResetPassword(id){const r=await appDialog({title:"Şifreyi Sıfırla",message:"Yeni şifreyi boş bırakırsan sistem güvenli bir şifre oluşturur.",confirmText:"ŞİFREYİ YENİLE",fields:[{name:"password",label:"Yeni şifre",type:"password",placeholder:"Boş bırak = otomatik",autocomplete:"new-password",maxLength:100}]});if(!r)return;const d=await api(`/api/admin/users/${id}/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:r.password})});await appNotice("Yeni Şifre Oluşturuldu",`Yeni şifre: ${d.password}`,"TAMAM")}async function adminToggleActive(id){await api(`/api/admin/users/${id}/toggle-active`,{method:"POST"});loadAdmin()}async function adminDeleteUser(id){if(!(await appConfirm("Hesabı Kalıcı Sil","Bu işlem geri alınamaz. Kullanıcının hesabı ve ilişkili verileri silinecek.","HESABI SİL")))return;await api(`/api/admin/users/${id}`,{method:"DELETE"});toast("Hesap silindi.");loadAdmin()}async function adminCloseReport(id){await api(`/api/admin/reports/${id}/close`,{method:"POST"});loadAdmin()}async function adminDeleteContent(t,id){if(!(await appConfirm("İçeriği Sil","Şikâyet edilen içerik kalıcı olarak kaldırılacak.","İÇERİĞİ SİL")))return;await api(`/api/admin/content/${t}/${id}`,{method:"DELETE"});toast("İçerik silindi.");loadAdmin()}async function saveAdminSettings(){const d=await api("/api/admin/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({registration_mode:$("regMode").value,daily_ip_registration_limit:+$("regLimit").value})});toast(d.message)}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/service-worker.js").catch(()=>{});if(token&&me)showApp();else showLogin();

// HAKKARI ROLL V4
let v4PresenceTimer=null;
async function loadV4Home(){try{const d=await api("/api/v4/dashboard");$("radarCount").textContent=`${d.roll_active} kişi`;$("rollScore").textContent=d.score;$("rollLevel").textContent=d.level;$("announcementStrip").innerHTML=(d.announcements||[]).map(a=>`<div class="announcement-card"><b>📢 ${esc(a.title)}</b><div>${esc(a.body)}</div></div>`).join("");const w=d.weekly_car,wu=d.weekly_user;$("weeklyCar").innerHTML=(wu?`<div class="weekly-user spotlight-user" onclick="openProfile(${wu.id})">${img(wu.profile_photo,"avatar weekly-profile-avatar")}<div><div class="eyebrow">⭐ HAFTANIN KULLANICISI</div><div class="weekly-person-name">${esc(wu.display_name)}</div><div class="user">${usernameHtml(wu)} ${vip(wu)}</div><button>PROFİLİ GÖR</button></div></div>`:"")+(w?`<div class="weekly-car-feature"><div class="weekly-title"><span>🏆 HAFTANIN ARABASI</span><b>${w.votes||0} oy</b></div><div class="weekly-owner" onclick="openProfile(${w.user_id})">${img(w.profile_photo,"avatar weekly-profile-avatar")}<div><div class="weekly-person-name">${esc(w.display_name)}</div><div class="user">${usernameHtml(w)} ${vip(w)}</div><small>${esc(w.brand)} ${esc(w.model)} ${w.plate?`• ${esc(w.plate)}`:""}</small></div>${brandLogo(w.brand,"weekly-small-brand-logo")}</div>${w.photo?`<img class="weekly-car-photo" src="/uploads/${encodeURIComponent(w.photo)}">`:""}<button class="cta mini" onclick="voteVehicle(${w.id})">🔥 OY VER</button></div>`:"")}catch(e){}loadStories()}
async function loadStories(){try{const d=await api("/api/stories");window.hrStories=d.stories;const by={};d.stories.forEach(s=>{if(!by[s.user_id])by[s.user_id]=s});$("stories").innerHTML=Object.values(by).map(s=>`<button class="story-bubble" onclick="openStory(${s.id})"><span class="story-ring">${img(s.profile_photo,"story-avatar")}</span><small>${esc(s.display_name)}</small></button>`).join("")||`<div class="meta story-empty">Henüz hikâye yok.</div>`}catch(e){}}
function createStory(){const i=document.createElement("input");i.type="file";i.accept="image/*,video/mp4,video/webm";i.onchange=async()=>{if(!i.files[0])return;const r=await appDialog({title:"Hikâye Paylaş",message:"Seçtiğin fotoğraf/video 24 saat hikâyende kalacak.",confirmText:"HİKÂYEYİ YAYINLA",fields:[{name:"body",label:"Hikâye notu",type:"textarea",placeholder:"Bir şeyler yaz... (opsiyonel)",maxLength:300}]});if(!r)return;const fd=new FormData();fd.append("media",i.files[0]);fd.append("body",r.body||"");try{const d=await api("/api/stories",{method:"POST",body:fd});toast(d.message);loadStories()}catch(e){toast(e.message)}};i.click()}
function openStory(id){const s=(window.hrStories||[]).find(x=>x.id===id);if(!s)return;$("storyOwner").textContent=`${s.display_name} • @${s.username}`;const media=s.media?(s.media.match(/\.(mp4|webm)$/i)?`<video class="story-media" src="/uploads/${encodeURIComponent(s.media)}" autoplay controls playsinline></video>`:`<img class="story-media" src="/uploads/${encodeURIComponent(s.media)}">`):"";$("storyContent").innerHTML=`${media}${s.body?`<p class="story-caption">${esc(s.body)}</p>`:""}${s.user_id===me.id||me.role==="admin"?`<button class="danger" onclick="deleteStory(${s.id})">HİKÂYEYİ SİL</button>`:""}`;$("storyModal").classList.remove("hidden")}
function closeStory(){$("storyModal").classList.add("hidden");$("storyContent").innerHTML=""}
async function deleteStory(id){try{await api(`/api/stories/${id}`,{method:"DELETE"});closeStory();loadStories()}catch(e){toast(e.message)}}
async function voteVehicle(id){try{const d=await api(`/api/vehicles/${id}/vote`,{method:"POST"});toast(d.voted?"Oy verildi 🔥":"Oy geri çekildi.");loadV4Home()}catch(e){toast(e.message)}}
async function setFavoriteVehicle(id){try{const d=await api(`/api/vehicles/${id}/favorite`,{method:"POST"});toast(d.message);openProfile(me.id)}catch(e){toast(e.message)}}
async function addGalleryPhoto(id){const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=async()=>{const fd=new FormData();fd.append("photo",i.files[0]);try{const d=await api(`/api/vehicles/${id}/gallery`,{method:"POST",body:fd});toast(d.message)}catch(e){toast(e.message)}};i.click()}
async function blockUser(id){try{const d=await api(`/api/users/${id}/block`,{method:"POST"});toast(d.blocked?"Kullanıcı engellendi.":"Engel kaldırıldı.");openProfile(id)}catch(e){toast(e.message)}}
async function editV4Profile(){const r=await appDialog({title:"Sosyal Bilgiler",message:"Profilinde göstermek istediğin sosyal bilgileri düzenle.",confirmText:"KAYDET",fields:[{name:"instagram",label:"Instagram",type:"text",placeholder:"kullaniciadi",maxLength:80}]});if(!r)return;try{await api("/api/v4/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({instagram:r.instagram})});toast("Sosyal bilgiler güncellendi.");openProfile(me.id)}catch(e){toast(e.message)}}
async function changeCoverPhoto(){const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=async()=>{const fd=new FormData();fd.append("photo",i.files[0]);try{await api("/api/v4/profile/cover",{method:"POST",body:fd});openProfile(me.id)}catch(e){toast(e.message)}};i.click()}
async function adminAnnouncement(){const title=$("annTitle").value.trim(),body=$("annBody").value.trim(),hours=+$("annHours").value||24;try{const d=await api("/api/admin/announcements",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body,hours})});toast(d.message)}catch(e){toast(e.message)}}
async function adminGiveBadge(uid){const r=await appDialog({title:"Rozet Ver",message:"Kullanıcının profilinde görünecek rozeti seç veya yaz.",confirmText:"ROZETİ VER",fields:[{name:"badge",label:"Rozet",type:"text",value:"Kurucu Üye",placeholder:"Örn: Kurucu Üye",required:true,maxLength:50}]});if(!r)return;try{const d=await api(`/api/admin/users/${uid}/badge`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({badge:r.badge})});toast(d.message)}catch(e){toast(e.message)}}
let activeCrewChat=null,crewChatTimer=null;async function openCrewChat(cid,name){activeCrewChat=cid;$("crewChatTitle").textContent=`💬 ${name}`;$("crewChatModal").classList.remove("hidden");await loadCrewMessages();clearInterval(crewChatTimer);crewChatTimer=setInterval(loadCrewMessages,1800)}function closeCrewChat(){$("crewChatModal").classList.add("hidden");activeCrewChat=null;clearInterval(crewChatTimer)}async function loadCrewMessages(){if(!activeCrewChat)return;try{const d=await api(`/api/crews/${activeCrewChat}/messages`);$("crewChatMessages").innerHTML=d.messages.map(x=>`<div class="bubble ${x.user_id===me.id?"me":""}"><b>${esc(x.display_name)}</b><br>${esc(x.body)}<div class="bubble-time">${esc(x.created_at)}</div></div>`).join("")||`<div class="meta">Henüz mesaj yok. İlk mesajı sen gönder.</div>`;$("crewChatMessages").scrollTop=$("crewChatMessages").scrollHeight}catch(e){toast(e.message)}}async function sendCrewMessage(){if(!activeCrewChat)return;const body=$("crewChatInput").value.trim();if(!body)return;try{await api(`/api/crews/${activeCrewChat}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});$("crewChatInput").value="";loadCrewMessages()}catch(e){toast(e.message)}}
async function v4Presence(){try{await api("/api/v4/presence",{method:"POST"})}catch(e){}}
window.addEventListener("load",()=>setTimeout(()=>{if(typeof me!=="undefined"&&me){loadV4Home();v4Presence();v4PresenceTimer=setInterval(v4Presence,60000)}},1200));
const _v4OpenProfile=openProfile;openProfile=async function(id){await _v4OpenProfile(id);try{const x=await api(`/api/v4/profile/${id}`),card=$("profileBox").querySelector(".profile-card");if(!card)return;if(x.cover_photo){card.style.backgroundImage=`linear-gradient(#0d1118dd,#0d1118f7),url('/uploads/${encodeURIComponent(x.cover_photo)}')`;card.style.backgroundSize="100% 210px";card.style.backgroundRepeat="no-repeat"}const head=card.querySelector(".profile-head");if(head)head.insertAdjacentHTML("afterend",`<div class="v4-profile-info"><span class="level-chip">🏁 ${esc(x.level)} • ${x.score} puan</span>${(x.badges||[]).map(b=>`<span class="profile-badge">🏅 ${esc(b)}</span>`).join("")}${x.instagram?`<span class="profile-badge">📸 @${esc(x.instagram)}</span>`:""}${x.last_seen?`<span class="last-seen">Son görülme: ${esc(x.last_seen)}</span>`:""}</div>`);const acts=card.querySelector(".person-actions");if(acts){if(id===me.id)acts.insertAdjacentHTML("beforeend",`<button onclick="editV4Profile()">SOSYAL BİLGİ</button><button onclick="changeCoverPhoto()">KAPAK</button>`);else acts.insertAdjacentHTML("beforeend",`<button class="danger" onclick="blockUser(${id})">${x.blocked?"ENGELİ KALDIR":"ENGELLE"}</button>`)}if(id===me.id){const pd=await api(`/api/users/${id}`);card.querySelectorAll(".car").forEach((el,k)=>{const v=pd.vehicles[k];if(v)el.insertAdjacentHTML("beforeend",`<div class="car-v4-actions"><button onclick="setFavoriteVehicle(${v.id})">⭐ FAVORİ</button><button onclick="addGalleryPhoto(${v.id})">📷 GALERİ</button></div>`)})}}catch(e){}}
const _v4LoadCrews=loadCrews;loadCrews=async function(){await _v4LoadCrews();try{const d=await api("/api/crews");document.querySelectorAll("#crews .crew-card").forEach((el,i)=>{const x=d.crews[i];if(x&&x.member)el.insertAdjacentHTML("beforeend",`<button onclick="openCrewChat(${x.id},'${esc(x.name)}')">💬 EKİP SOHBETİ</button>`)})}catch(e){}}

// HAKKARI ROLL V4.1 - yerel marka rozetleri
const HR_REAL_BRAND_LOGOS={"Alfa Romeo": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/alfaromeo.svg", "Audi": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/audi.svg", "BMW": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/bmw.svg", "Chevrolet": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/chevrolet.svg", "Citroën": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/citroen.svg", "CUPRA": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/cupra.svg", "Dacia": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/dacia.svg", "Fiat": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/fiat.svg", "Ford": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/ford.svg", "Honda": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/honda.svg", "Hyundai": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/hyundai.svg", "Jeep": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/jeep.svg", "Kia": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/kia.svg", "Land Rover": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/landrover.svg", "Lexus": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/lexus.svg", "Mazda": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/mazda.svg", "Mercedes-Benz": "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mercedes-Benz_free_logo.svg", "MINI": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/mini.svg", "Mitsubishi": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/mitsubishi.svg", "Nissan": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/nissan.svg", "Opel": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/opel.svg", "Peugeot": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/peugeot.svg", "Porsche": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/porsche.svg", "Range Rover": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/landrover.svg", "Renault": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/renault.svg", "SEAT": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/seat.svg", "Škoda": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/skoda.svg", "Suzuki": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/suzuki.svg", "Tesla": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/tesla.svg", "Togg": "https://www.togg.com.tr/assets/images/togg-logo.svg", "Toyota": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/toyota.svg", "Volkswagen": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/volkswagen.svg", "Volvo": "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@16.28.0/icons/volvo.svg"};

function brandLogoUrl(brand){
  const key=Object.keys(HR_REAL_BRAND_LOGOS).find(k=>k.toLocaleLowerCase("tr-TR")===String(brand||"").toLocaleLowerCase("tr-TR"));
  return key?HR_REAL_BRAND_LOGOS[key]:"/static/brands/generic.svg";
}
function brandLogo(brand,cls="brand-logo"){
  return `<img class="${cls}" src="${brandLogoUrl(brand)}" alt="${esc(brand||"Araç")} marka rozeti" loading="lazy">`;
}
function decorateBrandLogos(root=document){
  root.querySelectorAll(".car").forEach(card=>{
    if(card.querySelector(".brand-logo"))return;
    const text=(card.innerText||"").trim();
    const brand=Object.keys(HR_REAL_BRAND_LOGOS).find(b=>text.toLocaleLowerCase("tr-TR").includes(b.toLocaleLowerCase("tr-TR")));
    if(brand)card.insertAdjacentHTML("afterbegin",brandLogo(brand));
  });
}
const _hrRenderVehicles=typeof renderVehicles==="function"?renderVehicles:null;
if(_hrRenderVehicles){renderVehicles=async function(...a){const r=await _hrRenderVehicles(...a);setTimeout(()=>decorateBrandLogos(),0);return r}}
const _hrSearchVehicles=typeof searchVehicles==="function"?searchVehicles:null;
if(_hrSearchVehicles){searchVehicles=async function(...a){const r=await _hrSearchVehicles(...a);setTimeout(()=>decorateBrandLogos(),0);return r}}
const _hrV41Profile=openProfile;
openProfile=async function(...a){const r=await _hrV41Profile(...a);setTimeout(()=>decorateBrandLogos($("profileBox")),0);return r}
window.addEventListener("load",()=>setTimeout(()=>decorateBrandLogos(),1500));


// HAKKARI ROLL PWA
let deferredPWA=null;
const isStandalone=()=>window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
function showPWAInstall(){
  if(isStandalone()||localStorage.getItem("hr_pwa_dismissed")==="1")return;
  const bar=$("pwaInstallBar"); if(!bar)return;
  bar.classList.remove("hidden");
  if(isIOS()){$("pwaInstallBtn").textContent="NASIL YÜKLENİR?";$("pwaInstallHint").textContent="Safari'den Ana Ekrana Ekle."}
}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPWA=e;showPWAInstall()});
window.addEventListener("appinstalled",()=>{deferredPWA=null;$("pwaInstallBar")?.classList.add("hidden");toast("Hakkari Roll telefona yüklendi 🚗")});
async function installPWA(){
  if(isIOS()){$("pwaIosHelp").classList.remove("hidden");return}
  if(!deferredPWA){toast("Tarayıcı menüsünden “Uygulamayı yükle” veya “Ana ekrana ekle” seçeneğini kullan.");return}
  deferredPWA.prompt();await deferredPWA.userChoice;deferredPWA=null;$("pwaInstallBar").classList.add("hidden");
}
function dismissPWA(){localStorage.setItem("hr_pwa_dismissed","1");$("pwaInstallBar").classList.add("hidden")}
if("serviceWorker" in navigator){
 window.addEventListener("load",()=>navigator.serviceWorker.register("/static/service-worker.js").then(reg=>{
   reg.addEventListener("updatefound",()=>{const nw=reg.installing;if(nw)nw.addEventListener("statechange",()=>{if(nw.state==="installed"&&navigator.serviceWorker.controller)toast("Hakkari Roll güncellendi. Uygulamayı yeniden aç.")})})
 }).catch(()=>{}));
}
window.addEventListener("load",()=>setTimeout(showPWAInstall,1800));

let weeklyPickUsers=[],weeklyPickCars=[];
async function loadWeeklyPickers(){
 try{
  const [u,v]=await Promise.all([api("/api/admin/users"),api("/api/vehicles/weekly")]);
  weeklyPickUsers=u.users||[];
  weeklyPickCars=v.vehicles||v.cars||[];
  renderWeeklyUserChoices();renderWeeklyCarChoices();
 }catch(e){console.warn(e)}
}
function renderWeeklyUserChoices(){
 const box=$("weeklyUserChoices");if(!box)return;
 const q=($("weeklyUserSearch")?.value||"").toLocaleLowerCase("tr");
 const a=weeklyPickUsers.filter(u=>`${u.display_name} ${u.username}`.toLocaleLowerCase("tr").includes(q)).slice(0,20);
 box.innerHTML=a.map(u=>`<button class="weekly-choice" onclick="adminWeekly('user',${u.id})">${img(u.profile_photo,"choice-avatar")}<span><b>${esc(u.display_name)}</b><small>${usernameHtml(u)} ${vip(u)}</small></span><strong>SEÇ</strong></button>`).join("")||`<div class="meta">Kullanıcı bulunamadı.</div>`;
}
function renderWeeklyCarChoices(){
 const box=$("weeklyCarChoices");if(!box)return;
 const q=($("weeklyCarSearch")?.value||"").toLocaleLowerCase("tr");
 const a=weeklyPickCars.filter(v=>`${v.brand} ${v.model} ${v.plate||""} ${v.display_name||""} ${v.username||""}`.toLocaleLowerCase("tr").includes(q)).slice(0,20);
 box.innerHTML=a.map(v=>`<button class="weekly-choice" onclick="adminWeekly('car',${v.id})">${brandLogo(v.brand,"choice-brand-logo")}<span><b>${esc(v.brand)} ${esc(v.model)}</b><small>${esc(v.plate||"")} • ${esc(v.display_name||"")} @${esc(v.username||"")}</small></span><strong>SEÇ</strong></button>`).join("")||`<div class="meta">Araç bulunamadı.</div>`;
}
async function adminWeekly(kind,id){if(!id)return;try{const d=await api("/api/admin/weekly-feature",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,target_id:id})});toast(d.message);loadV4Home();loadWeeklyPickers()}catch(e){toast(e.message)}}
