let token=localStorage.getItem("hr_token")||sessionStorage.getItem("hr_token")||"";
let me=JSON.parse(localStorage.getItem("hr_user")||sessionStorage.getItem("hr_user")||"null");
let activeConversation=null,messageTimer=null,rollWatchId=null,rollMap=null,rollMarkers=null,vehicleCatalog={};
let garageMode="mine",conversationCache=[],conversationUnreadOnly=false;
// V5.4 canlı katman
let lastMessageId=0,messagePollTick=0,messageLiveBusy=false,typingStopTimer=null,typingLastSent=0;
let hrPulseTimer=null,hrMapLiveTick=0,selectedMessageId=null;
let globalSearchCache={users:[],vehicles:[],crews:[],events:[]},globalSearchTab="all",globalSearchTimer=null;
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

const HR_AGREEMENT_DOC={
 title:"Hakkari Roll Kullanım ve Güvenlik Kuralları",
 html:`<div class="legal-intro"><b>Hakkari Roll Topluluk Sözleşmesi</b><p>Bu metin Hakkari Roll'u kullanırken uyman gereken temel güvenlik, topluluk, konum ve gizlilik kurallarını açıklar. Hesap açmadan önce metnin tamamını okuyup kabul etmen gerekir.</p></div>
 <h3>1. Güvenli sürüş ve trafik kuralları</h3><p>Hakkari Roll bir yarış, hız denemesi veya trafik kurallarını ihlal etme platformu değildir. Hız yapma, makas atma, drift yapma, kamuya açık yolu kapatma, izinsiz yarış düzenleme veya trafiği tehlikeye düşüren davranışlar uygulama tarafından teşvik edilmez.</p>
 <p>Araç kullanan kişi yürürlükteki trafik mevzuatına, hız sınırlarına, trafik işaretlerine, emniyet kemeri ve diğer güvenlik yükümlülüklerine uymakla sorumludur. Telefon ve uygulama araç hareket halindeyken sürücünün dikkatini dağıtacak biçimde kullanılmamalıdır.</p>
 <h3>2. Etkinlik ve buluşmalar</h3><p>Uygulamada oluşturulan etkinlik ve buluşmalar güvenli, hukuka uygun ve çevreyi rahatsız etmeyecek şekilde planlanmalıdır. Etkinlik özelliği yasa dışı yarış, tehlikeli sürüş gösterisi veya kamu düzenini bozacak faaliyetler için kullanılamaz.</p>
 <h3>3. Kullanıcının kişisel sorumluluğu</h3><p>Kullanıcının kendi sürüş tercihlerinden, trafik ihlallerinden, kazalardan, idari veya adli yaptırımlardan, maddi veya bedensel zararlardan ilgili kullanıcı sorumludur. Hakkari Roll'un sosyal ve konum özellikleri güvenli sürüş yükümlülüğünü ortadan kaldırmaz.</p>
 <h3>4. Topluluk davranış kuralları</h3><p>Hakaret, tehdit, taciz, zorbalık, nefret söylemi, hedef gösterme, istenmeyen ısrarlı iletişim, dolandırıcılık veya başka bir kullanıcının güvenliğini tehlikeye düşürecek davranışlar yasaktır.</p>
 <h3>5. Fotoğraf, video ve içerik</h3><p>Kullanıcı; yüklediği fotoğraf, video, hikâye, yorum, araç bilgisi ve diğer içerikleri paylaşmaya yetkili olduğunu kabul eder. Başkasının özel görüntüsü, kişisel bilgisi veya telif hakkıyla korunan içeriği gerekli izin olmadan yayımlanmamalıdır.</p>
 <h3>6. Araç ve piyasa bilgileri</h3><p>Başkasına ait aracı kendi aracıymış gibi göstermek, yanıltıcı araç bilgisi vermek, sahte satış veya kullanıcıları yanıltmaya yönelik içerik oluşturmak yasaktır. Plaka gibi hassas araç bilgileri paylaşılırken kullanıcı kendi gizlilik tercihlerini dikkate almalıdır.</p>
 <h3>7. Roll Radar ve canlı konum</h3><p>Canlı konum paylaşımı isteğe bağlıdır ve yalnızca kullanıcı Roll Aktif özelliğini açtığında kullanılır. Roll Aktif durumunda konum bilgisi uygulamadaki uygun kullanıcılara harita üzerinde gösterilebilir. Kullanıcı Roll durumunu kapatarak paylaşımı sonlandırabilir.</p>
 <p>Konum bilgisinin bir kişiyi takip etmek, taciz etmek, tehdit etmek veya izinsiz biçimde fiziksel olarak bulmak amacıyla kullanılması kesinlikle yasaktır. Ev, iş yeri ve diğer hassas konumlarda Roll Aktif özelliğini açmadan önce kullanıcı kendi güvenliğini değerlendirmelidir.</p>
 <h3>8. Gizlilik ve hesap güvenliği</h3><p>Kullanıcı güçlü ve kendisine özel bir şifre kullanmalı, hesabını başkasına kullandırmamalı ve yetkisiz erişim şüphesinde şifresini değiştirmelidir. Profil adı, kullanıcı adı, profil fotoğrafı, araç bilgileri ve herkese açık paylaşımlar topluluk içinde görüntülenebilir.</p>
 <h3>9. Hassas kişisel bilgiler</h3><p>Telefon numarası, açık adres, kimlik bilgileri, finansal bilgiler ve benzeri hassas veriler herkese açık gönderilerde paylaşılmamalıdır. Kullanıcı kendi paylaşımlarının kapsamından sorumludur.</p>
 <h3>10. Moderasyon ve yaptırım</h3><p>Kuralları ihlal eden içerik kaldırılabilir; özellik erişimi sınırlandırılabilir; hesap geçici veya kalıcı olarak askıya alınabilir. Şikâyet edilen içerikler topluluk güvenliği amacıyla yönetim tarafından incelenebilir.</p>
 <h3>11. Kabul</h3><p>“Okudum ve Kabul Ediyorum” düğmesine basarak bu metnin tamamını okuduğunu, anladığını ve Hakkari Roll'u bu esaslara uygun kullanacağını kabul edersin.</p>`
};
let hrAgreementAccepted=false;

function openAgreement(){
 $("agreementTitle").textContent=HR_AGREEMENT_DOC.title;
 $("agreementText").innerHTML=HR_AGREEMENT_DOC.html;
 $("agreementModal").classList.remove("hidden");
 const sc=$("agreementScroll"); sc.scrollTop=0;
 $("agreementAccept").disabled=true;
 $("agreementHint").textContent="Onay düğmesi metnin sonuna geldiğinde açılır.";
 setTimeout(agreementScrolled,80);
}
function agreementScrolled(){
 const sc=$("agreementScroll");
 const atEnd=sc.scrollTop+sc.clientHeight>=sc.scrollHeight-12;
 $("agreementAccept").disabled=!atEnd;
 $("agreementHint").textContent=atEnd?"Metnin tamamını görüntüledin. Şimdi onaylayabilirsin.":"Onay düğmesi metnin sonuna geldiğinde açılır.";
}
function acceptAgreement(){
 if($("agreementAccept").disabled)return;
 hrAgreementAccepted=true;
 $("agreeMark-main").textContent="✓ KABUL";
 $("agreeMark-main").classList.add("accepted");
 closeAgreement();
 updateAgreementStatus();
}
function closeAgreement(){$("agreementModal").classList.add("hidden")}
function updateAgreementStatus(){
 $("registerSubmitBtn").disabled=!hrAgreementAccepted;
 $("agreementStatus").textContent=hrAgreementAccepted?"✓ Kullanım ve güvenlik kuralları kabul edildi.":"Kuralları sonuna kadar okuyup kabul etmelisin.";
 $("agreementStatus").classList.toggle("complete",hrAgreementAccepted);
}

