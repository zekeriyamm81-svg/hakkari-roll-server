# Hakkari Roll V5

Hakkâri'deki otomobil topluluğu için mobil öncelikli sosyal platform. Dijital garaj, paylaşım akışı, hikâyeler, Roll Radar, etkinlikler, ekipler, mesajlaşma ve moderasyon tek PWA içinde çalışır.

## V5 ile gelen temel iyileştirmeler

- Süreli, `HttpOnly` + `SameSite=Strict` cookie oturumları; veritabanında düz token yerine SHA-256 token özeti
- IP + kullanıcı bazlı giriş denemesi sınırlaması
- Yönetici onay modunun uçtan uca doğru çalışması
- E-posta adresinin yalnızca hesap sahibine ve yönetim ekranına gösterilmesi
- Dosya uzantısına ek olarak gerçek medya imzası doğrulaması
- Üretimde varsayılan admin parolası ve pepper ile başlamayı reddeden güvenli yapılandırma
- Güvenlik başlıkları, veritabanını kontrol eden `/health` yanıtı ve 413 JSON hatası
- Telefonlarda sabit beşli alt navigasyon, klavye odak stilleri ve azaltılmış hareket desteği
- Süresi dolan oturumun arayüzde otomatik temizlenmesi
- Yerel marka rozetleri ve daha sağlam çevrimdışı PWA önbelleği
- Kritik kimlik doğrulama ve gizlilik senaryoları için otomatik API testleri

## Hızlı başlangıç

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:HAKKARI_ROLL_ADMIN_PASSWORD="yerel-uzun-bir-parola"
$env:HAKKARI_ROLL_PEPPER="yerel-en-az-32-karakter-rastgele-deger"
python hakkari_roll_server.py
```

Uygulama varsayılan olarak `http://127.0.0.1:5000` adresinde açılır. Tüm ortam değişkenleri için `.env.example`, Railway adımları için `KURULUM.txt` dosyasına bak.

## Test

```powershell
python -m unittest discover -s tests -v
```

Test paketi onaylı kayıt akışını, oturum süresini, token saklamayı, e-posta gizliliğini, giriş hız sınırını, sahte medya engelini ve güvenlik başlıklarını kapsar.

## Mimari notlar

- Sunucu: Flask + Gunicorn
- Veri: SQLite (WAL modu)
- Arayüz: bağımlılıksız HTML/CSS/JavaScript PWA
- Kalıcı medya: yerel `uploads/` veya Railway Volume
- E-posta: Resend API

SQLite ve yerel medya mevcut ölçek için sade ve düşük maliyetlidir. Daha büyük kullanımda bir sonraki mimari adım PostgreSQL, nesne depolama, arka plan işleri ve WebSocket tabanlı gerçek zamanlı mesajlaşmadır.

## Üretim kontrol listesi

1. `HAKKARI_ROLL_ENV=production` ayarla.
2. Güçlü ve benzersiz `HAKKARI_ROLL_ADMIN_PASSWORD` ile `HAKKARI_ROLL_PEPPER` kullan.
3. Railway proxy arkasında `HAKKARI_ROLL_TRUST_PROXY=1` ayarla.
4. `/data` Volume'u hem DB hem uploads yollarına bağla.
5. Resend alan adını doğrula; `RESEND_API_KEY` ve `RESEND_FROM` ekle.
6. Deploy sonrası `/health` ve kayıt/onay/e-posta doğrulama akışlarını kontrol et.