function hideAuth(){["loginBox","registerBox","resetBox"].forEach(x=>$(x)?.classList.add("hidden"))}
function showRegister(){hideAuth();$("registerBox").classList.remove("hidden")}function showLogin(){hideAuth();$("loginBox").classList.remove("hidden")}function showReset(){hideAuth();$("resetBox").classList.remove("hidden")}
async function register(){
  if(!hrAgreementAccepted){toast("Önce Kullanım ve Güvenlik Kuralları metnini sonuna kadar okuyup kabul et.");return}
  try{
    const d=await api("/api/register",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        display_name:$("regName").value,
        username:$("regUser").value,
        password:$("regPass").value,
        terms_accepted:true,
        safety_accepted:true,
        privacy_accepted:true,
        location_accepted:true
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
async function logout(){try{if(voiceCall)await endVoiceCall(true)}catch(e){}stopVoiceCallWatcher();try{await api("/api/logout",{method:"POST"})}catch(e){}stopRollWatch();stopMessageLive();clearInterval(hrPulseTimer);hrPulseTimer=null;token="";me=null;[localStorage,sessionStorage].forEach(s=>{s.removeItem("hr_token");s.removeItem("hr_user")});$("appView").classList.add("hidden");$("authView").classList.remove("hidden");showLogin()}
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

function v5NavIcon(name){
 const icons={
  home:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5z"/></svg>`,
  roll:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="6.2" fill="none"/><path d="M4.2 4.5A10.5 10.5 0 0 0 2 11m17.8-6.5A10.5 10.5 0 0 1 22 11M4.2 19.5A10.5 10.5 0 0 1 2 13m17.8 6.5A10.5 10.5 0 0 0 22 13" fill="none"/></svg>`,
  garage:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15.5 6.6 10A2.8 2.8 0 0 1 9.3 8h5.4a2.8 2.8 0 0 1 2.7 2l1.6 5.5V20h-2v-2H7v2H5z"/><path d="M7 15h10M8.5 12.5h.01m6.99 0h.01" fill="none"/></svg>`,
  messages:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3z"/><path d="M8 10h8m-8 3h5" fill="none"/></svg>`
 };
 return icons[name]||"";
}
function buildNav(){
 const items=[
  ["home","Ana Sayfa","homePage",()=>{loadFeed();loadV4Home()}],
  ["roll","Roll","rollPage",loadRollHub],
  ["garage","Garaj","carsPage",()=>setGarageMode("mine")],
  ["messages","Mesajlar","messagesPage",()=>{$("messagesPage")?.classList.remove("chat-open");loadConversations()}]
 ];
 $("nav").innerHTML=`<div class="v2-nav-brand v5-nav-brand"><img src="/static/icons/icon.svg" alt=""><div><b>HAKKARİ ROLL</b><small>STREET COMMUNITY</small></div></div><div class="v2-nav-items v5-nav-items"></div><div class="v2-nav-foot v5-nav-foot"><button type="button" onclick="openProfile(me.id)"><i>●</i><span>Profilim</span></button>${me.role==="admin"?`<button type="button" onclick="showPage('adminPage');loadAdmin()"><i>◆</i><span>Yönetim</span></button>`:""}<button type="button" onclick="logout()"><i>↪</i><span>Çıkış Yap</span></button><small>GÜVENLİ SÜRÜŞ</small><span>Trafik kurallarına uy. Hızını değil, arabanı göster.</span></div>`;
 const host=$("nav").querySelector(".v2-nav-items");
 items.forEach(([icon,name,page,fn])=>{
  const b=document.createElement("button");
  b.dataset.page=page;
  b.setAttribute("aria-label",name);
  b.innerHTML=`<i class="v5-nav-icon">${v5NavIcon(icon)}</i><span>${name}</span>`;
  b.onclick=()=>{showPage(page);fn?.()};
  host.appendChild(b)
 });
 updateAppChrome();
}
function mainNavPage(id){
 if(["mapPage","offersPage","eventsPage","peoplePage","crewsPage"].includes(id))return "rollPage";
 if(id==="carsPage")return "carsPage";
 if(id==="messagesPage")return "messagesPage";
 if(id==="homePage")return "homePage";
 return "";
}
function showPage(id){
 const target=$(id);if(!target)return;
 document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
 target.classList.remove("hidden");
 const active=mainNavPage(id);
 document.querySelectorAll("#nav button[data-page]").forEach(b=>b.classList.toggle("active",!!active&&b.dataset.page===active));
 document.body.classList.remove("nav-open");
 if(id!=="messagesPage")stopMessageLive()
 window.scrollTo({top:0,behavior:"smooth"});
}
function updateAppChrome(){
 const host=$("topProfileAvatar");if(!host||!me)return;
 if(me.profile_photo)host.innerHTML=`<img src="/uploads/${encodeURIComponent(me.profile_photo)}" alt="">`;
 else{const letters=(me.display_name||me.username||"HR").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();host.innerHTML=`<span>${esc(letters||"HR")}</span>`}
}
function openExplore(){showPage("peoplePage");loadPeople();setTimeout(()=>$("peopleSearch")?.focus(),80)}
function loadRollHub(){loadRollCount()}
async function showApp(){
 $("authView").classList.add("hidden");$("appView").classList.remove("hidden");buildNav();showPage("homePage");
 await loadVehicleCatalog();
 loadFeed();loadV4Home();loadRollCount();loadNotifications();
 clearInterval(window.hrRollCountTimer);clearInterval(window.hrNotificationTimer);clearInterval(hrPulseTimer);
 await livePulse();hrPulseTimer=setInterval(livePulse,10000);
 setTimeout(()=>{startVoiceCallWatcher();refreshNotificationPermissionUI()},0);
}
async function loadVehicleCatalog(){try{vehicleCatalog=await (await fetch("/static/vehicle_catalog.json")).json();fillBrands()}catch(e){}}
function fillBrands(){const s=$("carBrand");if(!s)return;s.innerHTML=Object.keys(vehicleCatalog).map(x=>`<option>${esc(x)}</option>`).join("");catalogBrandChanged()}
function catalogBrandChanged(){const b=$("carBrand").value;const models=Object.keys(vehicleCatalog[b]||{});$("carModel").innerHTML=models.map(x=>`<option>${esc(x)}</option>`).join("");catalogModelChanged()}
function catalogModelChanged(){const x=vehicleCatalog[$("carBrand").value]?.[$("carModel").value]||{};$("carYear").innerHTML=(x.years||[]).slice().reverse().map(y=>`<option>${y}</option>`).join("");$("carEngine").innerHTML=(x.engines||[]).map(([e,f])=>`<option data-fuel="${esc(f)}">${esc(e)}</option>`).join("");catalogEngineChanged()}
function catalogEngineChanged(){const o=$("carEngine").selectedOptions[0];if(o?.dataset.fuel)$("carFuel").value=o.dataset.fuel}
async function createPost(){const fd=new FormData();fd.append("body",$("postBody").value);if($("postPhoto").files[0])fd.append("photo",$("postPhoto").files[0]);try{const d=await api("/api/posts",{method:"POST",body:fd});toast(d.message);$("postBody").value="";$("postPhoto").value="";loadFeed()}catch(e){toast(e.message)}}
async function loadFeed(){try{const d=await api("/api/feed");$("feed").innerHTML=d.posts.length?d.posts.map(postHtml).join(""):`<div class="panel meta">Henüz paylaşım yok.</div>`}catch(e){toast(e.message)}}
function postHtml(p){
 const media=p.photo?(((p.media_type==="video"||/\.(mp4|webm|mov|m4v)$/i.test(p.photo||"")))?`<video class="media-video v52-post-media" src="/uploads/${encodeURIComponent(p.photo)}" controls playsinline></video>`:`<img class="post-photo v52-post-media" src="/uploads/${encodeURIComponent(p.photo)}" alt="Gönderi fotoğrafı" ondblclick="quickLikePost(${p.id})">`):"";
 return `<article class="post v52-post ${p.author.vip?"vip-card":""}" id="post-${p.id}">
  <div class="post-head v52-post-head">
   <button class="v52-author" onclick="openProfile(${p.author.id})">${img(p.author.profile_photo)}<span><strong>${esc(p.author.display_name)} ${vip(p.author)}</strong><small>@${esc(p.author.username)} • ${esc(formatAppDateTime(p.created_at))}</small></span></button>
   <button class="v52-more" onclick="postMore(${p.id},${p.author.is_me?1:0})" aria-label="Gönderi seçenekleri">•••</button>
  </div>
  ${p.body?`<div class="post-body v52-post-body">${esc(p.body)}</div>`:""}
  ${media?`<div class="v52-media-shell">${media}<span class="v52-like-burst" id="likeBurst-${p.id}">♥</span></div>`:""}
  <div class="post-actions v52-post-actions">
   <button id="like-${p.id}" class="${p.liked?"liked":""}" onclick="toggleLike(${p.id})"><span>${p.liked?"♥":"♡"}</span> ${p.like_count}</button>
   <button onclick="toggleComments(${p.id})"><span>◯</span> ${p.comment_count}</button>
   <button onclick="sharePost(${p.id})"><span>↗</span> PAYLAŞ</button>
  </div>
  <div id="comments-${p.id}" class="comment-box hidden"></div>
 </article>`
}
function quickLikePost(id){const b=$(`like-${id}`);if(b&&!b.classList.contains("liked"))toggleLike(id);const burst=$(`likeBurst-${id}`);if(burst){burst.classList.remove("pop");void burst.offsetWidth;burst.classList.add("pop")}}
async function sharePost(id){const url=`${location.origin}${location.pathname}#post-${id}`;try{if(navigator.share)await navigator.share({title:"Hakkari Roll",text:"Hakkari Roll'daki bu gönderiye bak.",url});else{await navigator.clipboard.writeText(url);toast("Gönderi bağlantısı kopyalandı.")}}catch(e){if(e?.name!=="AbortError")toast("Paylaşım açılamadı.")}}
async function postMore(id,isMine){const fields=[];const r=await appDialog({title:"Gönderi",message:isMine?"Bu gönderi için bir işlem seç.":"Gönderiyi paylaşabilir veya şikâyet edebilirsin.",confirmText:isMine?"SİL":"ŞİKÂYET ET"});if(!r)return;if(isMine)deletePost(id);else reportItem('post',id)}
async function toggleLike(id){try{const d=await api(`/api/posts/${id}/like`,{method:"POST"}),b=$(`like-${id}`);if(b){b.classList.toggle("liked",!!d.liked);b.innerHTML=`<span>${d.liked?"♥":"♡"}</span> ${d.like_count}`}}catch(e){toast(e.message)}}async function deletePost(id){if(!(await appConfirm("Paylaşımı Sil","Bu paylaşım kalıcı olarak silinecek. Devam edilsin mi?","SİL")))return;try{await api(`/api/posts/${id}`,{method:"DELETE"});loadFeed()}catch(e){toast(e.message)}}
async function toggleComments(id){const box=$(`comments-${id}`);if(!box.classList.contains("hidden")){box.classList.add("hidden");return}try{const d=await api(`/api/posts/${id}/comments`);box.innerHTML=d.comments.map(c=>`<div class="comment"><b>${esc(c.display_name)}</b> ${esc(c.body)}</div>`).join("")+`<div class="row"><input id="commentInput-${id}" placeholder="Yorum yaz..."><button onclick="addComment(${id})">GÖNDER</button></div>`;box.classList.remove("hidden")}catch(e){toast(e.message)}}async function addComment(id){const body=$(`commentInput-${id}`).value;try{await api(`/api/posts/${id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});boxRefreshComments(id)}catch(e){toast(e.message)}}async function boxRefreshComments(id){const box=$(`comments-${id}`);box.classList.add("hidden");toggleComments(id)}
async function reportItem(type,id){const r=await appDialog({title:"Şikâyet Gönder",message:"Şikâyet nedenini kısaca açıkla. Admin ekibi inceleyecek.",confirmText:"ŞİKÂYETİ GÖNDER",fields:[{name:"reason",label:"Şikâyet sebebi",type:"textarea",placeholder:"Neden şikâyet ediyorsun?",required:true,maxLength:500}]});if(!r)return;try{const d=await api("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target_type:type,target_id:id,reason:r.reason})});toast(d.message)}catch(e){toast(e.message)}}
function toggleCarForm(){$("carForm").classList.toggle("hidden")}
async function createVehicle(){const fd=new FormData();[["brand","carBrand"],["model","carModel"],["model_year","carYear"],["engine","carEngine"],["fuel","carFuel"],["horsepower","carHp"],["plate","carPlate"],["note","carNote"],["transmission","carTransmission"],["body_type","carBody"],["color","carColor"],["drivetrain","carDrive"],["mods","carMods"]].forEach(([k,id])=>fd.append(k,$(id).value));fd.append("plate_visible",$("carPlateVisible").checked?"1":"0");if($("carPhoto").files[0])fd.append("photo",$("carPhoto").files[0]);try{const d=await api("/api/vehicles",{method:"POST",body:fd});toast(d.message);$("carForm").classList.add("hidden");loadVehicles()}catch(e){toast(e.message)}}
function setGarageMode(mode){
 garageMode=mode==="explore"?"explore":"mine";
 $("garageMineTab")?.classList.toggle("active",garageMode==="mine");
 $("garageExploreTab")?.classList.toggle("active",garageMode==="explore");
 $("garageExploreTools")?.classList.toggle("hidden",garageMode!=="explore");
 $("garageAddBtn")?.classList.toggle("hidden",garageMode!=="mine");
 if(garageMode==="mine"&&$("carSearch"))$("carSearch").value="";
 loadVehicles();
}
function vehicleCard(v){return `<article class="car v5-car-card v52-car-card" onclick="openVehicleDetail(${v.id})">${v.photo?`<div class="v5-car-photo-wrap"><img src="/uploads/${encodeURIComponent(v.photo)}" alt="${esc(v.brand)} ${esc(v.model)}">${v.is_favorite?`<span class="v52-main-car-badge">★ ANA ARAÇ</span>`:(v.user_id===me.id?`<span class="v5-my-car-badge">BENİM ARACIM</span>`:"")}</div>`:`<div class="v5-car-photo-wrap v5-car-no-photo"><span>🚘</span>${v.user_id===me.id?`<em>BENİM ARACIM</em>`:""}</div>`}<div class="v5-car-body"><div class="v52-car-owner">@${esc(v.username)}</div><div class="car-title">${esc(v.brand)} ${esc(v.model)}</div><div class="v5-car-specs"><span>${esc(v.model_year||"Yıl -")}</span><span>${esc(v.engine||"Motor -")}</span><span>${esc(v.horsepower?`${v.horsepower} HP`:v.fuel||"-")}</span></div>${v.mods?`<div class="meta v5-car-mods">⚙ ${esc(v.mods)}</div>`:""}<div class="v52-card-open">ARACI İNCELE <b>→</b></div></div></article>`}
async function openVehicleDetail(id){
 closeTransientOverlays('vehicleDetailModal');
 const modal=$("vehicleDetailModal"),host=$("vehicleDetailContent");if(!modal||!host)return;modal.classList.remove("hidden");syncOverlayState();host.innerHTML=`<div class="v52-detail-loading"><span>🚘</span><p>Araç profili yükleniyor...</p></div>`;
 try{const d=await api(`/api/vehicles/${id}`),v=d.vehicle;window.hrOpenVehicle=v;const canManage=!!(v.is_me||me?.role==='admin');
  const gallery=(v.gallery||[]).map(g=>`<div class="v512-gallery-item"><button class="v512-gallery-open" onclick="openVehicleGalleryImage('${encodeURIComponent(g.photo)}')"><img src="/uploads/${encodeURIComponent(g.photo)}" alt="Araç galerisi"></button>${canManage?`<button class="v512-gallery-delete" onclick="deleteVehicleGalleryPhoto(${v.id},${g.id});event.stopPropagation()" aria-label="Galeri fotoğrafını sil">✕</button>`:""}</div>`).join("");
  host.innerHTML=`<div class="v52-detail-hero">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}" alt="${esc(v.brand)} ${esc(v.model)}">`:`<div class="v52-detail-placeholder">🚘</div>`}<div class="v52-detail-gradient"></div><div class="v52-detail-title"><small>${v.is_favorite?"★ ANA ARAÇ":"HAKKARİ ROLL GARAJ"}</small><h2>${esc(v.brand)} ${esc(v.model)}</h2><p>${esc(v.model_year||"")} ${v.color?`• ${esc(v.color)}`:""}</p></div></div>
   <div class="v52-detail-body">
    <button class="v52-owner-row" onclick="closeVehicleDetail();openProfile(${v.user_id})">${img(v.profile_photo)}<span><b>${esc(v.display_name)}</b><small>@${esc(v.username)}</small></span><em>PROFİL →</em></button>
    <div class="v52-spec-grid"><div><b>${esc(v.horsepower||"-")}</b><span>HP</span></div><div><b>${esc(v.transmission||"-")}</b><span>ŞANZIMAN</span></div><div><b>${esc(v.drivetrain||"-")}</b><span>ÇEKİŞ</span></div><div><b>${esc(v.fuel||"-")}</b><span>YAKIT</span></div></div>
    ${v.mods?`<section class="v52-detail-section"><label>MODİFİKASYONLAR</label><p>${esc(v.mods)}</p></section>`:""}${v.note?`<section class="v52-detail-section"><label>ARAÇ HAKKINDA</label><p>${esc(v.note)}</p></section>`:""}
    ${canManage?`<section class="v52-detail-section v512-photo-manager"><div class="v52-section-line"><label>ANA FOTOĞRAF</label><span class="v512-manage-badge">${v.is_me?'SENİN ARACIN':'ADMIN YETKİSİ'}</span></div><div class="v512-photo-actions"><button onclick="replaceVehicleMainPhoto(${v.id})">📷 FOTOĞRAFI DEĞİŞTİR</button>${v.photo?`<button class="danger" onclick="removeVehicleMainPhoto(${v.id})">🗑 ANA FOTOĞRAFI SİL</button>`:''}</div></section>`:""}
    <section class="v52-detail-section"><div class="v52-section-line"><label>GALERİ</label>${canManage?`<button onclick="addVehicleGalleryPhoto(${v.id})">+ FOTOĞRAF</button>`:""}</div><div class="v52-gallery v512-gallery">${gallery||`<div class="v52-gallery-empty">Henüz galeri fotoğrafı yok.</div>`}</div></section>
    <div class="v52-vehicle-actions v512-vehicle-actions"><button id="vehicleVoteBtn" class="${v.voted?"active":""}" onclick="voteVehicleDetail(${v.id})">🔥 <b id="vehicleVoteCount">${v.votes||0}</b> OY</button>${canManage?`${v.is_me?`<button onclick="makeFavoriteVehicle(${v.id})">★ ANA ARAÇ YAP</button>`:''}<button onclick="closeVehicleDetail();editVehicle(${v.id})">✎ DÜZENLE</button><button class="danger" onclick="deleteVehicleFromDetail(${v.id})">🗑 ARACI SİL</button>`:`<button class="cta" onclick="sendOffer(${v.user_id},'roll')">🔥 ROLL TEKLİFİ</button><button onclick="closeVehicleDetail();startChat(${v.user_id})">💬 MESAJ</button>`}<button onclick="shareVehicle(${v.id},'${esc(v.brand).replace(/'/g,"\\'")} ${esc(v.model).replace(/'/g,"\\'")}')">↗ PAYLAŞ</button></div>
   </div>`;
 }catch(e){host.innerHTML=`<div class="v52-detail-loading"><span>!</span><p>${esc(e.message)}</p><button onclick="closeVehicleDetail()">KAPAT</button></div>`}
}
function closeVehicleDetail(){$("vehicleDetailModal")?.classList.add("hidden");window.hrOpenVehicle=null;syncOverlayState()}
async function replaceVehicleMainPhoto(id){const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=async()=>{if(!input.files?.[0])return;const fd=new FormData();fd.append('photo',input.files[0]);try{const d=await api(`/api/vehicles/${id}/photo`,{method:'POST',body:fd});toast(d.message);await openVehicleDetail(id);refreshVehicleViews()}catch(e){toast(e.message)}};input.click()}
async function removeVehicleMainPhoto(id){if(!(await appConfirm('Ana Fotoğrafı Sil','Araç kaydı kalacak, yalnızca ana fotoğraf kaldırılacak.','FOTOĞRAFI SİL')))return;try{const d=await api(`/api/vehicles/${id}/photo`,{method:'DELETE'});toast(d.message);await openVehicleDetail(id);refreshVehicleViews()}catch(e){toast(e.message)}}
async function deleteVehicleGalleryPhoto(vid,gid){if(!(await appConfirm('Galeri Fotoğrafını Sil','Bu fotoğraf araç galerisinden kalıcı olarak kaldırılacak.','FOTOĞRAFI SİL')))return;try{const d=await api(`/api/vehicles/${vid}/gallery/${gid}`,{method:'DELETE'});toast(d.message);await openVehicleDetail(vid);refreshVehicleViews()}catch(e){toast(e.message)}}
async function deleteVehicleFromDetail(id){if(!(await appConfirm('Aracı Kalıcı Sil','Araç, oylar ve galeri fotoğrafları kalıcı olarak silinecek. Bu işlem geri alınamaz.','ARACI SİL')))return;try{const d=await api(`/api/vehicles/${id}`,{method:'DELETE'});toast(d.message||'Araç silindi.');closeVehicleDetail();refreshVehicleViews(true)}catch(e){toast(e.message)}}
function refreshVehicleViews(profileToo=false){if(!$('carsPage')?.classList.contains('hidden'))loadVehicles();if(me?.role==='admin'&&!$('adminPage')?.classList.contains('hidden'))loadAdminVehicles();if(profileToo&&!$('profilePage')?.classList.contains('hidden'))openProfile(Number($('profileBox')?.dataset?.userId)||me.id);loadV4Home()}

async function voteVehicleDetail(id){try{const d=await api(`/api/vehicles/${id}/vote`,{method:"POST"});$("vehicleVoteCount").textContent=d.votes;$("vehicleVoteBtn").classList.toggle("active",d.voted)}catch(e){toast(e.message)}}
async function makeFavoriteVehicle(id){try{const d=await api(`/api/vehicles/${id}/favorite`,{method:"POST"});toast(d.message);await openVehicleDetail(id);loadVehicles()}catch(e){toast(e.message)}}
function addVehicleGalleryPhoto(id){const input=document.createElement("input");input.type="file";input.accept="image/*";input.onchange=async()=>{if(!input.files[0])return;const fd=new FormData();fd.append("photo",input.files[0]);try{const d=await api(`/api/vehicles/${id}/gallery`,{method:"POST",body:fd});toast(d.message);await openVehicleDetail(id);refreshVehicleViews()}catch(e){toast(e.message)}};input.click()}
function openVehicleGalleryImage(name){window.open(`/uploads/${name}`,"_blank")}
async function shareVehicle(id,name){const url=`${location.origin}${location.pathname}#vehicle-${id}`;try{if(navigator.share)await navigator.share({title:name,text:`${name} • Hakkari Roll Dijital Garaj`,url});else{await navigator.clipboard.writeText(url);toast("Araç bağlantısı kopyalandı.")}}catch(e){if(e?.name!=="AbortError")toast("Paylaşım açılamadı.")}}
async function loadVehicles(){
 const q=garageMode==="explore"?($("carSearch")?.value||""):"";
 try{
  const d=await api(`/api/vehicles?q=${encodeURIComponent(q)}`);
  const list=garageMode==="mine"?d.vehicles.filter(v=>v.user_id===me.id):d.vehicles;
  if(!list.length){
   $("vehicles").innerHTML=garageMode==="mine"?`<div class="v5-empty-garage"><span>🚘</span><h3>Garajın henüz boş</h3><p>İlk aracını ekle; profilinde ve Roll tekliflerinde otomobil kimliğin görünsün.</p><button class="cta" onclick="toggleCarForm()">+ İLK ARACIMI EKLE</button></div>`:`<div class="panel meta">Aramana uygun araç bulunamadı.</div>`;
   return;
  }
  $("vehicles").innerHTML=list.map(vehicleCard).join("");
 }catch(e){toast(e.message)}
}async function deleteVehicle(id){if(!(await appConfirm("Aracı Sil","Araç, oylar ve galeri fotoğrafları kalıcı olarak silinecek.","ARACI SİL")))return;try{const d=await api(`/api/vehicles/${id}`,{method:"DELETE"});toast(d.message||"Araç silindi.");closeVehicleDetail();refreshVehicleViews(true)}catch(e){toast(e.message)}}
function queueGlobalSearch(){clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(loadPeople,180)}
function clearGlobalSearch(){const i=$("peopleSearch");if(i)i.value="";loadPeople();i?.focus()}
function setSearchTab(tab,btn){globalSearchTab=tab;document.querySelectorAll("#searchTabs button").forEach(x=>x.classList.remove("active"));btn?.classList.add("active");renderGlobalSearch()}
function searchSection(title,count,html,key){if(globalSearchTab!=="all"&&globalSearchTab!==key)return"";return `<section class="v53-search-section"><div class="v53-search-section-head"><h3>${title}</h3><span>${count}</span></div>${html||`<div class="v53-search-empty">Sonuç bulunamadı.</div>`}</section>`}
function renderGlobalSearch(){const host=$("people");if(!host)return;const d=globalSearchCache;
 const people=(d.users||[]).map(u=>`<article class="v53-person-result"><button class="v53-result-main" onclick="openProfile(${u.id})">${img(u.profile_photo)}<span><b>${esc(u.display_name)} ${vip(u)}</b><small>@${esc(u.username)}</small></span><i>›</i></button>${u.id!==me.id?`<div class="v53-result-actions"><button onclick="toggleFollow(${u.id})">${u.following?"TAKİPTEN ÇIK":"TAKİP ET"}</button><button class="cta" onclick="startChat(${u.id})">MESAJ</button>${u.can_call?`<button class="v610-search-call" onclick="startVoiceCallUser(${u.id})">📞 ARA</button>`:""}</div>`:""}</article>`).join("");
 const cars=(d.vehicles||[]).map(v=>`<button class="v53-vehicle-result" onclick="openVehicleDetail(${v.id})"><span class="v53-result-car-photo">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}" alt="">`:`🚘`}</span><span><b>${esc(v.brand)} ${esc(v.model)}</b><small>${esc(v.model_year||"")} ${v.horsepower?`• ${esc(v.horsepower)} HP`:""}</small><em>@${esc(v.username||"")}</em></span><i>›</i></button>`).join("");
 const crews=(d.crews||[]).map(c=>`<button class="v53-simple-result" onclick="showPage('crewsPage');loadCrews()"><span>👥</span><div><b>${esc(c.name)}</b><small>${c.member_count||0} üye • @${esc(c.username||"")}</small></div><i>›</i></button>`).join("");
 const events=(d.events||[]).map(e=>`<button class="v53-simple-result" onclick="showPage('eventsPage');loadEvents()"><span>📍</span><div><b>${esc(e.title)}</b><small>${esc(e.event_time||"")} • ${e.going_count||0} kişi</small></div><i>›</i></button>`).join("");
 host.innerHTML=searchSection("KİŞİLER",d.users?.length||0,people,"users")+searchSection("ARAÇLAR",d.vehicles?.length||0,cars,"vehicles")+searchSection("EKİPLER",d.crews?.length||0,crews,"crews")+searchSection("ETKİNLİKLER",d.events?.length||0,events,"events");
}
async function loadPeople(){const q=$("peopleSearch")?.value||"";try{globalSearchCache=await api(`/api/search?q=${encodeURIComponent(q)}`);renderGlobalSearch()}catch(e){toast(e.message)}}async function toggleFollow(id){try{await api(`/api/users/${id}/follow`,{method:"POST"});loadPeople()}catch(e){toast(e.message)}}
function openRollPanel(){$("rollModal").classList.remove("hidden")}function closeRollPanel(){$("rollModal").classList.add("hidden")}
async function activateRoll(){if(!navigator.geolocation){toast("Konum desteklenmiyor.");return}navigator.geolocation.getCurrentPosition(async pos=>{try{const d=await api("/api/roll/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy,minutes:+$("rollMinutes").value,status:$("rollStatus").value,visibility:$("rollVisibility").value})});toast(d.message);closeRollPanel();startRollWatch();loadRollCount()}catch(e){toast(e.message)}},()=>toast("Konum izni verilmedi."),{enableHighAccuracy:true,timeout:15000})}
function startRollWatch(){stopRollWatch();if(!navigator.geolocation)return;rollWatchId=navigator.geolocation.watchPosition(pos=>api("/api/roll/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy})}).catch(()=>{}),()=>{},{enableHighAccuracy:true,maximumAge:5000,timeout:15000})}
function stopRollWatch(){if(rollWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(rollWatchId);rollWatchId=null}}
async function deactivateRoll(){try{const d=await api("/api/roll/deactivate",{method:"POST"});stopRollWatch();toast(d.message);closeRollPanel();loadRollCount()}catch(e){toast(e.message)}}
async function loadRollCount(){try{const d=await api("/api/roll/active"),mine=d.active.find(x=>x.user_id===me.id);if($("liveCount"))$("liveCount").innerHTML=`<i></i> ${d.count} ROLL AKTİF`;if($("v2HeroLive"))$("v2HeroLive").textContent=`${d.count} CANLI`;if($("radarCount"))$("radarCount").textContent=`${d.count} kişi`;if($("v5RollCount"))$("v5RollCount").textContent=d.count;if($("v5RollStatus"))$("v5RollStatus").textContent=mine?`${mine.status} • Roll aktif`:"Şu an çevrimdışısın";if($("rollToggleBtn"))$("rollToggleBtn").innerHTML=mine?"🟢 ROLL AKTİF <b>→</b>":"ROLL AKTİF ET <b>→</b>";if($("v5RollToggleBtn"))$("v5RollToggleBtn").innerHTML=mine?"ROLL DURUMUNU YÖNET <b>→</b>":"ROLL AKTİF ET <b>→</b>"}catch(e){}}
function openRollUserSheet(x){
 const modal=$("rollUserSheet"),host=$("rollUserSheetContent");if(!modal||!host)return;modal.classList.remove("hidden");
 const car=x.vehicle?`${esc(x.vehicle.brand)} ${esc(x.vehicle.model)}`:"Araç eklenmemiş";
 host.innerHTML=`<div class="v52-roll-user-top"><button class="v52-sheet-x" onclick="closeRollUserSheet()">✕</button>${img(x.profile_photo,"avatar big")}<div><span class="status-live">● ${esc(x.status)}</span><h3>${esc(x.display_name)}</h3><p>@${esc(x.username)}</p></div></div><button class="v52-roll-car" ${x.vehicle?`onclick="closeRollUserSheet();openVehicleDetail(${x.vehicle.id})"`:""}><span>🚘</span><div><small>AKTİF ARAÇ</small><b>${car}</b>${x.vehicle?.horsepower?`<em>${esc(x.vehicle.horsepower)} HP</em>`:""}</div><i>›</i></button><div class="v52-roll-sheet-actions"><button onclick="closeRollUserSheet();openProfile(${x.user_id})">PROFİL</button>${x.user_id!==me.id?`<button onclick="closeRollUserSheet();startChat(${x.user_id})">💬 MESAJ</button><button class="cta" onclick="sendOffer(${x.user_id},'roll')">🔥 ROLL</button>`:`<button class="cta" onclick="openRollPanel()">DURUMUM</button>`}</div>`
}
function closeRollUserSheet(){$("rollUserSheet")?.classList.add("hidden")}
async function loadRollMap(silent=false){try{const d=await api("/api/roll/active");if(!rollMap){rollMap=L.map("rollMap").setView([37.574,43.740],13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(rollMap);rollMarkers=L.layerGroup().addTo(rollMap)}rollMarkers.clearLayers();d.active.forEach(x=>{const marker=L.marker([x.lat,x.lon],{icon:L.divIcon({className:"",html:`<div class="roll-car-icon live v52-map-car">🚗</div>`,iconSize:[44,44],iconAnchor:[22,22]})}).addTo(rollMarkers);marker.on("click",()=>openRollUserSheet(x))});$("activeRollList").innerHTML=d.active.map(x=>`<button class="person roll-user-card v52-roll-list-card" onclick='openRollUserSheet(${JSON.stringify(x).replace(/'/g,"&#39;")})'><div class="person-head">${img(x.profile_photo)}<div><div class="name">${esc(x.display_name)}</div><div class="meta">${esc(x.vehicle?x.vehicle.brand+" "+x.vehicle.model:"Araç yok")} • <span class="status-live">${esc(x.status)}</span></div></div></div><em>›</em></button>`).join("")||`<div class="panel meta">Şu an aktif Roll kullanıcısı yok.</div>`;setTimeout(()=>rollMap.invalidateSize(),100)}catch(e){if(!silent)toast(e.message)}}
async function sendOffer(uid,type){const r=await appDialog({title:type==="roll"?"🔥 Roll Teklifi":"🚘 Piyasa Teklifi",message:"Teklif detaylarını yaz. İki alan da isteğe bağlı.",confirmText:"TEKLİFİ GÖNDER",fields:[{name:"meeting_text",label:type==="roll"?"Buluşma notu":"Yer / saat",type:"text",placeholder:type==="roll"?"Örn: 21:30 merkez":"Örn: 22:00 buluşma noktası",maxLength:250},{name:"message",label:"Mesaj",type:"textarea",placeholder:"Kısa bir mesaj yaz...",maxLength:500}]});if(!r)return;try{const d=await api("/api/offers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({receiver_id:uid,offer_type:type,meeting_text:r.meeting_text,message:r.message})});toast(d.message);loadNotifications()}catch(e){if(!silent)toast(e.message)}}
async function loadOffers(){try{const d=await api("/api/offers");$("offers").innerHTML=d.offers.length?d.offers.map(o=>`<div class="offer-card ${o.status}"><div class="offer-type">${o.offer_type==="roll"?"🔥 ROLL TEKLİFİ":"🚘 PİYASA TEKLİFİ"}</div><div class="name">${o.sender_id===me.id?`Sen → ${esc(o.receiver_name)}`:`${esc(o.sender_name)} → Sen`}</div>${o.message?`<p>${esc(o.message)}</p>`:""}${o.meeting_text?`<div class="meta">📍 ${esc(o.meeting_text)}</div>`:""}<div class="meta">Durum: ${esc(o.status)} • ${esc(o.created_at)}</div>${o.receiver_id===me.id&&o.status==="pending"?`<div class="person-actions"><button class="cta mini" onclick="respondOffer(${o.id},'accepted')">KABUL ET</button><button onclick="respondOffer(${o.id},'rejected')">REDDET</button></div>`:""}</div>`).join(""):`<div class="panel meta">Teklif yok.</div>`}catch(e){toast(e.message)}}async function respondOffer(id,status){try{await api(`/api/offers/${id}/respond`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});loadOffers();loadNotifications()}catch(e){toast(e.message)}}
function notificationIcon(type){return ({message:"💬",follow:"👤",offer:"🔥",comment:"◯",like:"♥"}[type]||"●")}
async function openNotificationTarget(type,id){closeNotifications();if(!type)return;if(type==="conversation"&&id){showPage("messagesPage");await loadConversations();const c=conversationCache.find(x=>x.id===Number(id));openConversation(Number(id),c?.other?.display_name||"Sohbet");return}if(type==="user"&&id){openProfile(Number(id));return}if(type==="vehicle"&&id){openVehicleDetail(Number(id));return}if(type==="event"){showPage("eventsPage");loadEvents();return}if(type==="offer"){showPage("offersPage");loadOffers();return}if(type==="post"&&id){showPage("homePage");await loadFeed();setTimeout(()=>$(`post-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"}),80);return}}
async function loadNotifications(){try{const d=await api("/api/notifications");$("notifCount").textContent=d.unread?d.unread:"";$("notifications").innerHTML=d.notifications.map(n=>`<button class="notification v53-notification ${n.read_at?"":"unread"}" onclick="openNotificationTarget('${esc(n.ref_type||"")}',${Number(n.ref_id)||0})"><span class="v53-notification-icon">${notificationIcon(n.type)}</span><span><b>${esc(n.title)}</b><div>${esc(n.body||"")}</div><small>${esc(formatAppDateTime(n.created_at))}</small></span><i>›</i></button>`).join("")||`<div class="v53-notif-empty">Bildirim yok.</div>`}catch(e){}}
async function openNotifications(){const drawer=$("notificationsDrawer");if(!drawer)return;closeMessageActions();drawer.classList.remove("hidden");document.body.classList.add("notif-open");document.documentElement.classList.add("notif-open");requestAnimationFrame(()=>drawer.querySelector(".v53-notif-close")?.focus());await loadNotifications();try{await api("/api/notifications/read-all",{method:"POST"});$("notifCount").textContent=""}catch(e){}}function closeNotifications(){const drawer=$("notificationsDrawer");drawer?.classList.add("hidden");document.body.classList.remove("notif-open");document.documentElement.classList.remove("notif-open");$("notifBtn")?.focus()}
function toggleEventForm(){
  const f=$("eventForm");
  f.classList.toggle("hidden");
  if(!f.classList.contains("hidden"))setTimeout(()=>$("eventTitle")?.focus(),50);
}
window.hrCreateEvent=async function(){
  const status=document.getElementById("eventPublishStatus");
  const btn=document.getElementById("eventPublishBtn");
  const title=(document.getElementById("eventTitle")?.value||"").trim();
  const event_time=document.getElementById("eventTime")?.value||"";
  const meeting_text=(document.getElementById("eventMeeting")?.value||"").trim();
  const description=(document.getElementById("eventDesc")?.value||"").trim();

  if(!title){if(status)status.textContent="Etkinlik adını yaz.";document.getElementById("eventTitle")?.focus();return}
  if(!event_time){if(status)status.textContent="Tarih ve saat seç.";document.getElementById("eventTime")?.focus();return}

  const old=btn?.textContent||"ETKİNLİĞİ YAYINLA";
  if(btn){btn.disabled=true;btn.textContent="YAYINLANIYOR..."}
  if(status)status.textContent="Sunucuya gönderiliyor...";

  try{
    const res=await fetch("/api/events",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        ...(token?{"Authorization":`Bearer ${token}`}:{})
      },
      body:JSON.stringify({title,event_time,meeting_text,description}),
      cache:"no-store"
    });

    let data={};
    try{data=await res.json()}catch(_){}
    if(!res.ok)throw new Error(data.message||`HTTP ${res.status}`);

    if(status)status.textContent="✅ Etkinlik yayınlandı.";
    toast(data.message||"Etkinlik yayınlandı.");
    document.getElementById("eventTitle").value="";
    document.getElementById("eventTime").value="";
    document.getElementById("eventMeeting").value="";
    document.getElementById("eventDesc").value="";
    await loadEvents();
    setTimeout(()=>document.getElementById("eventForm")?.classList.add("hidden"),700);
  }catch(e){
    console.error("EVENT_CREATE_CLIENT_ERROR",e);
    if(status)status.textContent="❌ "+(e.message||"Etkinlik yayınlanamadı.");
    toast(e.message||"Etkinlik yayınlanamadı.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old}
  }
}
async function loadEvents(){try{const d=await api("/api/events");$("events").innerHTML=d.events.map(e=>`<div class="event-card"><div class="name">${esc(e.title)}</div><div class="meta">@${esc(e.username)} • ${esc(e.event_time||"")}</div><p>${esc(e.description||"")}</p><div class="meta">📍 ${esc(e.meeting_text||"-")} • ${e.going_count} kişi</div><button class="${e.going?"cta":""}" onclick="toggleEvent(${e.id})">${e.going?"KATILIYORUM ✓":"KATIL"}</button>${e.owner_id===me.id||me.role==="admin"?`<button class="danger" onclick="deleteEvent(${e.id})">SİL</button>`:""}</div>`).join("")||`<div class="panel meta">Etkinlik yok.</div>`}catch(e){toast(e.message)}}async function toggleEvent(id){try{await api(`/api/events/${id}/toggle`,{method:"POST"});loadEvents()}catch(e){toast(e.message)}}async function deleteEvent(id){if(!(await appConfirm("Etkinliği Sil","Bu etkinlik ve katılım bilgileri kaldırılacak.","ETKİNLİĞİ SİL")))return;try{await api(`/api/events/${id}`,{method:"DELETE"});loadEvents()}catch(e){toast(e.message)}}
function createCrew(){$("crewName").value="";$("crewDescription").value="";$("crewCreateModal").classList.remove("hidden")}function closeCrewCreate(){$("crewCreateModal").classList.add("hidden")}async function saveCrewCreate(){const name=$("crewName").value.trim(),description=$("crewDescription").value.trim();if(!name){toast("Ekip adı gerekli.");return}try{const d=await api("/api/crews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,description})});toast(d.message);closeCrewCreate();loadCrews()}catch(e){toast(e.message)}}async function loadCrews(){try{const d=await api("/api/crews");$("crews").innerHTML=d.crews.map(c=>`<div class="crew-card"><div class="name">👥 ${esc(c.name)}</div><div class="meta">Kurucu @${esc(c.username)} • ${c.member_count} üye</div><p>${esc(c.description||"")}</p><div class="crew-actions"><button class="${c.member?"cta":""}" onclick="toggleCrew(${c.id})">${c.member?"EKİPTESİN ✓":"EKİBE KATIL"}</button>${c.member?`<button onclick="openCrewChat(${c.id},'${esc(c.name).replace(/'/g,"&#39;")}')">💬 SOHBET</button>`:""}${c.is_owner||me.role==="admin"?`<button onclick="editCrew(${c.id})">DÜZENLE</button><button class="danger" onclick="deleteCrew(${c.id})">SİL</button>`:""}</div></div>`).join("")||`<div class="panel meta">Henüz ekip yok.</div>`}catch(e){toast(e.message)}}async function toggleCrew(id){try{const d=await api(`/api/crews/${id}/toggle`,{method:"POST"});toast(d.message||"Güncellendi.");loadCrews()}catch(e){toast(e.message)}}
async function openProfile(id){showPage("profilePage");const box=$("profileBox");if(box)box.innerHTML=`<div class="v53-profile-loading"><span>●</span> Profil yükleniyor...</div>`;try{const d=await api(`/api/users/${id}`),u=d.user;const mainCar=d.vehicles.find(v=>v.is_favorite)||d.vehicles[0];const media=d.posts.filter(p=>p.photo);
 $("profileBox").dataset.userId=String(u.id);$("profileBox").innerHTML=`<div class="profile-card v53-profile-card"><div class="profile-head v53-profile-head">${img(u.profile_photo,"avatar big")}<div class="v53-profile-identity"><span class="v5-kicker">HAKKARİ ROLL PROFİLİ</span><h2>${esc(u.display_name)} ${vip(u)}</h2><div class="user">@${esc(u.username)}</div><p>${esc(u.bio||"Henüz biyografi eklenmemiş.")}</p></div></div><div class="v53-profile-stats"><button><b>${d.posts.length}</b><span>Gönderi</span></button><button><b>${u.follower_count}</b><span>Takipçi</span></button><button><b>${u.following_count}</b><span>Takip</span></button></div>${mainCar?`<button class="v53-main-vehicle" onclick="openVehicleDetail(${mainCar.id})"><span>🚘</span><div><small>${mainCar.is_favorite?"ANA ARAÇ":"GARAJ"}</small><b>${esc(mainCar.brand)} ${esc(mainCar.model)}</b><em>${esc(mainCar.model_year||"")} ${mainCar.horsepower?`• ${esc(mainCar.horsepower)} HP`:""}</em></div><i>›</i></button>`:""}<div class="person-actions v53-profile-actions">${u.id!==me.id?`<button onclick="toggleFollowProfile(${u.id})">${u.following?"TAKİPTEN ÇIK":"TAKİP ET"}</button><button class="cta" onclick="startChat(${u.id})">💬 MESAJ</button>${u.can_call?`<button class="v610-profile-call" onclick="startVoiceCallUser(${u.id})">📞 SESLİ ARA</button>`:`<button class="v610-profile-call" disabled title="${esc(u.call_restriction||'Yalnızca arkadaşlar arayabilir.')}">📞 ARAMA KAPALI</button>`}<button onclick="sendOffer(${u.id},'roll')">🔥 ROLL</button>`:`<button class="cta" onclick="editProfile()">PROFİLİ DÜZENLE</button><button onclick="changeProfilePhoto()">FOTOĞRAF</button>${me.role==="admin"?`<button onclick="showPage('adminPage');loadAdmin()">◆ YÖNETİM</button>`:""}<button class="danger" onclick="logout()">ÇIKIŞ</button>`}</div><div class="v53-profile-tabs"><button class="active" onclick="setProfileTab('posts',this)">GÖNDERİLER</button><button onclick="setProfileTab('garage',this)">GARAJ</button><button onclick="setProfileTab('media',this)">MEDYA</button></div><div id="profilePostsPanel" class="v53-profile-panel">${d.posts.map(postHtml).join("")||`<div class="v53-profile-empty">Henüz paylaşım yok.</div>`}</div><div id="profileGaragePanel" class="v53-profile-panel hidden"><div class="car-grid">${d.vehicles.map(v=>`<article class="car v53-profile-car" onclick="openVehicleDetail(${v.id})">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}" alt="">`:`<div class="v53-profile-car-placeholder">🚘</div>`}${v.is_favorite?`<span class="v52-main-car-badge">★ ANA ARAÇ</span>`:""}<div class="car-title">${esc(v.brand)} ${esc(v.model)}</div><div class="meta">${esc(v.model_year||"-")} • ${esc(v.engine||"-")} • ${esc(v.fuel||"-")}</div>${u.is_me||me.role==="admin"?`<div class="car-v4-actions v512-profile-car-actions"><button onclick="event.stopPropagation();editVehicle(${v.id})">DÜZENLE</button><button class="danger" onclick="event.stopPropagation();deleteVehicle(${v.id})">SİL</button></div>`:""}</article>`).join("")||`<div class="v53-profile-empty">Garajda araç yok.</div>`}</div></div><div id="profileMediaPanel" class="v53-profile-panel hidden"><div class="v53-profile-media">${media.map(p=>`<button onclick="setProfileTab('posts',document.querySelector('.v53-profile-tabs button'));setTimeout(()=>$('post-${p.id}')?.scrollIntoView({behavior:'smooth',block:'center'}),50)"><img src="/uploads/${encodeURIComponent(p.photo)}" alt=""></button>`).join("")||`<div class="v53-profile-empty">Henüz medya yok.</div>`}</div></div></div>`}catch(e){if(box)box.innerHTML=`<div class="panel meta">${esc(e.message)}</div>`;toast(e.message)}}
function setProfileTab(tab,btn){
 document.querySelectorAll(".v53-profile-tabs button").forEach(x=>x.classList.remove("active"));btn?.classList.add("active");
 const panels={posts:"profilePostsPanel",garage:"profileGaragePanel",media:"profileMediaPanel"};
 Object.entries(panels).forEach(([k,id])=>$(id)?.classList.toggle("hidden",k!==tab));
 const card=$('profileBox')?.querySelector('.v53-profile-card');if(card)card.dataset.activeTab=tab;
 // V5.12: mobilde otomatik window.scrollTo kaldirildi. Sticky+nested scroll kombinasyonu
 // profil -> Garaj gecisinde paneli topbar altinda kilitleyebiliyordu.
}

async function toggleFollowProfile(id){try{await api(`/api/users/${id}/follow`,{method:"POST"});openProfile(id)}catch(e){toast(e.message)}}function editProfile(){$("editDisplayName").value=me.display_name||"";$("editBio").value=me.bio||"";$("profileEditModal").classList.remove("hidden")}function closeProfileEdit(){$("profileEditModal").classList.add("hidden")}async function saveProfileEdit(){const display_name=$("editDisplayName").value.trim(),bio=$("editBio").value.trim();if(!display_name){toast("Görünen ad gerekli.");return}try{const d=await api("/api/me",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name,bio})});me=d.user;localStorage.setItem("hr_user",JSON.stringify(me));closeProfileEdit();updateAppChrome();openProfile(me.id);toast("Profil güncellendi.")}catch(e){toast(e.message)}}async function changeProfilePhoto(){const input=document.createElement("input");input.type="file";input.accept="image/*";input.onchange=async()=>{const fd=new FormData();fd.append("photo",input.files[0]);try{const d=await api("/api/me/photo",{method:"POST",body:fd});me.profile_photo=d.profile_photo;localStorage.setItem("hr_user",JSON.stringify(me));updateAppChrome();openProfile(me.id)}catch(e){toast(e.message)}};input.click()}
async function startChat(uid){try{const d=await api(`/api/conversations/with/${uid}`,{method:"POST"});showPage("messagesPage");await loadConversations();openConversation(d.conversation_id)}catch(e){toast(e.message)}}
function parseAppTime(v){if(!v)return null;let s=String(v).trim().replace(" ","T");if(!/[zZ]|[+\-]\d\d:\d\d$/.test(s))s+="Z";const t=new Date(s);return Number.isNaN(t.getTime())?null:t}
function formatAppTime(v){const t=parseAppTime(v);if(!t)return String(v||"");return new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",hour:"2-digit",minute:"2-digit"}).format(t)}
function formatAppDateTime(v){const t=parseAppTime(v);if(!t)return String(v||"");return new Intl.DateTimeFormat("tr-TR",{timeZone:"Europe/Istanbul",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(t)}
function conversationPresence(c){const v=c?.other?.last_seen;if(c?.other?.online)return"🟢 Çevrimiçi";if(!v)return"Özel sohbet";const t=parseAppTime(v);if(t&&Date.now()-t.getTime()<90000)return"🟢 Çevrimiçi";return `Son görülme ${formatAppTime(v)}`}
function setMessageUnreadBadge(total){total=Number(total)||0;const navBtn=document.querySelector('#nav button[data-page="messagesPage"]');if(!navBtn)return;let badge=navBtn.querySelector('.v53-nav-unread');if(total&&!badge){badge=document.createElement('b');badge.className='v53-nav-unread';navBtn.appendChild(badge)}if(badge){badge.textContent=total>99?'99+':String(total);badge.classList.toggle('hidden',!total)}}
function renderConversations(){const host=$("conversations");if(!host)return;const q=($("conversationSearch")?.value||"").toLocaleLowerCase("tr");const list=conversationCache.filter(c=>{const o=c.other||{};const hay=`${o.display_name||""} ${o.username||""} ${c.last_message?.body||""}`.toLocaleLowerCase("tr");return (!q||hay.includes(q))&&(!conversationUnreadOnly||c.unread>0)});host.innerHTML=list.map(c=>{const o=c.other||{display_name:"Kullanıcı",username:"",profile_photo:null};const online=o.online||(()=>{const t=parseAppTime(o.last_seen);return !!(t&&Date.now()-t.getTime()<90000)})();return `<button class="conversation v5-conversation ${activeConversation===c.id?"active":""}" data-conversation-id="${c.id}" onclick="openConversation(${c.id},'${esc(o.display_name).replace(/'/g,"&#39;")}')"><span class="v5-conversation-avatar ${online?'online':''}">${img(o.profile_photo)}${online?`<i class="v54-online-dot"></i>`:""}</span><span class="v5-conversation-copy"><b>${esc(o.display_name)}</b><small>@${esc(o.username)}</small><em>${esc(c.last_message?.body||"Yeni sohbet")}</em></span><span class="v5-conversation-meta">${c.unread?`<strong>${c.unread}</strong>`:""}<small>${esc(formatAppTime(c.last_message?.created_at||""))}</small></span></button>`}).join("")||`<div class="v5-empty-conversations"><span>💬</span><p>${conversationUnreadOnly?"Okunmamış mesajın yok.":q?"Aramana uygun sohbet bulunamadı.":"Henüz bir sohbetin yok."}</p><button onclick="openExplore()">YENİ SOHBET BAŞLAT</button></div>`;setMessageUnreadBadge(conversationCache.reduce((n,c)=>n+(Number(c.unread)||0),0))}
function showAllConversations(btn){conversationUnreadOnly=false;document.querySelectorAll(".v5-message-tabs button").forEach(x=>x.classList.remove("active"));btn?.classList.add("active");renderConversations()}
function filterUnreadConversations(btn){conversationUnreadOnly=true;document.querySelectorAll(".v5-message-tabs button").forEach(x=>x.classList.remove("active"));btn?.classList.add("active");renderConversations()}
async function loadConversations(silent=false){try{const d=await api("/api/conversations");conversationCache=(d.conversations||[]).filter(c=>c&&c.other);renderConversations();const c=conversationCache.find(x=>x.id===activeConversation);if(c&&$("chatPresence")&&!$("chatPresence").classList.contains("typing"))$("chatPresence").textContent=conversationPresence(c)}catch(e){if(!silent){const host=$("conversations");if(host)host.innerHTML=`<div class="v53-message-error"><b>Mesajlar açılamadı</b><p>${esc(e.message)}</p><button onclick="loadConversations()">TEKRAR DENE</button></div>`;toast(e.message)}}}
function messageBubbleHtml(m){const mine=m.sender_id===me.id,deleted=Number(m.deleted_for_everyone)||0;return `<div class="bubble ${mine?"me":""} ${deleted?"v55-deleted-message":""}" data-message-id="${m.id}"><div class="v55-bubble-row"><span class="v55-message-body">${deleted?`<i>🚫 Bu mesaj silindi.</i>`:esc(m.body)}</span><button class="v55-message-menu" onclick="openMessageActions(${m.id},${mine},${deleted});event.stopPropagation()" aria-label="Mesaj işlemleri">⋮</button></div><div class="bubble-time">${esc(formatAppTime(m.created_at))}${mine?` <span class="v54-ticks">${m.read_at?"✓✓":"✓"}</span>`:""}</div></div>`}
function openMessageActions(id,mine,deleted){selectedMessageId=Number(id);const modal=$("messageActionsModal");if(!modal)return;$("deleteForEveryoneBtn").classList.toggle("hidden",!mine||!!deleted);$("deleteForMeBtn").textContent=deleted?"Bu kaydı benden sil":"Benden sil";modal.classList.remove("hidden")}
function closeMessageActions(){$("messageActionsModal")?.classList.add("hidden");selectedMessageId=null}
async function deleteSelectedMessage(scope){if(!selectedMessageId)return;const mid=selectedMessageId;closeMessageActions();if(scope==="everyone"&&!await appConfirm("Herkesten Sil","Bu mesaj karşı tarafın sohbetinden de kalıcı olarak kaldırılacak. Süre sınırı yoktur.","HERKESTEN SİL"))return;if(scope==="me"&&!await appConfirm("Benden Sil","Bu mesaj yalnızca senin sohbetinden kaldırılacak.","BENDEN SİL"))return;try{const d=await api(`/api/messages/${mid}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope})});const el=$("chatMessages")?.querySelector(`[data-message-id="${mid}"]`);if(scope==="me")el?.remove();else if(el){el.classList.add("v55-deleted-message");const bodyEl=el.querySelector(".v55-message-body");if(bodyEl)bodyEl.innerHTML="<i>🚫 Bu mesaj silindi.</i>";const menu=el.querySelector(".v55-message-menu");if(menu)menu.setAttribute("onclick",`openMessageActions(${mid},true,true);event.stopPropagation()`)}toast(d.message);loadConversations(true);pollConversationLive()}catch(e){toast(e.message)}}
function updateReadTicks(readUpTo){if(!readUpTo)return;$("chatMessages")?.querySelectorAll('.bubble.me[data-message-id]').forEach(el=>{if(Number(el.dataset.messageId)<=Number(readUpTo)){const t=el.querySelector('.v54-ticks');if(t)t.textContent='✓✓'}})}
async function openConversation(id,title="Sohbet"){stopMessageLive();activeConversation=id;lastMessageId=0;messagePollTick=0;const c=conversationCache.find(x=>x.id===id),o=c?.other;const callBtn=$('chatCallBtn');if(callBtn){callBtn.classList.toggle('hidden',!o?.id||!o?.can_call);callBtn.dataset.userId=o?.id||'';callBtn.title=o?.can_call?'Sesli ara':(o?.call_restriction||'Yalnızca karşılıklı takip ettiğin arkadaşlarını arayabilirsin.');}$("chatTitle").textContent=o?.display_name||title||"Sohbet";if($("chatPeerAvatar"))$("chatPeerAvatar").innerHTML=img(o?.profile_photo);if($("chatPresence")){$("chatPresence").classList.remove("typing");$("chatPresence").textContent=conversationPresence(c)}if($("composerTyping")){$("composerTyping").classList.add("hidden");$("composerTyping").textContent=""}$("messagesPage")?.classList.add("chat-open");renderConversations();await loadMessages();loadConversations(true);messageTimer=setInterval(async()=>{await pollConversationLive();messagePollTick++;if(messagePollTick%4===0)loadConversations(true)},1100);setTimeout(()=>$('chatInput')?.focus(),80)}
function stopMessageLive(){clearInterval(messageTimer);messageTimer=null;messageLiveBusy=false;clearTimeout(typingStopTimer);typingStopTimer=null;if(activeConversation)sendTypingState(false,true)}
function closeMobileChat(){stopMessageLive();$("messagesPage")?.classList.remove("chat-open");activeConversation=null;lastMessageId=0;const b=$('chatCallBtn');if(b){b.classList.add('hidden');b.dataset.userId='';}loadConversations(true)}
async function loadMessages(showError=true){if(!activeConversation)return;try{const d=await api(`/api/conversations/${activeConversation}/messages`),host=$("chatMessages"),messages=d.messages||[];host.innerHTML=messages.length?messages.map(messageBubbleHtml).join(""):`<div class="v53-chat-empty">Henüz mesaj yok. İlk mesajı sen gönder.</div>`;lastMessageId=messages.length?Math.max(...messages.map(m=>Number(m.id)||0)):0;host.scrollTop=host.scrollHeight}catch(e){if(showError){$("chatMessages").innerHTML=`<div class="v53-message-error"><b>Sohbet açılamadı</b><p>${esc(e.message)}</p><button onclick="loadMessages()">TEKRAR DENE</button></div>`;toast(e.message)}}}
async function pollConversationLive(){if(!activeConversation||messageLiveBusy||document.hidden)return;messageLiveBusy=true;const cid=activeConversation;try{const d=await api(`/api/conversations/${cid}/live?after=${lastMessageId}`);if(cid!==activeConversation)return;const host=$("chatMessages"),nearBottom=host.scrollHeight-host.scrollTop-host.clientHeight<130,newMessages=d.messages||[];(d.hidden_ids||[]).forEach(id=>host.querySelector(`[data-message-id="${id}"]`)?.remove());(d.deleted_ids||[]).forEach(id=>{const el=host.querySelector(`[data-message-id="${id}"]`);if(el&&!el.classList.contains("v55-deleted-message")){const mine=el.classList.contains("me"),time=el.querySelector(".bubble-time")?.textContent||"";el.classList.add("v55-deleted-message");const body=el.querySelector(".v55-message-body");if(body)body.innerHTML="<i>🚫 Bu mesaj silindi.</i>";const everyone=el.querySelector(".v55-message-menu");if(everyone)everyone.setAttribute("onclick",`openMessageActions(${id},${mine},true);event.stopPropagation()`)}});if(newMessages.length){host.querySelector('.v53-chat-empty')?.remove();host.insertAdjacentHTML('beforeend',newMessages.map(messageBubbleHtml).join(''));lastMessageId=Math.max(lastMessageId,...newMessages.map(m=>Number(m.id)||0));if(nearBottom||newMessages.some(m=>m.sender_id===me.id))host.scrollTop=host.scrollHeight}updateReadTicks(d.read_up_to);const p=$("chatPresence"),cp=$("composerTyping");if(p){if(d.typing){p.textContent='yazıyor…';p.classList.add('typing')}else{p.classList.remove('typing');p.textContent=d.other_online?'🟢 Çevrimiçi':(d.other_last_seen?`Son görülme ${formatAppTime(d.other_last_seen)}`:'Özel sohbet')}}if(cp){cp.textContent=d.typing?`${$("chatTitle")?.textContent||"Kullanıcı"} yazıyor…`:"";cp.classList.toggle("hidden",!d.typing)}if(newMessages.some(m=>m.sender_id!==me.id))loadConversations(true)}catch(e){}finally{messageLiveBusy=false}}
async function sendTypingState(typing,silent=false){if(!activeConversation)return;try{await api(`/api/conversations/${activeConversation}/typing`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({typing})})}catch(e){}}
function messageTypingChanged(){if(!activeConversation)return;const has=!!$("chatInput")?.value.trim(),t=Date.now();if(has&&t-typingLastSent>1800){typingLastSent=t;sendTypingState(true,true)}clearTimeout(typingStopTimer);typingStopTimer=setTimeout(()=>sendTypingState(false,true),2200)}
function stopMessageTyping(){clearTimeout(typingStopTimer);typingStopTimer=null;sendTypingState(false,true)}
async function sendMessage(){if(!activeConversation){toast("Önce bir sohbet seç.");return}const input=$("chatInput"),body=input.value.trim();if(!body)return;const old=body;input.value="";stopMessageTyping();try{await api(`/api/conversations/${activeConversation}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});await pollConversationLive();loadConversations(true)}catch(e){input.value=old;toast(e.message)}}
async function livePulse(){if(!token||!me||document.hidden)return;try{const d=await api('/api/v54/pulse');setMessageUnreadBadge(d.unread_messages);if($("notifCount"))$("notifCount").textContent=d.unread_notifications?String(d.unread_notifications):"";if($("liveCount"))$("liveCount").innerHTML=`<i></i> ${d.roll_count} ROLL AKTİF`;if($("v2HeroLive"))$("v2HeroLive").textContent=`${d.roll_count} CANLI`;if($("radarCount"))$("radarCount").textContent=`${d.roll_count} kişi`;if($("v5RollCount"))$("v5RollCount").textContent=d.roll_count;if($("v5RollStatus"))$("v5RollStatus").textContent=d.roll_status?`${d.roll_status} • Roll aktif`:"Şu an çevrimdışısın";if($("rollToggleBtn"))$("rollToggleBtn").innerHTML=d.roll_status?"🟢 ROLL AKTİF <b>→</b>":"ROLL AKTİF ET <b>→</b>";if($("v5RollToggleBtn"))$("v5RollToggleBtn").innerHTML=d.roll_status?"ROLL DURUMUNU YÖNET <b>→</b>":"ROLL AKTİF ET <b>→</b>";hrMapLiveTick++;if(!$("mapPage")?.classList.contains("hidden")&&hrMapLiveTick%2===0)loadRollMap(true)}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){livePulse();if(activeConversation)pollConversationLive()}});
let adminUsersCache=[];function adminTab(id){document.querySelectorAll(".adminbox").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden");if(id==="adminWeeklyBox")loadWeeklyPickers();if(id==="adminAnnouncementsBox")loadAdminAnnouncements()}async function loadAdmin(){try{const [s,u,r,st,a]=await Promise.all([api("/api/admin/stats"),api("/api/admin/users"),api("/api/admin/reports"),api("/api/admin/settings"),api("/api/admin/audit")]);$("adminStats").innerHTML=Object.entries(s.stats).map(([k,v])=>`<div class="stat"><strong>${v}</strong>${esc(k)}</div>`).join("");adminUsersCache=u.users;renderAdminUsers();$("adminReports").innerHTML=r.reports.map(x=>`<div class="panel"><b>${esc(x.target_type)} #${x.target_id}</b><div class="meta">@${esc(x.reporter_username)} • ${esc(x.status)}</div><p>${esc(x.reason||"")}</p><div class="admin-actions">${x.status==="open"?`<button onclick="adminCloseReport(${x.id})">KAPAT</button>`:""}${["post","comment","vehicle"].includes(x.target_type)?`<button class="danger" onclick="adminDeleteContent('${x.target_type}',${x.target_id})">İÇERİĞİ SİL</button>`:""}${x.target_type==="user"?`<button onclick="adminBan(${x.target_id})">BANLA</button><button class="danger" onclick="adminDeleteUser(${x.target_id})">HESABI SİL</button>`:""}</div></div>`).join("");$("regMode").value=st.settings.registration_mode||"approval";$("regLimit").value=st.settings.daily_ip_registration_limit||3;$("adminAudit").innerHTML=a.logs.map(x=>`<div class="panel"><b>${esc(x.action)}</b><div class="meta">@${esc(x.admin_username||"sistem")} • ${esc(x.created_at||"")}</div></div>`).join("")}catch(e){toast(e.message)}}function renderAdminUsers(){const q=($("adminUserSearch")?.value||"").toLowerCase();$("adminUsers").innerHTML=adminUsersCache.filter(u=>`${u.username} ${u.display_name} ${u.email||""}`.toLowerCase().includes(q)).map(u=>`<div class="panel admin-user ${u.vip?"vip-card":""}"><div><div class="name">${esc(u.display_name)} @${esc(u.username)} ${u.vip?`<span class="vip-badge">★ VIP</span>`:""} ${!u.approved?`<span class="pending-badge">ONAY</span>`:""} ${u.banned?`<span class="ban-badge">BANLI</span>`:""}</div><div class="meta">${esc(u.email||"E-posta yok")} • ${u.role} • ${u.active?"Aktif":"Pasif"}</div></div><div class="admin-actions">${!u.approved?`<button class="cta" onclick="adminApprove(${u.id})">ONAYLA</button>`:""}<button onclick="adminVip(${u.id})">${u.vip?"VIP KALDIR":"VIP YAP"}</button><button onclick="adminBan(${u.id})">BANLA</button>${u.banned?`<button onclick="adminUnban(${u.id})">BAN KALDIR</button>`:""}<button onclick="adminResetPassword(${u.id})">ŞİFRE</button><button onclick="adminToggleActive(${u.id})">${u.active?"PASİF":"AKTİF"}</button>${(u.role!=="admin"||u.created_by===me.id)&&u.id!==me.id?`<button class="danger" onclick="adminDeleteUser(${u.id})">SİL</button>`:""}</div></div>`).join("")}async function adminCreateUser(){try{const d=await api("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({display_name:$("acuName").value,username:$("acuUser").value,email:$("acuEmail").value,password:$("acuPass").value,role:$("acuRole").value,vip:$("acuVip").checked})});await appNotice("Hesap Oluşturuldu",`Kullanıcı: ${d.username}
Şifre: ${d.password}`,"TAMAM");loadAdmin()}catch(e){toast(e.message)}}async function adminApprove(id){await api(`/api/admin/users/${id}/approve`,{method:"POST"});loadAdmin()}async function adminVip(id){await api(`/api/admin/users/${id}/vip`,{method:"POST"});loadAdmin()}async function adminBan(id){const r=await appDialog({title:"Kullanıcıyı Banla",message:"Ban süresini ve sebebini seç.",confirmText:"BANLA",danger:true,fields:[{name:"minutes",label:"Ban süresi",type:"select",value:"1440",options:[{value:"60",label:"1 saat"},{value:"1440",label:"1 gün"},{value:"10080",label:"7 gün"},{value:"43200",label:"30 gün"},{value:"5256000",label:"Uzun süre / kalıcı"}]},{name:"reason",label:"Sebep",type:"textarea",placeholder:"Ban sebebi...",maxLength:500}]});if(!r)return;await api(`/api/admin/users/${id}/ban`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({minutes:+r.minutes,reason:r.reason||""})});toast("Kullanıcı banlandı.");loadAdmin()}async function adminUnban(id){await api(`/api/admin/users/${id}/unban`,{method:"POST"});loadAdmin()}async function adminResetPassword(id){const r=await appDialog({title:"Şifreyi Sıfırla",message:"Yeni şifreyi boş bırakırsan sistem güvenli bir şifre oluşturur.",confirmText:"ŞİFREYİ YENİLE",fields:[{name:"password",label:"Yeni şifre",type:"password",placeholder:"Boş bırak = otomatik",autocomplete:"new-password",maxLength:100}]});if(!r)return;const d=await api(`/api/admin/users/${id}/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:r.password})});await appNotice("Yeni Şifre Oluşturuldu",`Yeni şifre: ${d.password}`,"TAMAM")}async function adminToggleActive(id){await api(`/api/admin/users/${id}/toggle-active`,{method:"POST"});loadAdmin()}async function adminDeleteUser(id){if(!(await appConfirm("Hesabı Kalıcı Sil","Bu işlem geri alınamaz. Kullanıcının hesabı ve ilişkili verileri silinecek.","HESABI SİL")))return;await api(`/api/admin/users/${id}`,{method:"DELETE"});toast("Hesap silindi.");loadAdmin()}async function adminCloseReport(id){await api(`/api/admin/reports/${id}/close`,{method:"POST"});loadAdmin()}async function adminDeleteContent(t,id){if(!(await appConfirm("İçeriği Sil","Şikâyet edilen içerik kalıcı olarak kaldırılacak.","İÇERİĞİ SİL")))return;await api(`/api/admin/content/${t}/${id}`,{method:"DELETE"});toast("İçerik silindi.");loadAdmin()}async function saveAdminSettings(){const d=await api("/api/admin/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({registration_mode:$("regMode").value,daily_ip_registration_limit:+$("regLimit").value})});toast(d.message)}

// =========================================================
// HAKKARI ROLL V5.12 — STABILITY / GARAGE / ADMIN
// =========================================================
function closeTransientOverlays(exceptId=''){
 ['vehicleDetailModal','rollUserSheet','rollModal','profileEditModal','crewCreateModal','crewChatModal','storyModal','messageActionsModal','verifyModal','agreementModal','appDialog','pwaIosHelp'].forEach(id=>{if(id!==exceptId)$(id)?.classList.add('hidden')});
 if(exceptId!=='notificationsDrawer'&&!$('notificationsDrawer')?.classList.contains('hidden'))closeNotifications();
 syncOverlayState();
}
function syncOverlayState(){const open=[...document.querySelectorAll('.modal')].some(x=>!x.classList.contains('hidden'));document.documentElement.classList.toggle('v512-modal-open',open);document.body.classList.toggle('v512-modal-open',open)}
const _v512ShowPage=showPage;showPage=function(id){closeTransientOverlays();return _v512ShowPage(id)};
const _v512OpenProfile=openProfile;openProfile=async function(id){closeTransientOverlays();return _v512OpenProfile(id)};
const _v512ModalObserver=new MutationObserver(()=>syncOverlayState());document.querySelectorAll('.modal').forEach(m=>_v512ModalObserver.observe(m,{attributes:true,attributeFilter:['class']}));syncOverlayState();

let adminVehicleSearchTimer=null;
const _v512AdminTab=adminTab;adminTab=function(id){_v512AdminTab(id);if(id==='adminVehiclesBox')loadAdminVehicles();if(id==='adminSystemBox')loadAdminDiagnostics()};
function queueAdminVehicleSearch(){clearTimeout(adminVehicleSearchTimer);adminVehicleSearchTimer=setTimeout(loadAdminVehicles,220)}
async function loadAdminVehicles(){if(me?.role!=='admin')return;const host=$('adminVehicles');if(!host)return;host.innerHTML='<div class="meta">Araçlar yükleniyor...</div>';try{const q=encodeURIComponent(($('adminVehicleSearch')?.value||'').trim()),d=await api(`/api/admin/vehicles?q=${q}`);host.innerHTML=(d.vehicles||[]).map(v=>`<article class="v512-admin-vehicle"><div class="v512-admin-vehicle-photo">${v.photo?`<img src="/uploads/${encodeURIComponent(v.photo)}" alt="">`:'<span>🚘</span>'}</div><div class="v512-admin-vehicle-info"><b>${esc(v.brand||'-')} ${esc(v.model||'')}</b><small>@${esc(v.username||'silinmiş-hesap')} • #${v.id}</small><div class="meta">${esc(v.model_year||'-')} • ${esc(v.plate||'Plaka yok')} • 🔥 ${v.vote_count||0} • 📷 ${v.gallery_count||0}</div></div><div class="v512-admin-vehicle-actions"><button onclick="openVehicleDetail(${v.id})">İNCELE</button>${v.user_id?`<button onclick="openProfile(${v.user_id})">SAHİBİ</button>`:''}<button onclick="editVehicle(${v.id})">DÜZENLE</button><button onclick="replaceVehicleMainPhoto(${v.id})">FOTOĞRAF</button><button class="danger" onclick="deleteVehicle(${v.id})">ARACI SİL</button></div></article>`).join('')||'<div class="meta">Araç bulunamadı.</div>'}catch(e){host.innerHTML=`<div class="v53-message-error"><b>Araçlar yüklenemedi</b><p>${esc(e.message)}</p><button onclick="loadAdminVehicles()">TEKRAR DENE</button></div>`}}
async function loadAdminDiagnostics(){const host=$('adminDiagnostics');if(!host)return;host.innerHTML='<div class="meta">Kontrol ediliyor...</div>';try{const d=await api('/api/admin/diagnostics');host.innerHTML=`<div class="panel"><b>✓ Veritabanı</b><div class="meta">${esc(d.database)} • V${esc(d.version||'')}</div></div><div class="panel"><b>Oturum Şeması</b><div class="meta">${(d.session_schema||[]).map(esc).join(' • ')}</div></div><div class="panel"><b>Tablolar</b><div class="meta">${Number(d.table_count)||0} tablo • ${esc(d.timezone||'')}</div></div>`}catch(e){host.innerHTML=`<div class="v53-message-error"><b>Sistem kontrolü başarısız</b><p>${esc(e.message)}</p></div>`}}

if("serviceWorker" in navigator)navigator.serviceWorker.register("/service-worker.js").catch(()=>{});if(token&&me)showApp();else showLogin();

// HAKKARI ROLL V4
let v4PresenceTimer=null;
async function loadV4Home(){try{const d=await api("/api/v4/dashboard");$("radarCount").textContent=`${d.roll_active} kişi`;$("rollScore").textContent=d.score;$("rollLevel").textContent=d.level;$("announcementStrip").innerHTML=(d.announcements||[]).map(a=>`<div class="announcement-card"><b>📢 ${esc(a.title)}</b><div>${esc(a.body)}</div></div>`).join("");const w=d.weekly_car,wu=d.weekly_user;$("weeklyCar").innerHTML=(wu?`<div class="weekly-user spotlight-user" onclick="openProfile(${wu.id})">${img(wu.profile_photo,"avatar weekly-profile-avatar")}<div><div class="eyebrow">⭐ HAFTANIN KULLANICISI</div><div class="weekly-person-name">${esc(wu.display_name)}</div><div class="user">${usernameHtml(wu)} ${vip(wu)}</div><button>PROFİLİ GÖR</button></div></div>`:"")+(w?`<article class="weekly-car-hero"><header class="weekly-hero-head"><div><span class="weekly-trophy">🏆</span><span>HAFTANIN ARABASI</span></div><div class="weekly-vote-count">🔥 ${w.votes||0} OY</div></header><div class="weekly-hero-grid"><div class="weekly-hero-person"><div class="weekly-profile-wrap" onclick="openProfile(${w.user_id})">${img(w.profile_photo,"avatar weekly-hero-avatar")}<span class="weekly-crown">👑</span></div><div class="weekly-identity"><div class="weekly-kicker">BU HAFTANIN YILDIZI</div><div class="weekly-hero-name" onclick="openProfile(${w.user_id})">${esc(w.display_name)}</div><div class="weekly-hero-user">${usernameHtml(w)} ${vip(w)}</div><div class="weekly-vehicle-line">${brandLogo(w.brand,"weekly-inline-logo")}<span><b>${esc(w.brand)} ${esc(w.model)}</b>${w.plate?`<small>${esc(w.plate)}</small>`:""}</span></div><div class="weekly-hero-actions"><button class="cta" onclick="voteVehicle(${w.id})">🔥 OY VER</button><button onclick="openVehicleDetail(${w.id})">🚘 ARACI İNCELE</button><button onclick="openProfile(${w.user_id})">👤 PROFİL</button></div></div></div>${w.photo?`<div class="weekly-hero-photo-wrap" onclick="openVehicleDetail(${w.id})"><img class="weekly-hero-photo" src="/uploads/${encodeURIComponent(w.photo)}" alt="${esc(w.brand)} ${esc(w.model)}"><span class="weekly-photo-badge">🏁 HAFTANIN SEÇİMİ</span></div>`:`<div class="weekly-hero-photo-wrap weekly-no-car-photo"><div>${brandLogo(w.brand,"weekly-fallback-logo")}<b>${esc(w.brand)} ${esc(w.model)}</b><small>Araç fotoğrafı henüz eklenmemiş</small></div></div>`}</div></article>`:"")}catch(e){}loadStories()}
async function loadStories(){try{const d=await api("/api/stories");window.hrStories=d.stories;const by={};d.stories.forEach(s=>{if(!by[s.user_id])by[s.user_id]=s});$("stories").innerHTML=Object.values(by).map(s=>`<button class="story-bubble" onclick="openStory(${s.id})"><span class="story-ring">${img(s.profile_photo,"story-avatar")}</span><small>${esc(s.display_name)}</small></button>`).join("")||`<div class="meta story-empty">Henüz hikâye yok.</div>`}catch(e){}}
function createStory(){const i=document.createElement("input");i.type="file";i.accept="image/*,video/mp4,video/webm,video/quicktime,.mov,.m4v,.heic,.heif";i.onchange=async()=>{if(!i.files[0])return;const r=await appDialog({title:"Hikâye Paylaş",message:"Seçtiğin fotoğraf/video 24 saat hikâyende kalacak.",confirmText:"HİKÂYEYİ YAYINLA",fields:[{name:"body",label:"Hikâye notu",type:"textarea",placeholder:"Bir şeyler yaz... (opsiyonel)",maxLength:300}]});if(!r)return;const fd=new FormData();fd.append("media",i.files[0]);fd.append("body",r.body||"");try{const d=await api("/api/stories",{method:"POST",body:fd});toast(d.message);loadStories()}catch(e){toast(e.message)}};i.click()}
function openStory(id){const s=(window.hrStories||[]).find(x=>x.id===id);if(!s)return;$("storyOwner").textContent=`${s.display_name} • @${s.username}`;const media=s.media?(s.media.match(/\.(mp4|webm|mov|m4v)$/i)?`<video class="story-media" src="/uploads/${encodeURIComponent(s.media)}" autoplay controls playsinline></video>`:`<img class="story-media" src="/uploads/${encodeURIComponent(s.media)}">`):"";$("storyContent").innerHTML=`${media}${s.body?`<p class="story-caption">${esc(s.body)}</p>`:""}${s.user_id===me.id||me.role==="admin"?`<button class="danger" onclick="deleteStory(${s.id})">HİKÂYEYİ SİL</button>`:""}`;$("storyModal").classList.remove("hidden")}
function closeStory(){$("storyModal").classList.add("hidden");$("storyContent").innerHTML=""}
async function deleteStory(id){try{await api(`/api/stories/${id}`,{method:"DELETE"});closeStory();loadStories()}catch(e){toast(e.message)}}
async function voteVehicle(id){try{const d=await api(`/api/vehicles/${id}/vote`,{method:"POST"});toast(d.voted?"Oy verildi 🔥":"Oy geri çekildi.");loadV4Home()}catch(e){toast(e.message)}}
async function setFavoriteVehicle(id){try{const d=await api(`/api/vehicles/${id}/favorite`,{method:"POST"});toast(d.message);openProfile(me.id)}catch(e){toast(e.message)}}
async function addGalleryPhoto(id){const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=async()=>{const fd=new FormData();fd.append("photo",i.files[0]);try{const d=await api(`/api/vehicles/${id}/gallery`,{method:"POST",body:fd});toast(d.message)}catch(e){toast(e.message)}};i.click()}
async function blockUser(id){try{const d=await api(`/api/users/${id}/block`,{method:"POST"});toast(d.blocked?"Kullanıcı engellendi.":"Engel kaldırıldı.");openProfile(id)}catch(e){toast(e.message)}}
async function editV4Profile(){const r=await appDialog({title:"Sosyal Bilgiler",message:"Profilinde göstermek istediğin sosyal bilgileri düzenle.",confirmText:"KAYDET",fields:[{name:"instagram",label:"Instagram",type:"text",placeholder:"kullaniciadi",maxLength:80}]});if(!r)return;try{await api("/api/v4/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({instagram:r.instagram})});toast("Sosyal bilgiler güncellendi.");openProfile(me.id)}catch(e){toast(e.message)}}
async function changeCoverPhoto(){const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=async()=>{const fd=new FormData();fd.append("photo",i.files[0]);try{await api("/api/v4/profile/cover",{method:"POST",body:fd});openProfile(me.id)}catch(e){toast(e.message)}};i.click()}
async function adminAnnouncement(){const title=$("annTitle").value.trim(),body=$("annBody").value.trim(),hours=+$("annHours").value||24;try{const d=await api("/api/admin/announcements",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body,hours})});toast(d.message);$("annTitle").value="";$("annBody").value="";loadAdminAnnouncements();loadV4Home()}catch(e){toast(e.message)}}
async function adminGiveBadge(uid){const r=await appDialog({title:"Rozet Ver",message:"Kullanıcının profilinde görünecek rozeti seç veya yaz.",confirmText:"ROZETİ VER",fields:[{name:"badge",label:"Rozet",type:"text",value:"Kurucu Üye",placeholder:"Örn: Kurucu Üye",required:true,maxLength:50}]});if(!r)return;try{const d=await api(`/api/admin/users/${uid}/badge`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({badge:r.badge})});toast(d.message)}catch(e){toast(e.message)}}
let activeCrewChat=null,crewChatTimer=null;async function openCrewChat(cid,name){activeCrewChat=cid;$("crewChatTitle").textContent=`💬 ${name}`;$("crewChatModal").classList.remove("hidden");await loadCrewMessages();clearInterval(crewChatTimer);crewChatTimer=setInterval(loadCrewMessages,1800)}function closeCrewChat(){$("crewChatModal").classList.add("hidden");activeCrewChat=null;clearInterval(crewChatTimer)}async function loadCrewMessages(){if(!activeCrewChat)return;try{const d=await api(`/api/crews/${activeCrewChat}/messages`);$("crewChatMessages").innerHTML=d.messages.map(x=>`<div class="bubble ${x.user_id===me.id?"me":""}"><b>${esc(x.display_name)}</b><br>${esc(x.body)}<div class="bubble-time">${esc(x.created_at)}</div></div>`).join("")||`<div class="meta">Henüz mesaj yok. İlk mesajı sen gönder.</div>`;$("crewChatMessages").scrollTop=$("crewChatMessages").scrollHeight}catch(e){toast(e.message)}}async function sendCrewMessage(){if(!activeCrewChat)return;const body=$("crewChatInput").value.trim();if(!body)return;try{await api(`/api/crews/${activeCrewChat}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})});$("crewChatInput").value="";loadCrewMessages()}catch(e){toast(e.message)}}
async function v4Presence(){try{await livePulse()}catch(e){}}
window.addEventListener("load",()=>setTimeout(()=>{if(typeof me!=="undefined"&&me){loadV4Home();livePulse()}},1200));
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

async function editVehicle(id){
 try{const d=await api(`/api/vehicles/${id}`),v=d.vehicle;if(!v)return toast('Araç bulunamadı.');
 const r=await appDialog({title:'Aracı Düzenle',message:'Araç bilgilerini güncelle.',confirmText:'DEĞİŞİKLİKLERİ KAYDET',fields:[
 {name:'brand',label:'Marka',type:'text',value:v.brand||'',required:true},{name:'model',label:'Model',type:'text',value:v.model||'',required:true},{name:'model_year',label:'Model yılı',type:'text',value:v.model_year||''},{name:'engine',label:'Motor',type:'text',value:v.engine||''},{name:'fuel',label:'Yakıt',type:'text',value:v.fuel||''},{name:'horsepower',label:'Beygir',type:'text',value:v.horsepower||''},{name:'transmission',label:'Şanzıman',type:'text',value:v.transmission||''},{name:'drivetrain',label:'Çekiş',type:'text',value:v.drivetrain||''},{name:'plate',label:'Plaka',type:'text',value:v.plate||''},{name:'color',label:'Renk',type:'text',value:v.color||''},{name:'mods',label:'Modifikasyonlar',type:'textarea',value:v.mods||''},{name:'note',label:'Not',type:'textarea',value:v.note||''}]});
 if(!r)return;const x=await api(`/api/vehicles/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});toast(x.message);refreshVehicleViews();if(!$('profilePage')?.classList.contains('hidden'))openProfile(Number($('profileBox')?.dataset?.userId)||me.id)
 }catch(e){toast(e.message)}
}


async function editCrew(id){try{const d=await api('/api/crews');const c=d.crews.find(x=>x.id===id);if(!c)return;const r=await appDialog({title:'Ekibi Düzenle',message:'Ekip bilgilerini yalnızca kurucu değiştirebilir.',confirmText:'KAYDET',fields:[{name:'name',label:'Ekip adı',type:'text',value:c.name||'',required:true,maxLength:80},{name:'description',label:'Açıklama',type:'textarea',value:c.description||'',maxLength:500}]});if(!r)return;const x=await api(`/api/crews/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});toast(x.message);loadCrews()}catch(e){toast(e.message)}}
async function deleteCrew(id){if(!(await appConfirm('Ekibi Sil','Ekip, üyelikler ve ekip sohbeti kalıcı olarak silinecek.','EKİBİ SİL')))return;try{const x=await api(`/api/crews/${id}`,{method:'DELETE'});toast(x.message);loadCrews()}catch(e){toast(e.message)}}


async function loadAdminAnnouncements(){if(me?.role!=='admin')return;try{const d=await api('/api/admin/announcements');const box=$('adminAnnouncementList');if(!box)return;box.innerHTML=d.announcements.map(a=>`<div class="announcement-admin-card"><div><b>📢 ${esc(a.title)}</b><div>${esc(a.body)}</div><small>${esc(a.expires_at||'Süresiz')}</small></div><div class="person-actions"><button onclick="editAnnouncement(${a.id})">DÜZENLE</button><button class="danger" onclick="deleteAnnouncement(${a.id})">SİL</button></div></div>`).join('')||'<div class="meta">Duyuru yok.</div>'}catch(e){toast(e.message)}}
async function editAnnouncement(id){try{const d=await api('/api/admin/announcements');const a=d.announcements.find(x=>x.id===id);if(!a)return;const r=await appDialog({title:'Duyuruyu Düzenle',confirmText:'KAYDET',fields:[{name:'title',label:'Başlık',type:'text',value:a.title||'',required:true},{name:'body',label:'Duyuru',type:'textarea',value:a.body||'',required:true},{name:'hours',label:'Yeni yayın süresi (saat)',type:'number',value:'24'}]});if(!r)return;const x=await api(`/api/admin/announcements/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)});toast(x.message);loadAdminAnnouncements();loadV4Home()}catch(e){toast(e.message)}}
async function deleteAnnouncement(id){if(!(await appConfirm('Duyuruyu Sil','Bu duyuru yayından tamamen kaldırılacak.','DUYURUYU SİL')))return;try{const x=await api(`/api/admin/announcements/${id}`,{method:'DELETE'});toast(x.message);loadAdminAnnouncements();loadV4Home()}catch(e){toast(e.message)}}

// V5.3 global mobile dismiss behavior
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("messageActionsModal")?.classList.contains("hidden"))closeMessageActions();if(!$("notificationsDrawer")?.classList.contains("hidden"))closeNotifications();if(!$("vehicleDetailModal")?.classList.contains("hidden"))closeVehicleDetail();}});let notifTouchY=null;document.addEventListener("touchstart",e=>{if(!$("notificationsDrawer")?.classList.contains("hidden"))notifTouchY=e.touches?.[0]?.clientY??null},{passive:true});document.addEventListener("touchend",e=>{if(notifTouchY==null)return;const y=e.changedTouches?.[0]?.clientY??notifTouchY;if(y-notifTouchY>90)closeNotifications();notifTouchY=null},{passive:true});

// =========================================================
// HAKKARI ROLL V5.6 → V5.10 — SESLİ ARAMA / MOBİL POLISH
// =========================================================
let voiceCall=null,voicePc=null,voiceLocalStream=null,voiceSignalAfter=0;
let voiceSignalTimer=null,voiceStateTimer=null,voiceWatcherTimer=null,voiceTimerInterval=null;
let voicePendingIce=[],voiceConfigCache=null,voiceLastNotifiedCallId=0,voiceWakeLock=null;
let voiceMuted=false,voiceRemoteMuted=false,voiceCleaning=false,voiceSignalBusy=false;

function voiceSupported(){return !!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia&&window.RTCPeerConnection)}
function voiceStatusText(status){return ({ringing:'Aranıyor…',accepted:'Bağlanıyor…',declined:'Arama reddedildi',missed:'Cevapsız arama',cancelled:'Arama iptal edildi',ended:'Arama sona erdi'}[status]||'Sesli arama')}
function voicePeer(){return voiceCall?.peer||null}
function voicePeerName(){const p=voicePeer();return p?.display_name||p?.username||'Hakkari Roll kullanıcısı'}
function voiceAvatarHtml(p){if(p?.profile_photo)return `<img src="/uploads/${encodeURIComponent(p.profile_photo)}" alt="">`;const s=(p?.display_name||p?.username||'HR').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();return esc(s||'HR')}
function voiceOpenOverlay(mode='outgoing'){
 if(!$('notificationsDrawer')?.classList.contains('hidden'))closeNotifications();
 const overlay=$('voiceCallOverlay');if(!overlay||!voiceCall)return;
 const p=voicePeer();$('voiceCallAvatar').innerHTML=voiceAvatarHtml(p);$('voiceCallName').textContent=voicePeerName();$('voiceCallHandle').textContent=p?.username?`@${p.username}`:'';
 $('voiceCallTimer').textContent='00:00';$('voiceIncomingActions').classList.toggle('hidden',mode!=='incoming');$('voiceActiveActions').classList.toggle('hidden',mode==='incoming');
 $('voiceCallStatus').textContent=mode==='incoming'?'Gelen sesli arama':voiceStatusText(voiceCall.status);
 overlay.classList.remove('hidden');document.documentElement.classList.add('voice-call-open');document.body.classList.add('voice-call-open');
 if(mode==='incoming'&&navigator.vibrate)try{navigator.vibrate([180,120,180,120,260])}catch(e){}
}
function voiceSetStatus(text){if($('voiceCallStatus'))$('voiceCallStatus').textContent=text||''}
function voiceSetAcceptedUi(){
 $('voiceIncomingActions')?.classList.add('hidden');$('voiceActiveActions')?.classList.remove('hidden');
 voiceSetStatus(voicePc?.connectionState==='connected'?'Bağlandı':'Bağlanıyor…');if(!voiceTimerInterval)voiceStartTimer();if(!voiceWakeLock)voiceAcquireWakeLock();
}
function voiceStartTimer(){
 clearInterval(voiceTimerInterval);const base=parseAppTime(voiceCall?.accepted_at)?.getTime()||Date.now();
 const tick=()=>{const sec=Math.max(0,Math.floor((Date.now()-base)/1000)),m=Math.floor(sec/60),s=sec%60;if($('voiceCallTimer'))$('voiceCallTimer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};tick();voiceTimerInterval=setInterval(tick,1000);
}
async function voiceAcquireWakeLock(){try{if('wakeLock'in navigator&&!voiceWakeLock)voiceWakeLock=await navigator.wakeLock.request('screen')}catch(e){}}
async function voiceReleaseWakeLock(){try{await voiceWakeLock?.release()}catch(e){}voiceWakeLock=null}
async function voiceGetConfig(){if(voiceConfigCache)return voiceConfigCache;try{voiceConfigCache=await api('/api/calls/config')}catch(e){voiceConfigCache={ice_servers:[{urls:'stun:stun.l.google.com:19302'}],turn_configured:false}}return voiceConfigCache}
async function voicePrepareMic(){
 if(!voiceSupported())throw new Error('Sesli arama için HTTPS ve mikrofon destekli güncel bir tarayıcı gerekli.');
 if(voiceLocalStream?.active)return voiceLocalStream;
 try{voiceLocalStream=await navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});return voiceLocalStream}
 catch(e){throw new Error(e?.name==='NotAllowedError'?'Mikrofon izni verilmedi. Sesli arama için mikrofon izni gerekli.':'Mikrofona erişilemedi.')}
}
async function voiceCreatePeer(){
 if(voicePc)return voicePc;const cfg=await voiceGetConfig();
 voicePc=new RTCPeerConnection({iceServers:cfg.ice_servers||[]});
 (voiceLocalStream?.getTracks()||[]).forEach(t=>voicePc.addTrack(t,voiceLocalStream));
 voicePc.onicecandidate=e=>{if(e.candidate&&voiceCall)voiceSendSignal('ice',e.candidate.toJSON?e.candidate.toJSON():e.candidate).catch(()=>{})};
 voicePc.ontrack=e=>{const a=$('voiceRemoteAudio');if(!a)return;const stream=e.streams?.[0]||new MediaStream([e.track]);a.srcObject=stream;a.muted=voiceRemoteMuted;a.play?.().catch(()=>{})};
 voicePc.onconnectionstatechange=()=>{const s=voicePc?.connectionState;if(s==='connected'){voiceSetStatus('Bağlandı');voiceSetAcceptedUi()}else if(s==='connecting')voiceSetStatus('Bağlanıyor…');else if(s==='failed'){voiceSetStatus('Bağlantı kurulamadı');setTimeout(()=>endVoiceCall(),600)}};
 return voicePc;
}
async function voiceSendSignal(type,payload){if(!voiceCall)return;await api(`/api/calls/${voiceCall.id}/signal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload})})}
async function voiceFlushIce(){if(!voicePc?.remoteDescription)return;const list=voicePendingIce.splice(0);for(const c of list){try{await voicePc.addIceCandidate(c)}catch(e){}}}
async function voiceHandleSignal(s){
 if(!voiceCall||!s)return;const pc=await voiceCreatePeer();
 try{
  if(s.type==='offer'){
   // Gelen çağrıda CEVAPLA basılmadan offer işlenmez ve answer üretilmez.
   if(voiceCall?.status!=='accepted'||voiceCall?.is_caller)return;
   if(!pc.remoteDescription){await pc.setRemoteDescription(s.payload);await voiceFlushIce();const ans=await pc.createAnswer();await pc.setLocalDescription(ans);await voiceSendSignal('answer',pc.localDescription.toJSON?pc.localDescription.toJSON():pc.localDescription)}
  }else if(s.type==='answer'){
   if(!pc.remoteDescription&&pc.signalingState==='have-local-offer'){await pc.setRemoteDescription(s.payload);await voiceFlushIce()}
  }else if(s.type==='ice'&&s.payload){if(pc.remoteDescription)await pc.addIceCandidate(s.payload);else voicePendingIce.push(s.payload)}
 }catch(e){console.warn('VOICE_SIGNAL_ERROR',s.type,e)}
}
async function voiceFetchSignals(){if(!voiceCall||voiceSignalBusy)return;voiceSignalBusy=true;try{const d=await api(`/api/calls/${voiceCall.id}/signals?after=${voiceSignalAfter}`);for(const s of d.signals||[]){voiceSignalAfter=Math.max(voiceSignalAfter,Number(s.id)||0);await voiceHandleSignal(s)}}catch(e){}finally{voiceSignalBusy=false}}
function voiceStartLoops(){clearInterval(voiceSignalTimer);clearInterval(voiceStateTimer);voiceSignalTimer=setInterval(voiceFetchSignals,700);voiceStateTimer=setInterval(voicePollState,1100);voiceFetchSignals();voicePollState()}
function voiceStartIncomingRingingLoop(){clearInterval(voiceSignalTimer);clearInterval(voiceStateTimer);voiceSignalTimer=null;voiceStateTimer=setInterval(voicePollState,850);voicePollState()}
async function voicePollState(){
 if(!voiceCall)return;try{const previousStatus=voiceCall.status,d=await api(`/api/calls/${voiceCall.id}`),c=d.call;if(!c)return;voiceCall={...voiceCall,...c,peer:c.peer||voiceCall.peer};
  if(c.status==='accepted'){voiceSetAcceptedUi();if(previousStatus!=='accepted'||!voiceSignalTimer)voiceStartLoops();else await voiceFetchSignals()}
  else if(c.status==='ringing'&&!voiceCall.is_caller){voiceSetStatus('Gelen sesli arama')}
  else if(['ended','declined','missed','cancelled'].includes(c.status)){voiceSetStatus(voiceStatusText(c.status));const msg=c.status==='declined'?'Arama reddedildi.':c.status==='missed'?'Arama cevaplanmadı.':c.status==='cancelled'?'Arama iptal edildi.':'';setTimeout(()=>voiceCleanup(msg),650)}
 }catch(e){}
}
async function startVoiceCallUser(userId){
 const uid=Number(userId)||0;if(!uid||uid===Number(me?.id))return toast('Kendini arayamazsın.');if(voiceCall)return toast('Zaten aktif bir araman var.');
 try{
  const permission=await api(`/api/calls/can/${uid}`);if(!permission.can_call)return toast(permission.reason||'Bu kullanıcıyı arayamazsın.');
  await voicePrepareMic();const d=await api('/api/calls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:uid})});voiceCall=d.call;voiceSignalAfter=0;voicePendingIce=[];voiceMuted=false;voiceRemoteMuted=false;voiceOpenOverlay('outgoing');
  const pc=await voiceCreatePeer(),offer=await pc.createOffer({offerToReceiveAudio:true});await pc.setLocalDescription(offer);await voiceSendSignal('offer',pc.localDescription.toJSON?pc.localDescription.toJSON():pc.localDescription);voiceStartLoops();
  const cfg=await voiceGetConfig();if(!cfg.turn_configured&&$('voiceCallHint'))$('voiceCallHint').textContent='Ses WebRTC ile cihazdan cihaza aktarılır. Bazı sıkı mobil ağlarda TURN sunucusu gerekebilir.';
 }catch(e){await voiceCleanup();toast(e.message||'Sesli arama başlatılamadı.')}
}
function startVoiceCallFromConversation(){const b=$('chatCallBtn'),uid=Number(b?.dataset.userId)||Number(conversationCache.find(x=>x.id===activeConversation)?.other?.id)||0;if(uid)startVoiceCallUser(uid);else toast('Aranacak kullanıcı bulunamadı.')}
async function acceptVoiceCall(){
 if(!voiceCall||voiceCall.status!=='ringing'||voiceCall.is_caller)return;
 try{await voicePrepareMic();const d=await api(`/api/calls/${voiceCall.id}/accept`,{method:'POST'});voiceCall=d.call;voiceSignalAfter=0;voicePendingIce=[];await voiceCreatePeer();voiceSetAcceptedUi();voiceStartLoops()}
 catch(e){toast(e.message||'Arama cevaplanamadı.');if(e.message?.includes('Mikrofon'))return;await voiceCleanup()}
}
async function declineVoiceCall(){if(!voiceCall)return;try{await api(`/api/calls/${voiceCall.id}/decline`,{method:'POST'})}catch(e){}await voiceCleanup()}
async function endVoiceCall(silent=false){if(!voiceCall){await voiceCleanup();return}try{await api(`/api/calls/${voiceCall.id}/end`,{method:'POST'})}catch(e){}await voiceCleanup(silent?'':null)}
async function voiceCleanup(message=null){
 if(voiceCleaning)return;voiceCleaning=true;clearInterval(voiceSignalTimer);clearInterval(voiceStateTimer);clearInterval(voiceTimerInterval);voiceSignalTimer=voiceStateTimer=voiceTimerInterval=null;
 try{voicePc?.close()}catch(e){}voicePc=null;try{voiceLocalStream?.getTracks().forEach(t=>t.stop())}catch(e){}voiceLocalStream=null;voicePendingIce=[];voiceSignalAfter=0;voiceSignalBusy=false;voiceMuted=false;voiceRemoteMuted=false;
 const a=$('voiceRemoteAudio');if(a){try{a.pause()}catch(e){}a.srcObject=null;a.muted=false}voiceCall=null;$('voiceCallOverlay')?.classList.add('hidden');document.documentElement.classList.remove('voice-call-open');document.body.classList.remove('voice-call-open');
 $('voiceMuteBtn')?.classList.remove('active');$('voiceAudioBtn')?.classList.remove('active');await voiceReleaseWakeLock();voiceCleaning=false;if(message)toast(message);
}
function toggleVoiceMute(){if(!voiceLocalStream)return;voiceMuted=!voiceMuted;voiceLocalStream.getAudioTracks().forEach(t=>t.enabled=!voiceMuted);$('voiceMuteBtn')?.classList.toggle('active',voiceMuted);voiceSetStatus(voiceMuted?'Mikrofon kapalı':(voicePc?.connectionState==='connected'?'Bağlandı':'Bağlanıyor…'))}
function toggleRemoteAudio(){voiceRemoteMuted=!voiceRemoteMuted;const a=$('voiceRemoteAudio');if(a)a.muted=voiceRemoteMuted;$('voiceAudioBtn')?.classList.toggle('active',voiceRemoteMuted)}
async function voicePollIncoming(){
 if(!token||!me||voiceCall||voiceCleaning)return;try{const d=await api('/api/calls/poll'),c=d.call;if(!c)return;
  // Sayfa yenilenmişse eski giden/kabul edilmiş WebRTC oturumu geri yüklenemez; hayalet arama bırakma.
  if(c.is_caller||c.status==='accepted'){try{await api(`/api/calls/${c.id}/end`,{method:'POST'})}catch(e){}if(c.status==='accepted')toast('Sayfa yenilendiği için önceki sesli arama kapatıldı.');return}
  voiceCall=c;voiceSignalAfter=0;voicePendingIce=[];
  if(c.status==='ringing'){voiceOpenOverlay('incoming');voiceStartIncomingRingingLoop();voiceNotifyIncoming(c)}
 }catch(e){}
}
function startVoiceCallWatcher(){if(voiceWatcherTimer||!token||!me)return;voicePollIncoming();voiceWatcherTimer=setInterval(voicePollIncoming,1500)}
function stopVoiceCallWatcher(){clearInterval(voiceWatcherTimer);voiceWatcherTimer=null}
async function voiceNotifyIncoming(c){
 if(!c||voiceLastNotifiedCallId===c.id)return;voiceLastNotifiedCallId=c.id;const name=c.peer?.display_name||c.peer?.username||'Bir kullanıcı';
 if(('Notification'in window)&&Notification.permission==='granted')await showAppSystemNotification('Gelen sesli arama',`${name} seni arıyor`,{tag:`hr-call-${c.id}`,requireInteraction:true,data:{kind:'call',call_id:c.id,url:'/'}});
}
async function showAppSystemNotification(title,body,extra={}){
 if(!('Notification'in window)||Notification.permission!=='granted')return false;try{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.ready;await reg.showNotification(title,{body,icon:'/static/icons/icon.svg',badge:'/static/icons/icon.svg',...extra});return true}new Notification(title,{body,...extra});return true}catch(e){return false}
}
async function enableAppNotifications(){
 if(!('Notification'in window)){toast('Bu tarayıcı sistem bildirimlerini desteklemiyor.');return}
 try{const p=await Notification.requestPermission();refreshNotificationPermissionUI();if(p==='granted')toast('Bildirim izni açıldı.');else if(p==='denied')toast('Bildirim izni tarayıcı ayarlarından kapalı.');else toast('Bildirim izni verilmedi.')}catch(e){toast('Bildirim izni açılamadı.')}
}
function refreshNotificationPermissionUI(){const b=$('enableNotifBtn');if(!b)return;if(!('Notification'in window)){b.textContent='BİLDİRİM DESTEKLENMİYOR';b.disabled=true;return}const p=Notification.permission;b.disabled=p==='granted';b.textContent=p==='granted'?'✓ BİLDİRİMLER AÇIK':p==='denied'?'⚠ İZİN KAPALI':'🔔 BİLDİRİM İZNİ'}
async function openVoiceCallNotification(id){closeNotifications();try{const d=await api(`/api/calls/${Number(id)||0}`),c=d.call;if(c&&['ringing','accepted'].includes(c.status)){if(!voiceCall){voiceCall=c;voiceSignalAfter=0;voicePendingIce=[];voiceOpenOverlay(c.is_caller?'outgoing':'incoming');if(!c.is_caller&&c.status==='ringing')voiceStartIncomingRingingLoop();else voiceStartLoops()}return}showPage('messagesPage');loadConversations();toast('Bu arama sona ermiş.')}catch(e){showPage('messagesPage');loadConversations();toast('Arama artık aktif değil.')}}
const _v610OpenNotificationTarget=openNotificationTarget;
openNotificationTarget=async function(type,id){if(type==='call')return openVoiceCallNotification(id);return _v610OpenNotificationTarget(type,id)};
const _v610NotificationIcon=notificationIcon;
notificationIcon=function(type){return ({call:'📞',vehicle:'🚘',event:'📍',crew:'👥'}[type]||_v610NotificationIcon(type))};

// Profil / arama / sohbet UI son dokunuşları.
const _v610OpenProfile=openProfile;
openProfile=async function(id){const r=await _v610OpenProfile(id);const box=$('profileBox');if(box&&Number(id)!==Number(me?.id)&&!box.querySelector('.v610-profile-call')){/* Arama düğmesi profil API'sindeki can_call kuralına göre ana renderer tarafından oluşturulur. */}return r};

// Bildirim merkezi açıldığında izin durumunu güncelle ve her şartta en üst katmanda tut.
const _v610OpenNotifications=openNotifications;
openNotifications=async function(){document.querySelectorAll('.modal:not(.hidden)').forEach(m=>{if(m.id!=='notificationsDrawer'&&m.id!=='voiceCallOverlay')m.classList.add('hidden')});const r=await _v610OpenNotifications();refreshNotificationPermissionUI();return r};

// Service Worker bildirim tıklaması / PWA geri dönüşü.
navigator.serviceWorker?.addEventListener?.('message',e=>{if(e.data?.type==='HR_NOTIFICATION_CLICK'&&e.data?.kind==='call')voicePollIncoming()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me){voicePollIncoming();if(voiceCall?.status==='accepted')voiceAcquireWakeLock()}});
window.addEventListener('pagehide',()=>{if(voiceCall&&token){try{fetch(`/api/calls/${voiceCall.id}/end`,{method:'POST',headers:{Authorization:`Bearer ${token}`},keepalive:true})}catch(e){}}});
window.addEventListener('load',()=>{if(me&&token){startVoiceCallWatcher();refreshNotificationPermissionUI()}});
